/**
 * Foldable Laws
 *
 * Laws for the Foldable typeclass.
 *
 * Foldable Laws:
 *   - foldRight/foldLeft consistency: foldRight should be consistent with foldLeft
 *   - foldMap consistency: foldMap should be derivable from foldRight
 *
 * @module
 */

import type { Foldable } from "../typeclasses/foldable.js";
import type { Monoid } from "../typeclasses/semigroup.js";
import type { Eq } from "../typeclasses/eq.js";
import type { $ } from "../hkt.js";
import type { Law, LawSet } from "./types.js";

// ============================================================================
// Foldable Laws
// ============================================================================

/**
 * Generate laws for a Foldable instance.
 *
 * @param F - The Foldable instance to verify
 * @param M - A Monoid for testing foldMap consistency
 * @param EqM - Eq instance for comparing monoid results
 * @returns Array of laws that must hold
 */
export function foldableLaws<F, A, M>(
  Fld: Foldable<F>,
  Monoid: Monoid<M>,
  EqM: Eq<M>,
  toM: (a: A) => M
): LawSet {
  return [
    {
      name: "foldLeft/foldRight consistency",
      arity: 1,
      description:
        "foldLeft and foldRight should produce the same result for commutative operations",
      check: (fa: $<F, A>): boolean => {
        // For a commutative monoid, foldLeft and foldRight should agree
        const left = Fld.foldLeft(fa, Monoid.empty, (acc, a) => Monoid.combine(acc, toM(a)));
        const right = Fld.foldRight(fa, Monoid.empty, (a, acc) => Monoid.combine(toM(a), acc));
        return EqM.eqv(left, right);
      },
    },
    {
      name: "foldMap consistency",
      arity: 1,
      description:
        "foldMap should be derivable from foldRight: foldMap(fa, f) === foldRight(fa, empty, (a, acc) => combine(f(a), acc))",
      check: (fa: $<F, A>): boolean => {
        // foldMap implemented via foldRight
        const viaFoldRight = Fld.foldRight(fa, Monoid.empty, (a, acc) =>
          Monoid.combine(toM(a), acc)
        );
        // foldMap implemented via foldLeft (should be same for commutative monoids)
        const viaFoldLeft = Fld.foldLeft(fa, Monoid.empty, (acc, a) => Monoid.combine(acc, toM(a)));
        return EqM.eqv(viaFoldRight, viaFoldLeft);
      },
    },
  ] as unknown as LawSet;
}

/**
 * Generate ordering laws for a Foldable instance.
 * These verify that the foldable preserves element order correctly.
 *
 * @param F - The Foldable instance to verify
 * @param EqA - Eq instance for comparing elements
 * @returns Array of ordering laws
 */
export function foldableOrderLaws<F, A>(Fld: Foldable<F>, EqA: Eq<A>): LawSet {
  return [
    {
      name: "toList via foldLeft preserves order",
      arity: 1,
      description: "Elements collected via foldLeft maintain their order",
      check: (fa: $<F, A>): boolean => {
        const leftList = Fld.foldLeft<A, A[]>(fa, [], (acc, a) => [...acc, a]);
        // foldRight should give the same order when we cons from the right
        const rightList = Fld.foldRight<A, A[]>(fa, [], (a, acc) => [a, ...acc]);

        if (leftList.length !== rightList.length) return false;
        return leftList.every((a, i) => EqA.eqv(a, rightList[i]));
      },
    },
  ] as unknown as LawSet;
}
