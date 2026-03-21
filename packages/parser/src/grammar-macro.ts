/**
 * Tagged template macro for PEG grammar definitions.
 *
 * Registers a `grammar` tagged template macro with @typesugar/core.
 * Phase 1: emits a runtime call to `parseGrammarDef` + `buildParser`.
 * Phase 2: generates inline recursive-descent parser code at compile time
 *          (zero-cost — no runtime grammar interpretation).
 */

import * as ts from "typescript";
import {
  type TaggedTemplateMacroDef,
  type MacroContext,
  defineTaggedTemplateMacro,
  globalRegistry,
} from "@typesugar/core";
import type { Grammar } from "./types.js";
import { parseGrammarDef, buildParser } from "./grammar.js";
import { generateParserCode, resetVarCounter } from "./codegen.js";

/**
 * The `grammar` tagged template macro definition.
 *
 * Usage:
 * ```ts
 * import { grammar } from "@typesugar/parser";
 *
 * const json = grammar`
 *   value   = string | number | object | array | "true" | "false" | "null"
 *   string  = '"' (!'"' .)* '"'
 *   number  = '-'? '0'..'9'+ ('.' '0'..'9'+)?
 *   object  = '{' pair (',' pair)* '}'
 *   pair    = string ':' value
 *   array   = '[' value (',' value)* ']'
 * `;
 * ```
 *
 * Phase 2: generates inlined recursive-descent parser code at compile time.
 * Falls back to runtime grammar parsing when template has interpolations.
 */
export const grammarMacro: TaggedTemplateMacroDef = defineTaggedTemplateMacro({
  name: "grammar",
  module: "@typesugar/parser",
  description: "Define a PEG grammar and generate a parser",
  expand(ctx: MacroContext, node: ts.TaggedTemplateExpression): ts.Expression {
    const { factory } = ctx;
    const template = node.template;

    // Extract the raw grammar text from the template
    let grammarText: string;
    let hasInterpolations = false;
    if (ts.isNoSubstitutionTemplateLiteral(template)) {
      grammarText = template.text;
    } else {
      // For templates with interpolations, fall back to runtime.
      hasInterpolations = true;
      grammarText = template.head.text;
      for (const span of template.templateSpans) {
        grammarText += "???" + span.literal.text;
      }
      ctx.reportWarning(
        node,
        "grammar template interpolation is not yet supported; " + "falling back to runtime parser"
      );
    }

    // Validate/parse the grammar at compile time
    let rules: Map<string, import("./types.js").GrammarRule>;
    try {
      rules = parseGrammarDef(grammarText);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      ctx.reportError(node, `Invalid grammar: ${msg}`);
      return node;
    }

    // If there are interpolations, fall back to runtime
    if (hasInterpolations) {
      return factory.createCallExpression(
        factory.createPropertyAccessExpression(
          factory.createIdentifier("__typesugar_parser"),
          factory.createIdentifier("grammar")
        ),
        undefined,
        [factory.createNoSubstitutionTemplateLiteral(grammarText, grammarText)]
      );
    }

    // Phase 2: generate inline recursive-descent parser code
    resetVarCounter();
    const code = generateParserCode(rules);
    return ctx.parseExpression(code);
  },
  validate(ctx: MacroContext, node: ts.TaggedTemplateExpression): boolean {
    const template = node.template;
    let grammarText: string;
    if (ts.isNoSubstitutionTemplateLiteral(template)) {
      grammarText = template.text;
    } else {
      grammarText = template.head.text;
      for (const span of template.templateSpans) {
        grammarText += span.literal.text;
      }
    }

    try {
      parseGrammarDef(grammarText);
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      ctx.reportError(node, `Invalid grammar: ${msg}`);
      return false;
    }
  },
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the grammar macro with the global registry. */
export function register(): void {
  globalRegistry.register(grammarMacro);
}

// Auto-register on import
register();

// ---------------------------------------------------------------------------
// Runtime fallback
// ---------------------------------------------------------------------------

/**
 * Runtime `grammar` tagged template function.
 *
 * This is the runtime fallback used when the compile-time macro is not active
 * (e.g., in tests, REPL, or when the transformer is not configured).
 *
 * @param strings - Template literal string parts
 * @param exprs - Template literal interpolated expressions (currently unused)
 * @returns A Grammar that can parse input strings
 */
export function grammar(strings: TemplateStringsArray, ...exprs: unknown[]): Grammar<unknown> {
  const source = strings.join("");
  const rules = parseGrammarDef(source);
  return buildParser(rules);
}
