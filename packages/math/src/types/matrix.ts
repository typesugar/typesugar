/**
 * Matrix<R, C> - Type-safe matrices with dimension tracking
 *
 * Matrices are branded Float64Arrays that track their dimensions at the type level.
 * This ensures dimension-mismatched operations are caught at compile time.
 *
 * @example
 * ```typescript
 * const a = matrix(2, 3, [1, 2, 3, 4, 5, 6]);  // 2x3 matrix
 * const b = matrix(3, 2, [1, 2, 3, 4, 5, 6]);  // 3x2 matrix
 * const c = matMul(a, b);  // 2x2 matrix - types match!
 * // matMul(b, a) would be 3x3 - also valid
 * // matMul(a, a) would fail to compile - dimension mismatch
 * ```
 */

import type { Numeric } from "@typesugar/std";
import type { Op } from "@typesugar/core";

// ============================================================================
// Type Definitions
// ============================================================================

/** Type-level brand for row count */
export interface Rows<N extends number> {
  readonly __rows: N;
}

/** Type-level brand for column count */
export interface Cols<N extends number> {
  readonly __cols: N;
}

/**
 * Matrix type - branded Float64Array with dimension tracking.
 * Data is stored in row-major order.
 */
export type Matrix<R extends number, C extends number> = Float64Array & Rows<R> & Cols<C>;

// ============================================================================
// Constructors
// ============================================================================

/**
 * Create a matrix from dimensions and data.
 *
 * @param rows - Number of rows
 * @param cols - Number of columns
 * @param data - Matrix data in row-major order
 * @returns A typed matrix
 * @throws RangeError if data length doesn't match dimensions
 */
export function matrix<R extends number, C extends number>(
  rows: R,
  cols: C,
  data: number[] | Float64Array
): Matrix<R, C> {
  const expectedLength = rows * cols;
  if (data.length !== expectedLength) {
    throw new RangeError(
      `Matrix data length ${data.length} doesn't match dimensions ${rows}x${cols} (expected ${expectedLength})`
    );
  }
  const arr = new Float64Array(data) as Matrix<R, C>;
  // Store dimensions as non-enumerable properties for runtime access
  Object.defineProperty(arr, "__rows", { value: rows, enumerable: false });
  Object.defineProperty(arr, "__cols", { value: cols, enumerable: false });
  return arr;
}

/**
 * Create a zero matrix of given dimensions.
 */
export function zeros<R extends number, C extends number>(rows: R, cols: C): Matrix<R, C> {
  const arr = new Float64Array(rows * cols) as Matrix<R, C>;
  Object.defineProperty(arr, "__rows", { value: rows, enumerable: false });
  Object.defineProperty(arr, "__cols", { value: cols, enumerable: false });
  return arr;
}

/**
 * Create an identity matrix of size n.
 */
export function identity<N extends number>(n: N): Matrix<N, N> {
  const arr = new Float64Array(n * n) as Matrix<N, N>;
  for (let i = 0; i < n; i++) {
    arr[i * n + i] = 1;
  }
  Object.defineProperty(arr, "__rows", { value: n, enumerable: false });
  Object.defineProperty(arr, "__cols", { value: n, enumerable: false });
  return arr;
}

/**
 * Create a matrix from row arrays.
 *
 * @param rows - Array of row arrays
 * @returns A typed matrix
 */
export function fromRows<R extends number, C extends number>(rows: number[][]): Matrix<R, C> {
  if (rows.length === 0) {
    throw new RangeError("Cannot create matrix from empty rows array");
  }
  const r = rows.length as R;
  const c = rows[0].length as C;
  const data: number[] = [];
  for (const row of rows) {
    if (row.length !== c) {
      throw new RangeError("All rows must have the same length");
    }
    data.push(...row);
  }
  return matrix(r, c, data);
}

/**
 * Create a diagonal matrix from a vector.
 */
export function diag<N extends number>(values: number[]): Matrix<N, N> {
  const n = values.length as N;
  const arr = new Float64Array(n * n) as Matrix<N, N>;
  for (let i = 0; i < n; i++) {
    arr[i * n + i] = values[i];
  }
  Object.defineProperty(arr, "__rows", { value: n, enumerable: false });
  Object.defineProperty(arr, "__cols", { value: n, enumerable: false });
  return arr;
}

// ============================================================================
// Runtime Dimension Access
// ============================================================================

/** Get the number of rows */
export function rows<R extends number, C extends number>(m: Matrix<R, C>): R {
  return (m as unknown as { __rows: R }).__rows;
}

/** Get the number of columns */
export function cols<R extends number, C extends number>(m: Matrix<R, C>): C {
  return (m as unknown as { __cols: C }).__cols;
}

// ============================================================================
// Element Access
// ============================================================================

/**
 * Get element at (row, col).
 */
export function get<R extends number, C extends number>(
  m: Matrix<R, C>,
  row: number,
  col: number
): number {
  const c = cols(m);
  return m[row * c + col];
}

/**
 * Set element at (row, col).
 */
export function set<R extends number, C extends number>(
  m: Matrix<R, C>,
  row: number,
  col: number,
  value: number
): void {
  const c = cols(m);
  m[row * c + col] = value;
}

/**
 * Get a row as an array.
 */
export function row<R extends number, C extends number>(m: Matrix<R, C>, i: number): number[] {
  const c = cols(m);
  const result: number[] = [];
  const start = i * c;
  for (let j = 0; j < c; j++) {
    result.push(m[start + j]);
  }
  return result;
}

/**
 * Get a column as an array.
 */
export function col<R extends number, C extends number>(m: Matrix<R, C>, j: number): number[] {
  const r = rows(m);
  const c = cols(m);
  const result: number[] = [];
  for (let i = 0; i < r; i++) {
    result.push(m[i * c + j]);
  }
  return result;
}

// ============================================================================
// Basic Operations
// ============================================================================

/**
 * Transpose a matrix.
 */
export function transpose<R extends number, C extends number>(m: Matrix<R, C>): Matrix<C, R> {
  const r = rows(m);
  const c = cols(m);
  const result = new Float64Array(r * c) as Matrix<C, R>;
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < c; j++) {
      result[j * r + i] = m[i * c + j];
    }
  }
  Object.defineProperty(result, "__rows", { value: c, enumerable: false });
  Object.defineProperty(result, "__cols", { value: r, enumerable: false });
  return result;
}

/**
 * Matrix multiplication.
 * The inner dimensions must match: (R×K) × (K×C) → (R×C)
 */
export function matMul<R extends number, K extends number, C extends number>(
  a: Matrix<R, K>,
  b: Matrix<K, C>
): Matrix<R, C> {
  const r = rows(a);
  const k = cols(a);
  const c = cols(b);

  // Runtime dimension check (type system handles static check)
  if (k !== rows(b)) {
    throw new RangeError(`Matrix multiplication dimension mismatch: ${r}x${k} * ${rows(b)}x${c}`);
  }

  const result = new Float64Array(r * c) as Matrix<R, C>;
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < c; j++) {
      let sum = 0;
      for (let m = 0; m < k; m++) {
        sum += a[i * k + m] * b[m * c + j];
      }
      result[i * c + j] = sum;
    }
  }
  Object.defineProperty(result, "__rows", { value: r, enumerable: false });
  Object.defineProperty(result, "__cols", { value: c, enumerable: false });
  return result;
}

/**
 * Element-wise addition.
 */
export function add<R extends number, C extends number>(
  a: Matrix<R, C>,
  b: Matrix<R, C>
): Matrix<R, C> {
  const r = rows(a);
  const c = cols(a);
  const result = new Float64Array(a.length) as Matrix<R, C>;
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] + b[i];
  }
  Object.defineProperty(result, "__rows", { value: r, enumerable: false });
  Object.defineProperty(result, "__cols", { value: c, enumerable: false });
  return result;
}

/**
 * Element-wise subtraction.
 */
export function sub<R extends number, C extends number>(
  a: Matrix<R, C>,
  b: Matrix<R, C>
): Matrix<R, C> {
  const r = rows(a);
  const c = cols(a);
  const result = new Float64Array(a.length) as Matrix<R, C>;
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] - b[i];
  }
  Object.defineProperty(result, "__rows", { value: r, enumerable: false });
  Object.defineProperty(result, "__cols", { value: c, enumerable: false });
  return result;
}

/**
 * Scalar multiplication.
 */
export function scale<R extends number, C extends number>(
  m: Matrix<R, C>,
  scalar: number
): Matrix<R, C> {
  const r = rows(m);
  const c = cols(m);
  const result = new Float64Array(m.length) as Matrix<R, C>;
  for (let i = 0; i < m.length; i++) {
    result[i] = m[i] * scalar;
  }
  Object.defineProperty(result, "__rows", { value: r, enumerable: false });
  Object.defineProperty(result, "__cols", { value: c, enumerable: false });
  return result;
}

/**
 * Negate all elements.
 */
export function negate<R extends number, C extends number>(m: Matrix<R, C>): Matrix<R, C> {
  return scale(m, -1);
}

// ============================================================================
// Square Matrix Operations
// ============================================================================

/**
 * Trace of a square matrix (sum of diagonal elements).
 */
export function trace<N extends number>(m: Matrix<N, N>): number {
  const n = rows(m);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += m[i * n + i];
  }
  return sum;
}

/**
 * Determinant of a square matrix.
 * Uses direct formulas for 2x2 and 3x3, LU decomposition for larger.
 */
export function det<N extends number>(m: Matrix<N, N>): number {
  const n = rows(m);

  if (n === 1) {
    return m[0];
  }

  if (n === 2) {
    return m[0] * m[3] - m[1] * m[2];
  }

  if (n === 3) {
    return (
      m[0] * (m[4] * m[8] - m[5] * m[7]) -
      m[1] * (m[3] * m[8] - m[5] * m[6]) +
      m[2] * (m[3] * m[7] - m[4] * m[6])
    );
  }

  // LU decomposition for larger matrices
  return detLU(m, n);
}

function detLU(m: Float64Array, n: number): number {
  // Work with a copy
  const lu = new Float64Array(m);
  let det = 1;

  for (let i = 0; i < n; i++) {
    // Find pivot
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(lu[k * n + i]) > Math.abs(lu[maxRow * n + i])) {
        maxRow = k;
      }
    }

    // Swap rows
    if (maxRow !== i) {
      for (let j = 0; j < n; j++) {
        const temp = lu[i * n + j];
        lu[i * n + j] = lu[maxRow * n + j];
        lu[maxRow * n + j] = temp;
      }
      det = -det;
    }

    if (Math.abs(lu[i * n + i]) < 1e-12) {
      return 0;
    }

    det *= lu[i * n + i];

    // Eliminate column
    for (let k = i + 1; k < n; k++) {
      const factor = lu[k * n + i] / lu[i * n + i];
      for (let j = i; j < n; j++) {
        lu[k * n + j] -= factor * lu[i * n + j];
      }
    }
  }

  return det;
}

/**
 * Inverse of a square matrix.
 * Uses direct formulas for 2x2 and 3x3, Gauss-Jordan for larger.
 *
 * @throws RangeError if matrix is singular
 */
export function inverse<N extends number>(m: Matrix<N, N>): Matrix<N, N> {
  const n = rows(m);

  if (n === 1) {
    if (Math.abs(m[0]) < 1e-12) {
      throw new RangeError("Matrix is singular");
    }
    return matrix(1, 1, [1 / m[0]]) as Matrix<N, N>;
  }

  if (n === 2) {
    const d = m[0] * m[3] - m[1] * m[2];
    if (Math.abs(d) < 1e-12) {
      throw new RangeError("Matrix is singular");
    }
    const invD = 1 / d;
    return matrix(2 as N, 2 as N, [m[3] * invD, -m[1] * invD, -m[2] * invD, m[0] * invD]) as Matrix<
      N,
      N
    >;
  }

  if (n === 3) {
    return inverse3x3(m);
  }

  return inverseGaussJordan(m, n);
}

function inverse3x3<N extends number>(m: Matrix<N, N>): Matrix<N, N> {
  const a = m[0],
    b = m[1],
    c = m[2];
  const d = m[3],
    e = m[4],
    f = m[5];
  const g = m[6],
    h = m[7],
    i = m[8];

  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);

  if (Math.abs(det) < 1e-12) {
    throw new RangeError("Matrix is singular");
  }

  const invDet = 1 / det;

  return matrix(3 as N, 3 as N, [
    (e * i - f * h) * invDet,
    (c * h - b * i) * invDet,
    (b * f - c * e) * invDet,
    (f * g - d * i) * invDet,
    (a * i - c * g) * invDet,
    (c * d - a * f) * invDet,
    (d * h - e * g) * invDet,
    (b * g - a * h) * invDet,
    (a * e - b * d) * invDet,
  ]) as Matrix<N, N>;
}

function inverseGaussJordan<N extends number>(m: Matrix<N, N>, n: number): Matrix<N, N> {
  // Augmented matrix [A | I]
  const aug = new Float64Array(n * 2 * n);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      aug[i * 2 * n + j] = m[i * n + j];
    }
    aug[i * 2 * n + n + i] = 1;
  }

  // Gauss-Jordan elimination
  for (let i = 0; i < n; i++) {
    // Find pivot
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(aug[k * 2 * n + i]) > Math.abs(aug[maxRow * 2 * n + i])) {
        maxRow = k;
      }
    }

    // Swap rows
    if (maxRow !== i) {
      for (let j = 0; j < 2 * n; j++) {
        const temp = aug[i * 2 * n + j];
        aug[i * 2 * n + j] = aug[maxRow * 2 * n + j];
        aug[maxRow * 2 * n + j] = temp;
      }
    }

    const pivot = aug[i * 2 * n + i];
    if (Math.abs(pivot) < 1e-12) {
      throw new RangeError("Matrix is singular");
    }

    // Scale row
    for (let j = 0; j < 2 * n; j++) {
      aug[i * 2 * n + j] /= pivot;
    }

    // Eliminate column
    for (let k = 0; k < n; k++) {
      if (k !== i) {
        const factor = aug[k * 2 * n + i];
        for (let j = 0; j < 2 * n; j++) {
          aug[k * 2 * n + j] -= factor * aug[i * 2 * n + j];
        }
      }
    }
  }

  // Extract inverse from augmented matrix
  const result = new Float64Array(n * n) as Matrix<N, N>;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      result[i * n + j] = aug[i * 2 * n + n + j];
    }
  }
  Object.defineProperty(result, "__rows", { value: n, enumerable: false });
  Object.defineProperty(result, "__cols", { value: n, enumerable: false });
  return result;
}

// ============================================================================
// Numeric Instance
// ============================================================================

/**
 * Numeric instance for square matrices.
 * - add/sub: element-wise
 * - mul: matrix multiplication (not element-wise!)
 * - zero: zero matrix
 * - one: identity matrix
 */
export function numericMatrix<N extends number>(n: N): Numeric<Matrix<N, N>> {
  return {
    add: (a, b) => add(a, b) as Matrix<N, N> & Op<"+">,
    sub: (a, b) => sub(a, b) as Matrix<N, N> & Op<"-">,
    mul: (a, b) => matMul(a, b) as Matrix<N, N> & Op<"*">,
    negate: (a) => negate(a),
    abs: (a) => a, // no meaningful abs for matrices
    signum: (a) => {
      const d = det(a);
      return d > 0 ? identity(n) : d < 0 ? scale(identity(n), -1) : zeros(n, n);
    },
    fromNumber: (num) => scale(identity(n), num),
    toNumber: (a) => trace(a),
    zero: () => zeros(n, n),
    one: () => identity(n),
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if two matrices are approximately equal.
 */
export function approxEquals<R extends number, C extends number>(
  a: Matrix<R, C>,
  b: Matrix<R, C>,
  tolerance = 1e-10
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > tolerance) return false;
  }
  return true;
}

/**
 * Convert matrix to 2D array representation.
 */
export function toArray<R extends number, C extends number>(m: Matrix<R, C>): number[][] {
  const r = rows(m);
  const c = cols(m);
  const result: number[][] = [];
  for (let i = 0; i < r; i++) {
    result.push(row(m, i));
  }
  return result;
}

/**
 * Pretty-print a matrix.
 */
export function toString<R extends number, C extends number>(m: Matrix<R, C>): string {
  return toArray(m)
    .map((row) => "[ " + row.map((v) => v.toFixed(4).padStart(10)).join(" ") + " ]")
    .join("\n");
}
