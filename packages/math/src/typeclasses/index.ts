/**
 * @typesugar/math typeclasses
 *
 * Linear algebra typeclasses for vector spaces, inner product spaces, and normed spaces.
 */

import type { Numeric } from "@typesugar/std";

/**
 * Vector space over a field F.
 *
 * A vector space is a set V equipped with:
 * - Vector addition: (V, V) → V
 * - Scalar multiplication: (F, V) → V
 * - A zero vector
 *
 * Laws:
 * - vAdd is associative and commutative
 * - vZero is the identity for vAdd
 * - vScale distributes over vAdd
 * - vScale(1, v) = v
 * - vScale(a, vScale(b, v)) = vScale(a * b, v)
 *
 * @typeclass
 */
export interface VectorSpace<V, F> {
  /** Vector addition */
  readonly vAdd: (a: V, b: V) => V;

  /** Scalar multiplication */
  readonly vScale: (scalar: F, v: V) => V;

  /** Zero vector (additive identity) */
  readonly vZero: () => V;
}

/**
 * Inner product space - a vector space equipped with an inner product.
 *
 * The inner product (dot product) generalizes the notion of "angle" and "length"
 * to abstract vector spaces.
 *
 * Laws:
 * - dot(a, b) = dot(b, a) (symmetry, or conjugate symmetry for complex)
 * - dot(a, vAdd(b, c)) = dot(a, b) + dot(a, c) (linearity)
 * - dot(vScale(k, a), b) = k * dot(a, b) (linearity)
 * - dot(a, a) >= 0, and dot(a, a) = 0 iff a = vZero (positive-definiteness)
 *
 * @typeclass
 */
export interface InnerProduct<V, F> extends VectorSpace<V, F> {
  /** Inner product / dot product */
  readonly dot: (a: V, b: V) => F;
}

/**
 * Normed vector space - a space with a notion of "length".
 *
 * Unlike InnerProduct, Normed doesn't require VectorSpace - it can be
 * applied to any type that has a meaningful notion of magnitude.
 *
 * Laws:
 * - norm(v) >= 0 (non-negativity)
 * - norm(v) = 0 iff v is the zero element (positive-definiteness)
 * - norm(scale(k, v)) = |k| * norm(v) (absolute homogeneity)
 * - norm(add(a, b)) <= norm(a) + norm(b) (triangle inequality)
 *
 * @typeclass
 */
export interface Normed<V, F> {
  /** The norm (length/magnitude) of a vector */
  readonly norm: (v: V) => F;
}

// ============================================================================
// Instances
// ============================================================================

/**
 * VectorSpace instance for numeric arrays.
 *
 * Treats arrays as vectors where operations are applied element-wise.
 * All arrays must have the same length for operations to be valid.
 *
 * @param N - Numeric instance for the field type
 */
export function vectorSpaceArray<F>(N: Numeric<F>): VectorSpace<F[], F> {
  return {
    vAdd: (a, b) => {
      const result: F[] = new Array(a.length);
      for (let i = 0; i < a.length; i++) {
        result[i] = N.add(a[i], b[i]);
      }
      return result;
    },

    vScale: (scalar, v) => {
      const result: F[] = new Array(v.length);
      for (let i = 0; i < v.length; i++) {
        result[i] = N.mul(scalar, v[i]);
      }
      return result;
    },

    vZero: () => [],
  };
}

/**
 * InnerProduct instance for numeric arrays (Euclidean dot product).
 *
 * @param N - Numeric instance for the field type
 */
export function innerProductArray<F>(N: Numeric<F>): InnerProduct<F[], F> {
  const vs = vectorSpaceArray(N);
  return {
    ...vs,
    dot: (a, b) => {
      let sum = N.zero();
      for (let i = 0; i < a.length; i++) {
        sum = N.add(sum, N.mul(a[i], b[i]));
      }
      return sum;
    },
  };
}

/**
 * Normed instance for numeric arrays (Euclidean norm).
 *
 * Note: This requires a sqrt operation, so it only works with number.
 * For generic F, use innerProductArray and compute sqrt externally.
 */
export const normedNumberArray: Normed<number[], number> = {
  norm: (v) => {
    let sum = 0;
    for (let i = 0; i < v.length; i++) {
      sum += v[i] * v[i];
    }
    return Math.sqrt(sum);
  },
};

// ============================================================================
// Derived operations
// ============================================================================

/**
 * Subtract two vectors: a - b = a + scale(-1, b)
 *
 * @param VS - VectorSpace instance
 * @param N - Numeric instance for the scalar field
 */
export function vSub<V, F>(VS: VectorSpace<V, F>, N: Numeric<F>): (a: V, b: V) => V {
  return (a, b) => VS.vAdd(a, VS.vScale(N.negate(N.one()), b));
}

/**
 * Compute the squared norm from an inner product.
 * More efficient than norm when you don't need the square root.
 */
export function normSquared<V, F>(IP: InnerProduct<V, F>): (v: V) => F {
  return (v) => IP.dot(v, v);
}

/**
 * Normalize a vector to unit length.
 * Returns the zero vector if the input is zero.
 */
export function normalize(IP: InnerProduct<number[], number>): (v: number[]) => number[] {
  return (v) => {
    const n = Math.sqrt(IP.dot(v, v));
    if (n === 0) return IP.vZero();
    return IP.vScale(1 / n, v);
  };
}

/**
 * Compute the distance between two vectors.
 *
 * @param IP - InnerProduct instance
 * @param N - Numeric instance for the scalar field
 */
export function distance(
  IP: InnerProduct<number[], number>,
  N: Numeric<number>
): (a: number[], b: number[]) => number {
  return (a, b) => {
    const diff = vSub(IP, N)(a, b);
    return Math.sqrt(IP.dot(diff, diff));
  };
}

/**
 * Check if two vectors are orthogonal (perpendicular).
 *
 * @param IP - InnerProduct instance
 * @param N - Numeric instance for equality check via zero()
 */
export function isOrthogonal<V, F>(IP: InnerProduct<V, F>, N: Numeric<F>): (a: V, b: V) => boolean {
  return (a, b) => {
    const d = IP.dot(a, b);
    const z = N.zero();
    return N.toNumber(d) === N.toNumber(z);
  };
}

/**
 * Project vector a onto vector b.
 */
export function project(
  IP: InnerProduct<number[], number>
): (a: number[], b: number[]) => number[] {
  return (a, b) => {
    const dotAB = IP.dot(a, b);
    const dotBB = IP.dot(b, b);
    if (dotBB === 0) return IP.vZero();
    return IP.vScale(dotAB / dotBB, b);
  };
}
