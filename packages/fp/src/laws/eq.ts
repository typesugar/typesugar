/**
 * Eq and Ord Laws
 *
 * Laws for equality and ordering typeclasses.
 *
 * Eq Laws:
 *   - Reflexivity: equals(x, x) === true
 *   - Symmetry: equals(x, y) === equals(y, x)
 *   - Transitivity: equals(x, y) && equals(y, z) => equals(x, z)
 *   - Inequality: notEquals(x, y) === !equals(x, y)
 *
 * Ord Laws (extends Eq):
 *   - Antisymmetry: compare(x, y) <= 0 && compare(y, x) <= 0 => equals(x, y)
 *   - Transitivity: compare(x, y) <= 0 && compare(y, z) <= 0 => compare(x, z) <= 0
 *   - Totality: compare(x, y) <= 0 || compare(y, x) <= 0
 *   - Consistency: equals(x, y) === (compare(x, y) === 0)
 *   - Comparison methods: lessThan(x, y) === (compare(x, y) < 0), and likewise
 *     lessThanOrEqual, greaterThan, greaterThanOrEqual
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
      description: "Every value is equal to itself: equals(x, x) === true",
      check: (x: A): boolean => E.equals(x, x),
    },
    {
      name: "symmetry",
      arity: 2,
      proofHint: "symmetry",
      description: "Equality is symmetric: equals(x, y) === equals(y, x)",
      check: (x: A, y: A): boolean => E.equals(x, y) === E.equals(y, x),
    },
    {
      name: "transitivity",
      arity: 3,
      proofHint: "transitivity",
      description: "Equality is transitive: equals(x, y) && equals(y, z) implies equals(x, z)",
      check: (x: A, y: A, z: A): boolean => {
        // If x == y and y == z, then x == z must hold
        if (E.equals(x, y) && E.equals(y, z)) {
          return E.equals(x, z);
        }
        // Vacuously true if premise doesn't hold
        return true;
      },
    },
    {
      name: "inequality",
      arity: 2,
      description:
        "notEquals (what `!==` calls) agrees with equals: notEquals(x, y) === !equals(x, y)",
      check: (x: A, y: A): boolean => E.notEquals(x, y) === !E.equals(x, y),
    },
  ] as unknown as LawSet;
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
        "If x <= y and y <= x, then x == y: compare(x,y) <= 0 && compare(y,x) <= 0 => equals(x,y)",
      check: (x: A, y: A): boolean => {
        if (O.compare(x, y) <= 0 && O.compare(y, x) <= 0) {
          return O.equals(x, y);
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
      description: "Any two values are comparable: compare(x,y) <= 0 || compare(y,x) <= 0",
      check: (x: A, y: A): boolean => O.compare(x, y) <= 0 || O.compare(y, x) <= 0,
    },
    {
      name: "consistency",
      arity: 2,
      description: "Eq and Ord agree: equals(x, y) === (compare(x, y) === 0)",
      check: (x: A, y: A): boolean => O.equals(x, y) === (O.compare(x, y) === 0),
    },
    {
      name: "comparison methods",
      arity: 2,
      description:
        "The methods `<`, `<=`, `>`, `>=` call agree with compare: lessThan(x, y) === (compare(x, y) < 0), ...",
      check: (x: A, y: A): boolean => {
        const c = O.compare(x, y);
        return (
          O.lessThan(x, y) === c < 0 &&
          O.lessThanOrEqual(x, y) === c <= 0 &&
          O.greaterThan(x, y) === c > 0 &&
          O.greaterThanOrEqual(x, y) === c >= 0
        );
      },
    },
  ] as unknown as LawSet;
}
