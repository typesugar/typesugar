/**
 * Applicative Laws
 *
 * Laws for Apply and Applicative typeclasses.
 *
 * Applicative Laws:
 *   - Identity: F.ap(F.pure(a => a), fa) === fa
 *   - Homomorphism: F.ap(F.pure(f), F.pure(x)) === F.pure(f(x))
 *   - Interchange: F.ap(ff, F.pure(a)) === F.ap(F.pure(f => f(a)), ff)
 *   - Map consistency: F.map(fa, f) === F.ap(F.pure(f), fa)
 *
 * @module
 */

import type { Apply, Applicative } from "../typeclasses/applicative.js";
import type { $ } from "../hkt.js";
import type { Law, LawSet } from "./types.js";
import { functorLaws } from "./functor.js";
import type { EqFA } from "./types.js";

// ============================================================================
// Apply Laws
// ============================================================================

/**
 * Generate laws for an Apply instance.
 *
 * @param F - The Apply instance to verify
 * @param EqFA - Eq instance for comparing F[A] values
 * @returns Array of laws that must hold
 */
export function applyLaws<F, A>(Ap: Apply<F>, EqFA: EqFA<F, A>): LawSet {
  return [
    // Include Functor laws
    ...functorLaws(Ap, EqFA),

    {
      name: "ap composition",
      arity: 3,
      proofHint: "composition",
      description:
        "ap composes: F.ap(F.ap(F.map(fbc, bc => ab => a => bc(ab(a))), fab), fa) === F.ap(fbc, F.ap(fab, fa))",
      check: (fa: $<F, A>, fab: $<F, (a: A) => A>, fbc: $<F, (a: A) => A>): boolean => {
        const compose = (bc: (a: A) => A) => (ab: (a: A) => A) => (a: A) => bc(ab(a));
        const left = Ap.ap(Ap.ap(Ap.map(fbc, compose), fab), fa);
        const right = Ap.ap(fbc, Ap.ap(fab, fa));
        return EqFA.eqv(left, right);
      },
    },
  ] as unknown as LawSet;
}

// ============================================================================
// Applicative Laws
// ============================================================================

/**
 * Generate laws for an Applicative instance.
 *
 * @param F - The Applicative instance to verify
 * @param EqFA - Eq instance for comparing F[A] values
 * @returns Array of laws that must hold
 */
export function applicativeLaws<F, A>(Ap: Applicative<F>, EqFA: EqFA<F, A>): LawSet {
  return [
    // Include Apply laws (which include Functor laws)
    ...applyLaws(Ap, EqFA),

    {
      name: "identity",
      arity: 1,
      proofHint: "identity-left",
      description: "pure identity is identity: F.ap(F.pure(a => a), fa) === fa",
      check: (fa: $<F, A>): boolean =>
        EqFA.eqv(
          Ap.ap(
            Ap.pure((a: A) => a),
            fa
          ),
          fa
        ),
    },
    {
      name: "homomorphism",
      arity: 2,
      proofHint: "homomorphism",
      description: "pure distributes over ap: F.ap(F.pure(f), F.pure(a)) === F.pure(f(a))",
      check: (a: A, f: (a: A) => A): boolean =>
        EqFA.eqv(Ap.ap(Ap.pure(f), Ap.pure(a)), Ap.pure(f(a))),
    },
    {
      name: "interchange",
      arity: 2,
      description: "interchange: F.ap(ff, F.pure(a)) === F.ap(F.pure(f => f(a)), ff)",
      check: (a: A, ff: $<F, (a: A) => A>): boolean =>
        EqFA.eqv(
          Ap.ap(ff, Ap.pure(a)),
          Ap.ap(
            Ap.pure((f: (a: A) => A) => f(a)),
            ff
          )
        ),
    },
    {
      name: "map consistency",
      arity: 2,
      description: "map via ap: F.map(fa, f) === F.ap(F.pure(f), fa)",
      check: (fa: $<F, A>, f: (a: A) => A): boolean =>
        EqFA.eqv(Ap.map(fa, f), Ap.ap(Ap.pure(f), fa)),
    },
  ] as unknown as LawSet;
}
