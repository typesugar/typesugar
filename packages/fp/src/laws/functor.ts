/**
 * Functor Laws
 *
 * Laws for the Functor typeclass and its variants.
 *
 * Functor Laws:
 *   - Identity: F.map(fa, a => a) === fa
 *   - Composition: F.map(F.map(fa, f), g) === F.map(fa, a => g(f(a)))
 *
 * @module
 */

import type { Functor } from "../typeclasses/functor.js";
import type { $ } from "../hkt.js";
import type { Law, LawSet, EqFA } from "./types.js";

// ============================================================================
// Functor Laws
// ============================================================================

/**
 * Generate laws for a Functor instance.
 *
 * @param F - The Functor instance to verify
 * @param EqFA - Eq instance for comparing F[A] values
 * @returns Array of laws that must hold
 *
 * @example
 * ```typescript
 * const laws = functorLaws(optionFunctor, optionEq(eqNumber));
 * // Test with: forAll((fa: Option<number>) => laws[0].check(fa))
 * ```
 */
export function functorLaws<F, A>(Fn: Functor<F>, EqFA: EqFA<F, A>): LawSet {
  return [
    {
      name: "identity",
      arity: 1,
      proofHint: "identity-left",
      description: "Mapping identity preserves structure: F.map(fa, a => a) === fa",
      check: (fa: $<F, A>): boolean =>
        EqFA.eqv(
          Fn.map(fa, (a: A) => a),
          fa
        ),
    },
    {
      name: "composition",
      arity: 3,
      proofHint: "composition",
      description: "Mapping composes: F.map(F.map(fa, f), g) === F.map(fa, a => g(f(a)))",
      check: (fa: $<F, A>, f: (a: A) => A, g: (a: A) => A): boolean =>
        EqFA.eqv(
          Fn.map(Fn.map(fa, f), g),
          Fn.map(fa, (a: A) => g(f(a)))
        ),
    },
  ] as unknown as LawSet;
}

/**
 * Generate laws for a Functor instance with specific test functions.
 * Useful when you want to test with concrete function types.
 *
 * @param F - The Functor instance to verify
 * @param EqFB - Eq instance for comparing F[B] values
 * @param f - First transformation function
 * @param g - Second transformation function
 * @returns Array of composition laws with fixed functions
 */
export function functorCompositionLaws<F, A, B, C>(
  Fn: Functor<F>,
  EqFC: { readonly eqv: (fa1: $<F, C>, fa2: $<F, C>) => boolean },
  f: (a: A) => B,
  g: (b: B) => C
): LawSet {
  return [
    {
      name: "composition (fixed functions)",
      arity: 1,
      proofHint: "composition",
      description: "F.map(F.map(fa, f), g) === F.map(fa, a => g(f(a)))",
      check: (fa: $<F, A>): boolean =>
        EqFC.eqv(
          Fn.map(Fn.map(fa, f), g),
          Fn.map(fa, (a: A) => g(f(a)))
        ),
    },
  ] as unknown as LawSet;
}
