import type {
  Cartesian,
  Cylindrical,
  CylindricalPoint,
  CoordSys,
  Dim,
  Dim2,
  Dim3,
  Point,
  Point2D,
  Point3D,
  Polar,
  PolarPoint,
  Spherical,
  SphericalPoint,
  Vec2,
  Vec3,
  Vector,
} from "./types.js";

/** Create a Cartesian 2D point */
export function point2d(x: number, y: number): Point2D {
  return [x, y] as Point2D;
}

/** Create a Cartesian 3D point */
export function point3d(x: number, y: number, z: number): Point3D {
  return [x, y, z] as Point3D;
}

/** Create a Cartesian 2D vector */
export function vec2(x: number, y: number): Vec2 {
  return [x, y] as Vec2;
}

/** Create a Cartesian 3D vector */
export function vec3(x: number, y: number, z: number): Vec3 {
  return [x, y, z] as Vec3;
}

/** Create a polar point from radius and angle (radians) */
export function polar(r: number, theta: number): PolarPoint {
  return [r, theta] as PolarPoint;
}

/** Create a spherical point from radius, inclination, and azimuth (radians) */
export function spherical(r: number, theta: number, phi: number): SphericalPoint {
  return [r, theta, phi] as SphericalPoint;
}

/** Create a cylindrical point from radius, angle (radians), and height */
export function cylindrical(r: number, theta: number, z: number): CylindricalPoint {
  return [r, theta, z] as CylindricalPoint;
}

/** Generic point constructor — caller supplies coordinate system and dimension via type parameters */
export function point<CS extends CoordSys, D extends Dim<number>>(
  ...components: number[]
): Point<CS, D> {
  return [...components] as Point<CS, D>;
}

/** Generic vector constructor — caller supplies coordinate system and dimension via type parameters */
export function vector<CS extends CoordSys, D extends Dim<number>>(
  ...components: number[]
): Vector<CS, D> {
  return [...components] as Vector<CS, D>;
}
