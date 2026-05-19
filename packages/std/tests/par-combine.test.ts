/**
 * Tests for the ParCombine typeclass instances.
 *
 * PEP-039 Wave 5 — verifies that the built-in ParCombine instances
 * (Promise, AsyncIterable, Array, Iterable) implement `all` / `map` correctly,
 * and that combine operations satisfy expected algebraic properties.
 */

import { describe, it, expect } from "vitest";
import {
  parCombinePromise,
  parCombineAsyncIterable,
  parCombineArray,
  parCombineIterable,
  getParCombine,
  getParCombineBuilder,
} from "../src/typeclasses/par-combine.js";

// ---------------------------------------------------------------------------
// Promise instance
// ---------------------------------------------------------------------------

describe("parCombinePromise", () => {
  it("all() resolves an array of promises into a promise of array", async () => {
    const result = await (parCombinePromise.all([
      Promise.resolve(1),
      Promise.resolve(2),
      Promise.resolve(3),
    ]) as Promise<number[]>);
    expect(result).toEqual([1, 2, 3]);
  });

  it("all() preserves order regardless of resolution timing", async () => {
    const slow = new Promise<string>((res) => setTimeout(() => res("a"), 10));
    const fast = Promise.resolve("b");
    const result = await (parCombinePromise.all([slow, fast]) as Promise<string[]>);
    expect(result).toEqual(["a", "b"]);
  });

  it("all() with empty array resolves to []", async () => {
    const result = await (parCombinePromise.all([]) as Promise<unknown[]>);
    expect(result).toEqual([]);
  });

  it("map() transforms the combined result", async () => {
    const combined = parCombinePromise.all([Promise.resolve(1), Promise.resolve(2)]);
    const mapped = parCombinePromise.map(combined, (xs) =>
      (xs as number[]).reduce((a, b) => a + b, 0)
    );
    expect(await (mapped as Promise<number>)).toBe(3);
  });

  it("all() rejects if any promise rejects", async () => {
    const combined = parCombinePromise.all([
      Promise.resolve(1),
      Promise.reject(new Error("boom")),
    ]) as Promise<unknown>;
    await expect(combined).rejects.toThrow("boom");
  });
});

// ---------------------------------------------------------------------------
// Array instance — cartesian product
// ---------------------------------------------------------------------------

describe("parCombineArray (cartesian product)", () => {
  it("all([]) returns [[]] (identity for cartesian product)", () => {
    const result = parCombineArray.all([]) as unknown[][];
    expect(result).toEqual([[]]);
  });

  it("all([[1,2],[3,4]]) returns the cartesian product", () => {
    const result = parCombineArray.all([
      [1, 2],
      [3, 4],
    ]) as number[][];
    expect(result).toEqual([
      [1, 3],
      [1, 4],
      [2, 3],
      [2, 4],
    ]);
  });

  it("all() with three arrays produces all combinations", () => {
    const result = parCombineArray.all([[1, 2], ["a"], [true, false]]) as unknown[][];
    expect(result).toHaveLength(2 * 1 * 2);
    expect(result).toContainEqual([1, "a", true]);
    expect(result).toContainEqual([2, "a", false]);
  });

  it("all() with an empty inner array yields empty product", () => {
    const result = parCombineArray.all([[1, 2], []]) as unknown[][];
    expect(result).toEqual([]);
  });

  it("map() transforms each combination", () => {
    const combined = parCombineArray.all([
      [1, 2],
      [10, 20],
    ]);
    const mapped = parCombineArray.map(combined, ([a, b]) => (a as number) + (b as number));
    expect(mapped).toEqual([11, 21, 12, 22]);
  });

  it("associativity-like property: cartesian product cardinality is multiplicative", () => {
    const a = [1, 2];
    const b = [3, 4, 5];
    const c = [6, 7];
    const result = parCombineArray.all([a, b, c]) as unknown[][];
    expect(result.length).toBe(a.length * b.length * c.length);
  });
});

// ---------------------------------------------------------------------------
// Iterable instance
// ---------------------------------------------------------------------------

describe("parCombineIterable", () => {
  function* range(start: number, end: number): Iterable<number> {
    for (let i = start; i < end; i++) yield i;
  }

  it("collects iterables and produces cartesian product", () => {
    const result = parCombineIterable.all([range(1, 3), range(10, 12)]) as number[][];
    expect(result).toEqual([
      [1, 10],
      [1, 11],
      [2, 10],
      [2, 11],
    ]);
  });

  it("works with arrays as iterables", () => {
    const result = parCombineIterable.all([
      [1, 2],
      ["a", "b"],
    ]) as unknown[][];
    expect(result).toHaveLength(4);
  });

  it("map() transforms each combination", () => {
    const combined = parCombineIterable.all([range(1, 3), range(10, 12)]);
    const mapped = parCombineIterable.map(combined, ([a, b]) => `${a}-${b}`);
    expect(mapped).toEqual(["1-10", "1-11", "2-10", "2-11"]);
  });

  it("all([]) returns [[]]", () => {
    expect(parCombineIterable.all([])).toEqual([[]]);
  });
});

// ---------------------------------------------------------------------------
// AsyncIterable instance
// ---------------------------------------------------------------------------

describe("parCombineAsyncIterable", () => {
  async function* asyncRange(start: number, end: number): AsyncIterable<number> {
    for (let i = start; i < end; i++) yield i;
  }

  it("collects async iterables and returns a Promise of arrays", async () => {
    const result = (await parCombineAsyncIterable.all([
      asyncRange(1, 4),
      asyncRange(10, 12),
    ])) as number[][];
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([1, 2, 3]);
    expect(result[1]).toEqual([10, 11]);
  });

  it("map() transforms the collected results", async () => {
    const combined = parCombineAsyncIterable.all([asyncRange(1, 3), asyncRange(10, 11)]);
    const mapped = parCombineAsyncIterable.map(combined, (results) => {
      const [a, b] = results as [number[], number[]];
      return a.length + b.length;
    });
    expect(await (mapped as Promise<number>)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Registry lookup
// ---------------------------------------------------------------------------

describe("ParCombine registry", () => {
  it("getParCombine returns built-in instances by name", () => {
    expect(getParCombine("Promise")).toBe(parCombinePromise);
    expect(getParCombine("Array")).toBe(parCombineArray);
    expect(getParCombine("Iterable")).toBe(parCombineIterable);
    expect(getParCombine("AsyncIterable")).toBe(parCombineAsyncIterable);
  });

  it("getParCombine returns undefined for unknown names", () => {
    expect(getParCombine("Unknown")).toBeUndefined();
  });

  it("getParCombineBuilder returns builders for built-in names", () => {
    expect(getParCombineBuilder("Promise")).toBeDefined();
    expect(getParCombineBuilder("Array")).toBeDefined();
    expect(getParCombineBuilder("Iterable")).toBeDefined();
    expect(getParCombineBuilder("AsyncIterable")).toBeDefined();
  });

  it("getParCombineBuilder returns undefined for unknown names", () => {
    expect(getParCombineBuilder("NotRegistered")).toBeUndefined();
  });
});
