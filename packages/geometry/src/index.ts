/**
 * @typesugar/geometry — Type-safe geometry with compile-time coordinate
 * system and dimension checking.
 *
 * Points and vectors are branded `number[]` at the type level so you
 * can't mix 2D with 3D or Cartesian with Polar — zero runtime overhead.
 *
 * @packageDocumentation
 */

export type {
  Cartesian,
  Polar,
  Spherical,
  Cylindrical,
  CoordSys,
  Dim,
  Dim2,
  Dim3,
  Point,
  Vector,
  Point2D,
  Point3D,
  Vec2,
  Vec3,
  PolarPoint,
  SphericalPoint,
  CylindricalPoint,
  Transform,
} from "./types.js";

export {
  point2d,
  point3d,
  vec2,
  vec3,
  polar,
  spherical,
  cylindrical,
  point,
  vector,
} from "./constructors.js";

export {
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
} from "./operations.js";

export {
  cartesianToPolar,
  polarToCartesian,
  cartesianToSpherical,
  sphericalToCartesian,
  cartesianToCylindrical,
  cylindricalToCartesian,
  vecCartesianToPolar,
  vecPolarToCartesian,
} from "./conversions.js";

export {
  rotation2d,
  translation2d,
  scale2d,
  shear2d,
  rotationX,
  rotationY,
  rotationZ,
  translation3d,
  scale3d,
  applyToPoint,
  applyToVector,
  compose,
  identity2d,
  identity3d,
  inverse,
} from "./transforms.js";

export {
  numericVector,
  numericVec2,
  numericVec3,
  eqVector,
  eqVec2,
  eqVec3,
} from "./typeclasses.js";
