/**
 * @typesugar/fusion — Expression templates and loop fusion
 *
 * Iterator and array operations with single-pass fusion.
 * Chains like `.filter().map().reduce()` execute in one pass
 * with no intermediate array allocations.
 *
 * **Current Status (Phase 1):** Runtime fusion via LazyPipeline class.
 * Single-pass iteration is achieved, but the pipeline object exists at runtime.
 *
 * **Future (Phase 2):** Compile-time fusion will eliminate the pipeline class
 * entirely, compiling to hand-optimized for-loops.
 *
 * @example
 * ```typescript
 * import { lazy, range, vec, dot } from "@typesugar/fusion";
 *
 * // Single-pass fusion — no intermediate arrays
 * const result = lazy([1, 2, 3, 4, 5])
 *   .filter(x => x % 2 === 0)
 *   .map(x => x * 10)
 *   .toArray(); // [20, 40]
 *
 * // Numeric range with early termination
 * const first5Squares = range(1, Infinity)
 *   .map(x => x * x)
 *   .take(5)
 *   .toArray(); // [1, 4, 9, 16, 25]
 *
 * // Element-wise vector arithmetic
 * const a = vec([1, 2, 3]);
 * const b = vec([4, 5, 6]);
 * const d = dot(a, b); // 32
 * ```
 */

export { LazyPipeline } from "./lazy.js";
export { lazy, range, iterate, repeat, generate } from "./lazy-entry.js";

export type { PipelineStep, FusedVec } from "./types.js";

export {
  vec,
  vecOf,
  add,
  sub,
  mul,
  div,
  scale,
  dot,
  magnitude,
  normalize,
  mapVec,
  zipVec,
  toArray,
} from "./vec.js";

export { lazyMacro, fusedMacro, register } from "./macros.js";

import { register } from "./macros.js";
register();
