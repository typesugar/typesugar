/**
 * Eq and Ord Laws
 *
 * Laws for equality and ordering typeclasses.
 *
 * Eq Laws:
 *   - Reflexivity: eqv(x, x) === true
 *   - Symmetry: eqv(x, y) === eqv(y, x)
 *   - Transitivity: eqv(x, y) && eqv(y, z) => eqv(x, z)
 *
 * Ord Laws (extends Eq):
 *   - Antisymmetry: compare(x, y) <= 0 && compare(y, x) <= 0 => eqv(x, y)
 *   - Transitivity: compare(x, y) <= 0 && compare(y, z) <= 0 => compare(x, z) <= 0
 *   - Totality: compare(x, y) <= 0 || compare(y, x) <= 0
 *   - Consistency: eqv(x, y) === (compare(x, y) === 0)
 *
 * @module
 */

import type { Eq, Ord } from "../typeclasses/eq.js";
import type { Law, LawSet } from "./types.js";

// ============================================================================
// Eq Laws
// ============================================================================

/**
 * Generate laws for an Eq instance.
 *
 * @param E - The Eq instance to verify
 * @returns Array of laws that must hold
 */
export function eqLaws<A>(E: Eq<A>): LawSet {
  return [
    {
      name: "reflexivity",
      arity: 1,
      proofHint: "reflexivity",
      description: "Every value is equal to itself: eqv(x, x) === true",
      check: (x: A): boolean => E.eqv(x, x),
    },
    {
      name: "symmetry",
      arity: 2,
      proofHint: "symmetry",
      description: "Equality is symmetric: eqv(x, y) === eqv(y, x)",
      check: (x: A, y: A): boolean => E.eqv(x, y) === E.eqv(y, x),
    },
    {
      name: "transitivity",
      arity: 3,
      proofHint: "transitivity",
      description:
        "Equality is transitive: eqv(x, y) && eqv(y, z) implies eqv(x, z)",
      check: (x: A, y: A, z: A): boolean => {
        // If x == y and y == z, then x == z must hold
        if (E.eqv(x, y) && E.eqv(y, z)) {
          return E.eqv(x, z);
        }
        // Vacuously true if premise doesn't hold
        return true;
      },
    },
  ] as const;
}

// ============================================================================
// Ord Laws
// ============================================================================

/**
 * Generate laws for an Ord instance.
 * Includes all Eq laws plus ordering-specific laws.
 *
 * @param O - The Ord instance to verify
 * @returns Array of laws that must hold
 */
export function ordLaws<A>(O: Ord<A>): LawSet {
  return [
    // Include Eq laws
    ...eqLaws(O),

    // Ord-specific laws
    {
      name: "antisymmetry",
      arity: 2,
      proofHint: "antisymmetry",
      description:
        "If x <= y and y <= x, then x == y: compare(x,y) <= 0 && compare(y,x) <= 0 => eqv(x,y)",
      check: (x: A, y: A): boolean => {
        if (O.compare(x, y) <= 0 && O.compare(y, x) <= 0) {
          return O.eqv(x, y);
        }
        return true;
      },
    },
    {
      name: "transitivity (ordering)",
      arity: 3,
      proofHint: "transitivity",
      description:
        "Ordering is transitive: compare(x,y) <= 0 && compare(y,z) <= 0 => compare(x,z) <= 0",
      check: (x: A, y: A, z: A): boolean => {
        if (O.compare(x, y) <= 0 && O.compare(y, z) <= 0) {
          return O.compare(x, z) <= 0;
        }
        return true;
      },
    },
    {
      name: "totality",
      arity: 2,
      proofHint: "totality",
      description:
        "Any two values are comparable: compare(x,y) <= 0 || compare(y,x) <= 0",
      check: (x: A, y: A): boolean =>
        O.compare(x, y) <= 0 || O.compare(y, x) <= 0,
    },
    {
      name: "consistency",
      arity: 2,
      description: "Eq and Ord agree: eqv(x, y) === (compare(x, y) === 0)",
      check: (x: A, y: A): boolean => O.eqv(x, y) === (O.compare(x, y) === 0),
    },
  ] as const;
}
