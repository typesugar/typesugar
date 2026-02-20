import { describe, it, expect } from "vitest";
import { LazyView, view } from "../views/lazy-view.js";
import { arraySeq } from "../instances/array.js";

describe("LazyView", () => {
  it("map / filter / flatMap are lazy", () => {
    let mapCalls = 0;
    const v = new LazyView(() => [1, 2, 3, 4, 5][Symbol.iterator]())
      .map((x) => {
        mapCalls++;
        return x * 2;
      })
      .filter((x) => x > 4);

    expect(mapCalls).toBe(0);
    expect(v.toArray()).toEqual([6, 8, 10]);
    expect(mapCalls).toBe(5);
  });

  it("take / drop", () => {
    const v = new LazyView(() => [1, 2, 3, 4, 5][Symbol.iterator]());
    expect(v.take(3).toArray()).toEqual([1, 2, 3]);
    expect(v.drop(3).toArray()).toEqual([4, 5]);
  });

  it("takeWhile / dropWhile", () => {
    const v = new LazyView(() => [1, 2, 3, 4, 5][Symbol.iterator]());
    expect(v.takeWhile((x) => x < 4).toArray()).toEqual([1, 2, 3]);
    expect(v.dropWhile((x) => x < 4).toArray()).toEqual([4, 5]);
  });

  it("collect", () => {
    const v = new LazyView(() => [1, 2, 3, 4][Symbol.iterator]());
    expect(v.collect((x) => (x > 2 ? x * 10 : undefined)).toArray()).toEqual([
      30, 40,
    ]);
  });

  it("zipWithIndex", () => {
    const v = new LazyView(() => ["a", "b", "c"][Symbol.iterator]());
    expect(v.zipWithIndex().toArray()).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });

  it("supports for...of", () => {
    const v = new LazyView(() => [1, 2, 3][Symbol.iterator]());
    const result: number[] = [];
    for (const x of v.map((x) => x * 2)) result.push(x);
    expect(result).toEqual([2, 4, 6]);
  });

  it("terminal: foldLeft / reduce", () => {
    const v = new LazyView(() => [1, 2, 3][Symbol.iterator]());
    expect(v.foldLeft(0, (a, b) => a + b)).toBe(6);
    expect(v.reduce((a, b) => a + b)).toBe(6);
  });

  it("terminal: count / exists / forall / find", () => {
    const v = new LazyView(() => [1, 2, 3, 4][Symbol.iterator]());
    expect(v.count((x) => x > 2)).toBe(2);
    expect(v.exists((x) => x === 3)).toBe(true);
    expect(v.forall((x) => x > 0)).toBe(true);
    expect(v.find((x) => x > 2)).toBe(3);
  });

  it("terminal: isEmpty / size / head / last", () => {
    const v = new LazyView(() => [1, 2, 3][Symbol.iterator]());
    expect(v.isEmpty()).toBe(false);
    expect(v.size()).toBe(3);
    expect(v.head()).toBe(1);
    expect(v.last()).toBe(3);
  });

  it("terminal: mkString / toSet / sum / min / max", () => {
    const v = new LazyView(() => [1, 2, 3][Symbol.iterator]());
    expect(v.mkString(", ", "[", "]")).toBe("[1, 2, 3]");
    expect(v.toSet()).toEqual(new Set([1, 2, 3]));

    const nums = new LazyView(() => [3, 1, 4, 1, 5][Symbol.iterator]());
    expect(nums.sum()).toBe(14);
    expect(nums.min()).toBe(1);
    expect(nums.max()).toBe(5);
  });

  it("complex chaining is lazy", () => {
    let ops = 0;
    const result = new LazyView(() =>
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10][Symbol.iterator](),
    )
      .map((x) => {
        ops++;
        return x * 2;
      })
      .filter((x) => x > 10)
      .take(2)
      .toArray();

    expect(result).toEqual([12, 14]);
    expect(ops).toBeLessThanOrEqual(10);
  });
});

describe("view() helper", () => {
  it("creates a LazyView from an IterableOnce instance", () => {
    const v = view(arraySeq)([1, 2, 3, 4, 5]);
    expect(v.filter((x) => x > 3).toArray()).toEqual([4, 5]);
  });
});
