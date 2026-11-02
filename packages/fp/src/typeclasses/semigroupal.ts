/**
 * Semigroupal Typeclass
 *
 * Semigroupal allows combining independent effects without
 * implicit sequencing (unlike Apply's ap which has left-to-right bias).
 *
 * Laws:
 *   - Associativity: product(product(fa, fb), fc) <-> product(fa, product(fb, fc))
 *     (isomorphic up to tuple nesting)
 */

import type { Kind } from "../hkt.js";
import type { Functor } from "./functor.js";

// ============================================================================
// Semigroupal
// ============================================================================

/**
 * Semigroupal typeclass
 */
export interface Semigroupal<F> {
  readonly product: <A, B>(fa: Kind<F, A>, fb: Kind<F, B>) => Kind<F, [A, B]>;
}

// ============================================================================
// Derived Operations
// ============================================================================

/**
 * Product of three effects, as a flat tuple `[A, B, C]`.
 *
 * Requires `map` as well as `product`: binary `product` alone produces the
 * nested shape `[[A, B], C]`, and flattening it needs a Functor.
 */
export function product3<F>(
  F: Semigroupal<F> & Functor<F>
): <A, B, C>(fa: Kind<F, A>, fb: Kind<F, B>, fc: Kind<F, C>) => Kind<F, [A, B, C]> {
  return <A, B, C>(fa: Kind<F, A>, fb: Kind<F, B>, fc: Kind<F, C>): Kind<F, [A, B, C]> =>
    F.map(F.product(F.product(fa, fb), fc), ([[a, b], c]): [A, B, C] => [a, b, c]);
}

/**
 * Product of four effects, as a flat tuple. See product3.
 */
export function product4<F>(
  F: Semigroupal<F> & Functor<F>
): <A, B, C, D>(
  fa: Kind<F, A>,
  fb: Kind<F, B>,
  fc: Kind<F, C>,
  fd: Kind<F, D>
) => Kind<F, [A, B, C, D]> {
  return <A, B, C, D>(
    fa: Kind<F, A>,
    fb: Kind<F, B>,
    fc: Kind<F, C>,
    fd: Kind<F, D>
  ): Kind<F, [A, B, C, D]> =>
    F.map(F.product(product3(F)(fa, fb, fc), fd), ([[a, b, c], d]): [A, B, C, D] => [a, b, c, d]);
}

/**
 * Product of five effects, as a flat tuple. See product3.
 */
export function product5<F>(
  F: Semigroupal<F> & Functor<F>
): <A, B, C, D, E>(
  fa: Kind<F, A>,
  fb: Kind<F, B>,
  fc: Kind<F, C>,
  fd: Kind<F, D>,
  fe: Kind<F, E>
) => Kind<F, [A, B, C, D, E]> {
  return <A, B, C, D, E>(
    fa: Kind<F, A>,
    fb: Kind<F, B>,
    fc: Kind<F, C>,
    fd: Kind<F, D>,
    fe: Kind<F, E>
  ): Kind<F, [A, B, C, D, E]> =>
    F.map(F.product(product4(F)(fa, fb, fc, fd), fe), ([[a, b, c, d], e]): [A, B, C, D, E] => [
      a,
      b,
      c,
      d,
      e,
    ]);
}

// ============================================================================
// Instance Creator
// ============================================================================

/**
 * Create a Semigroupal instance
 */
export function makeSemigroupal<F>(
  product: <A, B>(fa: Kind<F, A>, fb: Kind<F, B>) => Kind<F, [A, B]>
): Semigroupal<F> {
  return { product };
}
