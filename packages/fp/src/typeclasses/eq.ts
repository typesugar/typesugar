/**
 * Eq, PartialOrd, and Ord Typeclasses
 *
 * Eq: Equality comparison
 * PartialOrd: Partial ordering (may be incomparable)
 * Ord: Total ordering
 *
 * `Eq`, `Ord` and `Ordering` are `@typesugar/std`'s own types, re-exported, so
 * an fp instance is a std instance and the `===`/`<` operator rewrites work on
 * fp's instances too. `PartialOrd`, the `LT`/`EQ`/`GT` values and the
 * combinators below are fp's.
 *
 * Laws:
 *   - Reflexivity: equals(x, x) === true
 *   - Symmetry: equals(x, y) === equals(y, x)
 *   - Transitivity: equals(x, y) && equals(y, z) => equals(x, z)
 *   - Ord Antisymmetry: compare(x, y) <= 0 && compare(y, x) <= 0 => equals(x, y)
 *   - Ord Transitivity: compare(x, y) <= 0 && compare(y, z) <= 0 => compare(x, z) <= 0
 *   - Ord Totality: compare(x, y) <= 0 || compare(y, x) <= 0
 *
 * ## Operator Support (@op JSDoc tags)
 *
 * Methods are annotated with @op to enable operator rewriting by the transformer,
 * in files that activate the syntax (`import "@typesugar/std/syntax/eq/ops"`,
 * `import "@typesugar/std/syntax/ord/ops"`):
 * - `a === b` → `Eq<A>.equals(a, b)` when A has an Eq instance in scope
 * - `a !== b` → `Eq<A>.notEquals(a, b)`
 * - `a < b`  → `Ord<A>.lessThan(a, b)` when A has an Ord instance in scope
 */

import { instance } from "@typesugar/macros/runtime";
import type { Eq, Ord, Ordering } from "@typesugar/std/typeclasses";

export type { Eq, Ord, Ordering };

// ============================================================================
// Ordering
// ============================================================================

export const LT: Ordering = -1;
export const EQ: Ordering = 0;
export const GT: Ordering = 1;

// ============================================================================
// PartialOrd
// ============================================================================

/**
 * PartialOrd typeclass - partial ordering
 * Returns undefined when values are incomparable
 */
export interface PartialOrd<A> extends Eq<A> {
  partialCompare(x: A, y: A): Ordering | undefined;
}

// ============================================================================
// Derived Operations from Ord
// ============================================================================

/**
 * Less than
 */
export function lt<A>(O: Ord<A>): (x: A, y: A) => boolean {
  return (x, y) => O.compare(x, y) === LT;
}

/**
 * Less than or equal
 */
export function lte<A>(O: Ord<A>): (x: A, y: A) => boolean {
  return (x, y) => O.compare(x, y) !== GT;
}

/**
 * Greater than
 */
export function gt<A>(O: Ord<A>): (x: A, y: A) => boolean {
  return (x, y) => O.compare(x, y) === GT;
}

/**
 * Greater than or equal
 */
export function gte<A>(O: Ord<A>): (x: A, y: A) => boolean {
  return (x, y) => O.compare(x, y) !== LT;
}

/**
 * Return the minimum of two values
 */
export function min<A>(O: Ord<A>): (x: A, y: A) => A {
  return (x, y) => (O.compare(x, y) <= 0 ? x : y);
}

/**
 * Return the maximum of two values
 */
export function max<A>(O: Ord<A>): (x: A, y: A) => A {
  return (x, y) => (O.compare(x, y) >= 0 ? x : y);
}

/**
 * Clamp a value to a range
 */
export function clamp<A>(O: Ord<A>): (value: A, lo: A, hi: A) => A {
  return (value, lo, hi) => min(O)(max(O)(value, lo), hi);
}

/**
 * Check if a value is between two bounds (inclusive)
 */
export function between<A>(O: Ord<A>): (value: A, lo: A, hi: A) => boolean {
  return (value, lo, hi) => gte(O)(value, lo) && lte(O)(value, hi);
}

// ============================================================================
// Eq Combinators
// ============================================================================

/**
 * Eq that uses strict equality
 */
export function eqStrict<A>(): Eq<A> {
  return {
    equals: (x, y) => x === y,
    notEquals: (x, y) => x !== y,
  };
}

/**
 * Eq by mapping to a comparable value (strict equality on the mapped value
 * when no `E` is given). Same argument order as `@typesugar/std`'s `eqBy`.
 */
export function eqBy<A, B>(f: (a: A) => B, E: Eq<B> = eqStrict()): Eq<A> {
  return {
    equals: (x, y) => E.equals(f(x), f(y)),
    notEquals: (x, y) => E.notEquals(f(x), f(y)),
  };
}

/**
 * Eq for tuples
 */
export function eqTuple<A, B>(EA: Eq<A>, EB: Eq<B>): Eq<[A, B]> {
  return {
    equals: ([a1, b1], [a2, b2]) => EA.equals(a1, a2) && EB.equals(b1, b2),
    notEquals: ([a1, b1], [a2, b2]) => EA.notEquals(a1, a2) || EB.notEquals(b1, b2),
  };
}

/**
 * Eq for arrays (element-wise)
 */
export function eqArray<A>(E: Eq<A>): Eq<A[]> {
  return {
    equals: (xs, ys) => {
      if (xs.length !== ys.length) return false;
      return xs.every((x, i) => E.equals(x, ys[i]));
    },
    notEquals: (xs, ys) => {
      if (xs.length !== ys.length) return true;
      return xs.some((x, i) => E.notEquals(x, ys[i]));
    },
  };
}

// ============================================================================
// Ord Combinators
// ============================================================================

/**
 * Ord by mapping to a comparable value. Same argument order as
 * `@typesugar/std`'s `ordBy`.
 */
export function ordBy<A, B>(f: (a: A) => B, O: Ord<B>): Ord<A> {
  return contramapOrd(O, f);
}

/**
 * Reverse an Ord
 */
export function reverse<A>(O: Ord<A>): Ord<A> {
  return {
    equals: O.equals,
    notEquals: O.notEquals,
    compare: (x, y) => O.compare(y, x),
    lessThan: O.greaterThan,
    lessThanOrEqual: O.greaterThanOrEqual,
    greaterThan: O.lessThan,
    greaterThanOrEqual: O.lessThanOrEqual,
  };
}

/**
 * Combine multiple Ords (lexicographic)
 */
export function ordTuple<A, B>(OA: Ord<A>, OB: Ord<B>): Ord<[A, B]> {
  const compare = ([a1, b1]: [A, B], [a2, b2]: [A, B]) => {
    const cmpA = OA.compare(a1, a2);
    return cmpA !== EQ ? cmpA : OB.compare(b1, b2);
  };
  return {
    equals: ([a1, b1], [a2, b2]) => OA.equals(a1, a2) && OB.equals(b1, b2),
    notEquals: ([a1, b1], [a2, b2]) => OA.notEquals(a1, a2) || OB.notEquals(b1, b2),
    compare,
    lessThan: (x, y) => compare(x, y) === LT,
    lessThanOrEqual: (x, y) => compare(x, y) !== GT,
    greaterThan: (x, y) => compare(x, y) === GT,
    greaterThanOrEqual: (x, y) => compare(x, y) !== LT,
  };
}

/**
 * Ord for arrays (lexicographic)
 */
export function ordArray<A>(O: Ord<A>): Ord<A[]> {
  const E = eqArray<A>(O);
  const compare = (xs: A[], ys: A[]) => {
    const len = Math.min(xs.length, ys.length);
    for (let i = 0; i < len; i++) {
      const cmp = O.compare(xs[i], ys[i]);
      if (cmp !== EQ) return cmp;
    }
    return xs.length < ys.length ? LT : xs.length > ys.length ? GT : EQ;
  };
  return {
    equals: E.equals,
    notEquals: E.notEquals,
    compare,
    lessThan: (xs, ys) => compare(xs, ys) === LT,
    lessThanOrEqual: (xs, ys) => compare(xs, ys) !== GT,
    greaterThan: (xs, ys) => compare(xs, ys) === GT,
    greaterThanOrEqual: (xs, ys) => compare(xs, ys) !== LT,
  };
}

// ============================================================================
// Common Instances
// ============================================================================

/**
 * Eq for strings - enables `str1 === str2` operator rewriting
 */
/** @impl Eq<string> */
export const eqString: Eq<string> = eqStrict();
/**
 * Eq for numbers - enables `n1 === n2` operator rewriting
 *
 * Deliberately JS `===` semantics: `equals(NaN, NaN)` is false (so NaN breaks
 * Eq's reflexivity law) and `equals(-0, 0)` is true. Use `ordNumber.equals` for a
 * lawful equivalence in which NaN equals itself.
 */
/** @impl Eq<number> */
export const eqNumber: Eq<number> = eqStrict();
/**
 * Eq for booleans - enables `b1 === b2` operator rewriting
 */
/** @impl Eq<boolean> */
export const eqBoolean: Eq<boolean> = eqStrict();
/**
 * Ord for strings - enables `str1 < str2` operator rewriting
 */
/** @impl Ord<string> */
export const ordString: Ord<string> = {
  equals: (x, y) => x === y,
  notEquals: (x, y) => x !== y,
  compare: (x, y) => (x < y ? LT : x > y ? GT : EQ),
  lessThan: (x, y) => x < y,
  lessThanOrEqual: (x, y) => x <= y,
  greaterThan: (x, y) => x > y,
  greaterThanOrEqual: (x, y) => x >= y,
};
/**
 * Ord for numbers - a lawful total order.
 *
 * NaN sorts after every other number and is equal to itself, so `compare`,
 * `equals` and the comparison methods always agree (JS `<` / `===` do not for
 * NaN: every comparison with NaN is false). `-0` and `0` compare EQ.
 * For non-NaN inputs this is exactly `<`, `<=`, `>`, `>=`, `===`.
 */
const compareNumber = (x: number, y: number): Ordering => {
  if (x < y) return LT;
  if (x > y) return GT;
  if (x === y) return EQ;
  // At least one is NaN.
  const xn = x !== x;
  const yn = y !== y;
  return xn && yn ? EQ : xn ? GT : LT;
};
/** @impl Ord<number> */
export const ordNumber: Ord<number> = {
  equals: (x, y) => compareNumber(x, y) === EQ,
  notEquals: (x, y) => compareNumber(x, y) !== EQ,
  compare: compareNumber,
  lessThan: (x, y) => compareNumber(x, y) === LT,
  lessThanOrEqual: (x, y) => compareNumber(x, y) !== GT,
  greaterThan: (x, y) => compareNumber(x, y) === GT,
  greaterThanOrEqual: (x, y) => compareNumber(x, y) !== LT,
};
/**
 * Ord for booleans (false < true) - enables `b1 < b2` operator rewriting
 */
/** @impl Ord<boolean> */
export const ordBoolean: Ord<boolean> = {
  equals: (x, y) => x === y,
  notEquals: (x, y) => x !== y,
  compare: (x, y) => (x === y ? EQ : x ? GT : LT),
  lessThan: (x, y) => !x && y,
  lessThanOrEqual: (x, y) => !x || y,
  greaterThan: (x, y) => x && !y,
  greaterThanOrEqual: (x, y) => x || !y,
};
/**
 * Ord for dates - enables `d1 < d2` operator rewriting
 */
/** @impl Ord<Date> */
export const ordDate: Ord<Date> = {
  equals: (x, y) => x.getTime() === y.getTime(),
  notEquals: (x, y) => x.getTime() !== y.getTime(),
  compare: (x, y) => {
    const tx = x.getTime();
    const ty = y.getTime();
    return tx < ty ? LT : tx > ty ? GT : EQ;
  },
  lessThan: (x, y) => x.getTime() < y.getTime(),
  lessThanOrEqual: (x, y) => x.getTime() <= y.getTime(),
  greaterThan: (x, y) => x.getTime() > y.getTime(),
  greaterThanOrEqual: (x, y) => x.getTime() >= y.getTime(),
};
// ============================================================================
// Instance Creators
// ============================================================================

/**
 * Create an Eq instance from a custom equality function.
 *
 * The resulting instance supports operator rewriting:
 * `a === b` → `customEq.equals(a, b)`
 */
export function makeEq<A>(equals: (x: A, y: A) => boolean): Eq<A> {
  return { equals, notEquals: (x, y) => !equals(x, y) };
}

/**
 * Create an Ord instance from a compare function.
 * Automatically generates comparison methods for operator rewriting.
 */
export function makeOrd<A>(compare: (x: A, y: A) => Ordering): Ord<A> {
  return {
    equals: (x, y) => compare(x, y) === EQ,
    notEquals: (x, y) => compare(x, y) !== EQ,
    compare,
    lessThan: (x, y) => compare(x, y) === LT,
    lessThanOrEqual: (x, y) => compare(x, y) !== GT,
    greaterThan: (x, y) => compare(x, y) === GT,
    greaterThanOrEqual: (x, y) => compare(x, y) !== LT,
  };
}

/**
 * Create an Ord instance from a comparator function (returns number).
 * Generates all comparison methods for operator rewriting automatically.
 */
export function fromCompare<A>(comparator: (x: A, y: A) => number): Ord<A> {
  const compare = (x: A, y: A): Ordering => {
    const result = comparator(x, y);
    return result < 0 ? LT : result > 0 ? GT : EQ;
  };
  return {
    equals: (x, y) => comparator(x, y) === 0,
    notEquals: (x, y) => comparator(x, y) !== 0,
    compare,
    lessThan: (x, y) => comparator(x, y) < 0,
    lessThanOrEqual: (x, y) => comparator(x, y) <= 0,
    greaterThan: (x, y) => comparator(x, y) > 0,
    greaterThanOrEqual: (x, y) => comparator(x, y) >= 0,
  };
}

// ============================================================================
// Contravariant Functor for Eq/Ord
// ============================================================================

/**
 * Contramap for Eq - transform the input
 */
export function contramapEq<A, B>(E: Eq<A>, f: (b: B) => A): Eq<B> {
  return {
    equals: (x, y) => E.equals(f(x), f(y)),
    notEquals: (x, y) => E.notEquals(f(x), f(y)),
  };
}

/**
 * Contramap for Ord - transform the input
 */
export function contramapOrd<A, B>(O: Ord<A>, f: (b: B) => A): Ord<B> {
  return {
    equals: (x, y) => O.equals(f(x), f(y)),
    notEquals: (x, y) => O.notEquals(f(x), f(y)),
    compare: (x, y) => O.compare(f(x), f(y)),
    lessThan: (x, y) => O.lessThan(f(x), f(y)),
    lessThanOrEqual: (x, y) => O.lessThanOrEqual(f(x), f(y)),
    greaterThan: (x, y) => O.greaterThan(f(x), f(y)),
    greaterThanOrEqual: (x, y) => O.greaterThanOrEqual(f(x), f(y)),
  };
}
