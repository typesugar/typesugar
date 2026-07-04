/**
 * @typesugar/playground - Browser-compatible typesugar bundle
 *
 * This package provides the typesugar transformation pipeline in a form
 * suitable for running in web browsers. It's used by the interactive
 * playground on the documentation site.
 *
 * @example
 * ```typescript
 * import { transform } from "@typesugar/playground";
 *
 * // Transform TypeScript code with macros
 * const result = transform(`
 *   import { staticAssert } from "typesugar";
 *   staticAssert(1 + 1 === 2);
 * `);
 *
 * console.log(result.code);
 * ```
 *
 * @packageDocumentation
 */

import { type RawSourceMap } from "@typesugar/core";
import { transformCode, type TransformDiagnostic } from "@typesugar/transformer-core";
import { BrowserTransformCache, hashContent } from "./cache.js";

// PEP-052 Wave 6 Phase D: this bundle's `transformCode` call runs against
// browser-typed input with no real module resolution (no filesystem, no
// node_modules) — exactly the host `registerSyntaxMarkerFallback` exists for.
// Neither std's nor fp's compile-time registration ever runs otherwise: this
// package never imports `@typesugar/std/macros`/`@typesugar/fp` for anything
// but runtime VALUES (see `runtime-entry.ts`, a separate iframe-sandbox
// bundle), so without these side-effect imports here, a playground snippet
// importing e.g. `@typesugar/std/syntax/eq/ops` could never activate Eq
// operator syntax — the checker can't resolve the module, and no fallback
// entry would exist to catch it.
import "@typesugar/std/macros";
import "@typesugar/fp";

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

export { BrowserTransformCache, LRUCache, hashContent } from "./cache.js";
export { type RawSourceMap };
export { type TransformDiagnostic };
