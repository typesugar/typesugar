import { describe, it, expect } from "vitest";
import { arraySeq } from "../instances/array.js";
import { setSetLike } from "../instances/set.js";
import { stringMapMapLike } from "../instances/map.js";
import { C, P } from "../ops/index.js";

describe("Standalone operations (C.*)", () => {
  it("C.map / C.filter / C.foldLeft", () => {
    expect(C.map(arraySeq, [1, 2, 3], (x) => x * 2)).toEqual([2, 4, 6]);
    expect(C.filter(arraySeq, [1, 2, 3, 4], (x) => x > 2)).toEqual([3, 4]);
    expect(C.foldLeft(arraySeq, [1, 2, 3], 0, (a, b) => a + b)).toBe(6);
  });

  it("C.forEach / C.toArray / C.size / C.isEmpty", () => {
    const result: number[] = [];
    C.forEach(arraySeq, [1, 2, 3], (x) => result.push(x));
    expect(result).toEqual([1, 2, 3]);
    expect(C.toArray(arraySeq, [1, 2, 3])).toEqual([1, 2, 3]);
    expect(C.size(arraySeq, [1, 2, 3])).toBe(3);
    expect(C.isEmpty(arraySeq, [])).toBe(true);
  });

  it("C.flatMap / C.concat / C.take / C.drop", () => {
    expect(C.flatMap(arraySeq, [1, 2], (x) => [x, x * 10])).toEqual([
      1, 10, 2, 20,
    ]);
    expect(C.concat(arraySeq, [1, 2], [3, 4])).toEqual([1, 2, 3, 4]);
    expect(C.take(arraySeq, [1, 2, 3, 4, 5], 3)).toEqual([1, 2, 3]);
    expect(C.drop(arraySeq, [1, 2, 3, 4, 5], 3)).toEqual([4, 5]);
  });

  it("C.zip / C.zipWithIndex / C.groupBy", () => {
    expect(C.zip(arraySeq, [1, 2], ["a", "b"])).toEqual([
      [1, "a"],
      [2, "b"],
    ]);
    expect(C.zipWithIndex(arraySeq, ["a", "b"])).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
    const g = C.groupBy(arraySeq, [1, 2, 3, 4], (x) =>
      x % 2 === 0 ? "e" : "o",
    );
    expect(g.get("e")).toEqual([2, 4]);
  });

  it("C.apply / C.reverse / C.head / C.tail / C.last", () => {
    expect(C.apply(arraySeq, [10, 20, 30], 1)).toBe(20);
    expect(C.reverse(arraySeq, [1, 2, 3])).toEqual([3, 2, 1]);
    expect(C.head(arraySeq, [1, 2, 3])).toBe(1);
    expect(C.tail(arraySeq, [1, 2, 3])).toEqual([2, 3]);
    expect(C.last(arraySeq, [1, 2, 3])).toBe(3);
  });

  it("C.contains / C.add / C.remove (SetLike)", () => {
    const s = new Set([1, 2, 3]);
    expect(C.contains(setSetLike, s, 2)).toBe(true);
    expect(C.add(setSetLike, s, 4)).toEqual(new Set([1, 2, 3, 4]));
    expect(C.remove(setSetLike, s, 2)).toEqual(new Set([1, 3]));
  });

  it("C.get / C.has / C.mapUpdated / C.mapRemoved (MapLike)", () => {
    const m = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    expect(C.get(stringMapMapLike, m, "a")).toBe(1);
    expect(C.has(stringMapMapLike, m, "c")).toBe(false);
    expect(C.mapUpdated(stringMapMapLike, m, "c", 3).get("c")).toBe(3);
    expect(C.mapRemoved(stringMapMapLike, m, "a").has("a")).toBe(false);
  });

  it("C.sum / C.mkString", () => {
    expect(C.sum(arraySeq, [1, 2, 3])).toBe(6);
    expect(C.mkString(arraySeq, [1, 2, 3], ", ", "[", "]")).toBe("[1, 2, 3]");
  });
});

describe("Pipeable operations (P.*)", () => {
  it("P.map / P.filter / P.foldLeft", () => {
    const double = P.map(arraySeq)<number, number>((x) => x * 2);
    expect(double([1, 2, 3])).toEqual([2, 4, 6]);

    const gt2 = P.filter(arraySeq)<number>((x) => x > 2);
    expect(gt2([1, 2, 3, 4])).toEqual([3, 4]);

    const sumFn = P.foldLeft(arraySeq)<number, number>(0, (a, b) => a + b);
    expect(sumFn([1, 2, 3])).toBe(6);
  });

  it("P.take / P.drop / P.concat / P.reverse", () => {
    expect(P.take(arraySeq)(3)([1, 2, 3, 4, 5])).toEqual([1, 2, 3]);
    expect(P.drop(arraySeq)(3)([1, 2, 3, 4, 5])).toEqual([4, 5]);
    expect(P.concat(arraySeq)([3, 4])([1, 2])).toEqual([1, 2, 3, 4]);
    expect(P.reverse(arraySeq)([1, 2, 3])).toEqual([3, 2, 1]);
  });

  it("P.contains (SetLike)", () => {
    expect(P.contains(setSetLike)(2)(new Set([1, 2, 3]))).toBe(true);
    expect(P.contains(setSetLike)(5)(new Set([1, 2, 3]))).toBe(false);
  });
});
