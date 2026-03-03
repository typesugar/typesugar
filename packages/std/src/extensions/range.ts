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

import {
  type Range,
  rangeBy,
  rangeReversed,
  rangeToArray,
  rangeIterator,
  rangeForEach,
  rangeMap,
  rangeFilter,
  rangeReduce,
  rangeContains,
  rangeSize,
  rangeFirst,
  rangeLast,
  rangeIsEmpty,
} from "../data/range.js";

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
  return rangeBy(r, s);
}

/**
 * Returns a new Range with start and end swapped and step negated.
 *
 * @example
 * (1).to(5).reversed().toArray() // [5, 4, 3, 2, 1]
 */
export function reversed(r: Range): Range {
  return rangeReversed(r);
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
  return rangeToArray(r);
}

/**
 * Returns an iterator over the Range values.
 *
 * @example
 * for (const n of (1).to(5).iterator()) console.log(n)
 */
export function iterator(r: Range): IterableIterator<number> {
  return rangeIterator(r);
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
  return rangeContains(r, value);
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
  return rangeSize(r);
}

/**
 * Returns the first element of the Range, or undefined if empty.
 *
 * @example
 * (1).to(10).first()            // 1
 * (10).to(1).first()            // undefined (empty with positive step)
 */
export function first(r: Range): number | undefined {
  return rangeFirst(r);
}

/**
 * Returns the last element of the Range, or undefined if empty.
 *
 * @example
 * (1).to(10).last()             // 10
 * (1).to(10).step(3).last()     // 10
 */
export function last(r: Range): number | undefined {
  return rangeLast(r);
}

/**
 * Returns true if the Range contains no elements.
 *
 * @example
 * (1).to(10).isEmpty()          // false
 * (10).to(1).isEmpty()          // true (empty with positive step)
 */
export function isEmpty(r: Range): boolean {
  return rangeIsEmpty(r);
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
  return rangeForEach(r, fn);
}

/**
 * Maps each element of the Range to a new value.
 *
 * @example
 * (1).to(5).map(n => n * n)     // [1, 4, 9, 16, 25]
 */
export function map<T>(r: Range, fn: (n: number, index: number) => T): T[] {
  return rangeMap(r, fn);
}

/**
 * Filters the Range to elements matching the predicate.
 *
 * @example
 * (1).to(10).filter(n => n % 2 === 0) // [2, 4, 6, 8, 10]
 */
export function filter(r: Range, pred: (n: number) => boolean): number[] {
  return rangeFilter(r, pred);
}

/**
 * Reduces the Range to a single value.
 *
 * @example
 * (1).to(5).reduce(0, (acc, n) => acc + n) // 15
 */
export function reduce<T>(r: Range, init: T, fn: (acc: T, n: number) => T): T {
  return rangeReduce(r, init, fn);
}

// ============================================================================
// Aggregate — collect all into a namespace-like object for extension
// ============================================================================

export const RangeExtensions = {
  step,
  reversed,
  toArray,
  iterator,
  contains,
  size,
  first,
  last,
  isEmpty,
  forEach,
  map,
  filter,
  reduce,
} as const;
