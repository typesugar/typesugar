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
 */

export interface Range {
  readonly start: number;
  readonly end: number;
  readonly step: number;
  readonly inclusive: boolean;
}

/** @deprecated Use `(start).until(end)` extension method instead. */
export function range(start: number, end: number, step: number = 1): Range {
  return { start, end, step, inclusive: false };
}

/** @deprecated Use `(start).to(end)` extension method instead. */
export function rangeInclusive(start: number, end: number, step: number = 1): Range {
  return { start, end, step, inclusive: true };
}

/** @deprecated Use `(start).until(end).step(n)` extension method instead. */
export function rangeBy(r: Range, step: number): Range {
  return { ...r, step };
}

/**
 * The same elements in the opposite order: starts at the range's last element
 * and ends (inclusively) at its first. An empty range reverses to an empty range.
 */
export function rangeReversed(r: Range): Range {
  const n = rangeSize(r);
  if (n === 0) return { start: r.start, end: r.start, step: -r.step, inclusive: false };
  return {
    start: r.start + (n - 1) * r.step,
    end: r.start,
    step: -r.step,
    inclusive: true,
  };
}

// ============================================================================
// Iteration
// ============================================================================

export function* rangeIterator(r: Range): IterableIterator<number> {
  const { start, end, step, inclusive } = r;
  if (step > 0) {
    for (let i = start; inclusive ? i <= end : i < end; i += step) yield i;
  } else if (step < 0) {
    for (let i = start; inclusive ? i >= end : i > end; i += step) yield i;
  }
}

/** @deprecated Use `[...(start).until(end)]` or `.toArray()` extension method instead. */
export function rangeToArray(r: Range): number[] {
  return [...rangeIterator(r)];
}

export function rangeForEach(r: Range, fn: (n: number, index: number) => void): void {
  let idx = 0;
  for (const n of rangeIterator(r)) fn(n, idx++);
}

export function rangeMap<A>(r: Range, fn: (n: number, index: number) => A): A[] {
  const result: A[] = [];
  let idx = 0;
  for (const n of rangeIterator(r)) result.push(fn(n, idx++));
  return result;
}

export function rangeFilter(r: Range, pred: (n: number) => boolean): number[] {
  const result: number[] = [];
  for (const n of rangeIterator(r)) if (pred(n)) result.push(n);
  return result;
}

export function rangeReduce<A>(r: Range, init: A, fn: (acc: A, n: number) => A): A {
  let acc = init;
  for (const n of rangeIterator(r)) acc = fn(acc, n);
  return acc;
}

// ============================================================================
// Queries
// ============================================================================

export function rangeContains(r: Range, value: number): boolean {
  const { start, end, step, inclusive } = r;
  if (step > 0) {
    if (inclusive ? value > end : value >= end) return false;
    if (value < start) return false;
  } else {
    if (inclusive ? value < end : value <= end) return false;
    if (value > start) return false;
  }
  return (value - start) % step === 0;
}

/** Number of elements the range iterates (always equals `rangeToArray(r).length`). */
export function rangeSize(r: Range): number {
  const { start, end, step, inclusive } = r;
  if (step === 0 || Number.isNaN(step)) return 0;
  if (!Number.isFinite(step)) return [...rangeIterator(r)].length; // ±Infinity: at most 1
  // Number of whole steps from start that stay on the near side of `end`.
  const steps = (end - start) / step;
  if (steps < 0) return 0;
  if (inclusive) return Math.floor(steps) + 1;
  return Math.ceil(steps);
}

export function rangeFirst(r: Range): number | undefined {
  const iter = rangeIterator(r);
  const result = iter.next();
  return result.done ? undefined : result.value;
}

export function rangeLast(r: Range): number | undefined {
  let last: number | undefined;
  for (const n of rangeIterator(r)) last = n;
  return last;
}

export function rangeIsEmpty(r: Range): boolean {
  return rangeFirst(r) === undefined;
}

// ============================================================================
// Typeclass Instances
// ============================================================================

import type { Eq, Ord, Ordering } from "../typeclasses/index.js";
import { EQ_ORD, LT, GT } from "../typeclasses/index.js";

/**
 * Eq instance for Range.
 * Two ranges are equal if they have the same start, end, step, and inclusive flag.
 */
export const eqRange: Eq<Range> = {
  equals: (a, b) =>
    a.start === b.start && a.end === b.end && a.step === b.step && a.inclusive === b.inclusive,
  notEquals: (a, b) =>
    a.start !== b.start || a.end !== b.end || a.step !== b.step || a.inclusive !== b.inclusive,
};

/**
 * Ord instance for Range.
 * Compares lexicographically by: start, end, step, inclusive.
 */
export const ordRange: Ord<Range> = (() => {
  const compare = (a: Range, b: Range): Ordering => {
    if (a.start < b.start) return LT;
    if (a.start > b.start) return GT;
    if (a.end < b.end) return LT;
    if (a.end > b.end) return GT;
    if (a.step < b.step) return LT;
    if (a.step > b.step) return GT;
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

// ============================================================================
// Aggregate
// ============================================================================

export const RangeExt = {
  range,
  inclusive: rangeInclusive,
  by: rangeBy,
  reversed: rangeReversed,
  iterator: rangeIterator,
  toArray: rangeToArray,
  forEach: rangeForEach,
  map: rangeMap,
  filter: rangeFilter,
  reduce: rangeReduce,
  contains: rangeContains,
  size: rangeSize,
  first: rangeFirst,
  last: rangeLast,
  isEmpty: rangeIsEmpty,
} as const;
