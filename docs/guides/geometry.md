# Geometry

Type-safe geometry with compile-time coordinate system and dimension checking — can't mix 2D with 3D, can't mix Cartesian with Polar.

## Quick Start

```bash
npm install @typesugar/geometry
```

```typescript
import { point2d, vec2, translate, distance } from "@typesugar/geometry";

const p = point2d(1, 2);
const v = vec2(3, 4);

translate(p, v); // [4, 6] as Point2D
distance(point2d(0, 0), point2d(3, 4)); // 5
```

## Operations

### Point/Vector Arithmetic

Points and vectors are distinct concepts. You can translate a point by a vector, but you can't add two points:

```typescript
import {
  point2d,
  vec2,
  translate,
  displacement,
  addVec,
  subVec,
  scale,
  negate,
} from "@typesugar/geometry";

const p1 = point2d(1, 2);
const p2 = point2d(4, 6);
const v = vec2(3, 4);

translate(p1, v); // Point + Vector -> Point
displacement(p1, p2); // Point - Point -> Vector
addVec(v, vec2(1, 1)); // Vector + Vector -> Vector
subVec(v, vec2(1, 1)); // Vector - Vector -> Vector
scale(v, 2.5); // scalar * Vector -> Vector
negate(v); // -Vector -> Vector
```

### Measurements

```typescript
import { dot, cross, magnitude, distance, angle, normalize } from "@typesugar/geometry";
import { vec3, point3d } from "@typesugar/geometry";

const v1 = vec3(1, 0, 0);
const v2 = vec3(0, 1, 0);

dot(v1, v2); // 0
cross(v1, v2); // vec3(0, 0, 1) — 3D only
magnitude(v1); // 1
angle(v1, v2); // Math.PI / 2

normalize(vec2(3, 4)); // vec2(0.6, 0.8)
```

### Utilities

```typescript
import { midpoint, lerp, x, y, z } from "@typesugar/geometry";

midpoint(point2d(0, 0), point2d(10, 10)); // point2d(5, 5)
lerp(point2d(0, 0), point2d(10, 10), 0.25); // point2d(2.5, 2.5)

const p = point3d(1, 2, 3);
x(p); // 1
y(p); // 2
z(p); // 3
```

## Coordinate Systems

Four coordinate systems, each branded at the type level:

| System      | Components    | Constructor          |
| ----------- | ------------- | -------------------- |
| Cartesian   | x, y [, z]    | `point2d`, `point3d` |
| Polar       | r, theta      | `polar`              |
| Spherical   | r, theta, phi | `spherical`          |
| Cylindrical | r, theta, z   | `cylindrical`        |

```typescript
import { polar, spherical, cylindrical } from "@typesugar/geometry";

const pol = polar(1, Math.PI / 4); // r=1, theta=45 degrees
const sph = spherical(1, Math.PI / 4, 0); // r=1, theta=45deg, phi=0
const cyl = cylindrical(1, Math.PI / 4, 5); // r=1, theta=45deg, z=5
```

## Coordinate Conversions

Convert between systems explicitly:

```typescript
import {
  point2d,
  point3d,
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
sphericalToCartesian(sph); // Point3D
cylindricalToCartesian(cyl); // Point3D
```

You must convert explicitly — there's no implicit coercion between coordinate systems.

## Transform Matrices

2D transforms use 3x3 homogeneous matrices. 3D transforms use 4x4. Both are flat arrays at runtime.

```typescript
import {
  rotation2d,
  translation2d,
  scale2d,
  applyToPoint,
  applyToVector,
  compose,
  inverse,
} from "@typesugar/geometry";

const rotate90 = rotation2d(Math.PI / 2);
const moveRight = translation2d(5, 0);

applyToPoint(rotate90, point2d(1, 0)); // [0, 1]
applyToVector(moveRight, vec2(1, 0)); // [1, 0] — translation doesn't affect vectors

const combined = compose(rotate90, moveRight); // rotate, then translate
const undone = inverse(rotate90); // reverse the rotation
```

3D rotations around each axis:

```typescript
import { rotationX, rotationY, rotationZ, translation3d, scale3d } from "@typesugar/geometry";

const rx = rotationX(Math.PI / 2);
const ry = rotationY(Math.PI / 4);
const rz = rotationZ(Math.PI);
const move = translation3d(1, 2, 3);
const grow = scale3d(2, 2, 2);

const transform = compose(compose(rx, ry), move);
```

## Type Safety

The type system prevents common geometry bugs at compile time:

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

These aren't runtime checks — the TypeScript compiler rejects the code before it runs.

## Zero-Cost Design

At runtime, points and vectors are plain `number[]`. The coordinate system and dimension brands exist only in the type system:

```typescript
const p = point2d(3, 4);
console.log(Array.isArray(p)); // true
console.log(p[0], p[1]); // 3 4
```

No wrapper classes, no prototype chains, no extra allocations. Transforms are flat `number[]` too — a 3x3 matrix is a 9-element array.

## What's Next

- [API Reference](/reference/packages#geometry)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/geometry)
