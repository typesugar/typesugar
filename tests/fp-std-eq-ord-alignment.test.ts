/**
 * Architecture review 2026-11 (S4, S11): `@typesugar/fp` and `@typesugar/std`
 * each define `Eq`/`Ord` (fp does not depend on std), so the two families must
 * stay interchangeable: the same member names (the names the `===`/`<` operator
 * rewrites call) and the same argument order for the shared combinators.
 */
import { describe, it, expect } from "vitest";
import * as std from "@typesugar/std";
import { EqOps as fp } from "@typesugar/fp/typeclasses";
import { constant as fpConstant, mapFst as fpMapFst, mapSnd as fpMapSnd } from "@typesugar/fp";

const keys = (o: object) => Object.keys(o).sort();

describe("fp's Eq/Ord match std's", () => {
  it("instances have the same members", () => {
    expect(keys(fp.eqNumber)).toEqual(keys(std.eqNumber));
    expect(keys(fp.eqString)).toEqual(keys(std.eqString));
    expect(keys(fp.ordNumber)).toEqual(keys(std.ordNumber));
    expect(keys(fp.ordString)).toEqual(keys(std.ordString));
    expect(keys(fp.makeOrd<number>(() => 0))).toEqual(keys(std.makeOrd<number>(() => 0)));
    expect(keys(fp.makeEq<number>(() => true))).toEqual(keys(std.makeEq<number>(() => true)));
  });

  it("an instance of one works with the other's combinators", () => {
    const fpOrdArr = fp.ordArray(std.ordNumber);
    const stdOrdArr = std.ordArray(fp.ordNumber);
    expect(fpOrdArr.lessThan([1, 2], [1, 3])).toBe(true);
    expect(stdOrdArr.lessThan([1, 2], [1, 3])).toBe(true);
    expect(fp.eqArray(std.eqNumber).notEquals([1], [2])).toBe(true);
  });

  it("eqBy/ordBy take (f, E) in both", () => {
    const byLen = (s: string) => s.length;
    expect(fp.eqBy(byLen, fp.eqNumber).equals("ab", "cd")).toBe(true);
    expect(std.eqBy(byLen, std.eqNumber).equals("ab", "cd")).toBe(true);
    expect(fp.eqBy(byLen).notEquals("a", "cd")).toBe(true);
    expect(fp.ordBy(byLen, fp.ordNumber).compare("a", "bc")).toBe(-1);
    expect(std.ordBy(byLen, std.ordNumber).compare("a", "bc")).toBe(-1);
  });
});

describe("fp's constant/mapFst/mapSnd match std's", () => {
  it("constant is a thunk", () => {
    expect(fpConstant(42)()).toBe(42);
    expect(std.constant(42)()).toBe(42);
  });

  it("mapFst/mapSnd take the pair first", () => {
    expect(fpMapFst([1, "a"], (n: number) => n + 1)).toEqual([2, "a"]);
    expect(std.mapFst([1, "a"] as const, (n: number) => n + 1)).toEqual([2, "a"]);
    expect(fpMapSnd([1, "a"], (s: string) => s + "!")).toEqual([1, "a!"]);
    expect(std.mapSnd([1, "a"] as const, (s: string) => s + "!")).toEqual([1, "a!"]);
  });
});
