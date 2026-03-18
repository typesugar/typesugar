/**
 * Browser Bundle Entry Point
 *
 * This file is the entry point for the browser bundle (ESM).
 * It re-exports everything from the main index and ensures all
 * dependencies are bundled together for browser use.
 */

import "./browser-shims/process-global.js";

// Import @typesugar/macros to register all built-in macros with globalRegistry
// This is a side-effect import - the macros register themselves on import
import "@typesugar/macros";

// Import @typesugar/std macros to register match(), let:/yield:, par:/yield:
import "@typesugar/std/macros";

import {
  registerTypeRewrite,
  registerStandaloneExtensionEntry,
  globalRegistry,
  defineTaggedTemplateMacro,
  type MacroContext,
} from "@typesugar/core";
import * as ts from "typescript";

// ---------------------------------------------------------------------------
// Pre-register @opaque type rewrites for standard library types.
// Normally these are discovered when the transformer processes the interface
// declaration files, but the playground only processes the user's code.
// ---------------------------------------------------------------------------

const optionMethods = [
  "map",
  "flatMap",
  "fold",
  "match",
  "getOrElse",
  "getOrElseStrict",
  "getOrThrow",
  "orElse",
  "filter",
  "filterNot",
  "exists",
  "forall",
  "contains",
  "tap",
  "toArray",
  "toNullable",
  "toUndefined",
  "zip",
];
registerTypeRewrite({
  typeName: "Option",
  underlyingTypeText: "A | null",
  sourceModule: "@typesugar/fp",
  methods: new Map(optionMethods.map((m) => [m, m])),
  constructors: new Map([
    ["Some", { kind: "identity" }],
    ["None", { kind: "constant", value: "null" }],
  ]),
  transparent: true,
});

// ---------------------------------------------------------------------------
// Pre-register extension methods for built-in types.
// The transformer uses these to rewrite e.g. (42).clamp(0, 100) → clamp(42, 0, 100).
// ---------------------------------------------------------------------------

const numberExtensions = [
  "clamp",
  "isEven",
  "isOdd",
  "isPrime",
  "toHex",
  "toRoman",
  "abs",
  "sign",
  "to",
  "until",
];
const stringExtensions = [
  "capitalize",
  "kebabCase",
  "camelCase",
  "pascalCase",
  "snakeCase",
  "reverse",
  "isPalindrome",
  "isBlank",
  "words",
  "truncate",
];
for (const m of numberExtensions)
  registerStandaloneExtensionEntry({ methodName: m, forType: "number" });
for (const m of stringExtensions)
  registerStandaloneExtensionEntry({ methodName: m, forType: "string" });

// ---------------------------------------------------------------------------
// Register stateMachine tagged template macro (inline DSL parser).
// The full @typesugar/graph is not bundled in the transform bundle, so we
// inline the lightweight text parser here.
// ---------------------------------------------------------------------------

interface ParsedStateMachine {
  states: string[];
  transitions: Array<{ from: string; event: string; to: string }>;
  initial: string;
  terminal?: string[];
}

function parseStateMachineDSL(source: string): ParsedStateMachine | null {
  const transitions: Array<{ from: string; event: string; to: string }> = [];
  let initial: string | undefined;
  let terminal: string[] | undefined;

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    if (line.startsWith("@initial")) {
      initial = line.slice("@initial".length).trim();
      continue;
    }
    if (line.startsWith("@terminal")) {
      terminal = line
        .slice("@terminal".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }

    const m = line.match(/^(\S+)\s+--(\S+)-->\s+(\S+)$/);
    if (!m) continue;
    transitions.push({ from: m[1], event: m[2], to: m[3] });
  }

  if (transitions.length === 0) return null;

  const stateSet = new Set<string>();
  for (const t of transitions) {
    stateSet.add(t.from);
    stateSet.add(t.to);
  }
  const states = [...stateSet];

  return {
    states,
    transitions,
    initial: initial ?? transitions[0].from,
    terminal,
  };
}

globalRegistry.register(
  defineTaggedTemplateMacro({
    name: "stateMachine",
    module: "@typesugar/graph",
    description: "Define and verify state machines at compile time",
    expand(ctx: MacroContext, node: ts.TaggedTemplateExpression): ts.Expression {
      const template = node.template;
      let raw: string;
      const tsLib = ctx.factory as unknown as typeof import("typescript");
      if ("isNoSubstitutionTemplateLiteral" in tsLib) {
        const tsCheck = tsLib as unknown as {
          isNoSubstitutionTemplateLiteral(n: unknown): boolean;
        };
        if (tsCheck.isNoSubstitutionTemplateLiteral(template)) {
          raw = (template as unknown as { text: string }).text;
        } else {
          const tpl = template as unknown as {
            head: { text: string };
            templateSpans: Array<{ literal: { text: string } }>;
          };
          raw = tpl.head.text + tpl.templateSpans.map((s) => s.literal.text).join("");
        }
      } else {
        raw = (template as unknown as { text: string }).text ?? "";
      }
      const parsed = parseStateMachineDSL(raw);
      if (!parsed) {
        ctx.reportError(node, "stateMachine: failed to parse DSL");
        return node;
      }
      const f = ctx.factory;
      return f.createObjectLiteralExpression(
        [
          f.createPropertyAssignment(
            "states",
            f.createArrayLiteralExpression(parsed.states.map((s) => f.createStringLiteral(s)))
          ),
          f.createPropertyAssignment("initial", f.createStringLiteral(parsed.initial)),
          f.createPropertyAssignment(
            "terminal",
            f.createArrayLiteralExpression(
              (parsed.terminal || []).map((s) => f.createStringLiteral(s))
            )
          ),
          f.createPropertyAssignment(
            "transitions",
            f.createArrayLiteralExpression(
              parsed.transitions.map((t) =>
                f.createObjectLiteralExpression([
                  f.createPropertyAssignment("from", f.createStringLiteral(t.from)),
                  f.createPropertyAssignment("event", f.createStringLiteral(t.event)),
                  f.createPropertyAssignment("to", f.createStringLiteral(t.to)),
                ])
              )
            )
          ),
        ],
        true
      );
    },
  })
);

export * from "./index.js";

export { ts };

export const VERSION = "0.1.0";

export function isReady(): boolean {
  return typeof globalThis !== "undefined";
}
