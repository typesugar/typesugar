/**
 * Activation marker (PEP-052) — import this module to activate do-notation
 * LABEL syntax (`let:`/`seq:`/`par:`/`all:`) in the importing file AND bring
 * the Effect `FlatMap`/`ParCombine` instances into scope for it:
 *
 * ```ts
 * import "@typesugar/effect/syntax/do";
 * ```
 *
 * One import covers both halves of the gate: the `@syntax-labels` tags below
 * activate the labels (this module carries its own tags — the marker reader
 * does not follow re-exports), and the re-exported instances satisfy the
 * scope-based instance resolution (Wave 3). The std builtin instances
 * (Array/Promise/Iterable/AsyncIterable) are re-exported too, so mixed
 * Effect + Promise files need only this one marker.
 *
 * @syntax-labels letYield
 * @syntax-labels parYield
 */
export const __typesugar_syntax_labels_effect_do = true;

export { flatMapEffect, parCombineEffect } from "../index.js";
export {
  flatMapArray,
  flatMapPromise,
  flatMapIterable,
  flatMapAsyncIterable,
  parCombinePromise,
  parCombineArray,
  parCombineIterable,
  parCombineAsyncIterable,
} from "@typesugar/std/syntax/do";
