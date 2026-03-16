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

export {
  transform,
  preprocessCode,
  preprocessOnly,
  preprocess,
  clearCache,
  getCacheStats,
  type TransformResult,
  type TransformDiagnostic,
  type BrowserTransformOptions,
  type PreprocessResult,
  type RawSourceMap,
} from "./browser-transform.js";

export { BrowserTransformCache, LRUCache, hashContent } from "./cache.js";
