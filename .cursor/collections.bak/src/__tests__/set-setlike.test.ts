import { describe, it, expect } from "vitest";
import { setSetLike, setGrowable } from "../instances/set.js";
import {
  size,
  isEmpty,
  toArray,
  union,
  intersect,
  diff,
  symmetricDiff,
  subsetOf,
  supersetOf,
  isDisjoint,
} from "../typeclasses/index.js";

describe("setSetLike", () => {
  describe("IterableOnce", () => {
    it("iterator supports for...of", () => {
      const result: number[] = [];
      for (const x of setSetLike.iterator(new Set([1, 2, 3]))) result.push(x);
      expect(result.sort()).toEqual([1, 2, 3]);
    });

    it("foldLeft", () => {
      expect(setSetLike.foldLeft(new Set([1, 2, 3]), 0, (a, b) => a + b)).toBe(
        6,
      );
    });

    it("size / isEmpty", () => {
      expect(size(setSetLike)(new Set([1, 2, 3]))).toBe(3);
      expect(isEmpty(setSetLike)(new Set())).toBe(true);
      expect(isEmpty(setSetLike)(new Set([1]))).toBe(false);
    });
  });

  describe("Iterable", () => {
    it("map / filter / flatMap", () => {
      expect(setSetLike.map(new Set([1, 2, 3]), (x) => x * 2)).toEqual(
        new Set([2, 4, 6]),
      );
      expect(setSetLike.filter(new Set([1, 2, 3, 4]), (x) => x > 2)).toEqual(
        new Set([3, 4]),
      );
      expect(
        setSetLike.flatMap(new Set([1, 2]), (x) => new Set([x, x * 10])),
      ).toEqual(new Set([1, 10, 2, 20]));
    });

    it("from / empty / concat", () => {
      expect(setSetLike.from([1, 2, 2, 3])).toEqual(new Set([1, 2, 3]));
      expect(setSetLike.empty()).toEqual(new Set());
      expect(setSetLike.concat(new Set([1, 2]), new Set([2, 3]))).toEqual(
        new Set([1, 2, 3]),
      );
    });
  });

  describe("SetLike", () => {
    it("contains / add / remove", () => {
      const s = new Set([1, 2, 3]);
      expect(setSetLike.contains(s, 2)).toBe(true);
      expect(setSetLike.contains(s, 5)).toBe(false);
      expect(setSetLike.add(s, 4)).toEqual(new Set([1, 2, 3, 4]));
      expect(setSetLike.remove(s, 2)).toEqual(new Set([1, 3]));
    });

    it("union / intersect / diff / symmetricDiff", () => {
      const a = new Set([1, 2, 3]);
      const b = new Set([2, 3, 4]);
      expect(union(setSetLike)(a, b)).toEqual(new Set([1, 2, 3, 4]));
      expect(intersect(setSetLike)(a, b)).toEqual(new Set([2, 3]));
      expect(diff(setSetLike)(a, b)).toEqual(new Set([1]));
      expect(symmetricDiff(setSetLike)(a, b)).toEqual(new Set([1, 4]));
    });

    it("subsetOf / supersetOf / isDisjoint", () => {
      expect(subsetOf(setSetLike)(new Set([1, 2]), new Set([1, 2, 3]))).toBe(
        true,
      );
      expect(subsetOf(setSetLike)(new Set([1, 4]), new Set([1, 2, 3]))).toBe(
        false,
      );
      expect(supersetOf(setSetLike)(new Set([1, 2, 3]), new Set([1, 2]))).toBe(
        true,
      );
      expect(isDisjoint(setSetLike)(new Set([1, 2]), new Set([3, 4]))).toBe(
        true,
      );
      expect(isDisjoint(setSetLike)(new Set([1, 2]), new Set([2, 3]))).toBe(
        false,
      );
    });
  });

  describe("Growable", () => {
    it("newBuilder builds a set", () => {
      const builder = setGrowable.newBuilder<number>();
      builder.addOne(1);
      builder.addOne(2);
      builder.addOne(2);
      expect(builder.result()).toEqual(new Set([1, 2]));
    });
  });
});
