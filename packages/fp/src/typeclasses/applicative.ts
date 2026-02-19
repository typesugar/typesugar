/**
 * Apply and Applicative Typeclasses
 *
 * Apply extends Functor with the ability to apply a function in a context.
 * Applicative extends Apply with the ability to lift a value into a context.
 *
 * Laws:
 *   - Identity: pure(id).ap(v) === v
 *   - Homomorphism: pure(f).ap(pure(x)) === pure(f(x))
 *   - Interchange: u.ap(pure(y)) === pure(f => f(y)).ap(u)
 *   - Composition: pure(compose).ap(u).ap(v).ap(w) === u.ap(v.ap(w))
 */

import type { Functor } from "./functor.js";
import type { $ } from "../hkt.js";

// ============================================================================
// Apply
// ============================================================================

/**
 * Apply typeclass - extends Functor with application
 */
export interface Apply<F> extends Functor<F> {
  readonly ap: <A, B>(fab: $<F, (a: A) => B>, fa: $<F, A>) => $<F, B>;
}

// ============================================================================
// Applicative
// ============================================================================

/**
 * Applicative typeclass - extends Apply with pure
 */
export interface Applicative<F> extends Apply<F> {
  readonly pure: <A>(a: A) => $<F, A>;
}

// ============================================================================
// Derived Operations from Apply
// ============================================================================

/**
 * Apply two functorial values and combine with a function
 */
export function map2<F>(
  F: Apply<F>,
): <A, B, C>(fa: $<F, A>, fb: $<F, B>, f: (a: A, b: B) => C) => $<F, C> {
  return <A, B, C>(fa: $<F, A>, fb: $<F, B>, f: (a: A, b: B) => C): $<F, C> =>
    F.ap(
      F.map(fa, (a: A) => (b: B) => f(a, b)),
      fb,
    );
}

/**
 * Apply three functorial values and combine with a function
 */
export function map3<F>(
  F: Apply<F>,
): <A, B, C, D>(
  fa: $<F, A>,
  fb: $<F, B>,
  fc: $<F, C>,
  f: (a: A, b: B, c: C) => D,
) => $<F, D> {
  return <A, B, C, D>(
    fa: $<F, A>,
    fb: $<F, B>,
    fc: $<F, C>,
    f: (a: A, b: B, c: C) => D,
  ): $<F, D> => {
    const partialF = map2(F)(fa, fb, (a: A, b: B) => (c: C) => f(a, b, c));
    return F.ap(partialF, fc);
  };
}

/**
 * Apply four functorial values and combine with a function
 */
export function map4<F>(
  F: Apply<F>,
): <A, B, C, D, E>(
  fa: $<F, A>,
  fb: $<F, B>,
  fc: $<F, C>,
  fd: $<F, D>,
  f: (a: A, b: B, c: C, d: D) => E,
) => $<F, E> {
  return <A, B, C, D, E>(
    fa: $<F, A>,
    fb: $<F, B>,
    fc: $<F, C>,
    fd: $<F, D>,
    f: (a: A, b: B, c: C, d: D) => E,
  ): $<F, E> => {
    const partialF = map3(F)(
      fa,
      fb,
      fc,
      (a: A, b: B, c: C) => (d: D) => f(a, b, c, d),
    );
    return F.ap(partialF, fd);
  };
}

/**
 * Tuple two functorial values
 */
export function tuple2<F>(
  F: Apply<F>,
): <A, B>(fa: $<F, A>, fb: $<F, B>) => $<F, [A, B]> {
  return (fa, fb) => map2(F)(fa, fb, (a, b) => [a, b]);
}

/**
 * Tuple three functorial values
 */
export function tuple3<F>(
  F: Apply<F>,
): <A, B, C>(fa: $<F, A>, fb: $<F, B>, fc: $<F, C>) => $<F, [A, B, C]> {
  return (fa, fb, fc) => map3(F)(fa, fb, fc, (a, b, c) => [a, b, c]);
}

/**
 * Sequence two actions, keeping only the left value
 */
export function productL<F>(
  F: Apply<F>,
): <A, B>(fa: $<F, A>, fb: $<F, B>) => $<F, A> {
  return (fa, fb) => map2(F)(fa, fb, (a, _) => a);
}

/**
 * Sequence two actions, keeping only the right value
 */
export function productR<F>(
  F: Apply<F>,
): <A, B>(fa: $<F, A>, fb: $<F, B>) => $<F, B> {
  return (fa, fb) => map2(F)(fa, fb, (_, b) => b);
}

// ============================================================================
// Derived Operations from Applicative
// ============================================================================

/**
 * Lift a value into the applicative context
 */
export function unit<F>(F: Applicative<F>): $<F, void> {
  return F.pure(undefined);
}

/**
 * Perform an action when a condition is true
 */
export function when<F>(
  F: Applicative<F>,
): (condition: boolean, action: $<F, void>) => $<F, void> {
  return (condition, action) => (condition ? action : unit(F));
}

/**
 * Perform an action unless a condition is true
 */
export function unless<F>(
  F: Applicative<F>,
): (condition: boolean, action: $<F, void>) => $<F, void> {
  return (condition, action) => when(F)(!condition, action);
}

/**
 * Replicate an action n times and collect results
 */
export function replicateA<F>(
  F: Applicative<F>,
): <A>(n: number, fa: $<F, A>) => $<F, A[]> {
  return <A>(n: number, fa: $<F, A>): $<F, A[]> => {
    if (n <= 0) return F.pure([] as A[]);
    const result: $<F, A[]> = F.map(fa, (a: A) => [a]);
    let acc = result;
    for (let i = 1; i < n; i++) {
      acc = map2(F)(acc, fa, (arr: A[], a: A) => [...arr, a]);
    }
    return acc;
  };
}

// ============================================================================
// Instance Creators
// ============================================================================

/**
 * Create an Apply instance
 */
export function makeApply<F>(
  map: <A, B>(fa: $<F, A>, f: (a: A) => B) => $<F, B>,
  ap: <A, B>(fab: $<F, (a: A) => B>, fa: $<F, A>) => $<F, B>,
): Apply<F> {
  return { map, ap };
}

/**
 * Create an Applicative instance
 */
export function makeApplicative<F>(
  map: <A, B>(fa: $<F, A>, f: (a: A) => B) => $<F, B>,
  ap: <A, B>(fab: $<F, (a: A) => B>, fa: $<F, A>) => $<F, B>,
  pure: <A>(a: A) => $<F, A>,
): Applicative<F> {
  return { map, ap, pure };
}
