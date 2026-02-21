/**
 * Red Team Tests for @typesugar/fusion
 *
 * Attack surfaces:
 * - Lazy evaluation state corruption
 * - Infinite iterators without take()
 * - Side effects in predicates
 * - Empty source handling
 * - Reusing pipelines
 * - Step order sensitivity
 */
import { describe, it, expect } from "vitest";
import { lazy, range, iterate, repeat, generate } from "../packages/fusion/src/lazy-entry.js";
import { LazyPipeline } from "../packages/fusion/src/lazy.js";
import { vec, add, sub, mul, div, dot, magnitude, normalize } from "../packages/fusion/src/vec.js";

describe("LazyPipeline Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Empty Source Handling
  // ==========================================================================
  describe("Empty source handling", () => {
    it("Empty array produces empty result", () => {
      const result = lazy([])
        .map((x) => x * 2)
        .toArray();
      expect(result).toEqual([]);
    });

    it("Empty array with filter still empty", () => {
      const result = lazy([])
        .filter((x) => x > 0)
        .toArray();
      expect(result).toEqual([]);
    });

    it("first() on empty returns null", () => {
      const result = lazy([]).first();
      expect(result).toBeNull();
    });

    it("last() on empty returns null", () => {
      const result = lazy([]).last();
      expect(result).toBeNull();
    });

    it("reduce() on empty returns init", () => {
      const result = lazy([] as number[]).reduce((acc, x) => acc + x, 100);
      expect(result).toBe(100);
    });

    it("min() on empty returns null", () => {
      const result = lazy([] as number[]).min();
      expect(result).toBeNull();
    });

    it("max() on empty returns null", () => {
      const result = lazy([] as number[]).max();
      expect(result).toBeNull();
    });

    it("some() on empty returns false", () => {
      const result = lazy([]).some((_) => true);
      expect(result).toBe(false);
    });

    it("every() on empty returns true (vacuous truth)", () => {
      const result = lazy([]).every((_) => false);
      expect(result).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 2: Infinite Iterator Handling
  // ==========================================================================
  describe("Infinite iterator handling", () => {
    it("range(1, Infinity) with take() terminates", () => {
      const result = range(1, Infinity).take(5).toArray();
      expect(result).toEqual([1, 2, 3, 4, 5]);
    });

    it("iterate() with take() terminates", () => {
      const result = iterate(1, (x) => x * 2)
        .take(5)
        .toArray();
      expect(result).toEqual([1, 2, 4, 8, 16]);
    });

    it("repeat() with take() terminates", () => {
      const result = repeat("x").take(3).toArray();
      expect(result).toEqual(["x", "x", "x"]);
    });

    it("generate() with take() terminates", () => {
      let n = 0;
      const result = generate(() => n++)
        .take(4)
        .toArray();
      expect(result).toEqual([0, 1, 2, 3]);
    });

    it("takeWhile() terminates infinite iterator", () => {
      const result = range(1, Infinity)
        .takeWhile((x) => x < 5)
        .toArray();
      expect(result).toEqual([1, 2, 3, 4]);
    });

    it("find() terminates infinite iterator when found", () => {
      const result = range(1, Infinity).find((x) => x === 100);
      expect(result).toBe(100);
    });

    it("some() terminates infinite iterator when true", () => {
      const result = range(1, Infinity).some((x) => x > 10);
      expect(result).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 3: Side Effects in Predicates
  // ==========================================================================
  describe("Side effects in predicates", () => {
    it("Side effects in filter() are evaluated per element", () => {
      const effects: number[] = [];
      const result = lazy([1, 2, 3, 4, 5])
        .filter((x) => {
          effects.push(x);
          return x % 2 === 0;
        })
        .toArray();

      expect(result).toEqual([2, 4]);
      expect(effects).toEqual([1, 2, 3, 4, 5]); // All elements were tested
    });

    it("Side effects in map() are evaluated lazily", () => {
      const effects: number[] = [];
      const pipeline = lazy([1, 2, 3, 4, 5]).map((x) => {
        effects.push(x);
        return x * 2;
      });

      // No effects until terminal operation
      expect(effects).toEqual([]);

      // Now trigger evaluation
      const result = pipeline.toArray();
      expect(effects).toEqual([1, 2, 3, 4, 5]);
      expect(result).toEqual([2, 4, 6, 8, 10]);
    });

    it("Mutating values in map()", () => {
      const objects = [{ value: 1 }, { value: 2 }, { value: 3 }];

      // Mutating in map - BAD PRACTICE but should still work
      const result = lazy(objects)
        .map((obj) => {
          obj.value *= 2;
          return obj;
        })
        .toArray();

      // Original objects were mutated
      expect(objects[0].value).toBe(2);
      expect(result[0].value).toBe(2);
    });

    it("Short-circuiting prevents unnecessary side effects", () => {
      const effects: number[] = [];
      const result = lazy([1, 2, 3, 4, 5])
        .map((x) => {
          effects.push(x);
          return x;
        })
        .take(2)
        .toArray();

      expect(result).toEqual([1, 2]);
      expect(effects).toEqual([1, 2]); // Only 2 elements processed
    });
  });

  // ==========================================================================
  // Attack 4: Pipeline Reuse
  // ==========================================================================
  describe("Pipeline reuse", () => {
    it("Pipelines can be reused multiple times", () => {
      const pipeline = lazy([1, 2, 3]).map((x) => x * 2);

      const result1 = pipeline.toArray();
      const result2 = pipeline.toArray();

      expect(result1).toEqual([2, 4, 6]);
      expect(result2).toEqual([2, 4, 6]);
    });

    it("Generator-based sources can be reused (if iterable)", () => {
      // Array is iterable multiple times
      const source = [1, 2, 3];
      const pipeline = lazy(source).map((x) => x * 2);

      const result1 = pipeline.toArray();
      const result2 = pipeline.toArray();

      expect(result1).toEqual(result2);
    });

    it("Stateful generator cannot be reused", () => {
      // A generator function is iterable only once
      function* gen() {
        yield 1;
        yield 2;
        yield 3;
      }

      const pipeline = lazy(gen());

      // First use works
      const result1 = pipeline.toArray();
      expect(result1).toEqual([1, 2, 3]);

      // Second use is empty (generator exhausted)
      const result2 = pipeline.toArray();
      expect(result2).toEqual([]);
    });
  });

  // ==========================================================================
  // Attack 5: Step Ordering
  // ==========================================================================
  describe("Step ordering", () => {
    it("filter().map() vs map().filter() different results", () => {
      const source = [1, 2, 3, 4, 5];

      // Filter first, then map
      const filterFirst = lazy(source)
        .filter((x) => x > 2)
        .map((x) => x * 10)
        .toArray();

      // Map first, then filter (filter sees mapped values!)
      const mapFirst = lazy(source)
        .map((x) => x * 10)
        .filter((x) => x > 20)
        .toArray();

      expect(filterFirst).toEqual([30, 40, 50]);
      expect(mapFirst).toEqual([30, 40, 50]); // Same result here, but different semantics
    });

    it("take().filter() vs filter().take() different results", () => {
      const source = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

      // Take 3 first, then filter
      const takeFirst = lazy(source)
        .take(3)
        .filter((x) => x % 2 === 0)
        .toArray();

      // Filter first, then take 3
      const filterFirst = lazy(source)
        .filter((x) => x % 2 === 0)
        .take(3)
        .toArray();

      expect(takeFirst).toEqual([2]); // Only [1,2,3] considered, 2 passes
      expect(filterFirst).toEqual([2, 4, 6]); // First 3 even numbers
    });

    it("drop() then take() vs take() then drop()", () => {
      const source = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

      const dropTake = lazy(source).drop(2).take(3).toArray();
      const takeDrop = lazy(source).take(5).drop(2).toArray();

      expect(dropTake).toEqual([3, 4, 5]); // Skip 2, take 3
      expect(takeDrop).toEqual([3, 4, 5]); // Same result here
    });
  });

  // ==========================================================================
  // Attack 6: flatMap Edge Cases
  // ==========================================================================
  describe("flatMap edge cases", () => {
    it("flatMap with empty arrays", () => {
      const result = lazy([1, 2, 3])
        .flatMap((x) => (x === 2 ? [] : [x, x]))
        .toArray();

      expect(result).toEqual([1, 1, 3, 3]);
    });

    it("flatMap with nested flatMap", () => {
      const result = lazy([
        [1, 2],
        [3, 4],
      ])
        .flatMap((arr) => arr)
        .flatMap((x) => [x, x * 10])
        .toArray();

      expect(result).toEqual([1, 10, 2, 20, 3, 30, 4, 40]);
    });

    it("flatMap preserves order", () => {
      const result = lazy([1, 2, 3])
        .flatMap((x) => [x, x + 0.5])
        .toArray();

      expect(result).toEqual([1, 1.5, 2, 2.5, 3, 3.5]);
    });
  });

  // ==========================================================================
  // Attack 7: Comparison Edge Cases (min/max)
  // ==========================================================================
  describe("Comparison edge cases", () => {
    it("min() with custom comparator", () => {
      const items = [{ value: 3 }, { value: 1 }, { value: 2 }];
      const result = lazy(items).min((a, b) => a.value - b.value);

      expect(result?.value).toBe(1);
    });

    it("max() with NaN values", () => {
      const result = lazy([1, NaN, 3, 2]).max();

      // NaN comparisons are problematic
      // a > b returns false when either is NaN
      // So NaN tends to "lose" comparisons
      expect(result).toBe(3); // NaN doesn't win
    });

    it("min() with all equal values", () => {
      const result = lazy([5, 5, 5]).min();
      expect(result).toBe(5);
    });

    it("min() with strings", () => {
      const result = lazy(["banana", "apple", "cherry"]).min();
      expect(result).toBe("apple"); // Lexicographic
    });
  });
});

describe("Vec (Element-wise Operations) Edge Cases", () => {
  // ==========================================================================
  // Attack 8: Empty Vectors
  // ==========================================================================
  describe("Empty vector operations", () => {
    it("Empty vector dot product", () => {
      const a = vec([]);
      const b = vec([]);

      expect(dot(a, b)).toBe(0);
    });

    it("Empty vector magnitude", () => {
      const a = vec([]);

      expect(magnitude(a)).toBe(0);
    });
  });

  // ==========================================================================
  // Attack 9: Mismatched Lengths
  // ==========================================================================
  describe("Mismatched vector lengths", () => {
    it("dot() with different lengths", () => {
      const a = vec([1, 2, 3]);
      const b = vec([4, 5]);

      // What happens? Depends on implementation
      // Should either throw or compute partial
      const result = dot(a, b);
      expect(result).toBe(1 * 4 + 2 * 5); // Partial computation
    });

    it("add() with different lengths", () => {
      const a = vec([1, 2, 3]);
      const b = vec([4, 5]);

      // Should compute element-wise up to shorter length
      const result = add(a, b);
      expect(result.length).toBe(2);
    });
  });

  // ==========================================================================
  // Attack 10: Special Values in Vectors
  // ==========================================================================
  describe("Special values in vectors", () => {
    it("Vector with NaN", () => {
      const a = vec([1, NaN, 3]);
      const mag = magnitude(a);

      expect(Number.isNaN(mag)).toBe(true);
    });

    it("Vector with Infinity", () => {
      const a = vec([1, Infinity, 3]);
      const mag = magnitude(a);

      expect(mag).toBe(Infinity);
    });

    it("normalize() zero vector returns zero vector unchanged", () => {
      const a = vec([0, 0, 0]);

      // normalize handles mag=0 specially: returns input unchanged
      const result = normalize(a);
      // vec returns { data, length }
      expect(result.data).toEqual([0, 0, 0]);
    });

    it("Division by zero in div() produces Infinity", () => {
      const a = vec([1, 2, 3]);
      const b = vec([1, 0, 1]);

      const result = div(a, b);
      // vec returns { data, length }
      expect(result.data[0]).toBe(1);
      expect(result.data[1]).toBe(Infinity);
      expect(result.data[2]).toBe(3);
    });
  });
});

describe("Range Edge Cases", () => {
  // ==========================================================================
  // Attack 11: Range Edge Cases
  // ==========================================================================
  describe("Range bounds", () => {
    it("range(5, 5) produces empty (exclusive end)", () => {
      // range uses [start, end) - exclusive end
      const result = range(5, 5).toArray();
      expect(result).toEqual([]);
    });

    it("range(5, 6) produces single element", () => {
      const result = range(5, 6).toArray();
      expect(result).toEqual([5]);
    });

    it("range(5, 4) produces empty (reversed bounds)", () => {
      const result = range(5, 4).toArray();
      expect(result).toEqual([]);
    });

    it("range with negative numbers", () => {
      const result = range(-3, 3).toArray();
      expect(result).toEqual([-3, -2, -1, 0, 1, 2]);
    });

    it("range with fractional bounds", () => {
      const result = range(1.5, 4.9).toArray();
      // 1.5, 2.5, 3.5, 4.5 (incrementing by 1, stops before 4.9)
      expect(result[0]).toBeCloseTo(1.5);
      expect(result.length).toBe(4);
    });

    it("range with step 0 throws", () => {
      expect(() => range(1, 10, 0).toArray()).toThrow("step must not be zero");
    });

    it("range with negative step", () => {
      const result = range(5, 1, -1).toArray();
      expect(result).toEqual([5, 4, 3, 2]);
    });
  });
});
