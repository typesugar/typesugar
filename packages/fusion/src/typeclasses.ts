/**
 * Typeclass instances for LazyPipeline
 *
 * Provides Functor, Filterable, and Foldable instances for the LazyPipeline type,
 * enabling integration with the @typesugar typeclass system.
 *
 * ## @op Annotations
 *
 * - `Functor<LazyPipelineF>` — `.map()` method
 * - `Filterable<LazyPipelineF>` — `.filter()` method
 * - `Foldable<LazyPipelineF>` — `.reduce()` method
 *
 * ## Usage with specialize
 *
 * ```typescript
 * import { lazyPipelineFunctor } from "@typesugar/fusion";
 * import { lift } from "@typesugar/fp/typeclasses/functor";
 *
 * const liftLazy = specialize(lift, lazyPipelineFunctor);
 * ```
 */

import { LazyPipeline } from "./lazy.js";
import { lazy } from "./lazy-entry.js";
import { registerInstanceWithMeta } from "@typesugar/macros";

// ============================================================================
// Functor<LazyPipeline>
// ============================================================================

/**
 * Functor instance for LazyPipeline.
 *
 * Maps a function over every element in the pipeline.
 *
 * @op map — Functor.map dispatches to LazyPipeline.map
 */
export interface FunctorLazyPipeline {
  /** @op map */
  readonly map: <A, B>(fa: LazyPipeline<A>, f: (a: A) => B) => LazyPipeline<B>;
}

export const lazyPipelineFunctor: FunctorLazyPipeline = {
  map: <A, B>(fa: LazyPipeline<A>, f: (a: A) => B): LazyPipeline<B> => fa.map(f),
};
registerInstanceWithMeta({
  typeclassName: "Functor",
  forType: "LazyPipeline",
  instanceName: "lazyPipelineFunctor",
  derived: false,
  sourceModule: "@typesugar/fusion",
});

// ============================================================================
// Filterable<LazyPipeline>
// ============================================================================

/**
 * Filterable typeclass — types that support element filtering.
 *
 * Not present in the standard fp typeclasses, so we define it here
 * for fusion-specific use.
 */
export interface FilterableLazyPipeline {
  readonly filter: <A>(fa: LazyPipeline<A>, predicate: (a: A) => boolean) => LazyPipeline<A>;
}

export const lazyPipelineFilterable: FilterableLazyPipeline = {
  filter: <A>(fa: LazyPipeline<A>, predicate: (a: A) => boolean): LazyPipeline<A> =>
    fa.filter(predicate),
};
registerInstanceWithMeta({
  typeclassName: "Filterable",
  forType: "LazyPipeline",
  instanceName: "lazyPipelineFilterable",
  derived: false,
  sourceModule: "@typesugar/fusion",
});

// ============================================================================
// Foldable<LazyPipeline>
// ============================================================================

/**
 * Foldable instance for LazyPipeline.
 *
 * Provides left and right folds over the pipeline elements.
 */
export interface FoldableLazyPipeline {
  readonly foldLeft: <A, B>(fa: LazyPipeline<A>, b: B, f: (b: B, a: A) => B) => B;
  readonly foldRight: <A, B>(fa: LazyPipeline<A>, b: B, f: (a: A, b: B) => B) => B;
}

export const lazyPipelineFoldable: FoldableLazyPipeline = {
  foldLeft: <A, B>(fa: LazyPipeline<A>, b: B, f: (b: B, a: A) => B): B => fa.reduce(f, b),
  foldRight: <A, B>(fa: LazyPipeline<A>, b: B, f: (a: A, b: B) => B): B => {
    // Collect to array then fold right-to-left
    const arr = fa.toArray();
    let acc = b;
    for (let i = arr.length - 1; i >= 0; i--) {
      acc = f(arr[i], acc);
    }
    return acc;
  },
};
registerInstanceWithMeta({
  typeclassName: "Foldable",
  forType: "LazyPipeline",
  instanceName: "lazyPipelineFoldable",
  derived: false,
  sourceModule: "@typesugar/fusion",
});

// ============================================================================
// Convenience combinators
// ============================================================================

/**
 * Lift a function to work on LazyPipeline values using the Functor instance.
 */
export function liftLazy<A, B>(f: (a: A) => B): (fa: LazyPipeline<A>) => LazyPipeline<B> {
  return (fa) => lazyPipelineFunctor.map(fa, f);
}

/**
 * Map + filter in one pass, using both typeclass instances.
 */
export function filterMap<A, B>(
  fa: LazyPipeline<A>,
  f: (a: A) => B,
  predicate: (b: B) => boolean
): LazyPipeline<B> {
  return lazyPipelineFilterable.filter(lazyPipelineFunctor.map(fa, f), predicate);
}

/**
 * Fold a LazyPipeline using the Foldable instance.
 */
export function foldLazy<A, B>(fa: LazyPipeline<A>, init: B, f: (b: B, a: A) => B): B {
  return lazyPipelineFoldable.foldLeft(fa, init, f);
}
