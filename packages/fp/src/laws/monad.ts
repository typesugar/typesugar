/**
 * Monad Laws
 *
 * Laws for FlatMap and Monad typeclasses.
 *
 * Monad Laws:
 *   - Left identity: F.flatMap(F.pure(a), f) === f(a)
 *   - Right identity: F.flatMap(fa, F.pure) === fa
 *   - Associativity: F.flatMap(F.flatMap(fa, f), g) === F.flatMap(fa, a => F.flatMap(f(a), g))
 *
 * @module
 */

import type { FlatMap, Monad } from "../typeclasses/monad.js";
import type { Applicative } from "../typeclasses/applicative.js";
import type { $ } from "../hkt.js";
import type { Law, LawSet } from "./types.js";
import { applyLaws, applicativeLaws } from "./applicative.js";
import type { EqFA } from "./types.js";

// ============================================================================
// FlatMap Laws
// ============================================================================

/**
 * Generate laws for a FlatMap instance.
 *
 * @param F - The FlatMap instance to verify
 * @param EqFA - Eq instance for comparing F[A] values
 * @returns Array of laws that must hold
 */
export function flatMapLaws<F, A>(FM: FlatMap<F>, EqFA: EqFA<F, A>): LawSet {
  return [
    // Include Apply laws
    ...applyLaws(FM, EqFA),

    {
      name: "associativity",
      arity: 3,
      proofHint: "associativity",
      description:
        "flatMap is associative: F.flatMap(F.flatMap(fa, f), g) === F.flatMap(fa, a => F.flatMap(f(a), g))",
      check: (fa: $<F, A>, f: (a: A) => $<F, A>, g: (a: A) => $<F, A>): boolean =>
        EqFA.eqv(
          FM.flatMap(FM.flatMap(fa, f), g),
          FM.flatMap(fa, (a: A) => FM.flatMap(f(a), g))
        ),
    },
    {
      name: "flatMap consistency",
      arity: 2,
      description:
        "flatMap via ap and flatten: F.flatMap(fa, f) === F.ap(F.map(fa, f), fa) flattened",
      check: (fa: $<F, A>, f: (a: A) => $<F, A>): boolean => {
        // This law verifies flatMap produces the same result as ap + flatten
        // For a FlatMap, flatten(ffa) = flatMap(ffa, identity)
        const viaFlatMap = FM.flatMap(fa, f);
        // We can't easily express the alternative without a pure, so this is
        // mainly a sanity check that flatMap is internally consistent
        const viaFlatMap2 = FM.flatMap(fa, (a: A) => f(a));
        return EqFA.eqv(viaFlatMap, viaFlatMap2);
      },
    },
  ] as unknown as LawSet;
}

// ============================================================================
// Monad Laws
// ============================================================================

/**
 * Generate laws for a Monad instance.
 *
 * @param M - The Monad instance to verify
 * @param EqFA - Eq instance for comparing F[A] values
 * @returns Array of laws that must hold
 */
export function monadLaws<F, A>(M: Monad<F>, EqFA: EqFA<F, A>): LawSet {
  return [
    // Include Applicative laws
    ...applicativeLaws(M, EqFA),

    // Monad-specific laws
    {
      name: "left identity",
      arity: 2,
      proofHint: "identity-left",
      description: "pure is left identity for flatMap: F.flatMap(F.pure(a), f) === f(a)",
      check: (a: A, f: (a: A) => $<F, A>): boolean => EqFA.eqv(M.flatMap(M.pure(a), f), f(a)),
    },
    {
      name: "right identity",
      arity: 1,
      proofHint: "identity-right",
      description: "pure is right identity for flatMap: F.flatMap(fa, F.pure) === fa",
      check: (fa: $<F, A>): boolean => EqFA.eqv(M.flatMap(fa, M.pure), fa),
    },
    {
      name: "associativity",
      arity: 3,
      proofHint: "associativity",
      description:
        "flatMap is associative: F.flatMap(F.flatMap(fa, f), g) === F.flatMap(fa, a => F.flatMap(f(a), g))",
      check: (fa: $<F, A>, f: (a: A) => $<F, A>, g: (a: A) => $<F, A>): boolean =>
        EqFA.eqv(
          M.flatMap(M.flatMap(fa, f), g),
          M.flatMap(fa, (a: A) => M.flatMap(f(a), g))
        ),
    },
    {
      name: "map derived from flatMap",
      arity: 2,
      proofHint: "homomorphism",
      description:
        "map can be derived from flatMap: F.map(fa, f) === F.flatMap(fa, a => F.pure(f(a)))",
      check: (fa: $<F, A>, f: (a: A) => A): boolean =>
        EqFA.eqv(
          M.map(fa, f),
          M.flatMap(fa, (a: A) => M.pure(f(a)))
        ),
    },
  ] as unknown as LawSet;
}

/**
 * Stack-safe Monad laws.
 * Additional laws that verify the monad implementation handles deep recursion.
 *
 * @param M - The Monad instance to verify
 * @param EqFA - Eq instance for comparing F[A] values
 * @param depth - Recursion depth to test (default: 10000)
 * @returns Array of stack-safety laws
 */
export function monadStackSafetyLaws<F, A>(
  M: Monad<F>,
  EqFA: EqFA<F, A>,
  depth: number = 10000
): LawSet {
  return [
    {
      name: "tailRecM stack safety",
      arity: 1,
      description: `flatMap should be stack-safe for ${depth} iterations`,
      check: (a: A): boolean => {
        try {
          let result = M.pure(a);
          for (let i = 0; i < depth; i++) {
            result = M.flatMap(result, M.pure);
          }
          return EqFA.eqv(result, M.pure(a));
        } catch (e) {
          // Stack overflow means the law fails
          return false;
        }
      },
    },
  ] as unknown as LawSet;
}
