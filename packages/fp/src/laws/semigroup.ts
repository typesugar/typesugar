/**
 * Semigroup and Monoid Laws
 *
 * Laws for algebraic structures with binary operations.
 *
 * Semigroup Laws:
 *   - Associativity: combine(combine(x, y), z) === combine(x, combine(y, z))
 *
 * Monoid Laws (extends Semigroup):
 *   - Left Identity: combine(empty, x) === x
 *   - Right Identity: combine(x, empty) === x
 *
 * @module
 */

import type { Semigroup, Monoid } from "../typeclasses/semigroup.js";
import type { Eq } from "../typeclasses/eq.js";
import type { Law, LawSet } from "./types.js";

// ============================================================================
// Semigroup Laws
// ============================================================================

/**
 * Generate laws for a Semigroup instance.
 *
 * @param S - The Semigroup instance to verify
 * @param E - Eq instance for comparing results
 * @returns Array of laws that must hold
 */
export function semigroupLaws<A>(S: Semigroup<A>, E: Eq<A>): LawSet {
  return [
    {
      name: "associativity",
      arity: 3,
      proofHint: "associativity",
      description:
        "combine is associative: combine(combine(x, y), z) === combine(x, combine(y, z))",
      check: (x: A, y: A, z: A): boolean =>
        E.eqv(S.combine(S.combine(x, y), z), S.combine(x, S.combine(y, z))),
    },
  ] as const;
}

// ============================================================================
// Monoid Laws
// ============================================================================

/**
 * Generate laws for a Monoid instance.
 * Includes all Semigroup laws plus identity laws.
 *
 * @param M - The Monoid instance to verify
 * @param E - Eq instance for comparing results
 * @returns Array of laws that must hold
 */
export function monoidLaws<A>(M: Monoid<A>, E: Eq<A>): LawSet {
  return [
    // Include Semigroup laws
    ...semigroupLaws(M, E),

    // Monoid-specific laws
    {
      name: "left identity",
      arity: 1,
      proofHint: "identity-left",
      description: "empty is a left identity: combine(empty, x) === x",
      check: (x: A): boolean => E.eqv(M.combine(M.empty, x), x),
    },
    {
      name: "right identity",
      arity: 1,
      proofHint: "identity-right",
      description: "empty is a right identity: combine(x, empty) === x",
      check: (x: A): boolean => E.eqv(M.combine(x, M.empty), x),
    },
  ] as const;
}
