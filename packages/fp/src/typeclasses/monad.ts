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

import { type Acc, emptyAcc, snoc, accToArray } from "../internal/acc.js";
import type { Applicative, Apply, map2 } from "./applicative.js";
import type { Kind } from "../hkt.js";

// ============================================================================
// FlatMap
// ============================================================================

/**
 * FlatMap typeclass - adds flatMap to Apply
 *
 * @typeclass
 */
export interface FlatMap<F> extends Apply<F> {
  readonly flatMap: <A, B>(fa: Kind<F, A>, f: (a: A) => Kind<F, B>) => Kind<F, B>;
}

// ============================================================================
// Monad
// ============================================================================

/**
 * Monad typeclass - combines FlatMap with Applicative
 *
 * @typeclass
 */
export interface Monad<F> extends FlatMap<F>, Applicative<F> {}

// ============================================================================
// Derived Operations from FlatMap
// ============================================================================

/**
 * Flatten a nested structure
 */
export function flatten<F>(F: FlatMap<F>): <A>(ffa: Kind<F, Kind<F, A>>) => Kind<F, A> {
  return (ffa) => F.flatMap(ffa, (x) => x);
}

/**
 * Map then flatten
 */
export function flatTap<F>(
  F: FlatMap<F>
): <A, B>(fa: Kind<F, A>, f: (a: A) => Kind<F, B>) => Kind<F, A> {
  return (fa, f) => F.flatMap(fa, (a) => F.map(f(a), () => a));
}

/**
 * Conditional flatMap - apply f only if predicate holds
 */
export function ifM<F>(
  F: FlatMap<F>
): <A>(fb: Kind<F, boolean>, ifTrue: () => Kind<F, A>, ifFalse: () => Kind<F, A>) => Kind<F, A> {
  return (fb, ifTrue, ifFalse) => F.flatMap(fb, (b) => (b ? ifTrue() : ifFalse()));
}

/**
 * Filter the monadic value based on a predicate
 */
export function mfilter<F>(
  F: Monad<F>,
  empty: Kind<F, never>
): <A>(fa: Kind<F, A>, p: (a: A) => boolean) => Kind<F, A> {
  // pure(a), not map(fa, () => a): the latter re-runs fa's structure for each
  // kept element (for arrays, [1,2,3] -> [2,2,2,3,3,3]).
  return (fa, p) => F.flatMap(fa, (a) => (p(a) ? F.pure(a) : empty));
}

/**
 * Kleisli composition (>=>) - compose two monadic functions
 */
export function andThen<F>(
  F: FlatMap<F>
): <A, B, C>(f: (a: A) => Kind<F, B>, g: (b: B) => Kind<F, C>) => (a: A) => Kind<F, C> {
  return (f, g) => (a) => F.flatMap(f(a), g);
}

/**
 * Kleisli composition (<=<) - compose two monadic functions (reversed)
 */
export function compose<F>(
  F: FlatMap<F>
): <B, C, A>(g: (b: B) => Kind<F, C>, f: (a: A) => Kind<F, B>) => (a: A) => Kind<F, C> {
  return (g, f) => (a) => F.flatMap(f(a), g);
}

// ============================================================================
// Derived Operations from Monad
// ============================================================================

/**
 * Perform an action repeatedly, collecting results while predicate holds
 */
export function whileM<F>(F: Monad<F>): <A>(p: Kind<F, boolean>, body: Kind<F, A>) => Kind<F, A[]> {
  return <A>(p: Kind<F, boolean>, body: Kind<F, A>): Kind<F, A[]> => {
    const loop = (acc: Acc<A>): Kind<F, A[]> =>
      F.flatMap(p, (continue_) => {
        if (!continue_) return F.pure(accToArray(acc));
        return F.flatMap(body, (a: A) => loop(snoc(acc, a)));
      });
    return loop(emptyAcc);
  };
}

/**
 * Perform an action repeatedly until predicate holds
 */
export function untilM<F>(F: Monad<F>): <A>(body: Kind<F, A>, p: Kind<F, boolean>) => Kind<F, A[]> {
  return <A>(body: Kind<F, A>, p: Kind<F, boolean>): Kind<F, A[]> => {
    const loop = (acc: Acc<A>): Kind<F, A[]> =>
      F.flatMap(body, (a: A) => {
        const newAcc = snoc(acc, a);
        return F.flatMap(p, (done) => (done ? F.pure(accToArray(newAcc)) : loop(newAcc)));
      });
    return loop(emptyAcc);
  };
}

/**
 * Forever loop - run action forever (for effects)
 */
export function forever<F>(F: FlatMap<F>): <A>(fa: Kind<F, A>) => Kind<F, never> {
  return (fa) => {
    const loop: () => Kind<F, never> = () => F.flatMap(fa, loop);
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
  map: <A, B>(fa: Kind<F, A>, f: (a: A) => B) => Kind<F, B>,
  flatMap: <A, B>(fa: Kind<F, A>, f: (a: A) => Kind<F, B>) => Kind<F, B>,
  pure: <A>(a: A) => Kind<F, A>
): Monad<F> {
  return {
    map,
    flatMap,
    pure,
    ap: (fab, fa) => flatMap(fab, (f) => map(fa, f)),
  };
}
