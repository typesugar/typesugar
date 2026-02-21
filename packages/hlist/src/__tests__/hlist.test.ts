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
} from "../operations.js";
import type {
  HList,
  HNil,
  HCons,
  Head,
  Tail,
  Last,
  Init,
  Length,
  At,
  Concat,
  Reverse,
  Zip,
  SplitAt,
} from "../types.js";

// Type-level assertion helper: asserts that A extends B
type AssertExtends<A, B> = A extends B ? true : never;
// Compile-time equality check
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe("@typesugar/hlist", () => {
  // ==========================================================================
  // Construction
  // ==========================================================================

  describe("construction", () => {
    it("hlist() creates an HList from variadic args", () => {
      const list = hlist(1, "hello", true);
      expect(list).toEqual([1, "hello", true]);
    });

    it("hnil() creates an empty HList", () => {
      const empty = hnil();
      expect(empty).toEqual([]);
    });

    it("hlist() with single element", () => {
      const single = hlist(42);
      expect(single).toEqual([42]);
    });

    it("hlist() preserves different types in a single list", () => {
      const mixed = hlist(1, "two", true, null, { x: 1 });
      expect(mixed).toEqual([1, "two", true, null, { x: 1 }]);
      expect(mixed).toHaveLength(5);
    });

    it("labeled() creates a LabeledHList from a record", () => {
      const rec = labeled({ x: 42, y: "hi" });
      expect(rec).toHaveLength(2);
    });

    it("labeled() stores values accessible by get()", () => {
      const rec = labeled({ name: "Alice", age: 30, active: true });
      expect(get(rec, "name")).toBe("Alice");
      expect(get(rec, "age")).toBe(30);
      expect(get(rec, "active")).toBe(true);
    });
  });

  // ==========================================================================
  // Element Access
  // ==========================================================================

  describe("element access", () => {
    const list = hlist(10, "hello", true, null);

    it("head() returns the first element", () => {
      const h = head(hlist(1, "a", true));
      expect(h).toBe(1);
    });

    it("tail() returns everything except the first element", () => {
      const t = tail(hlist(1, "a", true));
      expect(t).toEqual(["a", true]);
    });

    it("last() returns the last element", () => {
      const l = last(hlist(1, "a", true));
      expect(l).toBe(true);
    });

    it("init() returns everything except the last element", () => {
      const i = init(hlist(1, "a", true));
      expect(i).toEqual([1, "a"]);
    });

    it("at() returns element at specific index", () => {
      expect(at(list, 0)).toBe(10);
      expect(at(list, 1)).toBe("hello");
      expect(at(list, 2)).toBe(true);
      expect(at(list, 3)).toBe(null);
    });

    it("length() returns the number of elements", () => {
      expect(length(list)).toBe(4);
      expect(length(hnil())).toBe(0);
      expect(length(hlist(1))).toBe(1);
    });

    it("head/tail round-trip preserves all elements", () => {
      const original = hlist(1, 2, 3);
      const h = head(original);
      const t = tail(original);
      expect([h, ...toArray(t)]).toEqual([1, 2, 3]);
    });
  });

  // ==========================================================================
  // Structural Operations
  // ==========================================================================

  describe("operations", () => {
    it("append() adds an element to the end", () => {
      const list = hlist(1, "a");
      const appended = append(list, true);
      expect(appended).toEqual([1, "a", true]);
    });

    it("prepend() adds an element to the front", () => {
      const list = hlist(1, "a");
      const prepended = prepend(true, list);
      expect(prepended).toEqual([true, 1, "a"]);
    });

    it("concat() joins two HLists", () => {
      const a = hlist(1, 2);
      const b = hlist("a", "b");
      const joined = concat(a, b);
      expect(joined).toEqual([1, 2, "a", "b"]);
    });

    it("concat() with empty list is identity", () => {
      const list = hlist(1, 2, 3);
      expect(concat(list, hnil())).toEqual([1, 2, 3]);
      expect(concat(hnil(), list)).toEqual([1, 2, 3]);
    });

    it("reverse() reverses element order", () => {
      const list = hlist(1, "a", true);
      const reversed = reverse(list);
      expect(reversed).toEqual([true, "a", 1]);
    });

    it("reverse() of empty is empty", () => {
      expect(reverse(hnil())).toEqual([]);
    });

    it("reverse() of single element is identity", () => {
      expect(reverse(hlist(42))).toEqual([42]);
    });

    it("double reverse is identity", () => {
      const list = hlist(1, "a", true, null);
      expect(reverse(reverse(list))).toEqual(toArray(list));
    });

    it("zip() pairs elements from two lists", () => {
      const a = hlist(1, 2, 3);
      const b = hlist("a", "b", "c");
      const zipped = zip(a, b);
      expect(zipped).toEqual([
        [1, "a"],
        [2, "b"],
        [3, "c"],
      ]);
    });

    it("zip() truncates to shorter list", () => {
      const a = hlist(1, 2, 3, 4);
      const b = hlist("a", "b");
      expect(zip(a, b)).toEqual([
        [1, "a"],
        [2, "b"],
      ]);
    });

    it("zip() with empty list returns empty", () => {
      expect(zip(hnil(), hlist(1, 2))).toEqual([]);
      expect(zip(hlist(1, 2), hnil())).toEqual([]);
    });

    it("splitAt() divides a list at an index", () => {
      const list = hlist(1, "a", true, null);
      const [left, right] = splitAt(list, 2);
      expect(left).toEqual([1, "a"]);
      expect(right).toEqual([true, null]);
    });

    it("splitAt(0) gives empty left and full right", () => {
      const list = hlist(1, 2, 3);
      const [left, right] = splitAt(list, 0);
      expect(left).toEqual([]);
      expect(right).toEqual([1, 2, 3]);
    });

    it("splitAt(length) gives full left and empty right", () => {
      const list = hlist(1, 2, 3);
      const [left, right] = splitAt(list, 3);
      expect(left).toEqual([1, 2, 3]);
      expect(right).toEqual([]);
    });
  });

  // ==========================================================================
  // Labeled Operations
  // ==========================================================================

  describe("labeled operations", () => {
    it("get() retrieves a field by name", () => {
      const rec = labeled({ x: 42, y: "hello", z: true });
      expect(get(rec, "x")).toBe(42);
      expect(get(rec, "y")).toBe("hello");
      expect(get(rec, "z")).toBe(true);
    });

    it("get() throws for unknown field name", () => {
      const rec = labeled({ x: 42 });
      expect(() => get(rec, "nonexistent" as any)).toThrow('no field named "nonexistent"');
    });

    it("set() returns a new LabeledHList with updated value", () => {
      const rec = labeled({ x: 42, y: "hello" });
      const updated = set(rec, "x", 99);
      expect(get(updated, "x")).toBe(99);
      expect(get(updated, "y")).toBe("hello");
      // Original is unchanged
      expect(get(rec, "x")).toBe(42);
    });

    it("set() throws for unknown field name", () => {
      const rec = labeled({ x: 42 });
      expect(() => set(rec, "nonexistent" as any, 0)).toThrow('no field named "nonexistent"');
    });

    it("labels() returns field names", () => {
      const rec = labeled({ name: "Alice", age: 30, active: true });
      expect(labels(rec)).toEqual(["name", "age", "active"]);
    });

    it("project() selects a subset of fields", () => {
      const rec = labeled({ x: 1, y: 2, z: 3 });
      const projected = project(rec, "x", "z");
      expect(get(projected, "x")).toBe(1);
      expect(get(projected, "z")).toBe(3);
      expect(labels(projected)).toEqual(["x", "z"]);
    });

    it("project() throws for unknown field name", () => {
      const rec = labeled({ x: 1 });
      expect(() => project(rec, "nonexistent" as any)).toThrow('no field named "nonexistent"');
    });

    it("merge() combines two LabeledHLists", () => {
      const a = labeled({ x: 1, y: 2 });
      const b = labeled({ z: 3, w: 4 });
      const merged = merge(a, b);
      expect(get(merged, "x")).toBe(1);
      expect(get(merged, "y")).toBe(2);
      expect(get(merged, "z")).toBe(3);
      expect(get(merged, "w")).toBe(4);
      expect(labels(merged)).toEqual(["x", "y", "z", "w"]);
    });
  });

  // ==========================================================================
  // Higher-Order Operations
  // ==========================================================================

  describe("higher-order operations", () => {
    it("map() applies a function to each element", () => {
      const list = hlist(1, 2, 3);
      const result = map(list, (x) => (x as number) * 2);
      expect(result).toEqual([2, 4, 6]);
    });

    it("map() with index", () => {
      const list = hlist("a", "b", "c");
      const result = map(list, (_, i) => i);
      expect(result).toEqual([0, 1, 2]);
    });

    it("map() on empty list returns empty", () => {
      expect(map(hnil(), (x) => x)).toEqual([]);
    });

    it("foldLeft() accumulates a result", () => {
      const list = hlist(1, 2, 3, 4);
      const sum = foldLeft(list, 0, (acc, x) => acc + (x as number));
      expect(sum).toBe(10);
    });

    it("foldLeft() with string concatenation", () => {
      const list = hlist("a", "b", "c");
      const result = foldLeft(list, "", (acc, x) => acc + (x as string));
      expect(result).toBe("abc");
    });

    it("foldLeft() on empty list returns init", () => {
      expect(foldLeft(hnil(), 42, (acc) => acc)).toBe(42);
    });

    it("foldLeft() index parameter increments correctly", () => {
      const list = hlist("a", "b", "c");
      const indices: number[] = [];
      foldLeft(list, null, (acc, _, i) => {
        indices.push(i);
        return acc;
      });
      expect(indices).toEqual([0, 1, 2]);
    });

    it("forEach() calls function for each element", () => {
      const list = hlist(10, 20, 30);
      const collected: unknown[] = [];
      forEach(list, (elem) => collected.push(elem));
      expect(collected).toEqual([10, 20, 30]);
    });

    it("forEach() provides correct indices", () => {
      const list = hlist("a", "b");
      const indices: number[] = [];
      forEach(list, (_, i) => indices.push(i));
      expect(indices).toEqual([0, 1]);
    });

    it("forEach() on empty list does nothing", () => {
      let called = false;
      forEach(hnil(), () => {
        called = true;
      });
      expect(called).toBe(false);
    });
  });

  // ==========================================================================
  // Conversion
  // ==========================================================================

  describe("conversion", () => {
    it("toArray() extracts the underlying array", () => {
      const list = hlist(1, "a", true);
      const arr = toArray(list);
      expect(arr).toEqual([1, "a", true]);
    });

    it("toArray() returns a copy (mutations don't affect original)", () => {
      const list = hlist(1, 2, 3);
      const arr = toArray(list);
      (arr as number[])[0] = 999;
      expect(head(list)).toBe(1);
    });

    it("fromArray() creates an HList from an array", () => {
      const arr = [1, "a", true] as const;
      const list = fromArray(arr);
      expect(list).toEqual([1, "a", true]);
    });

    it("fromArray -> toArray round-trip", () => {
      const original = [1, "hello", false, null] as const;
      const roundTripped = toArray(fromArray(original));
      expect(roundTripped).toEqual([...original]);
    });
  });

  // ==========================================================================
  // Type Preservation (compile-time checks via type assertions)
  // ==========================================================================

  describe("type preservation", () => {
    it("hlist() infers tuple type", () => {
      const list = hlist(1, "a", true);
      // These are compile-time checks — if they fail, tsc will error
      type _check1 = AssertExtends<typeof list, HList<[number, string, boolean]>>;
      type _check2 = AssertExtends<Head<typeof list extends HList<infer T> ? T : never>, number>;
      expect(list).toBeDefined();
    });

    it("hnil() is HNil", () => {
      const empty = hnil();
      type _check = AssertExtends<typeof empty, HNil>;
      expect(empty).toBeDefined();
    });

    it("head() narrows to the first element type", () => {
      const h = head(hlist(42, "test"));
      type _check = Equals<typeof h, number>;
      expect(h).toBe(42);
    });

    it("tail() narrows to the rest", () => {
      const t = tail(hlist(42, "test", true));
      type _check = AssertExtends<typeof t, HList<[string, boolean]>>;
      expect(t).toEqual(["test", true]);
    });

    it("at() narrows to the element at that index", () => {
      const list = hlist(1, "two", true);
      const elem = at(list, 1);
      type _check = Equals<typeof elem, string>;
      expect(elem).toBe("two");
    });

    it("concat() produces the concatenated tuple type", () => {
      const result = concat(hlist(1, 2), hlist("a", "b"));
      type _check = AssertExtends<typeof result, HList<[number, number, string, string]>>;
      expect(result).toHaveLength(4);
    });

    it("append() extends the tuple type", () => {
      const result = append(hlist(1, "a"), true);
      type _check = AssertExtends<typeof result, HList<[number, string, boolean]>>;
      expect(result).toHaveLength(3);
    });

    it("prepend() extends the tuple type at the front", () => {
      const result = prepend(true, hlist(1, "a"));
      type _check = AssertExtends<typeof result, HList<[boolean, number, string]>>;
      expect(result).toHaveLength(3);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe("edge cases", () => {
    it("operations on single-element HList", () => {
      const single = hlist(42);
      expect(head(single)).toBe(42);
      expect(last(single)).toBe(42);
      expect(tail(single)).toEqual([]);
      expect(init(single)).toEqual([]);
      expect(reverse(single)).toEqual([42]);
      expect(toArray(single)).toEqual([42]);
    });

    it("deeply nested types work", () => {
      const nested = hlist(hlist(1, 2), hlist("a", "b"));
      expect(head(nested)).toEqual([1, 2]);
      expect(at(nested, 1)).toEqual(["a", "b"]);
    });

    it("HList of functions", () => {
      const fns = hlist(
        (x: number) => x + 1,
        (s: string) => s.length
      );
      const f = head(fns);
      expect(f(10)).toBe(11);
    });

    it("large HList (20 elements)", () => {
      const large = hlist(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19);
      expect(length(large)).toBe(20);
      expect(at(large, 0)).toBe(0);
      expect(at(large, 19)).toBe(19);
      expect(last(large)).toBe(19);
    });

    it("HList with undefined and null elements", () => {
      const list = hlist(undefined, null, 0, "", false);
      expect(head(list)).toBeUndefined();
      expect(at(list, 1)).toBeNull();
      expect(at(list, 2)).toBe(0);
      expect(at(list, 3)).toBe("");
      expect(at(list, 4)).toBe(false);
    });

    it("chained operations", () => {
      const result = reverse(concat(hlist(1, 2), hlist(3, 4)));
      expect(result).toEqual([4, 3, 2, 1]);
    });

    it("splitAt then concat recovers original", () => {
      const list = hlist(1, "a", true, null, 5);
      const [left, right] = splitAt(list, 3);
      const recovered = concat(left, right);
      expect(recovered).toEqual(toArray(list));
    });

    it("labeled with single field", () => {
      const rec = labeled({ only: 42 });
      expect(get(rec, "only")).toBe(42);
      expect(labels(rec)).toEqual(["only"]);
    });

    it("labeled set preserves other fields", () => {
      const rec = labeled({ a: 1, b: 2, c: 3 });
      const updated = set(rec, "b", 99);
      expect(get(updated, "a")).toBe(1);
      expect(get(updated, "b")).toBe(99);
      expect(get(updated, "c")).toBe(3);
    });

    it("labeled merge preserves access to all fields", () => {
      const a = labeled({ x: 1 });
      const b = labeled({ y: 2 });
      const c = labeled({ z: 3 });
      const merged = merge(merge(a, b), c);
      expect(get(merged, "x")).toBe(1);
      expect(get(merged, "y")).toBe(2);
      expect(get(merged, "z")).toBe(3);
    });
  });
});
