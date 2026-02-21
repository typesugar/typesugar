/**
 * Show Laws
 *
 * The Show typeclass doesn't have strict algebraic laws like Semigroup or Eq,
 * but we can define consistency properties that well-behaved instances should satisfy.
 *
 * Show Laws:
 *   - Determinism: show(x) === show(x) (same input always produces same output)
 *   - Eq Consistency: eqv(x, y) => show(x) === show(y) (equal values have equal representations)
 *
 * Note: The Eq consistency law is optional and only applies when an Eq instance is provided.
 *
 * @module
 */

import type { Show } from "../typeclasses/show.js";
import type { Eq } from "../typeclasses/eq.js";
import type { Law, LawSet } from "./types.js";

// ============================================================================
// Show Laws
// ============================================================================

/**
 * Generate laws for a Show instance.
 *
 * @param S - The Show instance to verify
 * @returns Array of laws that must hold
 */
export function showLaws<A>(S: Show<A>): LawSet {
  return [
    {
      name: "determinism",
      arity: 1,
      description: "show is deterministic: show(x) === show(x) for the same x",
      check: (x: A): boolean => S.show(x) === S.show(x),
    },
  ] as unknown as LawSet;
}

/**
 * Generate laws for a Show instance with Eq consistency.
 *
 * @param S - The Show instance to verify
 * @param E - Eq instance for comparing values
 * @returns Array of laws that must hold
 */
export function showLawsWithEq<A>(S: Show<A>, E: Eq<A>): LawSet {
  return [
    ...showLaws(S),
    {
      name: "eq consistency",
      arity: 2,
      description: "Equal values have equal representations: eqv(x, y) => show(x) === show(y)",
      check: (x: A, y: A): boolean => {
        // If x == y, then show(x) must equal show(y)
        if (E.eqv(x, y)) {
          return S.show(x) === S.show(y);
        }
        // Vacuously true if x != y
        return true;
      },
    },
  ] as unknown as LawSet;
}
