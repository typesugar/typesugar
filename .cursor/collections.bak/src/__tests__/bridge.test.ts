import { describe, it, expect } from "vitest";
import { arraySeq } from "../instances/array.js";
import { setSetLike } from "../instances/set.js";
import {
  foldableFromIterableOnce,
  functorFromIterable,
  monadFromIterable,
  monoidKFromIterable,
  collectionMonoid,
} from "../bridge/fp.js";
import {
  sizedFromIterableOnce,
  searchableFromIterableOnce,
} from "../bridge/std.js";

describe("fp bridge", () => {
  it("foldableFromIterableOnce", () => {
    const foldable = foldableFromIterableOnce(arraySeq);
    expect(foldable.foldLeft([1, 2, 3], 0, (a, b) => a + b)).toBe(6);
    expect(foldable.foldRight([1, 2, 3], "", (a, b) => `${a}${b}`)).toBe("123");
  });

  it("functorFromIterable", () => {
    const functor = functorFromIterable(arraySeq);
    expect(functor.map([1, 2, 3], (x) => x * 2)).toEqual([2, 4, 6]);
  });

  it("monadFromIterable", () => {
    const monad = monadFromIterable(arraySeq);
    expect(monad.pure(42)).toEqual([42]);
    expect(monad.flatMap([1, 2, 3], (x) => [x, x * 10])).toEqual([
      1, 10, 2, 20, 3, 30,
    ]);
    expect(monad.map([1, 2], (x) => x + 1)).toEqual([2, 3]);
  });

  it("monoidKFromIterable", () => {
    const mk = monoidKFromIterable(arraySeq);
    expect(mk.emptyK()).toEqual([]);
    expect(mk.combineK([1, 2], [3, 4])).toEqual([1, 2, 3, 4]);
  });

  it("collectionMonoid", () => {
    const m = collectionMonoid<
      typeof arraySeq extends { map: any } ? any : never,
      number
    >(arraySeq);
    expect(m.empty).toEqual([]);
    expect(m.combine([1, 2], [3, 4])).toEqual([1, 2, 3, 4]);
  });

  it("works with Set", () => {
    const foldable = foldableFromIterableOnce(setSetLike);
    expect(foldable.foldLeft(new Set([1, 2, 3]), 0, (a, b) => a + b)).toBe(6);

    const functor = functorFromIterable(setSetLike);
    expect(functor.map(new Set([1, 2, 3]), (x) => x * 2)).toEqual(
      new Set([2, 4, 6]),
    );
  });
});

describe("std bridge", () => {
  it("sizedFromIterableOnce", () => {
    const sized = sizedFromIterableOnce(arraySeq);
    expect(sized.size([1, 2, 3])).toBe(3);
    expect(sized.isEmpty([])).toBe(true);
    expect(sized.isEmpty([1])).toBe(false);
  });

  it("searchableFromIterableOnce", () => {
    const searchable = searchableFromIterableOnce(arraySeq);
    expect(searchable.find([1, 2, 3], (x: number) => x > 1)).toBe(2);
    expect(searchable.contains([1, 2, 3], 2)).toBe(true);
    expect(searchable.contains([1, 2, 3], 5)).toBe(false);
    expect(searchable.indexOf([1, 2, 3], 2)).toBe(1);
    expect(searchable.indexOf([1, 2, 3], 5)).toBe(-1);
  });
});
