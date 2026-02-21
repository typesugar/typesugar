/**
 * ESLint Processor for typesugar (Lightweight)
 *
 * This processor runs the typesugar preprocessor (HKT, operators) and
 * ESLint-specific regex heuristics (commenting out decorators and labeled blocks)
 * before ESLint lints the file.
 *
 * It uses the preprocessor's source map for accurate position mapping via
 * PositionMapper from @typesugar/transformer.
 *
 * How it works:
 * 1. preprocess(): Runs preprocessor for custom syntax, then regex heuristics
 *    for ESLint-specific concerns (decorators, labeled blocks)
 * 2. ESLint lints the transformed code (no false positives from macro syntax)
 * 3. postprocess(): Maps lint messages back to original source locations
 *
 * This is the same approach used by eslint-plugin-svelte and eslint-plugin-vue.
 */

import type { Linter } from "eslint";
import { preprocess as preprocessCustomSyntax } from "@typesugar/preprocessor";
import { createPositionMapper, type PositionMapper } from "@typesugar/transformer/position-mapper";

/** typesugar package prefixes for import detection */
const TYPESUGAR_PACKAGE_PREFIXES = [
  "typesugar",
  "@typesugar/",
  "typemacro", // legacy name
  "@typemacro/", // legacy name
  "ttfx", // legacy name
  "@ttfx/", // legacy name
];

/**
 * Check if a lint message is about an unused import from a typesugar package.
 */
function isTypesugarUnusedImportError(message: Linter.LintMessage, source: string): boolean {
  const unusedImportRules = [
    "no-unused-vars",
    "@typescript-eslint/no-unused-vars",
    "import/no-unused-modules",
    "unused-imports/no-unused-imports",
    "unused-imports/no-unused-vars",
  ];

  if (!unusedImportRules.includes(message.ruleId ?? "")) {
    return false;
  }

  if (message.line === undefined) {
    return false;
  }

  const lines = source.split("\n");
  const errorLine = lines[message.line - 1] ?? "";

  const importMatch = errorLine.match(/from\s+["']([^"']+)["']/);
  if (!importMatch) {
    return false;
  }

  const modulePath = importMatch[1];
  return TYPESUGAR_PACKAGE_PREFIXES.some(
    (prefix) => modulePath === prefix.replace(/\/$/, "") || modulePath.startsWith(prefix)
  );
}

// ---------------------------------------------------------------------------
// Line/column <-> offset helpers (ESLint uses 1-based line, 1-based column)
// ---------------------------------------------------------------------------

function lineColToOffset(source: string, line: number, column: number): number {
  let currentLine = 1;
  let offset = 0;

  while (currentLine < line && offset < source.length) {
    if (source[offset] === "\n") {
      currentLine++;
    }
    offset++;
  }

  return offset + (column - 1);
}

function offsetToLineCol(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastLineStart = 0;

  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      lastLineStart = i + 1;
    }
  }

  return { line, column: offset - lastLineStart + 1 };
}

// ---------------------------------------------------------------------------
// Source transformation
// ---------------------------------------------------------------------------

interface TransformResult {
  code: string;
  mapper: PositionMapper;
}

/**
 * Run preprocessing and ESLint-specific heuristics on source code.
 *
 * 1. Preprocessor handles custom syntax (F<_> HKT, |>, ::)
 * 2. Regex heuristics comment out decorators and labeled blocks that would
 *    cause ESLint false positives
 */
function transformSource(fileName: string, source: string): TransformResult {
  try {
    const preprocessResult = preprocessCustomSyntax(source, { fileName });
    let transformed = preprocessResult.code;
    const sourceMap = preprocessResult.map;

    // ESLint-specific heuristics: comment out macro decorators
    const decoratorPattern =
      /@(derive|deriving|typeclass|instance|operators|contract|invariant|reflect)\s*\([^)]*\)/g;
    transformed = transformed.replace(decoratorPattern, (match) => {
      return `/* ${match} */`;
    });

    // ESLint-specific heuristics: comment out labeled blocks (requires:/ensures:)
    const labeledBlockPattern = /(requires|ensures)\s*:\s*\{[\s\S]*?\n\s*\}/g;
    transformed = transformed.replace(labeledBlockPattern, (match) => {
      return `/* ${match.replace(/\*\//g, "* /")} */`;
    });

    const mapper = createPositionMapper(sourceMap, source, transformed);
    return { code: transformed, mapper };
  } catch (error) {
    console.warn(`[typesugar-eslint] Transform failed for ${fileName}:`, error);
    return {
      code: source,
      mapper: createPositionMapper(null, source, source),
    };
  }
}

// ---------------------------------------------------------------------------
// Per-file state for postprocess
// ---------------------------------------------------------------------------

interface FileState {
  originalSource: string;
  mapper: PositionMapper;
}

const fileStates = new Map<string, FileState>();

/**
 * Create the ESLint processor
 */
export function createProcessor(): Linter.Processor {
  return {
    meta: {
      name: "typesugar",
      version: "0.1.0",
    },

    supportsAutofix: true,

    preprocess(text: string, filename: string): Array<string | { text: string; filename: string }> {
      if (!filename.endsWith(".ts") && !filename.endsWith(".tsx")) {
        return [text];
      }

      const usesTypesugar =
        text.includes("@derive") ||
        text.includes("@typeclass") ||
        text.includes("@instance") ||
        text.includes("@contract") ||
        text.includes("@invariant") ||
        text.includes("comptime(") ||
        text.includes("requires:") ||
        text.includes("ensures:") ||
        text.includes("@operators") ||
        text.includes("@reflect") ||
        text.includes("<_>") || // HKT syntax
        text.includes("|>") || // Pipeline operator
        /[)\]}\w]\s*::\s*[(\[{A-Za-z_$]/.test(text); // Cons operator

      if (!usesTypesugar) {
        fileStates.set(filename, {
          originalSource: text,
          mapper: createPositionMapper(null, text, text),
        });
        return [text];
      }

      const { code, mapper } = transformSource(filename, text);

      fileStates.set(filename, {
        originalSource: text,
        mapper,
      });

      return [code];
    },

    postprocess(messages: Linter.LintMessage[][], filename: string): Linter.LintMessage[] {
      const state = fileStates.get(filename);
      if (!state) {
        return messages.flat();
      }

      return messages
        .flat()
        .filter((message) => !isTypesugarUnusedImportError(message, state.originalSource))
        .map((message) => {
          if (message.line !== undefined && message.column !== undefined) {
            const offset = lineColToOffset(state.originalSource, message.line, message.column);
            const originalOffset = state.mapper.toOriginal(offset);

            if (originalOffset !== null) {
              const mapped = offsetToLineCol(state.originalSource, originalOffset);
              const result = { ...message, line: mapped.line, column: mapped.column };

              if (message.endLine !== undefined && message.endColumn !== undefined) {
                const endOffset = lineColToOffset(
                  state.originalSource,
                  message.endLine,
                  message.endColumn
                );
                const originalEndOffset = state.mapper.toOriginal(endOffset);
                if (originalEndOffset !== null) {
                  const mappedEnd = offsetToLineCol(state.originalSource, originalEndOffset);
                  result.endLine = mappedEnd.line;
                  result.endColumn = mappedEnd.column;
                }
              }

              return result;
            }
          }
          return message;
        });
    },
  };
}
