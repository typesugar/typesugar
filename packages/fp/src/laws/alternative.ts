/**
 * Alternative Laws
 *
 * Laws for SemigroupK, MonoidK, and Alternative typeclasses.
 *
 * SemigroupK Laws:
 *   - Associativity: combineK(combineK(x, y), z) === combineK(x, combineK(y, z))
 *
 * MonoidK Laws:
 *   - Left identity: combineK(emptyK, x) === x
 *   - Right identity: combineK(x, emptyK) === x
 *
 * Alternative Laws (combines Applicative + MonoidK):
 *   - Right distributivity: (f <|> g) <*> a === (f <*> a) <|> (g <*> a)
 *   - Right absorption: empty <*> a === empty
 *
 * @module
 */

import type {
  SemigroupK,
  MonoidK,
  Alternative,
} from "../typeclasses/alternative.js";
import type { $ } from "../hkt.js";
import type { Law, LawSet } from "./types.js";
import type { EqFA } from "./functor.js";
import { applicativeLaws } from "./applicative.js";

// ============================================================================
// SemigroupK Laws
// ============================================================================

/**
 * Generate laws for a SemigroupK instance.
 *
 * @param F - The SemigroupK instance to verify
 * @param EqFA - Eq instance for comparing F[A] values
 * @returns Array of laws that must hold
 */
export function semigroupKLaws<F, A>(
  SK: SemigroupK<F>,
  EqFA: EqFA<F, A>,
): LawSet {
  return [
    {
      name: "associativity",
      arity: 3,
      proofHint: "associativity",
      description:
        "combineK is associative: combineK(combineK(x, y), z) === combineK(x, combineK(y, z))",
      check: (x: $<F, A>, y: $<F, A>, z: $<F, A>): boolean =>
        EqFA.eqv(
          SK.combineK(SK.combineK(x, y), z),
          SK.combineK(x, SK.combineK(y, z)),
        ),
    },
  ] as const;
}

// ============================================================================
// MonoidK Laws
// ============================================================================

/**
 * Generate laws for a MonoidK instance.
 *
 * @param F - The MonoidK instance to verify
 * @param EqFA - Eq instance for comparing F[A] values
 * @returns Array of laws that must hold
 */
export function monoidKLaws<F, A>(MK: MonoidK<F>, EqFA: EqFA<F, A>): LawSet {
  return [
    // Include SemigroupK laws
    ...semigroupKLaws(MK, EqFA),

    {
      name: "left identity",
      arity: 1,
      proofHint: "identity-left",
      description: "emptyK is left identity: combineK(emptyK, x) === x",
      check: (x: $<F, A>): boolean =>
        EqFA.eqv(MK.combineK(MK.emptyK<A>(), x), x),
    },
    {
      name: "right identity",
      arity: 1,
      proofHint: "identity-right",
      description: "emptyK is right identity: combineK(x, emptyK) === x",
      check: (x: $<F, A>): boolean =>
        EqFA.eqv(MK.combineK(x, MK.emptyK<A>()), x),
    },
  ] as const;
}

// ============================================================================
// Alternative Laws
// ============================================================================

/**
 * Generate laws for an Alternative instance.
 *
 * @param F - The Alternative instance to verify
 * @param EqFA - Eq instance for comparing F[A] values
 * @returns Array of laws that must hold
 */
export function alternativeLaws<F, A>(
  Alt: Alternative<F>,
  EqFA: EqFA<F, A>,
): LawSet {
  return [
    // Include Applicative laws
    ...applicativeLaws(Alt, EqFA),

    // Include MonoidK laws
    ...monoidKLaws(Alt, EqFA),

    // Alternative-specific laws
    {
      name: "right distributivity",
      arity: 3,
      description:
        "ap distributes over combineK: ap(combineK(f, g), a) === combineK(ap(f, a), ap(g, a))",
      check: (
        a: $<F, A>,
        f: $<F, (a: A) => A>,
        g: $<F, (a: A) => A>,
      ): boolean =>
        EqFA.eqv(
          Alt.ap(Alt.combineK(f, g), a),
          Alt.combineK(Alt.ap(f, a), Alt.ap(g, a)),
        ),
    },
    {
      name: "right absorption",
      arity: 1,
      description: "ap with emptyK absorbs: ap(emptyK, a) === emptyK",
      check: (a: $<F, A>): boolean => {
        const emptyF = Alt.emptyK<(x: A) => A>();
        return EqFA.eqv(Alt.ap(emptyF, a), Alt.emptyK<A>());
      },
    },
  ] as const;
}

/**
 * Alternative laws for non-right-distributive instances.
 * Some Alternative instances (like parsers) don't satisfy right distributivity.
 *
 * @param F - The Alternative instance to verify
 * @param EqFA - Eq instance for comparing F[A] values
 * @returns Array of laws (without distributivity)
 */
export function alternativeLawsNonDistributive<F, A>(
  Alt: Alternative<F>,
  EqFA: EqFA<F, A>,
): LawSet {
  return [
    // Include Applicative laws
    ...applicativeLaws(Alt, EqFA),

    // Include MonoidK laws
    ...monoidKLaws(Alt, EqFA),

    // Only right absorption (not distributivity)
    {
      name: "right absorption",
      arity: 1,
      description: "ap with emptyK absorbs: ap(emptyK, a) === emptyK",
      check: (a: $<F, A>): boolean => {
        const emptyF = Alt.emptyK<(x: A) => A>();
        return EqFA.eqv(Alt.ap(emptyF, a), Alt.emptyK<A>());
      },
    },
  ] as const;
}
