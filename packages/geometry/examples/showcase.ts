/**
 * @typesugar/geometry Showcase
 *
 * Self-documenting examples of type-safe geometry with compile-time coordinate
 * system and dimension checking. Points and vectors are branded number[] —
 * brands exist only in the type system, zero runtime overhead.
 *
 * Type assertions used:
 *   typeAssert<Equal<A, B>>()        - A and B are the same type
 *   typeAssert<Extends<A, B>>()      - A is assignable to B
 *   typeAssert<Not<Equal<A, B>>>()   - A and B are DIFFERENT
 *   typeAssert<Not<Extends<A, B>>>() - A is NOT assignable to B
 *
 * Run:   typesugar run examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import { assert, typeAssert, type Equal, type Extends, type Not } from "@typesugar/testing";
import {
  // Types
  type Cartesian,
  type Polar,
  type Spherical,
  type Cylindrical,
  type Dim2,
  type Dim3,
  type Point,
  type Vector,
  type Point2D,
  type Point3D,
  type Vec2,
  type Vec3,
  type PolarPoint,
  type SphericalPoint,
  type CylindricalPoint,
  type Transform,

  // Constructors
  point2d,
  point3d,
  vec2,
  vec3,
  polar,
  spherical,
  cylindrical,

  // Operations
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

  // Conversions
  cartesianToPolar,
  polarToCartesian,
  cartesianToSpherical,
  sphericalToCartesian,
  cartesianToCylindrical,
  cylindricalToCartesian,
  vecCartesianToPolar,
  vecPolarToCartesian,

  // Transforms
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
} from "../src/index.js";

const EPSILON = 1e-10;

function approxEqual(a: number, b: number, eps = EPSILON): boolean {
  return Math.abs(a - b) < eps;
}

// ============================================================================
// 1. POINT & VECTOR CONSTRUCTION - Type-safe branded constructors
// ============================================================================

const p = point2d(3, 4);
typeAssert<Equal<typeof p, Point2D>>();
typeAssert<Equal<Point2D, Point<Cartesian, Dim2>>>();
assert(x(p) === 3);
assert(y(p) === 4);

const q = point3d(1, 2, 3);
typeAssert<Equal<typeof q, Point3D>>();
assert(x(q) === 1);
assert(y(q) === 2);
assert(z(q) === 3);

const v = vec2(5, 0);
typeAssert<Equal<typeof v, Vec2>>();
typeAssert<Equal<Vec2, Vector<Cartesian, Dim2>>>();

const w = vec3(1, 0, 0);
typeAssert<Equal<typeof w, Vec3>>();

// Points and vectors are distinct types — can't mix them
typeAssert<Not<Equal<Point2D, Vec2>>>();
typeAssert<Not<Equal<Point3D, Vec3>>>();

// 2D and 3D are distinct — can't mix dimensions
typeAssert<Not<Equal<Point2D, Point3D>>>();
typeAssert<Not<Equal<Vec2, Vec3>>>();

// ============================================================================
// 2. COORDINATE SYSTEM CONSTRUCTORS - Polar, spherical, cylindrical
// ============================================================================

const pp = polar(5, Math.PI / 4);
typeAssert<Equal<typeof pp, PolarPoint>>();
assert(x(pp) === 5);           // r
assert(y(pp) === Math.PI / 4); // theta

const sp = spherical(10, Math.PI / 3, Math.PI / 6);
typeAssert<Equal<typeof sp, SphericalPoint>>();

const cp = cylindrical(5, Math.PI / 4, 10);
typeAssert<Equal<typeof cp, CylindricalPoint>>();

// Coordinate systems are distinct — can't mix Cartesian and Polar
typeAssert<Not<Equal<Point2D, PolarPoint>>>();
typeAssert<Not<Equal<Point3D, SphericalPoint>>>();
typeAssert<Not<Equal<Point3D, CylindricalPoint>>>();

// ============================================================================
// 3. POINT-VECTOR OPERATIONS - Translate, displacement
// ============================================================================

// Translate a point by a vector
const origin = point2d(0, 0);
const offset = vec2(3, 4);
const moved = translate(origin, offset);
typeAssert<Equal<typeof moved, Point2D>>();
assert(x(moved) === 3);
assert(y(moved) === 4);

// Displacement: vector from one point to another
const a2d = point2d(1, 2);
const b2d = point2d(4, 6);
const disp = displacement(a2d, b2d);
typeAssert<Equal<typeof disp, Vec2>>();
assert(x(disp) === 3);
assert(y(disp) === 4);

// ============================================================================
// 4. VECTOR ARITHMETIC - Add, subtract, scale, negate
// ============================================================================

const v1 = vec2(1, 2);
const v2 = vec2(3, 4);

const sum = addVec(v1, v2);
assert(x(sum) === 4);
assert(y(sum) === 6);

const diff = subVec(v2, v1);
assert(x(diff) === 2);
assert(y(diff) === 2);

const scaled = scale(v1, 3);
assert(x(scaled) === 3);
assert(y(scaled) === 6);

const neg = negate(v1);
assert(x(neg) === -1);
assert(y(neg) === -2);

// ============================================================================
// 5. DOT PRODUCT, CROSS PRODUCT, MAGNITUDE - Core vector math
// ============================================================================

// Dot product
const dotResult = dot(vec2(1, 0), vec2(0, 1));
assert(dotResult === 0); // perpendicular vectors

const dotParallel = dot(vec2(3, 0), vec2(5, 0));
assert(dotParallel === 15);

// Cross product (3D only)
const cx = cross(vec3(1, 0, 0), vec3(0, 1, 0));
typeAssert<Equal<typeof cx, Vec3>>();
assert(x(cx) === 0);
assert(y(cx) === 0);
assert(z(cx) === 1); // i × j = k

// Magnitude
assert(magnitude(vec2(3, 4)) === 5);
assert(approxEqual(magnitude(vec3(1, 1, 1)), Math.sqrt(3)));

// Normalize
const unit = normalize(vec2(0, 5));
assert(approxEqual(magnitude(unit), 1));
assert(approxEqual(x(unit), 0));
assert(approxEqual(y(unit), 1));

// Zero vector stays zero
const zeroNorm = normalize(vec2(0, 0));
assert(x(zeroNorm) === 0);
assert(y(zeroNorm) === 0);

// ============================================================================
// 6. DISTANCE, MIDPOINT, ANGLE - Geometric queries
// ============================================================================

const dist = distance(point2d(0, 0), point2d(3, 4));
assert(dist === 5);

const mid = midpoint(point2d(0, 0), point2d(10, 10));
typeAssert<Equal<typeof mid, Point2D>>();
assert(x(mid) === 5);
assert(y(mid) === 5);

// Angle between perpendicular vectors is pi/2
const ang = angle(vec2(1, 0), vec2(0, 1));
assert(approxEqual(ang, Math.PI / 2));

// Angle between parallel vectors is 0
assert(approxEqual(angle(vec2(1, 0), vec2(5, 0)), 0));

// ============================================================================
// 7. LINEAR INTERPOLATION - Smooth transitions between points
// ============================================================================

const start = point2d(0, 0);
const end = point2d(10, 20);

const atStart = lerp(start, end, 0);
assert(x(atStart) === 0);
assert(y(atStart) === 0);

const atMid = lerp(start, end, 0.5);
assert(x(atMid) === 5);
assert(y(atMid) === 10);

const atEnd = lerp(start, end, 1);
assert(x(atEnd) === 10);
assert(y(atEnd) === 20);

// ============================================================================
// 8. COORDINATE CONVERSIONS - Cartesian <-> Polar
// ============================================================================

// Cartesian (1, 0) → Polar (1, 0)
const polarPt = cartesianToPolar(point2d(1, 0));
typeAssert<Equal<typeof polarPt, PolarPoint>>();
assert(approxEqual(x(polarPt), 1));  // r = 1
assert(approxEqual(y(polarPt), 0));  // theta = 0

// Round-trip: Cartesian → Polar → Cartesian
const original = point2d(3, 4);
const roundTripped = polarToCartesian(cartesianToPolar(original));
typeAssert<Equal<typeof roundTripped, Point2D>>();
assert(approxEqual(x(roundTripped), 3));
assert(approxEqual(y(roundTripped), 4));

// Vector conversions
const vecPolar = vecCartesianToPolar(vec2(0, 5));
assert(approxEqual(x(vecPolar), 5)); // magnitude
assert(approxEqual(y(vecPolar), Math.PI / 2)); // angle

const vecCart = vecPolarToCartesian(vecPolar);
assert(approxEqual(x(vecCart), 0));
assert(approxEqual(y(vecCart), 5));

// ============================================================================
// 9. COORDINATE CONVERSIONS - Cartesian <-> Spherical/Cylindrical
// ============================================================================

// Spherical round-trip
const pt3d = point3d(1, 1, 1);
const sph = cartesianToSpherical(pt3d);
typeAssert<Equal<typeof sph, SphericalPoint>>();
const backToCart = sphericalToCartesian(sph);
assert(approxEqual(x(backToCart), 1));
assert(approxEqual(y(backToCart), 1));
assert(approxEqual(z(backToCart), 1));

// Cylindrical round-trip
const cyl = cartesianToCylindrical(pt3d);
typeAssert<Equal<typeof cyl, CylindricalPoint>>();
const backFromCyl = cylindricalToCartesian(cyl);
assert(approxEqual(x(backFromCyl), 1));
assert(approxEqual(y(backFromCyl), 1));
assert(approxEqual(z(backFromCyl), 1));

// ============================================================================
// 10. 2D TRANSFORMS - Rotation, translation, scale, shear
// ============================================================================

// Rotation by 90 degrees counter-clockwise
const rot90 = rotation2d(Math.PI / 2);
typeAssert<Equal<typeof rot90, Transform<Cartesian, Cartesian, Dim2>>>();

const rotated = applyToPoint(rot90, point2d(1, 0));
assert(approxEqual(x(rotated), 0));
assert(approxEqual(y(rotated), 1));

// Translation
const trans = translation2d(10, 20);
const translated = applyToPoint(trans, point2d(1, 1));
assert(approxEqual(x(translated), 11));
assert(approxEqual(y(translated), 21));

// Vectors ignore translation
const transVec = applyToVector(trans, vec2(1, 1));
assert(approxEqual(x(transVec), 1));
assert(approxEqual(y(transVec), 1));

// Scale
const sc = scale2d(2, 3);
const scaledPt = applyToPoint(sc, point2d(4, 5));
assert(approxEqual(x(scaledPt), 8));
assert(approxEqual(y(scaledPt), 15));

// Shear
const sh = shear2d(1, 0);
const sheared = applyToPoint(sh, point2d(0, 1));
assert(approxEqual(x(sheared), 1)); // x += 1 * y
assert(approxEqual(y(sheared), 1));

// ============================================================================
// 11. 3D TRANSFORMS - Axis rotations, translation, scale
// ============================================================================

// Rotate (1, 0, 0) around Z by 90 degrees → (0, 1, 0)
const rotZ = rotationZ(Math.PI / 2);
typeAssert<Equal<typeof rotZ, Transform<Cartesian, Cartesian, Dim3>>>();
const rz = applyToPoint(rotZ, point3d(1, 0, 0));
assert(approxEqual(x(rz), 0));
assert(approxEqual(y(rz), 1));
assert(approxEqual(z(rz), 0));

// Rotate (0, 1, 0) around X by 90 degrees → (0, 0, 1)
const rotX = rotationX(Math.PI / 2);
const rx = applyToPoint(rotX, point3d(0, 1, 0));
assert(approxEqual(x(rx), 0));
assert(approxEqual(y(rx), 0));
assert(approxEqual(z(rx), 1));

// 3D translation
const trans3 = translation3d(1, 2, 3);
const t3 = applyToPoint(trans3, point3d(0, 0, 0));
assert(approxEqual(x(t3), 1));
assert(approxEqual(y(t3), 2));
assert(approxEqual(z(t3), 3));

// 3D scale
const sc3 = scale3d(2, 2, 2);
const s3 = applyToPoint(sc3, point3d(1, 2, 3));
assert(approxEqual(x(s3), 2));
assert(approxEqual(y(s3), 4));
assert(approxEqual(z(s3), 6));

// ============================================================================
// 12. TRANSFORM COMPOSITION - Chain multiple transforms
// ============================================================================

// Translate then rotate: first move (1,0) to (2,0), then rotate 90° → (0,2)
const moveRight = translation2d(1, 0);
const spin90 = rotation2d(Math.PI / 2);
const combined = compose(moveRight, spin90);

const result = applyToPoint(combined, point2d(1, 0));
assert(approxEqual(x(result), 0));
assert(approxEqual(y(result), 2));

// ============================================================================
// 13. IDENTITY AND INVERSE - Transform algebra
// ============================================================================

// Identity transform doesn't change anything
const id2 = identity2d();
const unchanged = applyToPoint(id2, point2d(42, 99));
assert(x(unchanged) === 42);
assert(y(unchanged) === 99);

const id3 = identity3d();
const unchanged3 = applyToPoint(id3, point3d(1, 2, 3));
assert(x(unchanged3) === 1);

// Inverse undoes a transform: T * T^-1 = identity
const tx = translation2d(5, 10);
const txInv = inverse(tx);
const roundTrip = compose(tx, txInv);
const back = applyToPoint(roundTrip, point2d(7, 3));
assert(approxEqual(x(back), 7));
assert(approxEqual(y(back), 3));

// 3D inverse
const rot3 = rotationY(Math.PI / 4);
const rot3Inv = inverse(rot3);
const rt3 = compose(rot3, rot3Inv);
const back3 = applyToPoint(rt3, point3d(5, 5, 5));
assert(approxEqual(x(back3), 5));
assert(approxEqual(y(back3), 5));
assert(approxEqual(z(back3), 5));

// ============================================================================
// 14. REAL-WORLD EXAMPLE - Game camera transform pipeline
// ============================================================================

// A game camera: translate to camera position, then rotate to face direction
const cameraPos = translation3d(-10, 5, -10);
const cameraRot = rotationY(Math.PI / 4);
const cameraTransform = compose(cameraPos, cameraRot);

// World-space point → camera-space
const worldPoint = point3d(0, 0, 0);
const cameraSpace = applyToPoint(cameraTransform, worldPoint);
typeAssert<Equal<typeof cameraSpace, Point3D>>();

// Undo with inverse to get back to world space
const invCamera = inverse(cameraTransform);
const backToWorld = applyToPoint(invCamera, cameraSpace);
assert(approxEqual(x(backToWorld), 0));
assert(approxEqual(y(backToWorld), 0));
assert(approxEqual(z(backToWorld), 0));

console.log("@typesugar/geometry showcase: all assertions passed!");
