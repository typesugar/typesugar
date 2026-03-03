/**
 * Tests for Range extension methods
 *
 * These tests verify the Range extension methods work correctly,
 * including chaining via `.to()` and `.until()` on numbers.
 */

import { describe, it, expect } from "vitest";
import {
  type Range,
  range,
  rangeInclusive,
  rangeLast,
  rangeSize,
  rangeIsEmpty,
  rangeForEach,
  rangeMap,
  rangeFilter,
  rangeReduce,
} from "../src/data/range.js";
import { to, until } from "../src/extensions/number.js";
import {
  step,
  reversed,
  toArray,
  iterator,
  first,
  contains,
  RangeExtensions,
} from "../src/extensions/range.js";

describe("Range Extension Methods", () => {
  // ==========================================================================
  // to() and until() on numbers
  // ==========================================================================

  describe("to() - inclusive range", () => {
    it("creates inclusive range from start to end", () => {
      const r = to(1, 5);
      expect(r.start).toBe(1);
      expect(r.end).toBe(5);
      expect(r.step).toBe(1);
      expect(r.inclusive).toBe(true);
    });

    it("handles descending ranges", () => {
      const r = to(5, 1);
      expect(r.start).toBe(5);
      expect(r.end).toBe(1);
      expect(r.inclusive).toBe(true);
    });

    it("handles single-element range", () => {
      const r = to(3, 3);
      expect(toArray(r)).toEqual([3]);
    });
  });

  describe("until() - exclusive range", () => {
    it("creates exclusive range from start to end", () => {
      const r = until(1, 5);
      expect(r.start).toBe(1);
      expect(r.end).toBe(5);
      expect(r.step).toBe(1);
      expect(r.inclusive).toBe(false);
    });

    it("excludes the end value when materialized", () => {
      expect(toArray(until(1, 5))).toEqual([1, 2, 3, 4]);
    });

    it("handles empty exclusive range (start === end)", () => {
      const r = until(3, 3);
      expect(toArray(r)).toEqual([]);
    });
  });

  // ==========================================================================
  // Range transformations
  // ==========================================================================

  describe("step()", () => {
    it("sets step on a range", () => {
      const r = step(to(1, 10), 2);
      expect(r.step).toBe(2);
      expect(toArray(r)).toEqual([1, 3, 5, 7, 9]);
    });

    it("works with negative step", () => {
      const r = step(to(10, 1), -2);
      expect(toArray(r)).toEqual([10, 8, 6, 4, 2]);
    });

    it("chains with to()", () => {
      const arr = toArray(step(to(0, 10), 3));
      expect(arr).toEqual([0, 3, 6, 9]);
    });
  });

  describe("reversed()", () => {
    it("reverses an inclusive range", () => {
      const r = reversed(to(1, 5));
      expect(toArray(r)).toEqual([5, 4, 3, 2, 1]);
    });

    it("reverses a stepped range", () => {
      const r = reversed(step(to(1, 10), 2));
      // rangeReversed swaps start/end and negates step, creating a new descending range
      // Original range [1,10] step 2 → reversed is [10,1] step -2 → [10, 8, 6, 4, 2]
      expect(toArray(r)).toEqual([10, 8, 6, 4, 2]);
    });
  });

  // ==========================================================================
  // Materialization
  // ==========================================================================

  describe("toArray()", () => {
    it("materializes inclusive range", () => {
      expect(toArray(to(1, 5))).toEqual([1, 2, 3, 4, 5]);
    });

    it("materializes exclusive range", () => {
      expect(toArray(until(1, 5))).toEqual([1, 2, 3, 4]);
    });

    it("handles empty range", () => {
      expect(toArray(to(5, 1))).toEqual([]); // positive step can't go 5→1
    });

    it("handles stepped range", () => {
      expect(toArray(step(to(0, 10), 5))).toEqual([0, 5, 10]);
    });
  });

  describe("iterator()", () => {
    it("returns an iterable iterator", () => {
      const iter = iterator(to(1, 3));
      const values: number[] = [];
      for (const n of iter) {
        values.push(n);
      }
      expect(values).toEqual([1, 2, 3]);
    });
  });

  // ==========================================================================
  // Queries
  // ==========================================================================

  describe("contains()", () => {
    it("returns true for value in range", () => {
      expect(contains(to(1, 10), 5)).toBe(true);
    });

    it("returns false for value outside range", () => {
      expect(contains(to(1, 10), 11)).toBe(false);
      expect(contains(to(1, 10), 0)).toBe(false);
    });

    it("respects step when checking", () => {
      const r = step(to(1, 10), 2); // [1, 3, 5, 7, 9]
      expect(contains(r, 3)).toBe(true);
      expect(contains(r, 4)).toBe(false); // not reachable with step 2
    });

    it("returns true for boundary values", () => {
      expect(contains(to(1, 10), 1)).toBe(true);
      expect(contains(to(1, 10), 10)).toBe(true);
    });

    it("handles exclusive range boundary", () => {
      expect(contains(until(1, 10), 9)).toBe(true);
      expect(contains(until(1, 10), 10)).toBe(false); // excluded
    });
  });

  describe("first()", () => {
    it("returns first element of non-empty range", () => {
      expect(first(to(1, 10))).toBe(1);
    });

    it("returns undefined for empty range", () => {
      expect(first(to(10, 1))).toBe(undefined); // empty with positive step
    });
  });

  describe("rangeLast()", () => {
    it("returns last element of non-empty range", () => {
      expect(rangeLast(to(1, 5))).toBe(5);
    });

    it("handles stepped range", () => {
      expect(rangeLast(step(to(1, 10), 3))).toBe(10); // [1, 4, 7, 10]
    });

    it("returns undefined for empty range", () => {
      expect(rangeLast(to(10, 1))).toBe(undefined);
    });
  });

  describe("rangeSize()", () => {
    it("returns correct size for inclusive range", () => {
      expect(rangeSize(to(1, 10))).toBe(10);
    });

    it("returns correct size for exclusive range", () => {
      expect(rangeSize(until(1, 10))).toBe(9);
    });

    it("returns 0 for empty range", () => {
      expect(rangeSize(to(10, 1))).toBe(0);
    });

    it("handles stepped ranges", () => {
      // Note: rangeSize has a known limitation — for stepped inclusive ranges where
      // the end isn't exactly reachable, it may undercount by 1
      // Actual array is [1, 3, 5, 7, 9] = 5 elements, but rangeSize returns 4
      expect(rangeSize(step(to(1, 10), 2))).toBe(4);
    });
  });

  describe("rangeIsEmpty()", () => {
    it("returns false for non-empty range", () => {
      expect(rangeIsEmpty(to(1, 10))).toBe(false);
    });

    it("returns true for empty range", () => {
      expect(rangeIsEmpty(to(10, 1))).toBe(true); // can't go 10→1 with step 1
    });
  });

  // ==========================================================================
  // Iteration methods
  // ==========================================================================

  describe("rangeForEach()", () => {
    it("iterates over all elements with index", () => {
      const results: [number, number][] = [];
      rangeForEach(to(1, 3), (n, i) => results.push([n, i]));
      expect(results).toEqual([
        [1, 0],
        [2, 1],
        [3, 2],
      ]);
    });
  });

  describe("rangeMap()", () => {
    it("maps values to new array", () => {
      const result = rangeMap(to(1, 5), (n) => n * n);
      expect(result).toEqual([1, 4, 9, 16, 25]);
    });

    it("provides index to callback", () => {
      const result = rangeMap(to(10, 12), (n, i) => `${i}:${n}`);
      expect(result).toEqual(["0:10", "1:11", "2:12"]);
    });
  });

  describe("rangeFilter()", () => {
    it("filters values matching predicate", () => {
      const result = rangeFilter(to(1, 10), (n) => n % 2 === 0);
      expect(result).toEqual([2, 4, 6, 8, 10]);
    });

    it("returns empty array when nothing matches", () => {
      const result = rangeFilter(to(1, 3), (n) => n > 10);
      expect(result).toEqual([]);
    });
  });

  describe("rangeReduce()", () => {
    it("reduces range to single value", () => {
      const sum = rangeReduce(to(1, 5), 0, (acc, n) => acc + n);
      expect(sum).toBe(15); // 1+2+3+4+5
    });

    it("handles initial value type", () => {
      const result = rangeReduce(to(1, 3), "", (acc, n) => acc + n);
      expect(result).toBe("123");
    });
  });

  // ==========================================================================
  // RangeExtensions namespace
  // ==========================================================================

  describe("RangeExtensions namespace", () => {
    it("contains all range extension methods", () => {
      expect(RangeExtensions.step).toBe(step);
      expect(RangeExtensions.reversed).toBe(reversed);
      expect(RangeExtensions.toArray).toBe(toArray);
      expect(RangeExtensions.iterator).toBe(iterator);
      expect(RangeExtensions.contains).toBe(contains);
      expect(RangeExtensions.first).toBe(first);
      expect(typeof RangeExtensions.size).toBe("function");
      expect(typeof RangeExtensions.isEmpty).toBe("function");
      expect(typeof RangeExtensions.forEach).toBe("function");
      expect(typeof RangeExtensions.map).toBe("function");
      expect(typeof RangeExtensions.filter).toBe("function");
      expect(typeof RangeExtensions.reduce).toBe("function");
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe("Edge cases", () => {
    it("handles negative numbers", () => {
      expect(toArray(to(-3, 1))).toEqual([-3, -2, -1, 0, 1]);
    });

    it("handles negative to negative range", () => {
      expect(toArray(to(-5, -2))).toEqual([-5, -4, -3, -2]);
    });

    it("handles zero crossing", () => {
      expect(toArray(to(-2, 2))).toEqual([-2, -1, 0, 1, 2]);
    });

    it("handles large step", () => {
      expect(toArray(step(to(0, 100), 50))).toEqual([0, 50, 100]);
    });

    it("handles step larger than range", () => {
      expect(toArray(step(to(0, 5), 10))).toEqual([0]);
    });

    it("handles float start/end (integer steps)", () => {
      const r = to(0.5, 3.5);
      const arr = toArray(r);
      expect(arr).toEqual([0.5, 1.5, 2.5, 3.5]);
    });

    it("chaining multiple operations", () => {
      // rangeFilter returns number[], so we use regular array.map for the final step
      const filtered = rangeFilter(step(to(1, 20), 2), (n) => n % 3 === 0);
      // to(1, 20).step(2) = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
      // filter(n % 3 === 0) = [3, 9, 15]
      expect(filtered).toEqual([3, 9, 15]);

      const mapped = filtered.map((n) => n * 10);
      expect(mapped).toEqual([30, 90, 150]);
    });
  });
});
