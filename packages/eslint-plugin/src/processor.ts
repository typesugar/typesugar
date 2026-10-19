/**
 * ESLint Processor for typesugar (Lightweight)
 *
 * This processor runs the HKT type-reference rewriter (`F<A>` -> `Kind<F, A>`)
 * and comments out macro-only syntax (macro decorators, `requires:` /
 * `ensures:` contract blocks) before ESLint lints the file.
 *
 * How it works:
 * 1. preprocess(): HKT rewriter (MagicString source map), then an AST pass
 *    that locates macro decorators and contract blocks and wraps them in
 *    comments via an exact edit list (no regex over code: nested braces,
 *    object keys named `ensures`, and strings containing `@derive(` are
 *    handled correctly).
 * 2. ESLint lints the transformed code (no false positives from macro syntax).
 * 3. postprocess(): maps locations back through both stages, and keeps an
 *    autofix only when it provably edits identical original text (see
 *    mapping.ts) — so `eslint --fix` never corrupts a file.
 *
 * This is the same approach used by eslint-plugin-svelte and eslint-plugin-vue.
 */

import type { Linter } from "eslint";
import * as ts from "typescript";
import {
  rewriteHKTTypeReferences,
  hasHKTPatterns,
  assertSupportedTypeScript,
} from "@typesugar/transformer";
import { createPositionMapper } from "@typesugar/transformer/position-mapper";
import {
  applyEdits,
  isTypesugarUnusedImportError,
  mapMessages,
  stripBom,
  type MappingState,
  type TextEdit,
} from "./mapping.js";
import { PLUGIN_VERSION } from "./version.js";

/** Decorators that only exist for the macro transformer. */
const MACRO_DECORATORS = new Set([
  "derive",
  "deriving",
  "typeclass",
  "instance",
  "operators",
  "contract",
  "invariant",
  "reflect",
]);

/** Contract-block labels (`requires: { ... }`, `ensures: { ... }`). */
const CONTRACT_LABELS = new Set(["requires", "ensures"]);

/**
 * Edits that wrap `[start, end)` of `text` in a block comment: insert "/* "
 * and " *\/" around it and neutralise any "*\/" inside, as separate edits so
 * every original character keeps an exact position.
 */
function commentOutEdits(text: string, start: number, end: number): TextEdit[] {
  const edits: TextEdit[] = [{ start, end: start, text: "/* " }];
  let i = text.indexOf("*/", start);
  while (i !== -1 && i + 2 <= end) {
    edits.push({ start: i, end: i + 2, text: "* /" });
    i = text.indexOf("*/", i + 2);
  }
  edits.push({ start: end, end, text: " */" });
  return edits;
}

function isMacroDecorator(d: ts.Decorator): boolean {
  const e = d.expression;
  if (ts.isIdentifier(e)) return MACRO_DECORATORS.has(e.text);
  return ts.isCallExpression(e) && ts.isIdentifier(e.expression)
    ? MACRO_DECORATORS.has(e.expression.text)
    : false;
}

/** Locate macro-only syntax with the TypeScript parser (no type checker). */
function collectMacroSyntaxEdits(fileName: string, text: string): TextEdit[] {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const edits: TextEdit[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isDecorator(node) && isMacroDecorator(node)) {
      edits.push(...commentOutEdits(text, node.getStart(sf), node.getEnd()));
      return;
    }
    if (
      ts.isLabeledStatement(node) &&
      CONTRACT_LABELS.has(node.label.text) &&
      ts.isBlock(node.statement)
    ) {
      edits.push(...commentOutEdits(text, node.getStart(sf), node.getEnd()));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return edits;
}

interface TransformResult {
  code: string;
  toOriginal: (offset: number) => number | null;
}

/**
 * Run preprocessing on source code:
 * 1. HKT rewriter rewrites `F<A>` -> `Kind<F, A>` for type parameters
 * 2. Macro decorators and contract blocks are commented out
 */
function transformSource(fileName: string, source: string): TransformResult {
  try {
    const hkt = hasHKTPatterns(source)
      ? rewriteHKTTypeReferences(source, fileName)
      : { code: source, map: null };
    const stage1 = hkt.code;
    const stage1Mapper = createPositionMapper(hkt.map, source, stage1);

    const { output, toInput } = applyEdits(stage1, collectMacroSyntaxEdits(fileName, stage1));
    return {
      code: output,
      toOriginal: (offset) => {
        const s1 = toInput(offset);
        return stage1 === source ? s1 : stage1Mapper.toOriginal(s1);
      },
    };
  } catch (error) {
    console.warn(`[typesugar-eslint] Transform failed for ${fileName}:`, error);
    return { code: source, toOriginal: (o) => o };
  }
}

function usesTypesugar(text: string): boolean {
  return (
    text.includes("@derive") ||
    text.includes("@deriving") ||
    text.includes("@typeclass") ||
    text.includes("@instance") ||
    text.includes("@contract") ||
    text.includes("@invariant") ||
    text.includes("comptime(") ||
    text.includes("requires:") ||
    text.includes("ensures:") ||
    text.includes("@operators") ||
    text.includes("@reflect") ||
    hasHKTPatterns(text) // HKT type-parameter syntax (F<A>)
  );
}

/**
 * Create the ESLint processor
 */
export function createProcessor(): Linter.Processor {
  // PEP-060 item 1: reject TypeScript 7 (no JS compiler API) with one clear
  // message when the plugin loads, not on the first file. Memoized.
  assertSupportedTypeScript(ts);
  // Per-file state between preprocess and postprocess. Each entry is removed
  // when its postprocess runs, so a long-lived ESLint process (editor
  // integration, `--cache` runs) doesn't retain every file it has linted.
  const fileStates = new Map<string, MappingState>();

  return {
    meta: {
      name: "typesugar",
      version: PLUGIN_VERSION,
    },

    // Fixes are remapped to original offsets and kept only when provably
    // safe (mapping.ts), so autofix is supported.
    supportsAutofix: true,

    preprocess(text: string, filename: string): Array<string | { text: string; filename: string }> {
      if (!filename.endsWith(".ts") && !filename.endsWith(".tsx")) {
        return [text];
      }

      // ESLint parses — and applies fixes to — the BOM-less text.
      const source = stripBom(text);
      if (!usesTypesugar(source)) {
        fileStates.set(filename, {
          originalSource: source,
          transformedSource: source,
          toOriginal: (o) => o,
        });
        return [text];
      }

      const { code, toOriginal } = transformSource(filename, source);
      fileStates.set(filename, {
        originalSource: source,
        transformedSource: code,
        toOriginal,
      });
      return [code];
    },

    postprocess(messages: Linter.LintMessage[][], filename: string): Linter.LintMessage[] {
      const state = fileStates.get(filename);
      fileStates.delete(filename);
      if (!state) {
        return messages.flat();
      }

      const flat = messages
        .flat()
        // An unused-import report on a line the transform inserted (the HKT
        // rewriter's `Kind` import) has no original line to check against.
        .filter((m) => !isTypesugarUnusedImportError(m, state.transformedSource));
      return mapMessages(flat, state).filter(
        (m) => !isTypesugarUnusedImportError(m, state.originalSource)
      );
    },
  };
}
