/**
 * Red Team Tests for @typesugar/geometry
 *
 * Attack surfaces:
 * - Coordinate system conversions (polar, spherical, cylindrical) edge cases
 * - Vector normalization and magnitude with zero/degenerate vectors
 * - Special floating-point values (NaN, Infinity, -0) in coordinates
 * - Transform matrix inversion of singular/near-singular matrices
 * - Angle calculations near boundaries and with parallel/antiparallel vectors
 * - Precision issues with accumulated transformations
 * - lerp extrapolation outside [0, 1]
 */
import { describe, it, expect } from "vitest";
import {
  point2d,
  point3d,
  vec2,
  vec3,
  polar,
  spherical,
  cylindrical,
  cartesianToPolar,
  polarToCartesian,
  cartesianToSpherical,
  sphericalToCartesian,
  cartesianToCylindrical,
  cylindricalToCartesian,
  normalize,
  magnitude,
  dot,
  cross,
  angle,
  distance,
  lerp,
  midpoint,
  addVec,
  scale,
  inverse,
  compose,
  applyToPoint,
  applyToVector,
  identity2d,
  identity3d,
  rotation2d,
  translation2d,
  scale2d,
  rotationX,
  rotationY,
  rotationZ,
  translation3d,
  scale3d,
} from "../packages/geometry/src/index.js";

describe("Geometry Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Coordinate System Conversion Edge Cases
  // ==========================================================================
  describe("Coordinate system conversions at origin and special angles", () => {
    it("cartesianToPolar at origin returns (0, 0) — theta is arbitrary but defined", () => {
      const p = point2d(0, 0);
      const pol = cartesianToPolar(p);
      expect(pol[0]).toBe(0); // r = 0
      // theta can be anything when r=0, but atan2(0,0) returns 0
      expect(pol[1]).toBe(0);
    });

    it("polarToCartesian with r=0 returns origin regardless of theta", () => {
      const p1 = polar(0, Math.PI);
      const p2 = polar(0, Math.PI / 2);
      const c1 = polarToCartesian(p1);
      const c2 = polarToCartesian(p2);
      expect(c1[0]).toBeCloseTo(0, 10);
      expect(c1[1]).toBeCloseTo(0, 10);
      expect(c2[0]).toBeCloseTo(0, 10);
      expect(c2[1]).toBeCloseTo(0, 10);
    });

    it("cartesianToSpherical at 3D origin returns (0, 0, 0)", () => {
      const p = point3d(0, 0, 0);
      const sph = cartesianToSpherical(p);
      expect(sph[0]).toBe(0); // r = 0
      expect(sph[1]).toBe(0); // theta is clamped when r=0
      expect(sph[2]).toBe(0); // phi = atan2(0, 0) = 0
    });

    it("spherical to cartesian roundtrip preserves values", () => {
      const original = point3d(1, 2, 3);
      const sph = cartesianToSpherical(original);
      const back = sphericalToCartesian(sph);
      expect(back[0]).toBeCloseTo(original[0], 10);
      expect(back[1]).toBeCloseTo(original[1], 10);
      expect(back[2]).toBeCloseTo(original[2], 10);
    });

    it("cartesianToCylindrical on z-axis has r=0 and arbitrary theta", () => {
      const p = point3d(0, 0, 5);
      const cyl = cartesianToCylindrical(p);
      expect(cyl[0]).toBe(0); // r = 0 on z-axis
      expect(cyl[2]).toBe(5); // z preserved
    });
  });

  // ==========================================================================
  // Attack 2: Special Floating-Point Values
  // ==========================================================================
  describe("Special floating-point values in coordinates", () => {
    it("NaN coordinates propagate through operations", () => {
      const p1 = point2d(NaN, 1);
      const p2 = point2d(2, 3);
      const d = distance(p1, p2);
      expect(Number.isNaN(d)).toBe(true);
    });

    it("Infinity coordinates produce Infinity distance", () => {
      const p1 = point2d(Infinity, 0);
      const p2 = point2d(0, 0);
      const d = distance(p1, p2);
      expect(d).toBe(Infinity);
    });

    it("magnitude of vector with Infinity component is Infinity", () => {
      const v = vec2(Infinity, 1);
      expect(magnitude(v)).toBe(Infinity);
    });

    it("negative zero is handled correctly in conversions", () => {
      const p = point2d(-0, 1);
      const pol = cartesianToPolar(p);
      // atan2(1, -0) = PI/2, not -PI/2
      expect(pol[1]).toBeCloseTo(Math.PI / 2, 10);
    });

    it("NaN in spherical conversion doesn't crash", () => {
      const p = point3d(NaN, 1, 2);
      const sph = cartesianToSpherical(p);
      expect(Number.isNaN(sph[0])).toBe(true); // r is NaN
    });
  });

  // ==========================================================================
  // Attack 3: Vector Normalization Edge Cases
  // ==========================================================================
  describe("Vector normalization with degenerate inputs", () => {
    it("normalizing zero vector returns zero vector (not NaN)", () => {
      const v = vec2(0, 0);
      const n = normalize(v);
      expect(n[0]).toBe(0);
      expect(n[1]).toBe(0);
    });

    it("normalizing 3D zero vector returns zero vector", () => {
      const v = vec3(0, 0, 0);
      const n = normalize(v);
      expect(n[0]).toBe(0);
      expect(n[1]).toBe(0);
      expect(n[2]).toBe(0);
    });

    it("normalizing very small vector doesn't produce NaN", () => {
      const v = vec2(1e-200, 1e-200);
      const n = normalize(v);
      // This may underflow or produce NaN depending on implementation
      const isFinite = Number.isFinite(n[0]) && Number.isFinite(n[1]);
      const isZero = n[0] === 0 && n[1] === 0;
      expect(isFinite || isZero).toBe(true);
    });

    it("magnitude of normalized non-zero vector is 1", () => {
      const v = vec3(3, 4, 0);
      const n = normalize(v);
      expect(magnitude(n)).toBeCloseTo(1, 10);
    });
  });

  // ==========================================================================
  // Attack 4: Angle Calculation Boundary Cases
  // ==========================================================================
  describe("Angle calculations near boundaries", () => {
    it("angle between identical vectors is 0", () => {
      const v = vec2(1, 0);
      expect(angle(v, v)).toBe(0);
    });

    it("angle between opposite vectors is PI", () => {
      const v1 = vec2(1, 0);
      const v2 = vec2(-1, 0);
      expect(angle(v1, v2)).toBeCloseTo(Math.PI, 10);
    });

    it("angle between perpendicular vectors is PI/2", () => {
      const v1 = vec2(1, 0);
      const v2 = vec2(0, 1);
      expect(angle(v1, v2)).toBeCloseTo(Math.PI / 2, 10);
    });

    it("angle with zero vector returns 0 (not NaN)", () => {
      const v1 = vec2(1, 0);
      const v2 = vec2(0, 0);
      expect(angle(v1, v2)).toBe(0);
    });

    it("angle clamps to valid range even with floating point errors", () => {
      // Nearly identical vectors might have dot/mag slightly > 1 due to FP errors
      const v1 = vec3(1, 0, 0);
      const v2 = vec3(1, 1e-16, 0);
      const a = angle(v1, v2);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(Math.PI);
    });
  });

  // ==========================================================================
  // Attack 5: Transform Matrix Edge Cases
  // ==========================================================================
  describe("Transform matrix operations with edge cases", () => {
    it("inverse of identity2d is identity2d", () => {
      const id = identity2d();
      const inv = inverse(id);
      // Check diagonal elements are 1
      expect(inv[0]).toBeCloseTo(1, 10);
      expect(inv[4]).toBeCloseTo(1, 10);
      expect(inv[8]).toBeCloseTo(1, 10);
    });

    it("inverse of identity3d is identity3d", () => {
      const id = identity3d();
      const inv = inverse(id);
      expect(inv[0]).toBeCloseTo(1, 10);
      expect(inv[5]).toBeCloseTo(1, 10);
      expect(inv[10]).toBeCloseTo(1, 10);
      expect(inv[15]).toBeCloseTo(1, 10);
    });

    it("scale2d with zero factor throws on inverse (singular matrix)", () => {
      const t = scale2d(0, 1);
      expect(() => inverse(t)).toThrow("Singular matrix");
    });

    it("scale3d with zero factor throws on inverse", () => {
      const t = scale3d(1, 0, 1);
      expect(() => inverse(t)).toThrow("Singular matrix");
    });

    it("compose(T, inverse(T)) is identity", () => {
      const t = compose(rotation2d(Math.PI / 4), translation2d(10, 20));
      const inv = inverse(t);
      const identity = compose(t, inv);
      // Check it's close to identity
      expect(identity[0]).toBeCloseTo(1, 8);
      expect(identity[4]).toBeCloseTo(1, 8);
      expect(identity[1]).toBeCloseTo(0, 8);
      expect(identity[3]).toBeCloseTo(0, 8);
    });
  });

  // ==========================================================================
  // Attack 6: Interpolation Edge Cases
  // ==========================================================================
  describe("lerp extrapolation and edge values", () => {
    it("lerp at t=0 returns first point", () => {
      const a = point2d(0, 0);
      const b = point2d(10, 10);
      const result = lerp(a, b, 0);
      expect(result[0]).toBe(0);
      expect(result[1]).toBe(0);
    });

    it("lerp at t=1 returns second point", () => {
      const a = point2d(0, 0);
      const b = point2d(10, 10);
      const result = lerp(a, b, 1);
      expect(result[0]).toBe(10);
      expect(result[1]).toBe(10);
    });

    it("lerp at t=0.5 returns midpoint", () => {
      const a = point2d(0, 0);
      const b = point2d(10, 10);
      const result = lerp(a, b, 0.5);
      expect(result[0]).toBe(5);
      expect(result[1]).toBe(5);
    });

    it("lerp extrapolates for t > 1", () => {
      const a = point2d(0, 0);
      const b = point2d(10, 0);
      const result = lerp(a, b, 2);
      expect(result[0]).toBe(20); // Extrapolates beyond b
    });

    it("lerp extrapolates for t < 0", () => {
      const a = point2d(0, 0);
      const b = point2d(10, 0);
      const result = lerp(a, b, -1);
      expect(result[0]).toBe(-10); // Extrapolates before a
    });

    it("midpoint of identical points is that point", () => {
      const p = point3d(5, 5, 5);
      const m = midpoint(p, p);
      expect(m[0]).toBe(5);
      expect(m[1]).toBe(5);
      expect(m[2]).toBe(5);
    });
  });

  // ==========================================================================
  // Attack 7: Cross Product Edge Cases
  // ==========================================================================
  describe("Cross product special cases", () => {
    it("cross product of parallel vectors is zero vector", () => {
      const v1 = vec3(1, 0, 0);
      const v2 = vec3(2, 0, 0); // Parallel to v1
      const result = cross(v1, v2);
      expect(result[0]).toBe(0);
      expect(result[1]).toBe(0);
      expect(result[2]).toBe(0);
    });

    it("cross product of antiparallel vectors is zero vector", () => {
      const v1 = vec3(1, 0, 0);
      const v2 = vec3(-1, 0, 0);
      const result = cross(v1, v2);
      // Use toBeCloseTo to handle -0 vs +0 distinction
      expect(result[0]).toBeCloseTo(0, 10);
      expect(result[1]).toBeCloseTo(0, 10);
      expect(result[2]).toBeCloseTo(0, 10);
    });

    it("cross product of perpendicular unit vectors has magnitude 1", () => {
      const v1 = vec3(1, 0, 0);
      const v2 = vec3(0, 1, 0);
      const result = cross(v1, v2);
      expect(magnitude(result)).toBeCloseTo(1, 10);
      // Should be (0, 0, 1)
      expect(result[2]).toBeCloseTo(1, 10);
    });

    it("cross product is anticommutative: a × b = -(b × a)", () => {
      const v1 = vec3(1, 2, 3);
      const v2 = vec3(4, 5, 6);
      const ab = cross(v1, v2);
      const ba = cross(v2, v1);
      expect(ab[0]).toBeCloseTo(-ba[0], 10);
      expect(ab[1]).toBeCloseTo(-ba[1], 10);
      expect(ab[2]).toBeCloseTo(-ba[2], 10);
    });
  });

  // ==========================================================================
  // Attack 8: Precision Accumulation in Transform Chains
  // ==========================================================================
  describe("Precision accumulation with repeated transformations", () => {
    it("360 degree rotation (4 × 90°) returns approximately to identity", () => {
      const rot90 = rotation2d(Math.PI / 2);
      const rot360 = compose(compose(compose(rot90, rot90), rot90), rot90);
      // Should be close to identity
      expect(rot360[0]).toBeCloseTo(1, 8);
      expect(rot360[4]).toBeCloseTo(1, 8);
      expect(rot360[1]).toBeCloseTo(0, 8);
    });

    it("translation roundtrip preserves point with floating point tolerance", () => {
      const p = point2d(1, 1);
      const t = translation2d(1000000, 1000000);
      const tInv = inverse(t);
      const moved = applyToPoint(t, p);
      const back = applyToPoint(tInv, moved);
      expect(back[0]).toBeCloseTo(1, 6);
      expect(back[1]).toBeCloseTo(1, 6);
    });

    it("many small rotations accumulate to expected total", () => {
      const smallAngle = Math.PI / 180; // 1 degree
      let total = identity2d();
      for (let i = 0; i < 360; i++) {
        total = compose(total, rotation2d(smallAngle));
      }
      // Should be close to identity after 360 × 1° rotations
      expect(total[0]).toBeCloseTo(1, 4); // Expect some drift
      expect(total[4]).toBeCloseTo(1, 4);
    });

    it("scale followed by inverse scale returns identity", () => {
      const p = point3d(1, 2, 3);
      const s = scale3d(100, 0.01, 1000);
      const sInv = inverse(s);
      const composed = compose(s, sInv);
      const result = applyToPoint(composed, p);
      expect(result[0]).toBeCloseTo(1, 8);
      expect(result[1]).toBeCloseTo(2, 8);
      expect(result[2]).toBeCloseTo(3, 8);
    });
  });

  // ==========================================================================
  // Attack 9: applyToVector vs applyToPoint Semantics
  // ==========================================================================
  describe("Point vs Vector transform semantics", () => {
    it("translation affects points but not vectors", () => {
      const t = translation2d(10, 20);
      const p = point2d(1, 1);
      const v = vec2(1, 1);

      const pTransformed = applyToPoint(t, p);
      const vTransformed = applyToVector(t, v);

      // Point should be translated
      expect(pTransformed[0]).toBe(11);
      expect(pTransformed[1]).toBe(21);

      // Vector should NOT be translated (translation-invariant)
      expect(vTransformed[0]).toBe(1);
      expect(vTransformed[1]).toBe(1);
    });

    it("rotation affects both points and vectors equally (for origin-centered rotation)", () => {
      const r = rotation2d(Math.PI / 2); // 90° CCW
      const p = point2d(1, 0);
      const v = vec2(1, 0);

      const pRotated = applyToPoint(r, p);
      const vRotated = applyToVector(r, v);

      // Both should rotate to (0, 1)
      expect(pRotated[0]).toBeCloseTo(0, 10);
      expect(pRotated[1]).toBeCloseTo(1, 10);
      expect(vRotated[0]).toBeCloseTo(0, 10);
      expect(vRotated[1]).toBeCloseTo(1, 10);
    });

    it("scale affects both points and vectors", () => {
      const s = scale2d(2, 3);
      const p = point2d(1, 1);
      const v = vec2(1, 1);

      const pScaled = applyToPoint(s, p);
      const vScaled = applyToVector(s, v);

      expect(pScaled[0]).toBe(2);
      expect(pScaled[1]).toBe(3);
      expect(vScaled[0]).toBe(2);
      expect(vScaled[1]).toBe(3);
    });
  });

  // ==========================================================================
  // Attack 10: Distance and Dot Product Edge Cases
  // ==========================================================================
  describe("Distance and dot product edge cases", () => {
    it("distance between identical points is 0", () => {
      const p = point3d(5, 10, 15);
      expect(distance(p, p)).toBe(0);
    });

    it("distance is symmetric: d(a,b) = d(b,a)", () => {
      const a = point2d(1, 2);
      const b = point2d(4, 6);
      expect(distance(a, b)).toBe(distance(b, a));
    });

    it("dot product of orthogonal vectors is 0", () => {
      const v1 = vec3(1, 0, 0);
      const v2 = vec3(0, 1, 0);
      expect(dot(v1, v2)).toBe(0);
    });

    it("dot product with self equals squared magnitude", () => {
      const v = vec3(3, 4, 5);
      const d = dot(v, v);
      const m = magnitude(v);
      expect(d).toBeCloseTo(m * m, 10);
    });

    it("dot product with scaled vector scales linearly", () => {
      const v1 = vec2(1, 2);
      const v2 = vec2(3, 4);
      const d1 = dot(v1, v2);
      const v2Scaled = scale(v2, 5);
      const d2 = dot(v1, v2Scaled);
      expect(d2).toBeCloseTo(d1 * 5, 10);
    });
  });
});
