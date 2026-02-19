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
 */

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
 * Eq typeclass - equality comparison
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
 * Ord typeclass - total ordering
 */
export interface Ord<A> extends Eq<A> {
  readonly compare: (x: A, y: A) => Ordering;
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
  return {
    eqv: (x, y) => O.eqv(f(x), f(y)),
    compare: (x, y) => O.compare(f(x), f(y)),
  };
}

/**
 * Reverse an Ord
 */
export function reverse<A>(O: Ord<A>): Ord<A> {
  return {
    eqv: O.eqv,
    compare: (x, y) => O.compare(y, x),
  };
}

/**
 * Combine multiple Ords (lexicographic)
 */
export function ordTuple<A, B>(OA: Ord<A>, OB: Ord<B>): Ord<[A, B]> {
  return {
    eqv: ([a1, b1], [a2, b2]) => OA.eqv(a1, a2) && OB.eqv(b1, b2),
    compare: ([a1, b1], [a2, b2]) => {
      const cmpA = OA.compare(a1, a2);
      return cmpA !== EQ ? cmpA : OB.compare(b1, b2);
    },
  };
}

/**
 * Ord for arrays (lexicographic)
 */
export function ordArray<A>(O: Ord<A>): Ord<A[]> {
  return {
    eqv: eqArray(O).eqv,
    compare: (xs, ys) => {
      const len = Math.min(xs.length, ys.length);
      for (let i = 0; i < len; i++) {
        const cmp = O.compare(xs[i], ys[i]);
        if (cmp !== EQ) return cmp;
      }
      return xs.length < ys.length ? LT : xs.length > ys.length ? GT : EQ;
    },
  };
}

// ============================================================================
// Common Instances
// ============================================================================

/**
 * Eq for strings
 */
export const eqString: Eq<string> = eqStrict();

/**
 * Eq for numbers
 */
export const eqNumber: Eq<number> = eqStrict();

/**
 * Eq for booleans
 */
export const eqBoolean: Eq<boolean> = eqStrict();

/**
 * Ord for strings
 */
export const ordString: Ord<string> = {
  eqv: (x, y) => x === y,
  compare: (x, y) => (x < y ? LT : x > y ? GT : EQ),
};

/**
 * Ord for numbers
 */
export const ordNumber: Ord<number> = {
  eqv: (x, y) => x === y,
  compare: (x, y) => (x < y ? LT : x > y ? GT : EQ),
};

/**
 * Ord for booleans (false < true)
 */
export const ordBoolean: Ord<boolean> = {
  eqv: (x, y) => x === y,
  compare: (x, y) => (x === y ? EQ : x ? GT : LT),
};

/**
 * Ord for dates
 */
export const ordDate: Ord<Date> = {
  eqv: (x, y) => x.getTime() === y.getTime(),
  compare: (x, y) => {
    const tx = x.getTime();
    const ty = y.getTime();
    return tx < ty ? LT : tx > ty ? GT : EQ;
  },
};

// ============================================================================
// Instance Creators
// ============================================================================

/**
 * Create an Eq instance
 */
export function makeEq<A>(eqv: (x: A, y: A) => boolean): Eq<A> {
  return { eqv };
}

/**
 * Create an Ord instance from a compare function
 */
export function makeOrd<A>(compare: (x: A, y: A) => Ordering): Ord<A> {
  return {
    eqv: (x, y) => compare(x, y) === EQ,
    compare,
  };
}

/**
 * Create an Ord instance from a comparator function (returns number)
 */
export function fromCompare<A>(compare: (x: A, y: A) => number): Ord<A> {
  return makeOrd((x, y) => {
    const result = compare(x, y);
    return result < 0 ? LT : result > 0 ? GT : EQ;
  });
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
  };
}
