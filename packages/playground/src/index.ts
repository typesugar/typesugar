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
 * // Preprocess HKT type syntax (F<_> -> Kind<F, A>)
 * const { code } = preprocess(`
 *   interface Functor<F<_>> { map<A, B>(fa: F<A>, f: (a: A) => B): F<B>; }
 * `);
 * ```
 *
 * @packageDocumentation
 */

import { preprocess, type RawSourceMap, type PreprocessResult } from "@typesugar/preprocessor";
import { transformCode, type TransformDiagnostic } from "@typesugar/transformer-core";
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

export function preprocessCode(
  code: string,
  options: { fileName?: string } = {}
): PreprocessResult {
  const fileName = options.fileName ?? "input.ts";
  return preprocess(code, { fileName });
}

/**
 * Transform TypeScript/JavaScript code with typesugar macro expansion.
 *
 * This function handles HKT preprocessing and macro expansion.
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

  try {
    const result = transformCode(code, {
      fileName,
      verbose,
    });

    const finalSourceMap = result.sourceMap;

    const cacheEntry = {
      code: result.code,
      sourceMap: finalSourceMap ? JSON.stringify(finalSourceMap) : null,
      changed: result.changed,
      diagnostics: result.diagnostics,
    };
    cache.set(fileName, contentHash, cacheEntry);

    return {
      original: code,
      code: result.code,
      sourceMap: finalSourceMap,
      changed: result.changed,
      diagnostics: result.diagnostics,
      preprocessed: false,
    };
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
