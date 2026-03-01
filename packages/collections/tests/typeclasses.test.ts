import { describe, it, expect } from "vitest";
import {
  arraySeq,
  stringSeq,
  nativeSetLike,
  nativeMutableSetLike,
  nativeMapLike,
  nativeMutableMapLike,
  hashMutableSetLike,
  hashMutableMapLike,
  mutableSetFor,
  mutableMapFor,
  union,
  intersection,
  difference,
  isSubsetOf,
  head,
  last,
  take,
  drop,
  toArray,
  forEach,
  find,
  exists,
  forAll,
  count,
  getOrElse,
  mapValues,
  filterEntries,
  sorted,
  seqContains,
} from "../src/index.js";
import { eqString, hashString, eqNumber, hashNumber, ordNumber } from "@typesugar/std";

describe("Typeclass instances", () => {
  describe("Array → Seq", () => {
    it("length", () => {
      expect(arraySeq.length([1, 2, 3])).toBe(3);
    });
    it("nth", () => {
      expect(arraySeq.nth([10, 20, 30], 1)).toBe(20);
      expect(arraySeq.nth([10], 5)).toBeUndefined();
    });
    it("fold", () => {
      expect(arraySeq.fold([1, 2, 3], 0, (a, b) => a + b)).toBe(6);
    });
    it("iterator", () => {
      expect([...arraySeq.iterator([1, 2, 3])]).toEqual([1, 2, 3]);
    });
  });

  describe("string → Seq", () => {
    it("length", () => {
      expect(stringSeq.length("hello")).toBe(5);
    });
    it("nth", () => {
      expect(stringSeq.nth("abc", 1)).toBe("b");
      expect(stringSeq.nth("abc", 10)).toBeUndefined();
    });
  });

  describe("native Set → MutableSetLike", () => {
    const SL = nativeMutableSetLike<string>();

    it("create and add", () => {
      const s = SL.create();
      SL.add(s, "a");
      SL.add(s, "b");
      expect(SL.has(s, "a")).toBe(true);
      expect(SL.size(s)).toBe(2);
    });
  });

  describe("native Map → MutableMapLike", () => {
    const ML = nativeMutableMapLike<string, number>();

    it("create and set", () => {
      const m = ML.create();
      ML.set(m, "x", 1);
      expect(ML.get(m, "x")).toBe(1);
      expect(ML.size(m)).toBe(1);
    });
  });

  describe("HashSet → MutableSetLike via mutableSetFor", () => {
    it("auto-derived from Eq+Hash", () => {
      const SL = mutableSetFor(eqString, hashString);
      const s = SL.create();
      SL.add(s, "hello");
      SL.add(s, "world");
      expect(SL.has(s, "hello")).toBe(true);
      expect(SL.size(s)).toBe(2);
    });
  });
});

describe("Derived operations", () => {
  describe("IterableOnce ops", () => {
    it("toArray", () => {
      expect(toArray([1, 2, 3], arraySeq)).toEqual([1, 2, 3]);
    });

    it("forEach", () => {
      const collected: number[] = [];
      forEach([1, 2, 3], (x: number) => collected.push(x), arraySeq);
      expect(collected).toEqual([1, 2, 3]);
    });

    it("find", () => {
      expect(find([1, 2, 3], (x: number) => x > 1, arraySeq)).toBe(2);
      expect(find([1, 2, 3], (x: number) => x > 10, arraySeq)).toBeUndefined();
    });

    it("exists", () => {
      expect(exists([1, 2, 3], (x: number) => x === 2, arraySeq)).toBe(true);
      expect(exists([1, 2, 3], (x: number) => x === 5, arraySeq)).toBe(false);
    });

    it("forAll", () => {
      expect(forAll([1, 2, 3], (x: number) => x > 0, arraySeq)).toBe(true);
      expect(forAll([1, 2, 3], (x: number) => x > 1, arraySeq)).toBe(false);
    });

    it("count", () => {
      expect(count([1, 2, 3], arraySeq)).toBe(3);
    });
  });

  describe("Seq ops", () => {
    it("head/last", () => {
      expect(head([10, 20, 30], arraySeq)).toBe(10);
      expect(last([10, 20, 30], arraySeq)).toBe(30);
      expect(head([], arraySeq)).toBeUndefined();
      expect(last([], arraySeq)).toBeUndefined();
    });

    it("take/drop", () => {
      expect(take([1, 2, 3, 4, 5], 3, arraySeq)).toEqual([1, 2, 3]);
      expect(drop([1, 2, 3, 4, 5], 3, arraySeq)).toEqual([4, 5]);
    });

    it("sorted", () => {
      expect(sorted([3, 1, 2], arraySeq, ordNumber)).toEqual([1, 2, 3]);
    });

    it("seqContains", () => {
      expect(seqContains([1, 2, 3], 2, arraySeq, eqNumber)).toBe(true);
      expect(seqContains([1, 2, 3], 5, arraySeq, eqNumber)).toBe(false);
    });
  });

  describe("Set ops", () => {
    const SL = hashMutableSetLike(eqString, hashString);

    function setOf(...items: string[]) {
      const s = SL.create();
      for (const i of items) SL.add(s, i);
      return s;
    }

    it("union", () => {
      const a = setOf("a", "b");
      const b = setOf("b", "c");
      const result = union(a, b, SL, SL);
      expect(result.size).toBe(3);
      expect(result.has("a")).toBe(true);
      expect(result.has("b")).toBe(true);
      expect(result.has("c")).toBe(true);
    });

    it("intersection", () => {
      const a = setOf("a", "b", "c");
      const b = setOf("b", "c", "d");
      const result = intersection(a, b, SL, SL);
      expect(result.size).toBe(2);
      expect(result.has("b")).toBe(true);
      expect(result.has("c")).toBe(true);
    });

    it("difference", () => {
      const a = setOf("a", "b", "c");
      const b = setOf("b", "c", "d");
      const result = difference(a, b, SL, SL);
      expect(result.size).toBe(1);
      expect(result.has("a")).toBe(true);
    });

    it("isSubsetOf", () => {
      const a = setOf("a", "b");
      const b = setOf("a", "b", "c");
      expect(isSubsetOf(a, b, SL)).toBe(true);
      expect(isSubsetOf(b, a, SL)).toBe(false);
    });
  });

  describe("Map ops", () => {
    const ML = hashMutableMapLike<string, number>(eqString, hashString);

    function mapOf(entries: [string, number][]): ReturnType<typeof ML.create> {
      const m = ML.create();
      for (const [k, v] of entries) ML.set(m, k, v);
      return m;
    }

    it("getOrElse", () => {
      const m = mapOf([
        ["a", 1],
        ["b", 2],
      ]);
      expect(getOrElse(m, "a", 99, ML)).toBe(1);
      expect(getOrElse(m, "c", 99, ML)).toBe(99);
    });

    it("mapValues", () => {
      const m = mapOf([
        ["a", 1],
        ["b", 2],
      ]);
      const ML2 = hashMutableMapLike<string, string>(eqString, hashString);
      const result = mapValues(m, (v: number) => `val${v}`, ML, ML2);
      expect(result.get("a")).toBe("val1");
      expect(result.get("b")).toBe("val2");
    });

    it("filterEntries", () => {
      const m = mapOf([
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ]);
      const result = filterEntries(m, (_k: string, v: number) => v > 1, ML, ML);
      expect(result.size).toBe(2);
      expect(result.has("a")).toBe(false);
      expect(result.get("b")).toBe(2);
    });
  });
});
