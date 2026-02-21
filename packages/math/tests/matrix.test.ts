import { describe, it, expect } from "vitest";
import {
  matrix,
  zeros,
  identity,
  fromRows,
  diag,
  rows,
  cols,
  get,
  set,
  row,
  col,
  transpose,
  matMul,
  matrixAdd,
  matrixSub,
  matrixScale,
  trace,
  det,
  matrixInverse as inverse,
  numericMatrix,
  matrixApproxEquals,
  toArray,
} from "../src/index.js";

describe("Matrix", () => {
  describe("constructors", () => {
    it("creates matrix from data", () => {
      const m = matrix(2, 3, [1, 2, 3, 4, 5, 6]);
      expect(rows(m)).toBe(2);
      expect(cols(m)).toBe(3);
      expect(get(m, 0, 0)).toBe(1);
      expect(get(m, 0, 2)).toBe(3);
      expect(get(m, 1, 0)).toBe(4);
    });

    it("throws for mismatched dimensions", () => {
      expect(() => matrix(2, 3, [1, 2, 3])).toThrow(RangeError);
    });

    it("creates zero matrix", () => {
      const m = zeros(2, 3);
      expect(rows(m)).toBe(2);
      expect(cols(m)).toBe(3);
      for (let i = 0; i < 6; i++) {
        expect(m[i]).toBe(0);
      }
    });

    it("creates identity matrix", () => {
      const m = identity(3);
      expect(rows(m)).toBe(3);
      expect(cols(m)).toBe(3);
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          expect(get(m, i, j)).toBe(i === j ? 1 : 0);
        }
      }
    });

    it("creates from rows", () => {
      const m = fromRows([
        [1, 2, 3],
        [4, 5, 6],
      ]);
      expect(rows(m)).toBe(2);
      expect(cols(m)).toBe(3);
      expect(get(m, 1, 2)).toBe(6);
    });

    it("creates diagonal matrix", () => {
      const m = diag([1, 2, 3]);
      expect(get(m, 0, 0)).toBe(1);
      expect(get(m, 1, 1)).toBe(2);
      expect(get(m, 2, 2)).toBe(3);
      expect(get(m, 0, 1)).toBe(0);
    });
  });

  describe("element access", () => {
    const m = matrix(2, 3, [1, 2, 3, 4, 5, 6]);

    it("gets elements", () => {
      expect(get(m, 0, 0)).toBe(1);
      expect(get(m, 0, 1)).toBe(2);
      expect(get(m, 1, 2)).toBe(6);
    });

    it("sets elements", () => {
      const m2 = matrix(2, 2, [1, 2, 3, 4]);
      set(m2, 0, 1, 10);
      expect(get(m2, 0, 1)).toBe(10);
    });

    it("gets row", () => {
      expect(row(m, 0)).toEqual([1, 2, 3]);
      expect(row(m, 1)).toEqual([4, 5, 6]);
    });

    it("gets column", () => {
      expect(col(m, 0)).toEqual([1, 4]);
      expect(col(m, 1)).toEqual([2, 5]);
      expect(col(m, 2)).toEqual([3, 6]);
    });
  });

  describe("transpose", () => {
    it("transposes matrix", () => {
      const m = matrix(2, 3, [1, 2, 3, 4, 5, 6]);
      const t = transpose(m);
      expect(rows(t)).toBe(3);
      expect(cols(t)).toBe(2);
      expect(toArray(t)).toEqual([
        [1, 4],
        [2, 5],
        [3, 6],
      ]);
    });

    it("transpose of transpose is original", () => {
      const m = matrix(2, 3, [1, 2, 3, 4, 5, 6]);
      const tt = transpose(transpose(m));
      expect(toArray(tt)).toEqual(toArray(m));
    });
  });

  describe("arithmetic", () => {
    it("adds matrices", () => {
      const a = matrix(2, 2, [1, 2, 3, 4]);
      const b = matrix(2, 2, [5, 6, 7, 8]);
      const c = matrixAdd(a, b);
      expect(toArray(c)).toEqual([
        [6, 8],
        [10, 12],
      ]);
    });

    it("subtracts matrices", () => {
      const a = matrix(2, 2, [5, 6, 7, 8]);
      const b = matrix(2, 2, [1, 2, 3, 4]);
      const c = matrixSub(a, b);
      expect(toArray(c)).toEqual([
        [4, 4],
        [4, 4],
      ]);
    });

    it("scales matrix", () => {
      const m = matrix(2, 2, [1, 2, 3, 4]);
      const s = matrixScale(m, 2);
      expect(toArray(s)).toEqual([
        [2, 4],
        [6, 8],
      ]);
    });
  });

  describe("matMul", () => {
    it("multiplies matrices", () => {
      const a = matrix(2, 3, [1, 2, 3, 4, 5, 6]);
      const b = matrix(3, 2, [7, 8, 9, 10, 11, 12]);
      const c = matMul(a, b);
      expect(rows(c)).toBe(2);
      expect(cols(c)).toBe(2);
      expect(toArray(c)).toEqual([
        [58, 64],
        [139, 154],
      ]);
    });

    it("identity is neutral", () => {
      const m = matrix(2, 2, [1, 2, 3, 4]);
      const i = identity(2);
      expect(toArray(matMul(m, i))).toEqual(toArray(m));
      expect(toArray(matMul(i, m))).toEqual(toArray(m));
    });
  });

  describe("square matrix operations", () => {
    it("computes trace", () => {
      const m = matrix(3, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(trace(m)).toBe(15); // 1 + 5 + 9
    });

    it("computes 2x2 determinant", () => {
      const m = matrix(2, 2, [1, 2, 3, 4]);
      expect(det(m)).toBe(-2); // 1*4 - 2*3
    });

    it("computes 3x3 determinant", () => {
      const m = matrix(3, 3, [1, 2, 3, 0, 1, 4, 5, 6, 0]);
      expect(det(m)).toBe(1); // Computed manually
    });

    it("computes larger determinant", () => {
      const m = matrix(4, 4, [1, 0, 2, -1, 3, 0, 0, 5, 2, 1, 4, -3, 1, 0, 5, 0]);
      expect(det(m)).toBeCloseTo(30, 10);
    });

    it("determinant of identity is 1", () => {
      expect(det(identity(3))).toBe(1);
    });

    it("determinant of singular matrix is 0", () => {
      const m = matrix(2, 2, [1, 2, 2, 4]); // row 2 = 2 * row 1
      expect(det(m)).toBe(0);
    });
  });

  describe("inverse", () => {
    it("inverts 2x2 matrix", () => {
      const m = matrix(2, 2, [4, 7, 2, 6]);
      const inv = inverse(m);
      const product = matMul(m, inv);
      expect(matrixApproxEquals(product, identity(2))).toBe(true);
    });

    it("inverts 3x3 matrix", () => {
      const m = matrix(3, 3, [1, 2, 3, 0, 1, 4, 5, 6, 0]);
      const inv = inverse(m);
      const product = matMul(m, inv);
      expect(matrixApproxEquals(product, identity(3))).toBe(true);
    });

    it("throws for singular matrix", () => {
      const m = matrix(2, 2, [1, 2, 2, 4]);
      expect(() => inverse(m)).toThrow(RangeError);
    });
  });

  describe("numericMatrix", () => {
    const N = numericMatrix(2);

    it("provides zero", () => {
      expect(toArray(N.zero())).toEqual([
        [0, 0],
        [0, 0],
      ]);
    });

    it("provides one (identity)", () => {
      expect(toArray(N.one())).toEqual([
        [1, 0],
        [0, 1],
      ]);
    });

    it("adds matrices", () => {
      const a = matrix(2, 2, [1, 2, 3, 4]);
      const b = matrix(2, 2, [5, 6, 7, 8]);
      expect(toArray(N.add(a, b))).toEqual([
        [6, 8],
        [10, 12],
      ]);
    });

    it("multiplies matrices (matmul, not element-wise)", () => {
      const a = matrix(2, 2, [1, 2, 3, 4]);
      const b = matrix(2, 2, [5, 6, 7, 8]);
      expect(toArray(N.mul(a, b))).toEqual([
        [19, 22],
        [43, 50],
      ]);
    });
  });
});
