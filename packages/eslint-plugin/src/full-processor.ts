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
 *
 * The text ESLint passes to `preprocess` is what gets transformed — an
 * unsaved editor buffer or stdin input, not whatever is on disk — via a
 * read-file overlay on the pipeline's compiler host.
 *
 * Autofixes are remapped and kept only when they provably edit identical
 * original text (mapping.ts); fixes inside or across macro-expanded code are
 * dropped rather than applied at a wrong offset.
 */

import type { Linter } from "eslint";
import * as path from "node:path";
import * as ts from "typescript";
import { createPipeline, type TransformationPipeline } from "@typesugar/transformer/pipeline";
import { assertSupportedTypeScript } from "@typesugar/transformer";
import {
  isTypesugarUnusedImportError,
  mapMessages,
  stripBom,
  type MappingState,
} from "./mapping.js";
import { PLUGIN_VERSION } from "./version.js";

// ---------------------------------------------------------------------------
// Pipeline management
// ---------------------------------------------------------------------------

let pipeline: TransformationPipeline | null = null;

/**
 * Text ESLint handed us that differs from the file on disk (unsaved editor
 * buffers, stdin), keyed by normalized path. The pipeline reads through this
 * overlay, so the BUFFER is linted, not the file on disk.
 */
const bufferOverlay = new Map<string, string>();

function overlayKey(fileName: string): string {
  return path.normalize(path.resolve(fileName));
}

function getPipeline(): TransformationPipeline | null {
  if (!pipeline) {
    try {
      const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json");
      if (configPath) {
        pipeline = createPipeline(configPath, {
          verbose: false,
          readFile: (f) => bufferOverlay.get(overlayKey(f)) ?? ts.sys.readFile(f),
          fileExists: (f) => bufferOverlay.has(overlayKey(f)) || ts.sys.fileExists(f),
        });
      }
    } catch (e) {
      console.warn("[typesugar-eslint] Could not create pipeline:", e);
    }
  }
  return pipeline;
}

// ---------------------------------------------------------------------------
// Per-file state for postprocess
// ---------------------------------------------------------------------------

// Removed by postprocess, so a long-lived ESLint process doesn't retain
// every file it has linted.
const fileStates = new Map<string, MappingState>();

/**
 * Create the full processor that uses the actual typesugar transformer
 */
export function createFullProcessor(): Linter.Processor {
  // PEP-060 item 1: see createProcessor. Memoized.
  assertSupportedTypeScript(ts);
  return {
    meta: {
      name: "typesugar-full",
      version: PLUGIN_VERSION,
    },

    supportsAutofix: true,

    preprocess(text: string, filename: string): Array<string | { text: string; filename: string }> {
      // Process TypeScript files
      const isTypeScript = /\.(ts|tsx)$/.test(filename);
      if (!isTypeScript) {
        return [text];
      }

      const source = stripBom(text);
      const p = getPipeline();
      if (p) {
        try {
          const key = overlayKey(filename);
          const onDisk = ts.sys.readFile(filename);
          const previous = bufferOverlay.has(key) ? bufferOverlay.get(key) : onDisk;
          // Only buffers that differ from disk are kept in the overlay, so a
          // plain `eslint .` run holds no extra copies of the project.
          if (source === onDisk) bufferOverlay.delete(key);
          else bufferOverlay.set(key, source);
          if (previous !== source) {
            // The pipeline's program holds the text it last read for this
            // file; drop it so the text being linted now is what's transformed.
            p.invalidate(filename);
          }
          const result = p.transform(filename);

          if (result.original !== undefined && result.original !== source) {
            // The pipeline transformed something other than the text being
            // linted; linting its output would report on the wrong code.
            console.warn(
              `[typesugar-eslint] ${filename}: transformer did not see the buffer being linted; linting it untransformed`
            );
            return [text];
          }

          fileStates.set(filename, {
            originalSource: source,
            transformedSource: result.code,
            toOriginal: (offset) => result.mapper.toOriginal(offset),
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
      fileStates.delete(filename);
      if (!state) {
        return messages.flat();
      }

      return mapMessages(messages.flat(), state).filter(
        (message) => !isTypesugarUnusedImportError(message, state.originalSource)
      );
    },
  };
}

/**
 * Clear the transform cache (delegates to pipeline.invalidateAll())
 */
export function clearTransformCache(): void {
  fileStates.clear();
  bufferOverlay.clear();
  if (pipeline) {
    pipeline.invalidateAll();
  }
}
