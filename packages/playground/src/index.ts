/**
 * @typesugar/playground - Browser-compatible typesugar bundle
 *
 * This package provides the typesugar transformation pipeline in a form
 * suitable for running in web browsers. It's used by the interactive
 * playground on the documentation site.
 *
 * @example
 * ```typescript
 * import { transform, preprocess } from "@typesugar/playground";
 *
 * // Transform TypeScript code with macros
 * const result = transform(`
 *   import { staticAssert } from "typesugar";
 *   staticAssert(1 + 1 === 2);
 * `);
 *
 * console.log(result.code);
 *
 * // Preprocess .sts code (custom syntax)
 * const { code } = preprocess(`
 *   const result = x |> f |> g;
 * `);
 * ```
 *
 * @packageDocumentation
 */

import { preprocess, type RawSourceMap, type PreprocessResult } from "@typesugar/preprocessor";
import {
  transformCode,
  type TransformDiagnostic,
  composeSourceMaps,
} from "@typesugar/transformer-core";
import { BrowserTransformCache, hashContent } from "./cache.js";

export interface TransformResult {
  original: string;
  code: string;
  sourceMap: RawSourceMap | null;
  changed: boolean;
  diagnostics: TransformDiagnostic[];
  preprocessed?: boolean;
}

export interface BrowserTransformOptions {
  fileName?: string;
  verbose?: boolean;
  cacheSize?: number;
}

let transformCache: BrowserTransformCache | null = null;

function getCache(maxSize: number = 100): BrowserTransformCache {
  if (!transformCache) {
    transformCache = new BrowserTransformCache(maxSize);
  }
  return transformCache;
}

export function clearCache(): void {
  transformCache?.clear();
}

export function getCacheStats(): string {
  return transformCache?.getStatsString() ?? "Cache not initialized";
}

function isSugaredTypeScriptFile(fileName: string): boolean {
  return /\.stsx?$/i.test(fileName);
}

export function preprocessCode(
  code: string,
  options: { fileName?: string } = {}
): PreprocessResult {
  const fileName = options.fileName ?? "input.sts";
  return preprocess(code, { fileName });
}

/**
 * Transform TypeScript/JavaScript code with typesugar macro expansion.
 *
 * This function handles both preprocessing (for .sts files) and macro expansion.
 * It uses the transformer-core package for the actual macro transformation.
 */
export function transform(code: string, options: BrowserTransformOptions = {}): TransformResult {
  const fileName = options.fileName ?? "input.ts";
  const verbose = options.verbose ?? false;
  const cache = getCache(options.cacheSize);
  const contentHash = hashContent(code);

  const cached = cache.get(fileName, contentHash);
  if (cached) {
    if (verbose) {
      console.log(`[playground] Cache hit for ${fileName}`);
    }
    return {
      original: code,
      code: cached.code,
      sourceMap: cached.sourceMap ? JSON.parse(cached.sourceMap) : null,
      changed: cached.changed,
      diagnostics: cached.diagnostics,
    };
  }

  let preprocessedCode = code;
  let preprocessMap: RawSourceMap | null = null;
  let wasPreprocessed = false;

  if (isSugaredTypeScriptFile(fileName)) {
    try {
      const result = preprocess(code, { fileName });
      if (result.changed) {
        preprocessedCode = result.code;
        preprocessMap = result.map;
        wasPreprocessed = true;
        if (verbose) {
          console.log(`[playground] Preprocessed ${fileName}`);
        }
      }
    } catch (e) {
      return {
        original: code,
        code,
        sourceMap: null,
        changed: false,
        diagnostics: [
          {
            file: fileName,
            start: 0,
            length: 0,
            message: `Preprocessing failed: ${e}`,
            severity: "error",
          },
        ],
      };
    }
  }

  try {
    const transformFileName = isSugaredTypeScriptFile(fileName)
      ? fileName.replace(/\.sts(x?)$/i, ".ts$1")
      : fileName;

    const result = transformCode(preprocessedCode, {
      fileName: transformFileName,
      verbose,
    });

    const finalSourceMap = composeSourceMaps(preprocessMap, result.sourceMap);

    const cacheEntry = {
      code: result.code,
      sourceMap: finalSourceMap ? JSON.stringify(finalSourceMap) : null,
      changed: result.changed || wasPreprocessed,
      diagnostics: result.diagnostics,
    };
    cache.set(fileName, contentHash, cacheEntry);

    return {
      original: code,
      code: result.code,
      sourceMap: finalSourceMap,
      changed: result.changed || wasPreprocessed,
      diagnostics: result.diagnostics,
      preprocessed: wasPreprocessed,
    };
  } catch (e) {
    return {
      original: code,
      code: preprocessedCode,
      sourceMap: preprocessMap,
      changed: wasPreprocessed,
      diagnostics: [
        {
          file: fileName,
          start: 0,
          length: 0,
          message: `Transform failed: ${e}`,
          severity: "error",
        },
      ],
    };
  }
}

export const preprocessOnly = preprocessCode;

export { BrowserTransformCache, LRUCache, hashContent } from "./cache.js";
export { preprocess, type PreprocessResult, type RawSourceMap };
export { type TransformDiagnostic };
