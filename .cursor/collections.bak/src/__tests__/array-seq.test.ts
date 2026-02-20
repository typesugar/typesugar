import { describe, it, expect } from "vitest";
import { arraySeq, arrayGrowable } from "../instances/array.js";
import {
  foldRight,
  forEach,
  reduce,
  size,
  isEmpty,
  toArray,
  count,
  exists,
  forall,
  find,
  sum,
  product,
  min,
  max,
  mkString,
  toSet,
  toMap,
  partition,
  groupBy,
  take,
  drop,
  takeWhile,
  dropWhile,
  zip,
  zipWithIndex,
  collect,
  intersperse,
  head,
  tail,
  last,
  init,
  splitAt,
  span,
  scanLeft,
  sliding,
  corresponds,
  tails,
  inits,
  distinctBy,
} from "../typeclasses/index.js";

describe("arraySeq", () => {
  describe("IterableOnce", () => {
    it("iterator supports for...of", () => {
      const result: number[] = [];
      for (const x of arraySeq.iterator([1, 2, 3])) result.push(x);
      expect(result).toEqual([1, 2, 3]);
    });

    it("foldLeft", () => {
      expect(arraySeq.foldLeft([1, 2, 3], 0, (a, b) => a + b)).toBe(6);
    });

    it("foldRight", () => {
      expect(foldRight(arraySeq)([1, 2, 3], "", (a, b) => `${a}${b}`)).toBe(
        "123",
      );
    });

    it("forEach", () => {
      const result: number[] = [];
      forEach(arraySeq)([1, 2, 3], (x) => result.push(x));
      expect(result).toEqual([1, 2, 3]);
    });

    it("reduce", () => {
      expect(reduce(arraySeq)([1, 2, 3], (a, b) => a + b)).toBe(6);
      expect(
        reduce(arraySeq)([], (a: number, b: number) => a + b),
      ).toBeUndefined();
    });

    it("size / isEmpty", () => {
      expect(size(arraySeq)([1, 2, 3])).toBe(3);
      expect(size(arraySeq)([])).toBe(0);
      expect(isEmpty(arraySeq)([])).toBe(true);
      expect(isEmpty(arraySeq)([1])).toBe(false);
    });

    it("toArray", () => {
      expect(toArray(arraySeq)([1, 2, 3])).toEqual([1, 2, 3]);
    });

    it("count / exists / forall / find", () => {
      expect(count(arraySeq)([1, 2, 3, 4], (x) => x > 2)).toBe(2);
      expect(exists(arraySeq)([1, 2, 3], (x) => x === 2)).toBe(true);
      expect(exists(arraySeq)([1, 2, 3], (x) => x === 5)).toBe(false);
      expect(forall(arraySeq)([2, 4, 6], (x) => x % 2 === 0)).toBe(true);
      expect(forall(arraySeq)([2, 3, 6], (x) => x % 2 === 0)).toBe(false);
      expect(find(arraySeq)([1, 2, 3], (x) => x > 1)).toBe(2);
    });

    it("sum / product / min / max", () => {
      expect(sum(arraySeq)([1, 2, 3])).toBe(6);
      expect(product(arraySeq)([1, 2, 3, 4])).toBe(24);
      expect(min(arraySeq)([3, 1, 2])).toBe(1);
      expect(max(arraySeq)([3, 1, 2])).toBe(3);
    });

    it("mkString", () => {
      expect(mkString(arraySeq)([1, 2, 3], ", ", "[", "]")).toBe("[1, 2, 3]");
    });

    it("toSet / toMap", () => {
      expect(toSet(arraySeq)([1, 2, 2, 3])).toEqual(new Set([1, 2, 3]));
      expect(
        toMap(arraySeq)([
          ["a", 1],
          ["b", 2],
        ] as [string, number][]),
      ).toEqual(
        new Map([
          ["a", 1],
          ["b", 2],
        ]),
      );
    });
  });

  describe("Iterable", () => {
    it("map / filter / flatMap", () => {
      expect(arraySeq.map([1, 2, 3], (x) => x * 2)).toEqual([2, 4, 6]);
      expect(arraySeq.filter([1, 2, 3, 4], (x) => x > 2)).toEqual([3, 4]);
      expect(arraySeq.flatMap([1, 2], (x) => [x, x * 10])).toEqual([
        1, 10, 2, 20,
      ]);
    });

    it("from / empty / concat", () => {
      expect(arraySeq.from([1, 2, 3])).toEqual([1, 2, 3]);
      expect(arraySeq.empty()).toEqual([]);
      expect(arraySeq.concat([1, 2], [3, 4])).toEqual([1, 2, 3, 4]);
    });

    it("partition / groupBy", () => {
      const [yes, no] = partition(arraySeq)([1, 2, 3, 4], (x) => x > 2);
      expect(yes).toEqual([3, 4]);
      expect(no).toEqual([1, 2]);

      const groups = groupBy(arraySeq)([1, 2, 3, 4], (x) =>
        x % 2 === 0 ? "even" : "odd",
      );
      expect(groups.get("even")).toEqual([2, 4]);
      expect(groups.get("odd")).toEqual([1, 3]);
    });

    it("take / drop / takeWhile / dropWhile", () => {
      expect(take(arraySeq)([1, 2, 3, 4, 5], 3)).toEqual([1, 2, 3]);
      expect(drop(arraySeq)([1, 2, 3, 4, 5], 3)).toEqual([4, 5]);
      expect(takeWhile(arraySeq)([1, 2, 3, 4, 5], (x) => x < 4)).toEqual([
        1, 2, 3,
      ]);
      expect(dropWhile(arraySeq)([1, 2, 3, 4, 5], (x) => x < 4)).toEqual([
        4, 5,
      ]);
    });

    it("zip / zipWithIndex", () => {
      expect(zip(arraySeq)([1, 2], ["a", "b"])).toEqual([
        [1, "a"],
        [2, "b"],
      ]);
      expect(zipWithIndex(arraySeq)(["a", "b"])).toEqual([
        ["a", 0],
        ["b", 1],
      ]);
    });

    it("collect / intersperse", () => {
      expect(
        collect(arraySeq)([1, 2, 3, 4], (x) => (x > 2 ? x * 10 : undefined)),
      ).toEqual([30, 40]);
      expect(intersperse(arraySeq)([1, 2, 3], 0)).toEqual([1, 0, 2, 0, 3]);
    });
  });

  describe("Seq", () => {
    it("apply / reverse / sorted / updated", () => {
      expect(arraySeq.apply([10, 20, 30], 1)).toBe(20);
      expect(arraySeq.reverse([1, 2, 3])).toEqual([3, 2, 1]);
      expect(arraySeq.sorted([3, 1, 2])).toEqual([1, 2, 3]);
      expect(arraySeq.updated([1, 2, 3], 1, 99)).toEqual([1, 99, 3]);
    });

    it("head / tail / last / init", () => {
      expect(head(arraySeq)([1, 2, 3])).toBe(1);
      expect(head(arraySeq)([])).toBeUndefined();
      expect(tail(arraySeq)([1, 2, 3])).toEqual([2, 3]);
      expect(last(arraySeq)([1, 2, 3])).toBe(3);
      expect(init(arraySeq)([1, 2, 3])).toEqual([1, 2]);
    });

    it("splitAt / span / scanLeft", () => {
      expect(splitAt(arraySeq)([1, 2, 3, 4], 2)).toEqual([
        [1, 2],
        [3, 4],
      ]);
      expect(span(arraySeq)([1, 2, 3, 4], (x) => x < 3)).toEqual([
        [1, 2],
        [3, 4],
      ]);
      expect(scanLeft(arraySeq)([1, 2, 3], 0, (a, b) => a + b)).toEqual([
        0, 1, 3, 6,
      ]);
    });

    it("sliding", () => {
      expect(sliding(arraySeq)([1, 2, 3, 4, 5], 3)).toEqual([
        [1, 2, 3],
        [2, 3, 4],
        [3, 4, 5],
      ]);
    });

    it("corresponds", () => {
      expect(
        corresponds(arraySeq)([1, 2, 3], [2, 4, 6], (a, b) => b === a * 2),
      ).toBe(true);
      expect(corresponds(arraySeq)([1, 2], [1, 2, 3], (a, b) => a === b)).toBe(
        false,
      );
    });

    it("tails / inits", () => {
      expect(tails(arraySeq)([1, 2, 3])).toEqual([[1, 2, 3], [2, 3], [3], []]);
      expect(inits(arraySeq)([1, 2, 3])).toEqual([[1, 2, 3], [1, 2], [1], []]);
    });

    it("distinctBy", () => {
      expect(distinctBy(arraySeq)([1, 2, 3, 4, 5], (x) => x % 3)).toEqual([
        1, 2, 3,
      ]);
    });
  });

  describe("Growable", () => {
    it("newBuilder builds an array", () => {
      const builder = arrayGrowable.newBuilder<number>();
      builder.addOne(1);
      builder.addOne(2);
      builder.addOne(3);
      expect(builder.result()).toEqual([1, 2, 3]);
    });
  });
});
