# @typesugar/geometry

Type-safe geometry with compile-time coordinate system and dimension checking. Can't mix 2D with 3D, can't mix Cartesian with Polar — the type system catches it before your code runs.

## Why?

Geometric bugs are subtle. Adding a 2D vector to a 3D point, or mixing up Cartesian and Polar coordinates, compiles fine in plain TypeScript. This package brands points and vectors at the type level so those mistakes become type errors — with zero runtime overhead.

## Quick Start

```typescript
import { point2d, vec2, translate, distance, point3d, vec3 } from "@typesugar/geometry";

const p = point2d(1, 2);
const v = vec2(3, 4);
const moved = translate(p, v); // [4, 6] as Point2D

distance(point2d(0, 0), point2d(3, 4)); // 5

// This is a type error — can't mix 2D and 3D:
// translate(p, vec3(1, 2, 3));
//              ~~~~~~~~~~~~~~~ Type error!
```

## Zero-Cost Brands

At runtime, points and vectors are plain `number[]`. The coordinate system and dimension information exists only in the type system:

```typescript
const p = point2d(3, 4);
console.log(Array.isArray(p)); // true
console.log(p.length); // 2
console.log(p[0], p[1]); // 3 4
```

## Coordinate Systems

Four coordinate systems are supported, each as a type-level brand:

| System      | Components    | Constructor          |
| ----------- | ------------- | -------------------- |
| Cartesian   | x, y [, z]    | `point2d`, `point3d` |
| Polar       | r, theta      | `polar`              |
| Spherical   | r, theta, phi | `spherical`          |
| Cylindrical | r, theta, z   | `cylindrical`        |

## Operations

### Point/Vector Arithmetic

```typescript
import { translate, displacement, addVec, scale, negate } from "@typesugar/geometry";

translate(p, v); // Point + Vector -> Point
displacement(a, b); // Point - Point -> Vector
addVec(v1, v2); // Vector + Vector -> Vector
subVec(v1, v2); // Vector - Vector -> Vector
scale(v, 2.5); // scalar * Vector -> Vector
negate(v); // -Vector -> Vector
```

### Measurements

```typescript
import { dot, cross, magnitude, distance, angle } from "@typesugar/geometry";

dot(v1, v2); // dot product
cross(v1, v2); // cross product (3D only)
magnitude(v); // vector length
distance(p1, p2); // Euclidean distance
angle(v1, v2); // angle in radians
```

### Utilities

```typescript
import { normalize, midpoint, lerp, x, y, z } from "@typesugar/geometry";

normalize(v); // unit vector
midpoint(p1, p2); // midpoint
lerp(p1, p2, 0.5); // linear interpolation
x(p);
y(p);
z(p); // component access
```

## Coordinate Conversions

```typescript
import {
  cartesianToPolar,
  polarToCartesian,
  cartesianToSpherical,
  sphericalToCartesian,
  cartesianToCylindrical,
  cylindricalToCartesian,
} from "@typesugar/geometry";

const p = point2d(1, 1);
const pol = cartesianToPolar(p); // PolarPoint
const back = polarToCartesian(pol); // Point2D

const q = point3d(1, 1, 1);
const sph = cartesianToSpherical(q); // SphericalPoint
const cyl = cartesianToCylindrical(q); // CylindricalPoint
```

## Transform Matrices

2D transforms use 3x3 homogeneous matrices (flat 9-element array). 3D transforms use 4x4 (flat 16 elements).

```typescript
import {
  rotation2d,
  translation2d,
  scale2d,
  rotationX,
  rotationY,
  rotationZ,
  translation3d,
  scale3d,
  applyToPoint,
  applyToVector,
  compose,
  inverse,
} from "@typesugar/geometry";

const r = rotation2d(Math.PI / 2);
const t = translation2d(5, 0);

applyToPoint(r, point2d(1, 0)); // [0, 1]
applyToVector(t, vec2(1, 0)); // [1, 0] — translation doesn't affect vectors

const combined = compose(r, t); // rotate, then translate
const undone = inverse(r); // reverse the rotation
```

## Type Safety Examples

```typescript
const cart = point2d(1, 2);
const pol = polar(1, 0);

// Type error: can't compute distance between different coordinate systems
distance(cart, pol);

// Type error: can't translate a 2D point with a 3D vector
translate(point2d(1, 2), vec3(1, 2, 3));

// Type error: cross product is only defined for 3D vectors
cross(vec2(1, 0), vec2(0, 1));
```
