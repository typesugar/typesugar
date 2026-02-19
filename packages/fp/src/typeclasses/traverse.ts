/**
 * Traverse Typeclass
 *
 * Traverse extends Functor and Foldable with the ability to traverse
 * a structure while accumulating effects.
 *
 * Laws:
 *   - Identity: traverse(F)(fa, G.pure) === G.pure(fa)
 *   - Composition: traverse(F)(fa, Compose(G, H).of . f) === G.map(traverse(F)(fa, f), traverse(F)(_, g))
 *   - Naturality: t(traverse(F)(fa, f)) === traverse(F)(fa, t . f) for any applicative transformation t
 */

import type { Applicative } from "./applicative.js";
import type { Functor } from "./functor.js";
import type { Foldable } from "./foldable.js";
import type { $ } from "../hkt.js";

// ============================================================================
// Traverse
// ============================================================================

/**
 * Traverse typeclass
 */
export interface Traverse<F> extends Functor<F>, Foldable<F> {
  readonly traverse: <G>(
    G: Applicative<G>,
  ) => <A, B>(fa: $<F, A>, f: (a: A) => $<G, B>) => $<G, $<F, B>>;
}

// ============================================================================
// Derived Operations
// ============================================================================

/**
 * Sequence a structure of effects into an effect of structure
 */
export function sequence<F>(
  F: Traverse<F>,
): <G>(G: Applicative<G>) => <A>(fga: $<F, $<G, A>>) => $<G, $<F, A>> {
  return (G) => (fga) => F.traverse(G)(fga, (x) => x);
}

/**
 * Traverse with an effectful function that can fail (returning undefined)
 */
export function traverseFilter<F>(
  F: Traverse<F>,
): <G>(
  G: Applicative<G>,
) => <A, B>(fa: $<F, A>, f: (a: A) => $<G, B | undefined>) => $<G, $<F, B>> {
  return <G>(G: Applicative<G>) =>
    <A, B>(fa: $<F, A>, f: (a: A) => $<G, B | undefined>): $<G, $<F, B>> =>
      F.traverse(G)(fa, (a: A) =>
        G.map(f(a), (b: B | undefined) => (b !== undefined ? [b] : [])),
      ) as unknown as $<G, $<F, B>>;
}

/**
 * Traverse with index
 */
export function traverseWithIndex<F>(
  F: Traverse<F>,
): <G>(
  G: Applicative<G>,
) => <A, B>(fa: $<F, A>, f: (i: number, a: A) => $<G, B>) => $<G, $<F, B>> {
  return (G) => (fa, f) => {
    let index = 0;
    return F.traverse(G)(fa, (a) => f(index++, a));
  };
}

/**
 * Map each element to an action, evaluate actions left-to-right,
 * and ignore the results
 */
export function traverse_<F>(
  F: Traverse<F>,
): <G>(
  G: Applicative<G>,
) => <A, B>(fa: $<F, A>, f: (a: A) => $<G, B>) => $<G, void> {
  return (G) => (fa, f) => G.map(F.traverse(G)(fa, f), () => undefined);
}

/**
 * Evaluate effects in structure left-to-right and ignore the results
 */
export function sequence_<F>(
  F: Traverse<F>,
): <G>(G: Applicative<G>) => <A>(fga: $<F, $<G, A>>) => $<G, void> {
  return (G) => (fga) => traverse_(F)(G)(fga, (x) => x);
}

import type { MonoidK } from "./alternative.js";

/**
 * Traverse with an effectful function that returns a nested structure,
 * then flatten the inner layer using MonoidK.
 *
 * This is the proper implementation that correctly combines all inner structures.
 *
 * @example
 * ```typescript
 * // For List[Option[Int]], flatten using optionMonoidK
 * const result = flatTraverseK(listTraverse, optionMonoidK)(optionApplicative)(
 *   list,
 *   (a) => optionApplicative.pure(someList(a))
 * );
 * ```
 */
export function flatTraverseK<F>(
  F: Traverse<F>,
  MK: MonoidK<F>,
): <G>(
  G: Applicative<G>,
) => <A, B>(fa: $<F, A>, f: (a: A) => $<G, $<F, B>>) => $<G, $<F, B>> {
  return <G>(G: Applicative<G>) =>
    <A, B>(fa: $<F, A>, f: (a: A) => $<G, $<F, B>>): $<G, $<F, B>> =>
      G.map(F.traverse(G)(fa, f), (nested: $<F, $<F, B>>) => {
        // Properly flatten using MonoidK: fold over nested, combining each inner F<B>
        return F.foldLeft<$<F, B>, $<F, B>>(nested, MK.emptyK<B>(), (acc, fb) =>
          MK.combineK(acc, fb),
        );
      });
}

/**
 * Traverse with an effectful function that returns a nested structure,
 * then flatten the inner layer.
 *
 * @deprecated Use `flatTraverseK` with an explicit MonoidK parameter instead.
 * This version throws an error to prevent silent incorrect behavior.
 */
export function flatTraverse<F>(
  F: Traverse<F>,
): <G>(
  G: Applicative<G>,
) => <A, B>(fa: $<F, A>, f: (a: A) => $<G, $<F, B>>) => $<G, $<F, B>> {
  return (_G) => (_fa, _f) => {
    throw new Error(
      "flatTraverse requires a MonoidK instance to properly flatten nested structures. " +
        "Use flatTraverseK(F, MK)(G)(fa, f) instead, passing the MonoidK explicitly.",
    );
  };
}

// ============================================================================
// Instance Creator
// ============================================================================

/**
 * Create a Traverse instance
 */
export function makeTraverse<F>(
  map: <A, B>(fa: $<F, A>, f: (a: A) => B) => $<F, B>,
  foldLeft: <A, B>(fa: $<F, A>, b: B, f: (b: B, a: A) => B) => B,
  foldRight: <A, B>(fa: $<F, A>, b: B, f: (a: A, b: B) => B) => B,
  traverse: <G>(
    G: Applicative<G>,
  ) => <A, B>(fa: $<F, A>, f: (a: A) => $<G, B>) => $<G, $<F, B>>,
): Traverse<F> {
  return { map, foldLeft, foldRight, traverse };
}
