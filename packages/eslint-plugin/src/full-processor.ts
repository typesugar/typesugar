/**
 * Full ESLint Processor for typesugar
 *
 * This processor runs the ACTUAL typesugar macro transformer via the unified
 * TransformationPipeline. It produces properly transformed output with
 * accurate source mappings via PositionMapper.
 *
 * Requirements:
 * - TypeScript must be available
 * - typesugar transformer must be built
 *
 * Trade-offs vs the lightweight processor:
 * - More accurate (real macro expansion)
 * - Better source mapping (offset-based via PositionMapper)
 * - Slower (full TS compilation)
 * - Higher memory usage
 */

import type { Linter } from "eslint";
import * as ts from "typescript";
import { createPipeline, type TransformationPipeline } from "@typesugar/transformer/pipeline";
import type { PositionMapper } from "@typesugar/transformer/position-mapper";

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
// Pipeline management
// ---------------------------------------------------------------------------

let pipeline: TransformationPipeline | null = null;

function getPipeline(): TransformationPipeline | null {
  if (!pipeline) {
    try {
      const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json");
      if (configPath) {
        pipeline = createPipeline(configPath, { verbose: false });
      }
    } catch (e) {
      console.warn("[typesugar-eslint] Could not create pipeline:", e);
    }
  }
  return pipeline;
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

  // column is 1-based in ESLint
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
// Per-file state for postprocess
// ---------------------------------------------------------------------------

interface FileState {
  originalSource: string;
  transformedSource: string;
  mapper: PositionMapper;
}

const fileStates = new Map<string, FileState>();

/**
 * Create the full processor that uses the actual typesugar transformer
 */
export function createFullProcessor(): Linter.Processor {
  return {
    meta: {
      name: "typesugar-full",
      version: "0.1.0",
    },

    supportsAutofix: true,

    preprocess(text: string, filename: string): Array<string | { text: string; filename: string }> {
      if (!filename.endsWith(".ts") && !filename.endsWith(".tsx")) {
        return [text];
      }

      const p = getPipeline();
      if (p) {
        try {
          const result = p.transform(filename);

          fileStates.set(filename, {
            originalSource: text,
            transformedSource: result.code,
            mapper: result.mapper,
          });

          return [result.code];
        } catch (e) {
          console.warn(`[typesugar-eslint] Transform failed for ${filename}:`, e);
        }
      }

      // Fallback: return original
      return [text];
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
            const offset = lineColToOffset(state.transformedSource, message.line, message.column);
            const originalOffset = state.mapper.toOriginal(offset);

            if (originalOffset !== null) {
              const mapped = offsetToLineCol(state.originalSource, originalOffset);
              const result = { ...message, line: mapped.line, column: mapped.column };

              if (message.endLine !== undefined && message.endColumn !== undefined) {
                const endOffset = lineColToOffset(
                  state.transformedSource,
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

/**
 * Clear the transform cache (delegates to pipeline.invalidateAll())
 */
export function clearTransformCache(): void {
  fileStates.clear();
  if (pipeline) {
    pipeline.invalidateAll();
  }
}
