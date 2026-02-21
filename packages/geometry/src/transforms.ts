import type { Cartesian, CoordSys, Dim, Dim2, Dim3, Point, Transform, Vector } from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers — flat row-major homogeneous matrices
// ---------------------------------------------------------------------------

/**
 * Multiply two 3x3 matrices stored as flat 9-element arrays (row-major).
 * Result = a * b
 */
function mul3(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],

    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],

    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

/**
 * Multiply two 4x4 matrices stored as flat 16-element arrays (row-major).
 * Result = a * b
 */
function mul4(a: number[], b: number[]): number[] {
  const out: number[] = new Array(16);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[row * 4 + k] * b[k * 4 + col];
      }
      out[row * 4 + col] = sum;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2D transforms (3x3 homogeneous, flat 9-element array)
// ---------------------------------------------------------------------------

/** 2D rotation around the origin by `angle` radians (counter-clockwise) */
export function rotation2d(angle: number): Transform<Cartesian, Cartesian, Dim2> {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // prettier-ignore
  return [
    c, -s,  0,
    s,  c,  0,
    0,  0,  1,
  ] as Transform<Cartesian, Cartesian, Dim2>;
}

/** 2D translation by (dx, dy) */
export function translation2d(dx: number, dy: number): Transform<Cartesian, Cartesian, Dim2> {
  // prettier-ignore
  return [
    1, 0, dx,
    0, 1, dy,
    0, 0,  1,
  ] as Transform<Cartesian, Cartesian, Dim2>;
}

/** 2D scale by (sx, sy) */
export function scale2d(sx: number, sy: number): Transform<Cartesian, Cartesian, Dim2> {
  // prettier-ignore
  return [
    sx,  0, 0,
     0, sy, 0,
     0,  0, 1,
  ] as Transform<Cartesian, Cartesian, Dim2>;
}

/** 2D shear by (sx, sy) */
export function shear2d(sx: number, sy: number): Transform<Cartesian, Cartesian, Dim2> {
  // prettier-ignore
  return [
    1, sx, 0,
    sy, 1, 0,
     0, 0, 1,
  ] as Transform<Cartesian, Cartesian, Dim2>;
}

// ---------------------------------------------------------------------------
// 3D transforms (4x4 homogeneous, flat 16-element array)
// ---------------------------------------------------------------------------

/** 3D rotation around the X axis */
export function rotationX(angle: number): Transform<Cartesian, Cartesian, Dim3> {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // prettier-ignore
  return [
    1, 0,  0, 0,
    0, c, -s, 0,
    0, s,  c, 0,
    0, 0,  0, 1,
  ] as Transform<Cartesian, Cartesian, Dim3>;
}

/** 3D rotation around the Y axis */
export function rotationY(angle: number): Transform<Cartesian, Cartesian, Dim3> {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // prettier-ignore
  return [
     c, 0, s, 0,
     0, 1, 0, 0,
    -s, 0, c, 0,
     0, 0, 0, 1,
  ] as Transform<Cartesian, Cartesian, Dim3>;
}

/** 3D rotation around the Z axis */
export function rotationZ(angle: number): Transform<Cartesian, Cartesian, Dim3> {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // prettier-ignore
  return [
    c, -s, 0, 0,
    s,  c, 0, 0,
    0,  0, 1, 0,
    0,  0, 0, 1,
  ] as Transform<Cartesian, Cartesian, Dim3>;
}

/** 3D translation by (dx, dy, dz) */
export function translation3d(
  dx: number,
  dy: number,
  dz: number
): Transform<Cartesian, Cartesian, Dim3> {
  // prettier-ignore
  return [
    1, 0, 0, dx,
    0, 1, 0, dy,
    0, 0, 1, dz,
    0, 0, 0,  1,
  ] as Transform<Cartesian, Cartesian, Dim3>;
}

/** 3D scale by (sx, sy, sz) */
export function scale3d(sx: number, sy: number, sz: number): Transform<Cartesian, Cartesian, Dim3> {
  // prettier-ignore
  return [
    sx,  0,  0, 0,
     0, sy,  0, 0,
     0,  0, sz, 0,
     0,  0,  0, 1,
  ] as Transform<Cartesian, Cartesian, Dim3>;
}

// ---------------------------------------------------------------------------
// Transform application
// ---------------------------------------------------------------------------

/** Apply a 2D or 3D transform to a point (includes translation) */
export function applyToPoint<CS extends CoordSys, D extends Dim<number>>(
  transform: Transform<CS, CS, D>,
  p: Point<CS, D>
): Point<CS, D> {
  if (p.length === 2) {
    const t = transform as number[];
    return [t[0] * p[0] + t[1] * p[1] + t[2], t[3] * p[0] + t[4] * p[1] + t[5]] as Point<CS, D>;
  }
  const t = transform as number[];
  return [
    t[0] * p[0] + t[1] * p[1] + t[2] * p[2] + t[3],
    t[4] * p[0] + t[5] * p[1] + t[6] * p[2] + t[7],
    t[8] * p[0] + t[9] * p[1] + t[10] * p[2] + t[11],
  ] as Point<CS, D>;
}

/** Apply a 2D or 3D transform to a vector (translation is ignored) */
export function applyToVector<CS extends CoordSys, D extends Dim<number>>(
  transform: Transform<CS, CS, D>,
  v: Vector<CS, D>
): Vector<CS, D> {
  if (v.length === 2) {
    const t = transform as number[];
    return [t[0] * v[0] + t[1] * v[1], t[3] * v[0] + t[4] * v[1]] as Vector<CS, D>;
  }
  const t = transform as number[];
  return [
    t[0] * v[0] + t[1] * v[1] + t[2] * v[2],
    t[4] * v[0] + t[5] * v[1] + t[6] * v[2],
    t[8] * v[0] + t[9] * v[1] + t[10] * v[2],
  ] as Vector<CS, D>;
}

// ---------------------------------------------------------------------------
// Transform composition and utilities
// ---------------------------------------------------------------------------

/** Compose two transforms: apply `first`, then `second` */
export function compose<CS extends CoordSys, D extends Dim<number>>(
  first: Transform<CS, CS, D>,
  second: Transform<CS, CS, D>
): Transform<CS, CS, D> {
  if (first.length === 9) {
    return mul3(second as number[], first as number[]) as Transform<CS, CS, D>;
  }
  return mul4(second as number[], first as number[]) as Transform<CS, CS, D>;
}

/** 2D identity transform */
export function identity2d(): Transform<Cartesian, Cartesian, Dim2> {
  // prettier-ignore
  return [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ] as Transform<Cartesian, Cartesian, Dim2>;
}

/** 3D identity transform */
export function identity3d(): Transform<Cartesian, Cartesian, Dim3> {
  // prettier-ignore
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ] as Transform<Cartesian, Cartesian, Dim3>;
}

/**
 * Compute the inverse of a transform.
 *
 * Uses Cramer's rule for 3x3 and a cofactor expansion for 4x4.
 * Throws if the matrix is singular.
 */
export function inverse<CS extends CoordSys, D extends Dim<number>>(
  transform: Transform<CS, CS, D>
): Transform<CS, CS, D> {
  if (transform.length === 9) {
    return inverse3(transform as number[]) as Transform<CS, CS, D>;
  }
  return inverse4(transform as number[]) as Transform<CS, CS, D>;
}

function inverse3(m: number[]): number[] {
  const det =
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6]);

  if (Math.abs(det) < 1e-12) {
    throw new Error("Singular matrix — cannot invert");
  }

  const invDet = 1 / det;
  return [
    (m[4] * m[8] - m[5] * m[7]) * invDet,
    (m[2] * m[7] - m[1] * m[8]) * invDet,
    (m[1] * m[5] - m[2] * m[4]) * invDet,

    (m[5] * m[6] - m[3] * m[8]) * invDet,
    (m[0] * m[8] - m[2] * m[6]) * invDet,
    (m[2] * m[3] - m[0] * m[5]) * invDet,

    (m[3] * m[7] - m[4] * m[6]) * invDet,
    (m[1] * m[6] - m[0] * m[7]) * invDet,
    (m[0] * m[4] - m[1] * m[3]) * invDet,
  ];
}

function inverse4(m: number[]): number[] {
  const s0 = m[0] * m[5] - m[4] * m[1];
  const s1 = m[0] * m[6] - m[4] * m[2];
  const s2 = m[0] * m[7] - m[4] * m[3];
  const s3 = m[1] * m[6] - m[5] * m[2];
  const s4 = m[1] * m[7] - m[5] * m[3];
  const s5 = m[2] * m[7] - m[6] * m[3];

  const c5 = m[10] * m[15] - m[14] * m[11];
  const c4 = m[9] * m[15] - m[13] * m[11];
  const c3 = m[9] * m[14] - m[13] * m[10];
  const c2 = m[8] * m[15] - m[12] * m[11];
  const c1 = m[8] * m[14] - m[12] * m[10];
  const c0 = m[8] * m[13] - m[12] * m[9];

  const det = s0 * c5 - s1 * c4 + s2 * c3 + s3 * c2 - s4 * c1 + s5 * c0;

  if (Math.abs(det) < 1e-12) {
    throw new Error("Singular matrix — cannot invert");
  }

  const invDet = 1 / det;
  return [
    (m[5] * c5 - m[6] * c4 + m[7] * c3) * invDet,
    (-m[1] * c5 + m[2] * c4 - m[3] * c3) * invDet,
    (m[13] * s5 - m[14] * s4 + m[15] * s3) * invDet,
    (-m[9] * s5 + m[10] * s4 - m[11] * s3) * invDet,

    (-m[4] * c5 + m[6] * c2 - m[7] * c1) * invDet,
    (m[0] * c5 - m[2] * c2 + m[3] * c1) * invDet,
    (-m[12] * s5 + m[14] * s2 - m[15] * s1) * invDet,
    (m[8] * s5 - m[10] * s2 + m[11] * s1) * invDet,

    (m[4] * c4 - m[5] * c2 + m[7] * c0) * invDet,
    (-m[0] * c4 + m[1] * c2 - m[3] * c0) * invDet,
    (m[12] * s4 - m[13] * s2 + m[15] * s0) * invDet,
    (-m[8] * s4 + m[9] * s2 - m[11] * s0) * invDet,

    (-m[4] * c3 + m[5] * c1 - m[6] * c0) * invDet,
    (m[0] * c3 - m[1] * c1 + m[2] * c0) * invDet,
    (-m[12] * s3 + m[13] * s1 - m[14] * s0) * invDet,
    (m[8] * s3 - m[9] * s1 + m[10] * s0) * invDet,
  ];
}
