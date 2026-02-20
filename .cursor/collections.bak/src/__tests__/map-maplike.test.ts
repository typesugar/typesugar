import { describe, it, expect } from "vitest";
import { stringMapMapLike, mapBuilder } from "../instances/map.js";
import { recordMapLike } from "../instances/object-record.js";
import {
  getOrElse,
  merge,
  foldEntries,
  filterKeys,
  filterValues,
} from "../typeclasses/index.js";

describe("stringMapMapLike (Map<string, V>)", () => {
  const m = new Map([
    ["a", 1],
    ["b", 2],
    ["c", 3],
  ]);

  it("get / has / keys / values / size", () => {
    expect(stringMapMapLike.get(m, "a")).toBe(1);
    expect(stringMapMapLike.get(m, "z")).toBeUndefined();
    expect(stringMapMapLike.has(m, "b")).toBe(true);
    expect(stringMapMapLike.has(m, "z")).toBe(false);
    expect(Array.from(stringMapMapLike.keys(m)).sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(Array.from(stringMapMapLike.values(m)).sort()).toEqual([1, 2, 3]);
    expect(stringMapMapLike.size(m)).toBe(3);
  });

  it("updated / removed / fromEntries / empty", () => {
    expect(stringMapMapLike.updated(m, "d", 4).get("d")).toBe(4);
    expect(stringMapMapLike.removed(m, "a").has("a")).toBe(false);
    expect(stringMapMapLike.fromEntries([["x", 10]])).toEqual(
      new Map([["x", 10]]),
    );
    expect(stringMapMapLike.empty().size).toBe(0);
  });

  it("getOrElse", () => {
    expect(getOrElse(stringMapMapLike)(m, "a", () => 99)).toBe(1);
    expect(getOrElse(stringMapMapLike)(m, "z", () => 99)).toBe(99);
  });

  it("merge", () => {
    const m2 = new Map([
      ["b", 20],
      ["d", 4],
    ]);
    const merged = merge(stringMapMapLike)(m, m2);
    expect(merged.get("a")).toBe(1);
    expect(merged.get("b")).toBe(20);
    expect(merged.get("d")).toBe(4);

    const mergedResolve = merge(stringMapMapLike)(m, m2, (a, b) => a + b);
    expect(mergedResolve.get("b")).toBe(22);
  });

  it("foldEntries", () => {
    const result = foldEntries(stringMapMapLike)(
      m,
      "",
      (acc, k, v) => acc + `${k}=${v} `,
    );
    expect(result).toContain("a=1");
    expect(result).toContain("b=2");
  });

  it("filterKeys / filterValues", () => {
    expect(filterKeys(stringMapMapLike)(m, (k) => k !== "b")).toEqual(
      new Map([
        ["a", 1],
        ["c", 3],
      ]),
    );
    expect(filterValues(stringMapMapLike)(m, (v) => v > 1)).toEqual(
      new Map([
        ["b", 2],
        ["c", 3],
      ]),
    );
  });

  it("iterator iterates over values", () => {
    const values = Array.from(stringMapMapLike.iterator(m)).sort();
    expect(values).toEqual([1, 2, 3]);
  });

  it("foldLeft over values", () => {
    expect(stringMapMapLike.foldLeft(m, 0, (acc, v) => acc + v)).toBe(6);
  });
});

describe("mapBuilder", () => {
  it("builds a Map", () => {
    const builder = mapBuilder<string, number>();
    builder.addOne(["a", 1]);
    builder.addOne(["b", 2]);
    expect(builder.result()).toEqual(
      new Map([
        ["a", 1],
        ["b", 2],
      ]),
    );
  });
});

describe("recordMapLike (Record<string, V>)", () => {
  const obj = { a: 1, b: 2, c: 3 };

  it("get / has / keys / values / size", () => {
    expect(recordMapLike.get(obj, "a")).toBe(1);
    expect(recordMapLike.has(obj, "b")).toBe(true);
    expect(recordMapLike.has(obj, "z")).toBe(false);
    expect(Array.from(recordMapLike.keys(obj)).sort()).toEqual(["a", "b", "c"]);
    expect(Array.from(recordMapLike.values(obj)).sort()).toEqual([1, 2, 3]);
    expect(recordMapLike.size(obj)).toBe(3);
  });

  it("updated / removed / fromEntries / empty", () => {
    expect(recordMapLike.updated(obj, "d", 4)).toEqual({
      a: 1,
      b: 2,
      c: 3,
      d: 4,
    });
    expect(recordMapLike.removed(obj, "a")).toEqual({ b: 2, c: 3 });
    expect(recordMapLike.fromEntries([["x", 10]])).toEqual({ x: 10 });
    expect(recordMapLike.empty()).toEqual({});
  });

  it("getOrElse", () => {
    expect(getOrElse(recordMapLike)(obj, "a", () => 99)).toBe(1);
    expect(getOrElse(recordMapLike)(obj, "z", () => 99)).toBe(99);
  });
});
