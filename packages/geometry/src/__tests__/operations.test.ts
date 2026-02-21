import { describe, expect, it } from "vitest";
import {
  point2d,
  point3d,
  vec2,
  vec3,
  polar,
  translate,
  displacement,
  addVec,
  subVec,
  scale,
  negate,
  dot,
  cross,
  magnitude,
  normalize,
  distance,
  midpoint,
  angle,
  lerp,
  x,
  y,
  z,
} from "../index.js";
import type { Vec2, Vec3, Point2D, Point3D, PolarPoint } from "../index.js";

describe("translate", () => {
  it("translates a 2D point by a vector", () => {
    const p = point2d(1, 2);
    const v = vec2(3, 4);
    const result = translate(p, v);
    expect(result[0]).toBe(4);
    expect(result[1]).toBe(6);
  });

  it("translates a 3D point by a vector", () => {
    const p = point3d(1, 2, 3);
    const v = vec3(10, 20, 30);
    const result = translate(p, v);
    expect(result).toEqual([11, 22, 33]);
  });
});

describe("displacement", () => {
  it("computes displacement vector between two points", () => {
    const a = point2d(1, 2);
    const b = point2d(4, 6);
    const v = displacement(a, b);
    expect(v).toEqual([3, 4]);
  });

  it("displacement from a to b then translate a gives b", () => {
    const a = point3d(1, 2, 3);
    const b = point3d(7, 8, 9);
    const v = displacement(a, b);
    const result = translate(a, v);
    expect(result[0]).toBeCloseTo(b[0]);
    expect(result[1]).toBeCloseTo(b[1]);
    expect(result[2]).toBeCloseTo(b[2]);
  });
});

describe("vector arithmetic", () => {
  it("adds vectors", () => {
    expect(addVec(vec2(1, 2), vec2(3, 4))).toEqual([4, 6]);
    expect(addVec(vec3(1, 2, 3), vec3(4, 5, 6))).toEqual([5, 7, 9]);
  });

  it("subtracts vectors", () => {
    expect(subVec(vec2(5, 7), vec2(3, 4))).toEqual([2, 3]);
  });

  it("scales a vector", () => {
    expect(scale(vec2(1, 2), 3)).toEqual([3, 6]);
    expect(scale(vec3(1, 2, 3), -1)).toEqual([-1, -2, -3]);
  });

  it("negates a vector", () => {
    expect(negate(vec2(1, -2))).toEqual([-1, 2]);
    expect(negate(vec3(1, -2, 3))).toEqual([-1, 2, -3]);
  });
});

describe("dot product", () => {
  it("computes dot product of 2D vectors", () => {
    expect(dot(vec2(1, 0), vec2(0, 1))).toBe(0);
    expect(dot(vec2(3, 4), vec2(3, 4))).toBe(25);
  });

  it("computes dot product of 3D vectors", () => {
    expect(dot(vec3(1, 2, 3), vec3(4, 5, 6))).toBe(32);
  });
});

describe("cross product", () => {
  it("computes cross product of basis vectors", () => {
    const i = vec3(1, 0, 0);
    const j = vec3(0, 1, 0);
    const k = vec3(0, 0, 1);
    expect(cross(i, j)).toEqual([0, 0, 1]);
    expect(cross(j, k)).toEqual([1, 0, 0]);
    expect(cross(k, i)).toEqual([0, 1, 0]);
  });

  it("cross product is anticommutative", () => {
    const a = vec3(1, 2, 3);
    const b = vec3(4, 5, 6);
    const ab = cross(a, b);
    const ba = cross(b, a);
    expect(ab[0]).toBeCloseTo(-ba[0]);
    expect(ab[1]).toBeCloseTo(-ba[1]);
    expect(ab[2]).toBeCloseTo(-ba[2]);
  });

  it("cross product of parallel vectors is zero", () => {
    const a = vec3(2, 4, 6);
    const b = vec3(1, 2, 3);
    const result = cross(a, b);
    expect(result[0]).toBeCloseTo(0);
    expect(result[1]).toBeCloseTo(0);
    expect(result[2]).toBeCloseTo(0);
  });
});

describe("magnitude", () => {
  it("computes length of 2D vectors", () => {
    expect(magnitude(vec2(3, 4))).toBe(5);
    expect(magnitude(vec2(0, 0))).toBe(0);
  });

  it("computes length of 3D vectors", () => {
    expect(magnitude(vec3(1, 2, 2))).toBe(3);
  });
});

describe("normalize", () => {
  it("produces a unit vector", () => {
    const n = normalize(vec2(3, 4));
    expect(magnitude(n)).toBeCloseTo(1);
    expect(n[0]).toBeCloseTo(0.6);
    expect(n[1]).toBeCloseTo(0.8);
  });

  it("returns zero vector unchanged", () => {
    const z = normalize(vec2(0, 0));
    expect(z).toEqual([0, 0]);
  });
});

describe("distance", () => {
  it("computes Euclidean distance between 2D points", () => {
    expect(distance(point2d(0, 0), point2d(3, 4))).toBe(5);
  });

  it("distance from a point to itself is zero", () => {
    const p = point3d(1, 2, 3);
    expect(distance(p, p)).toBe(0);
  });
});

describe("midpoint", () => {
  it("computes the midpoint of two 2D points", () => {
    expect(midpoint(point2d(0, 0), point2d(4, 6))).toEqual([2, 3]);
  });

  it("midpoint of identical points is the same point", () => {
    const p = point3d(5, 5, 5);
    expect(midpoint(p, p)).toEqual([5, 5, 5]);
  });
});

describe("angle", () => {
  it("angle between perpendicular vectors is pi/2", () => {
    expect(angle(vec2(1, 0), vec2(0, 1))).toBeCloseTo(Math.PI / 2);
  });

  it("angle between parallel vectors is 0", () => {
    expect(angle(vec2(1, 0), vec2(2, 0))).toBeCloseTo(0);
  });

  it("angle between opposite vectors is pi", () => {
    expect(angle(vec2(1, 0), vec2(-1, 0))).toBeCloseTo(Math.PI);
  });

  it("angle between 3D vectors", () => {
    expect(angle(vec3(1, 0, 0), vec3(0, 1, 0))).toBeCloseTo(Math.PI / 2);
  });
});

describe("lerp", () => {
  it("interpolates between two points", () => {
    const a = point2d(0, 0);
    const b = point2d(10, 20);
    expect(lerp(a, b, 0)).toEqual([0, 0]);
    expect(lerp(a, b, 1)).toEqual([10, 20]);
    expect(lerp(a, b, 0.5)).toEqual([5, 10]);
  });

  it("works for 3D points", () => {
    const a = point3d(0, 0, 0);
    const b = point3d(6, 8, 10);
    const mid = lerp(a, b, 0.5);
    expect(mid).toEqual([3, 4, 5]);
  });
});

describe("component access", () => {
  it("x and y work for 2D points and vectors", () => {
    expect(x(point2d(3, 4))).toBe(3);
    expect(y(point2d(3, 4))).toBe(4);
    expect(x(vec2(5, 6))).toBe(5);
    expect(y(vec2(5, 6))).toBe(6);
  });

  it("z works for 3D types", () => {
    expect(z(point3d(1, 2, 3))).toBe(3);
    expect(z(vec3(4, 5, 6))).toBe(6);
  });
});

describe("type safety", () => {
  it("prevents mixing 2D and 3D", () => {
    const p2 = point2d(1, 2);
    const v3 = vec3(1, 2, 3);
    // @ts-expect-error — cannot translate 2D point with 3D vector
    translate(p2, v3);
  });

  it("prevents mixing coordinate systems", () => {
    const cart = point2d(1, 2);
    const pol = polar(1, 0);
    // @ts-expect-error — cannot compute distance between Cartesian and Polar
    distance(cart, pol);
  });

  it("prevents adding vectors from different coordinate systems", () => {
    const v1 = vec2(1, 2);
    // @ts-expect-error — cannot add Cartesian vector to Polar vector
    addVec(v1, [1, 0] as unknown as import("../types.js").Vector<
      import("../types.js").Polar,
      import("../types.js").Dim2
    >);
  });
});
