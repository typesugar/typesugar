"use extension";

/**
 * Range Extension Methods
 *
 * Chainable methods for Range objects, enabling fluent syntax:
 *
 *   (1).to(10).step(2).toArray()  // [1, 3, 5, 7, 9]
 *   (1).to(100).contains(42)      // true
 *   (1).to(5).map(n => n * n)     // [1, 4, 9, 16, 25]
 *
 * Inspired by:
 * - Scala (Range: by, contains, map, foreach, toArray)
 * - Kotlin (IntProgression: step, reversed, first, last)
 * - Rust (Iterator trait on ranges)
 * - Ruby (Range: each, step, to_a)
 */

import type { Range } from "../data/range.js";

// ============================================================================
// Range Transformations (return new Range)
// ============================================================================

/**
 * Returns a new Range with the specified step value.
 *
 * @example
 * (1).to(10).step(2).toArray()  // [1, 3, 5, 7, 9]
 * (10).to(1).step(-2).toArray() // [10, 8, 6, 4, 2]
 */
export function step(r: Range, s: number): Range {
  return { ...r, step: s };
}

/**
 * Returns a Range over the same elements in reverse order (it starts at the
 * last element, which for a stepped range need not be `end`).
 *
 * @example
 * (1).to(5).reversed().toArray() // [5, 4, 3, 2, 1]
 * (1).to(10).step(2).reversed().toArray() // [9, 7, 5, 3, 1]
 */
export function reversed(r: Range): Range {
  const n = size(r);
  if (n === 0) return { start: r.start, end: r.start, step: -r.step, inclusive: false };
  return {
    start: r.start + (n - 1) * r.step,
    end: r.start,
    step: -r.step,
    inclusive: true,
  };
}

// ============================================================================
// Materialization
// ============================================================================

/**
 * Materializes the Range into an array of numbers.
 *
 * @example
 * (1).to(5).toArray()           // [1, 2, 3, 4, 5]
 * (1).to(10).step(3).toArray()  // [1, 4, 7, 10]
 */
export function toArray(r: Range): number[] {
  return [...iterator(r)];
}

/**
 * Returns an iterator over the Range values.
 *
 * @example
 * for (const n of (1).to(5).iterator()) console.log(n)
 */
export function* iterator(r: Range): IterableIterator<number> {
  const { start, end, step, inclusive } = r;
  if (step > 0) {
    for (let i = start; inclusive ? i <= end : i < end; i += step) yield i;
  } else if (step < 0) {
    for (let i = start; inclusive ? i >= end : i > end; i += step) yield i;
  }
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Returns true if the value is contained in the Range.
 * Considers step — a value must be reachable from start by step increments.
 *
 * @example
 * (1).to(10).contains(5)        // true
 * (1).to(10).step(2).contains(4) // false (only odd numbers)
 */
export function contains(r: Range, value: number): boolean {
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

/**
 * Returns the number of elements in the Range.
 *
 * @example
 * (1).to(10).size()             // 10
 * (1).until(10).size()          // 9
 * (1).to(10).step(2).size()     // 5
 */
export function size(r: Range): number {
  const { start, end, step, inclusive } = r;
  if (step === 0 || Number.isNaN(step)) return 0;
  if (!Number.isFinite(step)) return [...iterator(r)].length; // ±Infinity: at most 1
  // Number of whole steps from start that stay on the near side of `end`.
  const steps = (end - start) / step;
  if (steps < 0) return 0;
  if (inclusive) return Math.floor(steps) + 1;
  return Math.ceil(steps);
}

/**
 * Returns the first element of the Range, or undefined if empty.
 *
 * @example
 * (1).to(10).first()            // 1
 * (10).to(1).first()            // undefined (empty with positive step)
 */
export function first(r: Range): number | undefined {
  const result = iterator(r).next();
  return result.done ? undefined : result.value;
}

/**
 * Returns the last element of the Range, or undefined if empty.
 *
 * @example
 * (1).to(10).last()             // 10
 * (1).to(10).step(3).last()     // 10
 */
export function last(r: Range): number | undefined {
  let result: number | undefined;
  for (const n of iterator(r)) result = n;
  return result;
}

/**
 * Returns true if the Range contains no elements.
 *
 * @example
 * (1).to(10).isEmpty()          // false
 * (10).to(1).isEmpty()          // true (empty with positive step)
 */
export function isEmpty(r: Range): boolean {
  return first(r) === undefined;
}

// ============================================================================
// Iteration
// ============================================================================

/**
 * Executes a function for each element in the Range.
 *
 * @example
 * (1).to(5).forEach(n => console.log(n))
 */
export function forEach(r: Range, fn: (n: number, index: number) => void): void {
  let idx = 0;
  for (const n of iterator(r)) fn(n, idx++);
}

/**
 * Maps each element of the Range to a new value.
 *
 * @example
 * (1).to(5).map(n => n * n)     // [1, 4, 9, 16, 25]
 */
export function map<T>(r: Range, fn: (n: number, index: number) => T): T[] {
  const result: T[] = [];
  let idx = 0;
  for (const n of iterator(r)) result.push(fn(n, idx++));
  return result;
}

/**
 * Filters the Range to elements matching the predicate.
 *
 * @example
 * (1).to(10).filter(n => n % 2 === 0) // [2, 4, 6, 8, 10]
 */
export function filter(r: Range, pred: (n: number) => boolean): number[] {
  const result: number[] = [];
  for (const n of iterator(r)) if (pred(n)) result.push(n);
  return result;
}

/**
 * Reduces the Range to a single value.
 *
 * @example
 * (1).to(5).reduce(0, (acc, n) => acc + n) // 15
 */
export function reduce<T>(r: Range, init: T, fn: (acc: T, n: number) => T): T {
  let acc = init;
  for (const n of iterator(r)) acc = fn(acc, n);
  return acc;
}
