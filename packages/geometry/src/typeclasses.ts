/**
 * Typeclass instances for geometry types.
 *
 * Provides Numeric, Eq, and Show instances for Vector and Point types, enabling:
 * - `v1 + v2` → addVec(v1, v2)
 * - `v1 - v2` → subVec(v1, v2)
 * - `v1 === v2` → component-wise equality
 * - `v.show()` → human-readable string representation
 */

import { type Op } from "@typesugar/core";
import { registerInstanceWithMeta } from "@typesugar/macros";
import { type Eq, type Numeric, makeEq } from "@typesugar/std";
import type { CoordSys, Dim, Point2D, Point3D, Vec2, Vec3, Vector } from "./types.js";

// ============================================================================
// Numeric instances for Vectors
// Component-wise arithmetic operations
// ============================================================================

/**
 * Create a Numeric instance for vectors of a given coordinate system and dimension.
 *
 * Note: div and pow don't have geometric meaning for vectors, so they throw.
 * Use scale() for scalar multiplication instead of mul() on two vectors.
 */
export function numericVector<CS extends CoordSys, D extends Dim<number>>(
  dim: number
): Numeric<Vector<CS, D>> {
  const zero = Array(dim).fill(0) as Vector<CS, D>;
  const one = Array(dim).fill(1) as Vector<CS, D>;

  return {
    add: (a, b) => a.map((c, i) => c + b[i]) as Vector<CS, D> & Op<"+">,
    sub: (a, b) => a.map((c, i) => c - b[i]) as Vector<CS, D> & Op<"-">,
    mul: (a, b) => a.map((c, i) => c * b[i]) as Vector<CS, D> & Op<"*">,
    div: (a, b) => a.map((c, i) => c / b[i]) as Vector<CS, D> & Op<"/">,
    pow: (_a, _b) => {
      throw new Error("Vector exponentiation is not defined");
    },
    negate: (a) => a.map((c) => -c) as Vector<CS, D>,
    abs: (a) => a.map((c) => Math.abs(c)) as Vector<CS, D>,
    signum: (a) => a.map((c) => Math.sign(c)) as Vector<CS, D>,
    fromNumber: (n) => Array(dim).fill(n) as Vector<CS, D>,
    toNumber: (a) => Math.sqrt(a.reduce((sum, c) => sum + c * c, 0)),
    zero: () => [...zero] as Vector<CS, D>,
    one: () => [...one] as Vector<CS, D>,
  };
}

/** Numeric instance for 2D Cartesian vectors */
export const numericVec2: Numeric<Vec2> = numericVector<
  import("./types.js").Cartesian,
  import("./types.js").Dim2
>(2);

/** Numeric instance for 3D Cartesian vectors */
export const numericVec3: Numeric<Vec3> = numericVector<
  import("./types.js").Cartesian,
  import("./types.js").Dim3
>(3);

// Register instances with the typeclass system
registerInstanceWithMeta({
  typeclassName: "Numeric",
  forType: "Vec2",
  instanceName: "numericVec2",
  derived: false,
});

registerInstanceWithMeta({
  typeclassName: "Numeric",
  forType: "Vec3",
  instanceName: "numericVec3",
  derived: false,
});

// ============================================================================
// Eq instances for Vectors
// Component-wise equality comparison
// ============================================================================

/**
 * Create an Eq instance for vectors with tolerance-based comparison.
 */
export function eqVector<CS extends CoordSys, D extends Dim<number>>(
  tolerance: number = 1e-10
): Eq<Vector<CS, D>> {
  return makeEq((a, b) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i] - b[i]) > tolerance) return false;
    }
    return true;
  });
}

/** Eq instance for 2D Cartesian vectors */
export const eqVec2: Eq<Vec2> = eqVector<
  import("./types.js").Cartesian,
  import("./types.js").Dim2
>();

/** Eq instance for 3D Cartesian vectors */
export const eqVec3: Eq<Vec3> = eqVector<
  import("./types.js").Cartesian,
  import("./types.js").Dim3
>();

// Register Eq instances
registerInstanceWithMeta({
  typeclassName: "Eq",
  forType: "Vec2",
  instanceName: "eqVec2",
  derived: false,
});

registerInstanceWithMeta({
  typeclassName: "Eq",
  forType: "Vec3",
  instanceName: "eqVec3",
  derived: false,
});

// ============================================================================
// Show instances — human-readable string representation
// ============================================================================

function showNumericArray(arr: number[], prefix: string): string {
  const parts = arr.map((c) => String(c)).join(", ");
  return `${prefix}(${parts})`;
}

/** Show instance for Vec2 */
export const showVec2 = {
  show: (v: Vec2) => showNumericArray(v, "Vec2"),
};

/** Show instance for Vec3 */
export const showVec3 = {
  show: (v: Vec3) => showNumericArray(v, "Vec3"),
};

/** Show instance for Point2D */
export const showPoint2D = {
  show: (p: Point2D) => showNumericArray(p, "Point2D"),
};

/** Show instance for Point3D */
export const showPoint3D = {
  show: (p: Point3D) => showNumericArray(p, "Point3D"),
};

// Register Show instances
registerInstanceWithMeta({
  typeclassName: "Show",
  forType: "Vec2",
  instanceName: "showVec2",
  derived: false,
});

registerInstanceWithMeta({
  typeclassName: "Show",
  forType: "Vec3",
  instanceName: "showVec3",
  derived: false,
});

registerInstanceWithMeta({
  typeclassName: "Show",
  forType: "Point2D",
  instanceName: "showPoint2D",
  derived: false,
});

registerInstanceWithMeta({
  typeclassName: "Show",
  forType: "Point3D",
  instanceName: "showPoint3D",
  derived: false,
});
