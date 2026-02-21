import type { CoordSys, Dim, Point, Point3D, Vec3, Vector } from "./types.js";

/** Translate a point by a vector: `p + v` */
export function translate<CS extends CoordSys, D extends Dim<number>>(
  p: Point<CS, D>,
  v: Vector<CS, D>
): Point<CS, D> {
  return p.map((c, i) => c + v[i]) as Point<CS, D>;
}

/** Displacement vector from one point to another: `to - from` */
export function displacement<CS extends CoordSys, D extends Dim<number>>(
  from: Point<CS, D>,
  to: Point<CS, D>
): Vector<CS, D> {
  return from.map((c, i) => to[i] - c) as Vector<CS, D>;
}

/** Component-wise vector addition */
export function addVec<CS extends CoordSys, D extends Dim<number>>(
  a: Vector<CS, D>,
  b: Vector<CS, D>
): Vector<CS, D> {
  return a.map((c, i) => c + b[i]) as Vector<CS, D>;
}

/** Component-wise vector subtraction */
export function subVec<CS extends CoordSys, D extends Dim<number>>(
  a: Vector<CS, D>,
  b: Vector<CS, D>
): Vector<CS, D> {
  return a.map((c, i) => c - b[i]) as Vector<CS, D>;
}

/** Scale a vector by a scalar */
export function scale<CS extends CoordSys, D extends Dim<number>>(
  v: Vector<CS, D>,
  scalar: number
): Vector<CS, D> {
  return v.map((c) => c * scalar) as Vector<CS, D>;
}

/** Negate a vector (reverse direction) */
export function negate<CS extends CoordSys, D extends Dim<number>>(
  v: Vector<CS, D>
): Vector<CS, D> {
  return v.map((c) => -c) as Vector<CS, D>;
}

/** Dot product of two vectors */
export function dot<CS extends CoordSys, D extends Dim<number>>(
  a: Vector<CS, D>,
  b: Vector<CS, D>
): number {
  return a.reduce((sum, c, i) => sum + c * b[i], 0);
}

/** Cross product — only defined for 3D Cartesian vectors */
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] as Vec3;
}

/** Euclidean length of a vector */
export function magnitude<CS extends CoordSys, D extends Dim<number>>(v: Vector<CS, D>): number {
  return Math.sqrt(v.reduce((sum, c) => sum + c * c, 0));
}

/** Unit vector in the same direction. Returns the zero vector if magnitude is 0. */
export function normalize<CS extends CoordSys, D extends Dim<number>>(
  v: Vector<CS, D>
): Vector<CS, D> {
  const mag = magnitude(v);
  if (mag === 0) return v;
  return v.map((c) => c / mag) as Vector<CS, D>;
}

/** Euclidean distance between two points */
export function distance<CS extends CoordSys, D extends Dim<number>>(
  a: Point<CS, D>,
  b: Point<CS, D>
): number {
  return Math.sqrt(a.reduce((sum, c, i) => sum + (c - b[i]) ** 2, 0));
}

/** Midpoint of two points */
export function midpoint<CS extends CoordSys, D extends Dim<number>>(
  a: Point<CS, D>,
  b: Point<CS, D>
): Point<CS, D> {
  return a.map((c, i) => (c + b[i]) / 2) as Point<CS, D>;
}

/** Angle between two vectors in radians */
export function angle<CS extends CoordSys, D extends Dim<number>>(
  a: Vector<CS, D>,
  b: Vector<CS, D>
): number {
  const d = dot(a, b);
  const m = magnitude(a) * magnitude(b);
  if (m === 0) return 0;
  return Math.acos(Math.max(-1, Math.min(1, d / m)));
}

/** Linear interpolation between two points: `a*(1-t) + b*t` */
export function lerp<CS extends CoordSys, D extends Dim<number>>(
  a: Point<CS, D>,
  b: Point<CS, D>,
  t: number
): Point<CS, D> {
  return a.map((c, i) => c * (1 - t) + b[i] * t) as Point<CS, D>;
}

/** First component (x for Cartesian, r for Polar/Spherical/Cylindrical) */
export function x<CS extends CoordSys, D extends Dim<number>>(
  p: Point<CS, D> | Vector<CS, D>
): number {
  return p[0];
}

/** Second component (y for Cartesian, theta for Polar/Spherical/Cylindrical) */
export function y<CS extends CoordSys, D extends Dim<number>>(
  p: Point<CS, D> | Vector<CS, D>
): number {
  return p[1];
}

/** Third component — only available for 3D types */
export function z(p: Point3D | Vec3): number {
  return p[2];
}
