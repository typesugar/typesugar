/**
 * Range Type
 *
 * Inspired by:
 * - Scala (Range, NumericRange, inclusive/exclusive, by, contains, map, foreach)
 * - Kotlin (IntRange, LongRange, CharRange, step, reversed, contains, first, last)
 * - Rust (Range, RangeInclusive, Iterator trait on ranges)
 * - Haskell ([1..10], [1,3..10], enumFromTo, enumFromThenTo)
 * - Python (range, slice)
 * - Ruby (Range, each, step, include?, to_a)
 *
 * Build a Range with the `to`/`until` number extensions (`(1).to(10)`,
 * `(0).until(n)`); its methods (`step`, `toArray`, `map`, ...) are the
 * extensions in `extensions/range.ts`.
 */

export interface Range {
  readonly start: number;
  readonly end: number;
  /** The distance between elements, set with the `step` extension (`(0).to(10).step(2)`). */
  readonly stride: number;
  readonly inclusive: boolean;
}

// ============================================================================
// Typeclass Instances
// ============================================================================

import type { Eq, Ord, Ordering } from "../typeclasses/index.js";
import { EQ_ORD, LT, GT } from "../typeclasses/index.js";

/**
 * Eq instance for Range.
 * Two ranges are equal if they have the same start, end, stride and inclusive flag.
 */
export const eqRange: Eq<Range> = {
  equals: (a, b) =>
    a.start === b.start && a.end === b.end && a.stride === b.stride && a.inclusive === b.inclusive,
  notEquals: (a, b) =>
    a.start !== b.start || a.end !== b.end || a.stride !== b.stride || a.inclusive !== b.inclusive,
};

/**
 * Ord instance for Range.
 * Compares lexicographically by: start, end, stride, inclusive.
 */
export const ordRange: Ord<Range> = (() => {
  const compare = (a: Range, b: Range): Ordering => {
    if (a.start < b.start) return LT;
    if (a.start > b.start) return GT;
    if (a.end < b.end) return LT;
    if (a.end > b.end) return GT;
    if (a.stride < b.stride) return LT;
    if (a.stride > b.stride) return GT;
    if (a.inclusive && !b.inclusive) return GT;
    if (!a.inclusive && b.inclusive) return LT;
    return EQ_ORD;
  };

  return {
    equals: eqRange.equals,
    notEquals: eqRange.notEquals,
    compare,
    lessThan: (a, b) => compare(a, b) === LT,
    lessThanOrEqual: (a, b) => compare(a, b) !== GT,
    greaterThan: (a, b) => compare(a, b) === GT,
    greaterThanOrEqual: (a, b) => compare(a, b) !== LT,
  };
})();
