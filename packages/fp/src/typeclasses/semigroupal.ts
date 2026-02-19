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

import type { $ } from "../hkt.js";

// ============================================================================
// Semigroupal
// ============================================================================

/**
 * Semigroupal typeclass
 */
export interface Semigroupal<F> {
  readonly product: <A, B>(fa: $<F, A>, fb: $<F, B>) => $<F, [A, B]>;
}

// ============================================================================
// Derived Operations
// ============================================================================

/**
 * Product of three effects.
 *
 * NOTE: The runtime tuple shape is nested: [[A, B], C], not flat [A, B, C].
 * This is because Semigroupal only provides binary `product` and has no `map`
 * to flatten the result. The type signature uses `as unknown as` to present
 * a flat tuple type, but consumers should be aware of the nesting if they
 * inspect the runtime value directly.
 *
 * For a properly flat tuple, use an Apply/Applicative instance with mapN instead.
 */
export function product3<F>(
  F: Semigroupal<F>,
): <A, B, C>(fa: $<F, A>, fb: $<F, B>, fc: $<F, C>) => $<F, [A, B, C]> {
  return <A, B, C>(fa: $<F, A>, fb: $<F, B>, fc: $<F, C>): $<F, [A, B, C]> => {
    const ab = F.product(fa, fb);
    return F.product(ab, fc) as unknown as $<F, [A, B, C]>;
  };
}

/**
 * Product of four effects.
 *
 * NOTE: Runtime tuple shape is nested: [[A, B], [C, D]], not flat [A, B, C, D].
 * See product3 for details.
 */
export function product4<F>(
  F: Semigroupal<F>,
): <A, B, C, D>(
  fa: $<F, A>,
  fb: $<F, B>,
  fc: $<F, C>,
  fd: $<F, D>,
) => $<F, [A, B, C, D]> {
  return <A, B, C, D>(
    fa: $<F, A>,
    fb: $<F, B>,
    fc: $<F, C>,
    fd: $<F, D>,
  ): $<F, [A, B, C, D]> => {
    const ab = F.product(fa, fb);
    const cd = F.product(fc, fd);
    return F.product(ab, cd) as unknown as $<F, [A, B, C, D]>;
  };
}

/**
 * Product of five effects.
 *
 * NOTE: Runtime tuple shape is nested: [[[A, B], [C, D]], E], not flat.
 * See product3 for details.
 */
export function product5<F>(
  F: Semigroupal<F>,
): <A, B, C, D, E>(
  fa: $<F, A>,
  fb: $<F, B>,
  fc: $<F, C>,
  fd: $<F, D>,
  fe: $<F, E>,
) => $<F, [A, B, C, D, E]> {
  return <A, B, C, D, E>(
    fa: $<F, A>,
    fb: $<F, B>,
    fc: $<F, C>,
    fd: $<F, D>,
    fe: $<F, E>,
  ): $<F, [A, B, C, D, E]> => {
    const abcd = product4(F)(fa, fb, fc, fd);
    return F.product(abcd, fe) as unknown as $<F, [A, B, C, D, E]>;
  };
}

// ============================================================================
// Instance Creator
// ============================================================================

/**
 * Create a Semigroupal instance
 */
export function makeSemigroupal<F>(
  product: <A, B>(fa: $<F, A>, fb: $<F, B>) => $<F, [A, B]>,
): Semigroupal<F> {
  return { product };
}
