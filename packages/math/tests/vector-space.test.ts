/**
 * MU-22: vectorSpaceArray(N).vZero() must be an additive identity.
 */
import { describe, it, expect } from "vitest";
import { vectorSpaceArray, innerProductArray } from "../src/typeclasses/index.js";
import { numericNumber } from "@typesugar/std";

describe("MU-22: vectorSpaceArray zero", () => {
  const V = vectorSpaceArray(numericNumber);
  it("vZero is a two-sided identity for vAdd", () => {
    expect(V.vAdd(V.vZero(), [1, 2])).toEqual([1, 2]);
    expect(V.vAdd([1, 2], V.vZero())).toEqual([1, 2]);
    expect(V.vAdd(V.vZero(), V.vZero())).toEqual([]);
  });
  it("mismatched non-zero dimensions throw instead of truncating", () => {
    expect(() => V.vAdd([1, 2, 3], [1, 2])).toThrow(RangeError);
    expect(() => V.vAdd([1, 2], [1, 2, 3])).toThrow(RangeError);
  });
  it("dot with the zero vector is zero; mismatched dimensions throw", () => {
    const I = innerProductArray(numericNumber);
    expect(I.dot(I.vZero(), [1, 2])).toBe(0);
    expect(() => I.dot([1, 2, 3], [1, 2])).toThrow(RangeError);
  });
});
