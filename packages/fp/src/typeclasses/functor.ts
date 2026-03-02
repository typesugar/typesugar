/**
 * Functor Typeclass
 *
 * A type class of types that can be mapped over.
 * Instances must satisfy the following laws:
 *   - Identity: fa.map(a => a) === fa
 *   - Composition: fa.map(f).map(g) === fa.map(a => g(f(a)))
 *
 * ## Zero-Cost
 *
 * All derived operations accept the typeclass dictionary as the first argument.
 * When used with `specialize(derivedOp, concreteInstance)`, the dictionary is
 * eliminated at compile time and method calls are inlined directly.
 */

import type { Kind } from "../hkt.js";

// ============================================================================
// Functor
// ============================================================================

/**
 * Functor typeclass interface.
 *
 * Uses `Kind<F, A>` which resolves to the concrete type at compile time.
 * Combined with `specialize`, dictionary dispatch is eliminated entirely.
 */
export interface Functor<F> {
  readonly map: <A, B>(fa: Kind<F, A>, f: (a: A) => B) => Kind<F, B>;
}

// ============================================================================
// Derived Operations
// ============================================================================

/**
 * Replace all A values with a constant B value
 */
export function as<F>(F: Functor<F>): <A, B>(fa: Kind<F, A>, b: B) => Kind<F, B> {
  return (fa, b) => F.map(fa, () => b);
}

/**
 * Replace all A values with void/undefined
 */
export function void_<F>(F: Functor<F>): <A>(fa: Kind<F, A>) => Kind<F, void> {
  return (fa) => F.map(fa, () => undefined);
}

/**
 * Tuple the value with a constant on the left
 */
export function tupleLeft<F>(F: Functor<F>): <A, B>(fa: Kind<F, A>, b: B) => Kind<F, [B, A]> {
  return (fa, b) => F.map(fa, (a) => [b, a]);
}

/**
 * Tuple the value with a constant on the right
 */
export function tupleRight<F>(F: Functor<F>): <A, B>(fa: Kind<F, A>, b: B) => Kind<F, [A, B]> {
  return (fa, b) => F.map(fa, (a) => [a, b]);
}

/**
 * Lift a function to work on Functor values
 */
export function lift<F>(F: Functor<F>): <A, B>(f: (a: A) => B) => (fa: Kind<F, A>) => Kind<F, B> {
  return (f) => (fa) => F.map(fa, f);
}

/**
 * Apply a function inside the functor to a value
 */
export function flap<F>(F: Functor<F>): <A, B>(a: A, fab: Kind<F, (a: A) => B>) => Kind<F, B> {
  return (a, fab) => F.map(fab, (f) => f(a));
}

// ============================================================================
// Contravariant Functor
// ============================================================================

/**
 * Contravariant Functor typeclass
 * For types that can be "pre-composed" with a function
 */
export interface Contravariant<F> {
  readonly contramap: <A, B>(fa: Kind<F, A>, f: (b: B) => A) => Kind<F, B>;
}

// ============================================================================
// Invariant Functor
// ============================================================================

/**
 * Invariant Functor - both covariant and contravariant
 */
export interface Invariant<F> {
  readonly imap: <A, B>(fa: Kind<F, A>, f: (a: A) => B, g: (b: B) => A) => Kind<F, B>;
}

// ============================================================================
// Instance Creators
// ============================================================================

/**
 * Create a Functor instance from a map function
 */
export function makeFunctor<F>(
  map: <A, B>(fa: Kind<F, A>, f: (a: A) => B) => Kind<F, B>
): Functor<F> {
  return { map };
}

// ============================================================================
// Compose Functors
// ============================================================================

/**
 * Compose two functors.
 *
 * Note: Uses `unknown` coercion because tuple-based type function composition
 * (`[F, G]`) doesn't have a proper HKT encoding. This is a known limitation.
 */
export function composeFunctor<F, G>(F: Functor<F>, G: Functor<G>): Functor<[F, G]> {
  return {
    map: <A, B>(fga: Kind<[F, G], A>, f: (a: A) => B): Kind<[F, G], B> =>
      F.map(fga as unknown as Kind<F, Kind<G, A>>, (ga: Kind<G, A>) =>
        G.map(ga, f)
      ) as unknown as Kind<[F, G], B>,
  };
}
