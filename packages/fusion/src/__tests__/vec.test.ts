import { describe, it, expect } from "vitest";
import {
  vec,
  vecOf,
  add,
  sub,
  mul,
  div,
  scale,
  dot,
  magnitude,
  normalize,
  mapVec,
  zipVec,
  toArray,
} from "../vec.js";

// ===========================================================================
// Element-wise arithmetic
// ===========================================================================

describe("vec — element-wise arithmetic", () => {
  it("add adds element-wise", () => {
    const result = add(vec([1, 2, 3]), vec([4, 5, 6]));
    expect(toArray(result)).toEqual([5, 7, 9]);
  });

  it("sub subtracts element-wise", () => {
    const result = sub(vec([10, 20, 30]), vec([1, 2, 3]));
    expect(toArray(result)).toEqual([9, 18, 27]);
  });

  it("mul multiplies element-wise", () => {
    const result = mul(vec([2, 3, 4]), vec([5, 6, 7]));
    expect(toArray(result)).toEqual([10, 18, 28]);
  });

  it("div divides element-wise", () => {
    const result = div(vec([10, 20, 30]), vec([2, 4, 5]));
    expect(toArray(result)).toEqual([5, 5, 6]);
  });

  it("scale multiplies by scalar", () => {
    const result = scale(vec([1, 2, 3]), 10);
    expect(toArray(result)).toEqual([10, 20, 30]);
  });
});

// ===========================================================================
// Vector operations
// ===========================================================================

describe("vec — vector operations", () => {
  it("dot product", () => {
    expect(dot(vec([1, 2, 3]), vec([4, 5, 6]))).toBe(32);
  });

  it("dot product of orthogonal vectors is 0", () => {
    expect(dot(vec([1, 0]), vec([0, 1]))).toBe(0);
  });

  it("magnitude of unit vector is 1", () => {
    expect(magnitude(vec([1, 0, 0]))).toBe(1);
  });

  it("magnitude of [3, 4] is 5", () => {
    expect(magnitude(vec([3, 4]))).toBe(5);
  });

  it("normalize produces unit vector", () => {
    const n = normalize(vec([3, 4]));
    expect(n.data[0]).toBeCloseTo(0.6);
    expect(n.data[1]).toBeCloseTo(0.8);
    expect(magnitude(n)).toBeCloseTo(1);
  });

  it("normalize zero vector returns zero vector", () => {
    const n = normalize(vec([0, 0, 0]));
    expect(toArray(n)).toEqual([0, 0, 0]);
  });
});

// ===========================================================================
// Map and zip
// ===========================================================================

describe("vec — mapVec and zipVec", () => {
  it("mapVec applies function to each element", () => {
    const result = mapVec(vec([1, 4, 9]), Math.sqrt);
    expect(result.data[0]).toBeCloseTo(1);
    expect(result.data[1]).toBeCloseTo(2);
    expect(result.data[2]).toBeCloseTo(3);
  });

  it("mapVec can change type", () => {
    const result = mapVec(vecOf([1, 2, 3]), (x) => String(x));
    expect(toArray(result)).toEqual(["1", "2", "3"]);
  });

  it("zipVec combines two vectors", () => {
    const result = zipVec(vec([1, 2, 3]), vec([10, 20, 30]), (a, b) => a + b);
    expect(toArray(result)).toEqual([11, 22, 33]);
  });

  it("zipVec with different types", () => {
    const result = zipVec(
      vecOf(["a", "b", "c"]),
      vec([1, 2, 3]),
      (s, n) => `${s}${n}`,
    );
    expect(toArray(result)).toEqual(["a1", "b2", "c3"]);
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================

describe("vec — edge cases", () => {
  it("empty vectors", () => {
    const result = add(vec([]), vec([]));
    expect(toArray(result)).toEqual([]);
    expect(result.length).toBe(0);
  });

  it("single element", () => {
    const result = add(vec([5]), vec([3]));
    expect(toArray(result)).toEqual([8]);
  });

  it("mismatched lengths uses minimum", () => {
    const result = add(vec([1, 2, 3]), vec([10, 20]));
    expect(toArray(result)).toEqual([11, 22]);
    expect(result.length).toBe(2);
  });

  it("dot product of empty vectors is 0", () => {
    expect(dot(vec([]), vec([]))).toBe(0);
  });

  it("magnitude of empty vector is 0", () => {
    expect(magnitude(vec([]))).toBe(0);
  });

  it("scale by zero", () => {
    expect(toArray(scale(vec([1, 2, 3]), 0))).toEqual([0, 0, 0]);
  });

  it("div by zero produces Infinity", () => {
    const result = div(vec([1, 2]), vec([0, 0]));
    expect(result.data[0]).toBe(Infinity);
    expect(result.data[1]).toBe(Infinity);
  });

  it("toArray returns a copy", () => {
    const data: number[] = [1, 2, 3];
    const v = vec(data);
    const arr = toArray(v);
    arr[0] = 999;
    expect(v.data[0]).toBe(1);
  });

  it("vec preserves input reference", () => {
    const input = [1, 2, 3] as const;
    const v = vec(input);
    expect(v.data).toBe(input);
    expect(v.length).toBe(3);
  });
});

// ===========================================================================
// Compound expressions
// ===========================================================================

describe("vec — compound expressions", () => {
  it("a + b * c (fused by hand)", () => {
    const a = vec([1, 2, 3]);
    const b = vec([4, 5, 6]);
    const c = vec([2, 2, 2]);
    const result = add(a, mul(b, c));
    expect(toArray(result)).toEqual([9, 12, 15]);
  });

  it("linear combination: a*x + b*y", () => {
    const x = vec([1, 0]);
    const y = vec([0, 1]);
    const result = add(scale(x, 3), scale(y, 4));
    expect(toArray(result)).toEqual([3, 4]);
  });

  it("distance between two points", () => {
    const p1 = vec([1, 2]);
    const p2 = vec([4, 6]);
    const diff = sub(p2, p1);
    expect(magnitude(diff)).toBe(5);
  });
});
