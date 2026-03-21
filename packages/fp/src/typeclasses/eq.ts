/**
 * Eq, PartialOrd, and Ord Typeclasses
 *
 * Eq: Equality comparison
 * PartialOrd: Partial ordering (may be incomparable)
 * Ord: Total ordering
 *
 * Laws:
 *   - Reflexivity: eqv(x, x) === true
 *   - Symmetry: eqv(x, y) === eqv(y, x)
 *   - Transitivity: eqv(x, y) && eqv(y, z) => eqv(x, z)
 *   - Ord Antisymmetry: compare(x, y) <= 0 && compare(y, x) <= 0 => eqv(x, y)
 *   - Ord Transitivity: compare(x, y) <= 0 && compare(y, z) <= 0 => compare(x, z) <= 0
 *   - Ord Totality: compare(x, y) <= 0 || compare(y, x) <= 0
 *
 * ## Operator Support (@op JSDoc tags)
 *
 * Methods are annotated with @op to enable operator rewriting by the transformer:
 * - `a === b` → `Eq<A>.eqv(a, b)` when A has an Eq instance
 * - `a < b`  → `Ord<A>.compare(a, b) < 0` when A has an Ord instance
 */

import { registerInstanceWithMeta } from "@typesugar/macros";
import { instance } from "@typesugar/macros/runtime";

// ============================================================================
// Ordering
// ============================================================================

/**
 * Result of a comparison
 */
export type Ordering = -1 | 0 | 1;

export const LT: Ordering = -1;
export const EQ: Ordering = 0;
export const GT: Ordering = 1;

// ============================================================================
// Eq
// ============================================================================

/**
 * Eq typeclass - equality comparison with operator support.
 *
 * The `eqv` method is annotated with @op to enable:
 * - `optA === optB` → `eqOption.eqv(optA, optB)` when Option has an Eq instance
 *
 * @example
 * ```typescript
 * const eq = getEq(eqNumber);
 * const a = Some(1);
 * const b = Some(1);
 *
 * // With @op annotation, the transformer rewrites:
 * a === b  // → eq.eqv(a, b) → true
 * ```
 */
export interface Eq<A> {
  readonly eqv: (x: A, y: A) => boolean;
}

// ============================================================================
// PartialOrd
// ============================================================================

/**
 * PartialOrd typeclass - partial ordering
 * Returns undefined when values are incomparable
 */
export interface PartialOrd<A> extends Eq<A> {
  readonly partialCompare: (x: A, y: A) => Ordering | undefined;
}

// ============================================================================
// Ord
// ============================================================================

/**
 * Ord typeclass - total ordering with operator support.
 *
 * Methods are annotated with @op to enable operator rewriting by the transformer:
 * - `a < b`  → `ordA.lessThan(a, b)`
 * - `a <= b` → `ordA.lessThanOrEqual(a, b)`
 * - `a > b`  → `ordA.greaterThan(a, b)`
 * - `a >= b` → `ordA.greaterThanOrEqual(a, b)`
 *
 * @example
 * ```typescript
 * const ord = getOrd(ordNumber);
 * const a = Some(1);
 * const b = Some(2);
 *
 * // With @op annotation, the transformer rewrites:
 * a < b   // → ord.lessThan(a, b) → true
 * a >= b  // → ord.greaterThanOrEqual(a, b) → false
 * ```
 */
export interface Ord<A> extends Eq<A> {
  readonly compare: (x: A, y: A) => Ordering;
  readonly lessThan: (x: A, y: A) => boolean;
  readonly lessThanOrEqual: (x: A, y: A) => boolean;
  readonly greaterThan: (x: A, y: A) => boolean;
  readonly greaterThanOrEqual: (x: A, y: A) => boolean;
}

// ============================================================================
// Derived Operations from Eq
// ============================================================================

/**
 * Not equal
 */
export function neqv<A>(E: Eq<A>): (x: A, y: A) => boolean {
  return (x, y) => !E.eqv(x, y);
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
    eqv: (x, y) => x === y,
  };
}

/**
 * Eq by mapping to a comparable value
 */
export function eqBy<A, B>(E: Eq<B>, f: (a: A) => B): Eq<A> {
  return {
    eqv: (x, y) => E.eqv(f(x), f(y)),
  };
}

/**
 * Eq for tuples
 */
export function eqTuple<A, B>(EA: Eq<A>, EB: Eq<B>): Eq<[A, B]> {
  return {
    eqv: ([a1, b1], [a2, b2]) => EA.eqv(a1, a2) && EB.eqv(b1, b2),
  };
}

/**
 * Eq for arrays (element-wise)
 */
export function eqArray<A>(E: Eq<A>): Eq<A[]> {
  return {
    eqv: (xs, ys) => {
      if (xs.length !== ys.length) return false;
      return xs.every((x, i) => E.eqv(x, ys[i]));
    },
  };
}

// ============================================================================
// Ord Combinators
// ============================================================================

/**
 * Ord by mapping to a comparable value
 */
export function ordBy<A, B>(O: Ord<B>, f: (a: A) => B): Ord<A> {
  const compare = (x: A, y: A) => O.compare(f(x), f(y));
  return {
    eqv: (x, y) => O.eqv(f(x), f(y)),
    compare,
    lessThan: (x, y) => compare(x, y) === LT,
    lessThanOrEqual: (x, y) => compare(x, y) !== GT,
    greaterThan: (x, y) => compare(x, y) === GT,
    greaterThanOrEqual: (x, y) => compare(x, y) !== LT,
  };
}

/**
 * Reverse an Ord
 */
export function reverse<A>(O: Ord<A>): Ord<A> {
  return {
    eqv: O.eqv,
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
    eqv: ([a1, b1], [a2, b2]) => OA.eqv(a1, a2) && OB.eqv(b1, b2),
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
  const compare = (xs: A[], ys: A[]) => {
    const len = Math.min(xs.length, ys.length);
    for (let i = 0; i < len; i++) {
      const cmp = O.compare(xs[i], ys[i]);
      if (cmp !== EQ) return cmp;
    }
    return xs.length < ys.length ? LT : xs.length > ys.length ? GT : EQ;
  };
  return {
    eqv: eqArray(O).eqv,
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
export const eqString: Eq<string> = eqStrict();

registerInstanceWithMeta({
  typeclassName: "Eq",
  forType: "string",
  instanceName: "eqString",
  derived: false,
});

/**
 * Eq for numbers - enables `n1 === n2` operator rewriting
 */
export const eqNumber: Eq<number> = eqStrict();

registerInstanceWithMeta({
  typeclassName: "Eq",
  forType: "number",
  instanceName: "eqNumber",
  derived: false,
});

/**
 * Eq for booleans - enables `b1 === b2` operator rewriting
 */
export const eqBoolean: Eq<boolean> = eqStrict();

registerInstanceWithMeta({
  typeclassName: "Eq",
  forType: "boolean",
  instanceName: "eqBoolean",
  derived: false,
});

/**
 * Ord for strings - enables `str1 < str2` operator rewriting
 */
export const ordString: Ord<string> = {
  eqv: (x, y) => x === y,
  compare: (x, y) => (x < y ? LT : x > y ? GT : EQ),
  lessThan: (x, y) => x < y,
  lessThanOrEqual: (x, y) => x <= y,
  greaterThan: (x, y) => x > y,
  greaterThanOrEqual: (x, y) => x >= y,
};

registerInstanceWithMeta({
  typeclassName: "Ord",
  forType: "string",
  instanceName: "ordString",
  derived: false,
});

/**
 * Ord for numbers - enables `n1 < n2` operator rewriting
 */
export const ordNumber: Ord<number> = {
  eqv: (x, y) => x === y,
  compare: (x, y) => (x < y ? LT : x > y ? GT : EQ),
  lessThan: (x, y) => x < y,
  lessThanOrEqual: (x, y) => x <= y,
  greaterThan: (x, y) => x > y,
  greaterThanOrEqual: (x, y) => x >= y,
};

registerInstanceWithMeta({
  typeclassName: "Ord",
  forType: "number",
  instanceName: "ordNumber",
  derived: false,
});

/**
 * Ord for booleans (false < true) - enables `b1 < b2` operator rewriting
 */
export const ordBoolean: Ord<boolean> = {
  eqv: (x, y) => x === y,
  compare: (x, y) => (x === y ? EQ : x ? GT : LT),
  lessThan: (x, y) => !x && y,
  lessThanOrEqual: (x, y) => !x || y,
  greaterThan: (x, y) => x && !y,
  greaterThanOrEqual: (x, y) => x || !y,
};

registerInstanceWithMeta({
  typeclassName: "Ord",
  forType: "boolean",
  instanceName: "ordBoolean",
  derived: false,
});

/**
 * Ord for dates - enables `d1 < d2` operator rewriting
 */
export const ordDate: Ord<Date> = {
  eqv: (x, y) => x.getTime() === y.getTime(),
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

registerInstanceWithMeta({
  typeclassName: "Ord",
  forType: "Date",
  instanceName: "ordDate",
  derived: false,
});

// ============================================================================
// Instance Creators
// ============================================================================

/**
 * Create an Eq instance from a custom equality function.
 *
 * The resulting instance supports operator rewriting:
 * `a === b` → `customEq.eqv(a, b)`
 */
export function makeEq<A>(eqv: (x: A, y: A) => boolean): Eq<A> {
  return { eqv };
}

/**
 * Create an Ord instance from a compare function.
 * Automatically generates comparison methods for operator rewriting.
 */
export function makeOrd<A>(compare: (x: A, y: A) => Ordering): Ord<A> {
  return {
    eqv: (x, y) => compare(x, y) === EQ,
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
    eqv: (x, y) => comparator(x, y) === 0,
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
    eqv: (x, y) => E.eqv(f(x), f(y)),
  };
}

/**
 * Contramap for Ord - transform the input
 */
export function contramapOrd<A, B>(O: Ord<A>, f: (b: B) => A): Ord<B> {
  return {
    eqv: (x, y) => O.eqv(f(x), f(y)),
    compare: (x, y) => O.compare(f(x), f(y)),
    lessThan: (x, y) => O.lessThan(f(x), f(y)),
    lessThanOrEqual: (x, y) => O.lessThanOrEqual(f(x), f(y)),
    greaterThan: (x, y) => O.greaterThan(f(x), f(y)),
    greaterThanOrEqual: (x, y) => O.greaterThanOrEqual(f(x), f(y)),
  };
}
