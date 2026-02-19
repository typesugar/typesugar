/**
 * FlatMap and Monad Typeclasses
 *
 * FlatMap adds flatMap (bind) to Apply - sequencing dependent computations.
 * Monad combines FlatMap with Applicative.
 *
 * Laws:
 *   - Left identity: pure(a).flatMap(f) === f(a)
 *   - Right identity: m.flatMap(pure) === m
 *   - Associativity: m.flatMap(f).flatMap(g) === m.flatMap(a => f(a).flatMap(g))
 */

import type { Applicative, Apply, map2 } from "./applicative.js";
import type { $ } from "../hkt.js";

// ============================================================================
// FlatMap
// ============================================================================

/**
 * FlatMap typeclass - adds flatMap to Apply
 */
export interface FlatMap<F> extends Apply<F> {
  readonly flatMap: <A, B>(fa: $<F, A>, f: (a: A) => $<F, B>) => $<F, B>;
}

// ============================================================================
// Monad
// ============================================================================

/**
 * Monad typeclass - combines FlatMap with Applicative
 */
export interface Monad<F> extends FlatMap<F>, Applicative<F> {}

// ============================================================================
// Derived Operations from FlatMap
// ============================================================================

/**
 * Flatten a nested structure
 */
export function flatten<F>(F: FlatMap<F>): <A>(ffa: $<F, $<F, A>>) => $<F, A> {
  return (ffa) => F.flatMap(ffa, (x) => x);
}

/**
 * Map then flatten
 */
export function flatTap<F>(
  F: FlatMap<F>,
): <A, B>(fa: $<F, A>, f: (a: A) => $<F, B>) => $<F, A> {
  return (fa, f) => F.flatMap(fa, (a) => F.map(f(a), () => a));
}

/**
 * Conditional flatMap - apply f only if predicate holds
 */
export function ifM<F>(
  F: FlatMap<F>,
): <A>(
  fb: $<F, boolean>,
  ifTrue: () => $<F, A>,
  ifFalse: () => $<F, A>,
) => $<F, A> {
  return (fb, ifTrue, ifFalse) =>
    F.flatMap(fb, (b) => (b ? ifTrue() : ifFalse()));
}

/**
 * Filter the monadic value based on a predicate
 */
export function mfilter<F extends FlatMap<F>>(
  F: FlatMap<F>,
  empty: $<F, never>,
): <A>(fa: $<F, A>, p: (a: A) => boolean) => $<F, A> {
  return (fa, p) => F.flatMap(fa, (a) => (p(a) ? F.map(fa, () => a) : empty));
}

/**
 * Kleisli composition (>=>) - compose two monadic functions
 */
export function andThen<F>(
  F: FlatMap<F>,
): <A, B, C>(f: (a: A) => $<F, B>, g: (b: B) => $<F, C>) => (a: A) => $<F, C> {
  return (f, g) => (a) => F.flatMap(f(a), g);
}

/**
 * Kleisli composition (<=<) - compose two monadic functions (reversed)
 */
export function compose<F>(
  F: FlatMap<F>,
): <B, C, A>(g: (b: B) => $<F, C>, f: (a: A) => $<F, B>) => (a: A) => $<F, C> {
  return (g, f) => (a) => F.flatMap(f(a), g);
}

// ============================================================================
// Derived Operations from Monad
// ============================================================================

/**
 * Perform an action repeatedly, collecting results while predicate holds
 */
export function whileM<F>(
  F: Monad<F>,
): <A>(p: $<F, boolean>, body: $<F, A>) => $<F, A[]> {
  return <A>(p: $<F, boolean>, body: $<F, A>): $<F, A[]> => {
    const loop = (acc: A[]): $<F, A[]> =>
      F.flatMap(p, (continue_) => {
        if (!continue_) return F.pure(acc);
        return F.flatMap(body, (a: A) => loop([...acc, a]));
      });
    return loop([]);
  };
}

/**
 * Perform an action repeatedly until predicate holds
 */
export function untilM<F>(
  F: Monad<F>,
): <A>(body: $<F, A>, p: $<F, boolean>) => $<F, A[]> {
  return <A>(body: $<F, A>, p: $<F, boolean>): $<F, A[]> => {
    const loop = (acc: A[]): $<F, A[]> =>
      F.flatMap(body, (a: A) => {
        const newAcc = [...acc, a];
        return F.flatMap(p, (done) => (done ? F.pure(newAcc) : loop(newAcc)));
      });
    return loop([]);
  };
}

/**
 * Forever loop - run action forever (for effects)
 */
export function forever<F>(F: FlatMap<F>): <A>(fa: $<F, A>) => $<F, never> {
  return (fa) => {
    const loop: () => $<F, never> = () => F.flatMap(fa, loop);
    return loop();
  };
}

// ============================================================================
// Instance Creator
// ============================================================================

/**
 * Create a Monad instance
 */
export function makeMonad<F>(
  map: <A, B>(fa: $<F, A>, f: (a: A) => B) => $<F, B>,
  flatMap: <A, B>(fa: $<F, A>, f: (a: A) => $<F, B>) => $<F, B>,
  pure: <A>(a: A) => $<F, A>,
): Monad<F> {
  return {
    map,
    flatMap,
    pure,
    ap: (fab, fa) => flatMap(fab, (f) => map(fa, f)),
  };
}
