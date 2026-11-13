/**
 * Tests for Range extension methods
 *
 * These tests verify the Range extension methods work correctly,
 * including chaining via `.to()` and `.until()` on numbers.
 */

import { describe, it, expect } from "vitest";
import { to, until } from "../src/extensions/number.js";
import {
  step,
  reversed,
  toArray,
  iterator,
  first,
  last,
  size,
  isEmpty,
  forEach,
  map,
  filter,
  reduce,
  contains,
} from "../src/extensions/range.js";
import * as rangeMethods from "../src/extensions/range.js";

describe("Range Extension Methods", () => {
  // A field named after a method hides the method from the type checker:
  // while the field was `step`, `(0).to(10).step(2)` was TS2349 (not callable).
  it("no Range field shares a name with a Range extension method", () => {
    const methods = new Set(Object.keys(rangeMethods));
    expect(Object.keys(step(to(0, 10), 2)).filter((field) => methods.has(field))).toEqual([]);
  });

  // ==========================================================================
  // to() and until() on numbers
  // ==========================================================================

  describe("to() - inclusive range", () => {
    it("creates inclusive range from start to end", () => {
      const r = to(1, 5);
      expect(r.start).toBe(1);
      expect(r.end).toBe(5);
      expect(r.stride).toBe(1);
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
      expect(r.stride).toBe(1);
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
      expect(r.stride).toBe(2);
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
      // Same elements as [1, 3, 5, 7, 9], backwards (deep review #22).
      expect(toArray(r)).toEqual([9, 7, 5, 3, 1]);
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

  describe("last()", () => {
    it("returns last element of non-empty range", () => {
      expect(last(to(1, 5))).toBe(5);
    });

    it("handles stepped range", () => {
      expect(last(step(to(1, 10), 3))).toBe(10); // [1, 4, 7, 10]
    });

    it("returns undefined for empty range", () => {
      expect(last(to(10, 1))).toBe(undefined);
    });
  });

  describe("size()", () => {
    it("returns correct size for inclusive range", () => {
      expect(size(to(1, 10))).toBe(10);
    });

    it("returns correct size for exclusive range", () => {
      expect(size(until(1, 10))).toBe(9);
    });

    it("returns 0 for empty range", () => {
      expect(size(to(10, 1))).toBe(0);
    });

    it("handles stepped ranges", () => {
      // [1, 3, 5, 7, 9] (deep review #22 fixed the old undercount).
      expect(size(step(to(1, 10), 2))).toBe(5);
    });
  });

  describe("isEmpty()", () => {
    it("returns false for non-empty range", () => {
      expect(isEmpty(to(1, 10))).toBe(false);
    });

    it("returns true for empty range", () => {
      expect(isEmpty(to(10, 1))).toBe(true); // can't go 10→1 with step 1
    });
  });

  // ==========================================================================
  // Iteration methods
  // ==========================================================================

  describe("forEach()", () => {
    it("iterates over all elements with index", () => {
      const results: [number, number][] = [];
      forEach(to(1, 3), (n, i) => results.push([n, i]));
      expect(results).toEqual([
        [1, 0],
        [2, 1],
        [3, 2],
      ]);
    });
  });

  describe("map()", () => {
    it("maps values to new array", () => {
      const result = map(to(1, 5), (n) => n * n);
      expect(result).toEqual([1, 4, 9, 16, 25]);
    });

    it("provides index to callback", () => {
      const result = map(to(10, 12), (n, i) => `${i}:${n}`);
      expect(result).toEqual(["0:10", "1:11", "2:12"]);
    });
  });

  describe("filter()", () => {
    it("filters values matching predicate", () => {
      const result = filter(to(1, 10), (n) => n % 2 === 0);
      expect(result).toEqual([2, 4, 6, 8, 10]);
    });

    it("returns empty array when nothing matches", () => {
      const result = filter(to(1, 3), (n) => n > 10);
      expect(result).toEqual([]);
    });
  });

  describe("reduce()", () => {
    it("reduces range to single value", () => {
      const sum = reduce(to(1, 5), 0, (acc, n) => acc + n);
      expect(sum).toBe(15); // 1+2+3+4+5
    });

    it("handles initial value type", () => {
      const result = reduce(to(1, 3), "", (acc, n) => acc + n);
      expect(result).toBe("123");
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
      // filter returns number[], so we use regular array.map for the final step
      const filtered = filter(step(to(1, 20), 2), (n) => n % 3 === 0);
      // to(1, 20).step(2) = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
      // filter(n % 3 === 0) = [3, 9, 15]
      expect(filtered).toEqual([3, 9, 15]);

      const mapped = filtered.map((n) => n * 10);
      expect(mapped).toEqual([30, 90, 150]);
    });
  });
});
