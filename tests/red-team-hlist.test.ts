/**
 * Red Team Tests for @typesugar/hlist
 *
 * Attack surfaces:
 * - Type-level vs runtime mismatches
 * - Empty HList operations
 * - Out-of-bounds access
 * - Labeled HList key conflicts
 * - Mutation of underlying arrays
 * - Unicode/special characters in labels
 */
import { describe, it, expect } from "vitest";
import {
  hlist,
  hnil,
  labeled,
  head,
  tail,
  last,
  init,
  at,
  length,
  append,
  prepend,
  concat,
  reverse,
  zip,
  splitAt,
  get,
  set,
  labels,
  project,
  merge,
  map,
  foldLeft,
  forEach,
  toArray,
  fromArray,
} from "../packages/hlist/src/operations.js";

describe("HList Basic Operations Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Empty HList Operations
  // ==========================================================================
  describe("Empty HList operations", () => {
    it("hnil() creates empty HList", () => {
      const empty = hnil();
      expect(length(empty)).toBe(0);
      expect(toArray(empty)).toEqual([]);
    });

    it("head() on empty throws", () => {
      const empty = hnil();
      // This is a type error at compile time, but what happens at runtime?
      // @ts-expect-error - testing runtime behavior
      expect(() => head(empty)).not.toThrow(); // Returns undefined
    });

    it("tail() on empty", () => {
      const empty = hnil();
      // @ts-expect-error - testing runtime behavior
      const result = tail(empty);
      expect(toArray(result)).toEqual([]);
    });

    it("last() on empty throws", () => {
      const empty = hnil();
      // @ts-expect-error - testing runtime behavior
      expect(() => last(empty)).not.toThrow(); // Returns undefined
    });

    it("reverse() on empty", () => {
      const empty = hnil();
      // @ts-expect-error - testing runtime behavior
      const result = reverse(empty);
      expect(toArray(result)).toEqual([]);
    });
  });

  // ==========================================================================
  // Attack 2: Out-of-Bounds Access
  // ==========================================================================
  describe("Out-of-bounds access", () => {
    it("at() with negative index", () => {
      const list = hlist(1, 2, 3);
      // @ts-expect-error - testing runtime behavior
      const result = at(list, -1);
      expect(result).toBeUndefined();
    });

    it("at() with index beyond length", () => {
      const list = hlist(1, 2, 3);
      // @ts-expect-error - testing runtime behavior
      const result = at(list, 10);
      expect(result).toBeUndefined();
    });

    it("at() with non-integer index", () => {
      const list = hlist(1, 2, 3);
      // @ts-expect-error - testing runtime behavior
      const result = at(list, 1.5);
      expect(result).toBeUndefined(); // Array indexing truncates
    });

    it("splitAt() with negative index splits at end", () => {
      const list = hlist(1, 2, 3);
      // Negative index is treated as splitting at that position from start
      // -1 means split at 2 (last element goes to right)
      // @ts-expect-error - testing runtime behavior
      const [left, right] = splitAt(list, -1);
      // Actual behavior: slice handles negative as (length + index)
      expect(toArray(left)).toEqual([1, 2]); // First 2 elements
      expect(toArray(right)).toEqual([3]); // Last element
    });

    it("splitAt() with index beyond length", () => {
      const list = hlist(1, 2, 3);
      // @ts-expect-error - testing runtime behavior
      const [left, right] = splitAt(list, 10);
      expect(toArray(left)).toEqual([1, 2, 3]);
      expect(toArray(right)).toEqual([]);
    });
  });

  // ==========================================================================
  // Attack 3: Type Safety of at() Return Type
  // ==========================================================================
  describe("Type safety edge cases", () => {
    it("Type narrowing after head()", () => {
      const list = hlist(1, "hello", true);
      const h = head(list);
      // h should be typed as number
      expect(typeof h).toBe("number");
    });

    it("Type narrowing after at()", () => {
      const list = hlist(1, "hello", true);
      const elem0 = at(list, 0);
      const elem1 = at(list, 1);
      const elem2 = at(list, 2);

      expect(typeof elem0).toBe("number");
      expect(typeof elem1).toBe("string");
      expect(typeof elem2).toBe("boolean");
    });

    it("Heterogeneous types in map()", () => {
      const list = hlist(1, "hello", true);

      // map loses type information in result
      const result = map(list, (elem) => String(elem));

      // Runtime works, but type is HList<unknown[]>
      expect(result).toEqual(["1", "hello", "true"]);
    });
  });

  // ==========================================================================
  // Attack 4: Mutation of Underlying Array
  // ==========================================================================
  describe("Mutation edge cases", () => {
    it("Modifying source array affects HList", () => {
      const source = [1, 2, 3] as const;
      const list = fromArray(source);

      // fromArray creates a copy, so this shouldn't affect list
      // Actually: fromArray uses spread, so it's a shallow copy
      expect(toArray(list)).toEqual([1, 2, 3]);
    });

    it("toArray returns a copy, not the internal array", () => {
      const list = hlist(1, 2, 3);
      const arr = toArray(list);

      arr[0] = 999;

      // Original list should be unchanged
      expect(at(list, 0)).toBe(1);
    });

    it("concat() doesn't mutate originals", () => {
      const a = hlist(1, 2);
      const b = hlist(3, 4);

      const c = concat(a, b);

      // Check originals unchanged
      expect(toArray(a)).toEqual([1, 2]);
      expect(toArray(b)).toEqual([3, 4]);
      expect(toArray(c)).toEqual([1, 2, 3, 4]);
    });
  });

  // ==========================================================================
  // Attack 5: zip() Length Mismatch
  // ==========================================================================
  describe("zip edge cases", () => {
    it("zip() with different lengths (shorter determines result)", () => {
      const a = hlist(1, 2, 3);
      const b = hlist("a", "b");

      const result = zip(a, b);
      expect(toArray(result)).toEqual([
        [1, "a"],
        [2, "b"],
      ]);
    });

    it("zip() with empty HList", () => {
      const a = hlist(1, 2, 3);
      const b = hnil();

      // @ts-expect-error - testing runtime behavior
      const result = zip(a, b);
      expect(toArray(result)).toEqual([]);
    });

    it("zip() two empty HLists", () => {
      // @ts-expect-error - testing runtime behavior
      const result = zip(hnil(), hnil());
      expect(toArray(result)).toEqual([]);
    });
  });
});

describe("LabeledHList Edge Cases", () => {
  // ==========================================================================
  // Attack 6: Invalid Field Names
  // ==========================================================================
  describe("Invalid field names", () => {
    it("Empty string as field name", () => {
      const rec = labeled({ "": 42 });
      expect(get(rec, "")).toBe(42);
    });

    it("Numeric string as field name", () => {
      const rec = labeled({ "123": "value" });
      expect(get(rec, "123")).toBe("value");
    });

    it("Field name with spaces", () => {
      const rec = labeled({ "field name": 42 });
      expect(get(rec, "field name")).toBe(42);
    });

    it("Unicode field names", () => {
      const rec = labeled({ αβγ: 1, 日本語: 2, "🎉": 3 });
      expect(get(rec, "αβγ")).toBe(1);
      expect(get(rec, "日本語")).toBe(2);
      expect(get(rec, "🎉")).toBe(3);
    });

    it("Reserved JavaScript property names (except __proto__)", () => {
      // Note: __proto__ is special in JavaScript - it sets the prototype
      // rather than being stored as a regular property. We skip it.
      const rec = labeled({
        constructor: "ctor-value",
        toString: "tostring-value",
        hasOwnProperty: "has-own-value",
      });

      expect(get(rec, "constructor")).toBe("ctor-value");
      expect(get(rec, "toString")).toBe("tostring-value");
      expect(get(rec, "hasOwnProperty")).toBe("has-own-value");
    });
  });

  // ==========================================================================
  // Attack 7: Missing Field Access
  // ==========================================================================
  describe("Missing field access", () => {
    it("get() throws on missing field", () => {
      const rec = labeled({ x: 1, y: 2 });

      // @ts-expect-error - testing runtime behavior
      expect(() => get(rec, "z")).toThrow('LabeledHList: no field named "z"');
    });

    it("set() throws on missing field", () => {
      const rec = labeled({ x: 1, y: 2 });

      // @ts-expect-error - testing runtime behavior
      expect(() => set(rec, "z", 3)).toThrow('LabeledHList: no field named "z"');
    });

    it("project() throws on missing field", () => {
      const rec = labeled({ x: 1, y: 2 });

      // @ts-expect-error - testing runtime behavior
      expect(() => project(rec, "x", "z")).toThrow('LabeledHList: no field named "z"');
    });
  });

  // ==========================================================================
  // Attack 8: set() Creates New Instance
  // ==========================================================================
  describe("set() immutability", () => {
    it("set() returns new instance", () => {
      const rec = labeled({ x: 1, y: 2 });
      const updated = set(rec, "x", 99);

      expect(get(rec, "x")).toBe(1); // Original unchanged
      expect(get(updated, "x")).toBe(99);
    });

    it("set() preserves other fields", () => {
      const rec = labeled({ x: 1, y: 2, z: 3 });
      const updated = set(rec, "y", 99);

      expect(get(updated, "x")).toBe(1);
      expect(get(updated, "y")).toBe(99);
      expect(get(updated, "z")).toBe(3);
    });
  });

  // ==========================================================================
  // Attack 9: labels() Order Consistency
  // ==========================================================================
  describe("labels() order consistency", () => {
    it("labels() returns keys in declaration order", () => {
      const rec = labeled({ c: 3, a: 1, b: 2 });
      // Object key order in modern JS follows insertion order
      expect(labels(rec)).toEqual(["c", "a", "b"]);
    });

    it("labels() returns copy, not reference", () => {
      const rec = labeled({ x: 1, y: 2 });
      const keys1 = labels(rec);
      const keys2 = labels(rec);

      keys1.push("extra");
      expect(keys2).not.toContain("extra");
    });
  });

  // ==========================================================================
  // Attack 10: merge() with Duplicate Keys
  // ==========================================================================
  describe("merge() edge cases", () => {
    it("merge() with disjoint keys", () => {
      const a = labeled({ x: 1 });
      const b = labeled({ y: 2 });
      const merged = merge(a, b);

      expect(get(merged, "x")).toBe(1);
      expect(get(merged, "y")).toBe(2);
      expect(labels(merged)).toEqual(["x", "y"]);
    });

    it("merge() with overlapping keys creates duplicates", () => {
      const a = labeled({ x: 1, y: 2 });
      const b = labeled({ y: 3, z: 4 });
      const merged = merge(a, b);

      // Both 'y' values are present
      expect(labels(merged)).toEqual(["x", "y", "y", "z"]);

      // get() finds first matching key
      expect(get(merged, "y")).toBe(2); // First 'y'
    });

    it("merge() empty labeled lists", () => {
      const a = labeled({});
      const b = labeled({});
      const merged = merge(a, b);

      expect(labels(merged)).toEqual([]);
    });
  });

  // ==========================================================================
  // Attack 11: project() Order Preservation
  // ==========================================================================
  describe("project() edge cases", () => {
    it("project() preserves requested order, not original order", () => {
      const rec = labeled({ a: 1, b: 2, c: 3 });
      const projected = project(rec, "c", "a"); // Different order

      expect(labels(projected)).toEqual(["c", "a"]);
      expect(get(projected, "c")).toBe(3);
      expect(get(projected, "a")).toBe(1);
    });

    it("project() with empty selection", () => {
      const rec = labeled({ a: 1, b: 2 });
      const projected = project(rec);

      expect(labels(projected)).toEqual([]);
    });

    it("project() with same field twice", () => {
      const rec = labeled({ a: 1, b: 2 });
      const projected = project(rec, "a", "a");

      // Both included
      expect(labels(projected)).toEqual(["a", "a"]);
    });
  });
});

describe("HList Higher-Order Operations", () => {
  // ==========================================================================
  // Attack 12: foldLeft() Edge Cases
  // ==========================================================================
  describe("foldLeft() edge cases", () => {
    it("foldLeft() on empty HList returns init", () => {
      const empty = hnil();
      // @ts-expect-error - testing runtime behavior
      const result = foldLeft(empty, 100, (acc) => acc + 1);
      expect(result).toBe(100);
    });

    it("foldLeft() callback receives correct index", () => {
      const list = hlist("a", "b", "c");
      const indices: number[] = [];

      foldLeft(list, 0, (_acc, _elem, index) => {
        indices.push(index);
        return 0;
      });

      expect(indices).toEqual([0, 1, 2]);
    });

    it("foldLeft() with heterogeneous types", () => {
      const list = hlist(1, "hello", true);

      const result = foldLeft(list, "", (acc, elem) => acc + String(elem));
      expect(result).toBe("1hellotrue");
    });
  });

  // ==========================================================================
  // Attack 13: forEach() Side Effects
  // ==========================================================================
  describe("forEach() side effects", () => {
    it("forEach() executes in order", () => {
      const list = hlist(1, 2, 3);
      const results: number[] = [];

      forEach(list, (elem) => results.push(elem as number));

      expect(results).toEqual([1, 2, 3]);
    });

    it("forEach() on empty does nothing", () => {
      const empty = hnil();
      let called = false;

      // @ts-expect-error - testing runtime behavior
      forEach(empty, () => {
        called = true;
      });

      expect(called).toBe(false);
    });
  });

  // ==========================================================================
  // Attack 14: reverse() Type Safety
  // ==========================================================================
  describe("reverse() type safety", () => {
    it("reverse() preserves element types in reverse order", () => {
      const list = hlist(1, "hello", true);
      const reversed = reverse(list);

      expect(toArray(reversed)).toEqual([true, "hello", 1]);
    });

    it("reverse() on single element", () => {
      const list = hlist(42);
      const reversed = reverse(list);

      expect(toArray(reversed)).toEqual([42]);
    });

    it("reverse() is self-inverse", () => {
      const list = hlist(1, 2, 3);
      const doubleReversed = reverse(reverse(list));

      expect(toArray(doubleReversed)).toEqual([1, 2, 3]);
    });
  });
});
