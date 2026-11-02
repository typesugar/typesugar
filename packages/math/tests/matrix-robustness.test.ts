/**
 * MU-13 (numericMatrix scalar view), MU-17 (absolute singularity threshold),
 * MU-18 (element-wise ops never check dimensions).
 */
import { describe, it, expect } from "vitest";
import {
  diag,
  fromRows,
  add,
  sub,
  det,
  inverse,
  matMul,
  identity,
  numericMatrix,
  approxEquals,
  type Matrix,
} from "../src/types/matrix.js";

describe("MU-13: numericMatrix scalar view", () => {
  const N = numericMatrix(3);
  it("pow(a, one()) is a, and fromNumber/toNumber round-trip", () => {
    const a = diag<3>([2, 1, 1]);
    expect(Array.from(N.pow(a, N.one()))).toEqual(Array.from(a));
    expect(Array.from(N.pow(a, N.fromNumber(3)))[0]).toBe(8);
    expect(N.toNumber(N.fromNumber(5))).toBe(5);
  });
  it("pow rejects a non-scalar or non-integer exponent matrix", () => {
    const a = diag<3>([2, 1, 1]);
    expect(() => N.pow(a, diag<3>([1, 2, 3]))).toThrow(RangeError);
    expect(() => N.pow(a, N.fromNumber(1.5))).toThrow(RangeError);
  });
});

describe("MU-17: scale-invariant singularity tests", () => {
  it("well-conditioned small-scale matrices are invertible", () => {
    for (const s of [1e-7, 1e-20, 1e20]) {
      for (const n of [1, 2, 3, 4, 5]) {
        const m = diag(Array(n).fill(s)) as Matrix<number, number>;
        const inv = inverse(m);
        expect(approxEquals(matMul(m, inv), identity(n), 1e-9)).toBe(true);
      }
    }
  });
  it("det(4x4 tiny diagonal) is the product, like the 3x3 case", () => {
    expect(det(diag([1e-4, 1e-4, 1e-4, 1e-13]))).toBeCloseTo(1e-25, 35);
    expect(det(diag([1e-4, 1e-4, 1e-13]))).toBeCloseTo(1e-21, 31);
  });
  it("genuinely singular matrices are still rejected", () => {
    expect(() =>
      inverse(
        fromRows([
          [1, 2],
          [2, 4],
        ])
      )
    ).toThrow("singular");
    expect(() =>
      inverse(
        fromRows([
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9],
        ])
      )
    ).toThrow("singular");
    expect(() =>
      inverse(
        fromRows([
          [1, 2, 3, 4],
          [2, 4, 6, 8],
          [0, 1, 0, 1],
          [1, 0, 1, 0],
        ])
      )
    ).toThrow("singular");
    expect(
      det(
        fromRows([
          [1, 2, 3, 4],
          [2, 4, 6, 8],
          [0, 1, 0, 1],
          [1, 0, 1, 0],
        ])
      )
    ).toBe(0);
  });
});

describe("MU-18: element-wise ops check dimensions", () => {
  it("add/sub of differently shaped matrices throw", () => {
    const a = fromRows([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    const b = fromRows([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
    expect(() => add(a, b)).toThrow(RangeError);
    expect(() => sub(a, b)).toThrow(RangeError);
  });
});
