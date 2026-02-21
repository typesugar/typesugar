/**
 * Element-wise vector operations for @typesugar/fusion
 *
 * Phase 1: immediate execution. Phase 2 (future) will defer and fuse
 * expression trees at compile time via macro expansion.
 */

import type { FusedVec } from "./types.js";

/** Wrap a numeric array for element-wise operations */
export function vec<T extends number>(data: readonly T[]): FusedVec<T> {
  return { data, length: data.length };
}

/** Create a FusedVec from any readonly array */
export function vecOf<T>(data: readonly T[]): FusedVec<T> {
  return { data, length: data.length };
}

// ---------------------------------------------------------------------------
// Element-wise arithmetic
// ---------------------------------------------------------------------------

/** Element-wise addition */
export function add(a: FusedVec<number>, b: FusedVec<number>): FusedVec<number> {
  const len = Math.min(a.length, b.length);
  const result = new Array<number>(len);
  for (let i = 0; i < len; i++) {
    result[i] = a.data[i] + b.data[i];
  }
  return { data: result, length: len };
}

/** Element-wise subtraction */
export function sub(a: FusedVec<number>, b: FusedVec<number>): FusedVec<number> {
  const len = Math.min(a.length, b.length);
  const result = new Array<number>(len);
  for (let i = 0; i < len; i++) {
    result[i] = a.data[i] - b.data[i];
  }
  return { data: result, length: len };
}

/** Element-wise multiplication */
export function mul(a: FusedVec<number>, b: FusedVec<number>): FusedVec<number> {
  const len = Math.min(a.length, b.length);
  const result = new Array<number>(len);
  for (let i = 0; i < len; i++) {
    result[i] = a.data[i] * b.data[i];
  }
  return { data: result, length: len };
}

/** Element-wise division */
export function div(a: FusedVec<number>, b: FusedVec<number>): FusedVec<number> {
  const len = Math.min(a.length, b.length);
  const result = new Array<number>(len);
  for (let i = 0; i < len; i++) {
    result[i] = a.data[i] / b.data[i];
  }
  return { data: result, length: len };
}

/** Multiply every element by a scalar */
export function scale(a: FusedVec<number>, scalar: number): FusedVec<number> {
  const result = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a.data[i] * scalar;
  }
  return { data: result, length: a.length };
}

/** Dot product of two vectors */
export function dot(a: FusedVec<number>, b: FusedVec<number>): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    sum += a.data[i] * b.data[i];
  }
  return sum;
}

/** Euclidean magnitude (L2 norm) */
export function magnitude(a: FusedVec<number>): number {
  let sumSq = 0;
  for (let i = 0; i < a.length; i++) {
    sumSq += a.data[i] * a.data[i];
  }
  return Math.sqrt(sumSq);
}

/** Normalize to unit length */
export function normalize(a: FusedVec<number>): FusedVec<number> {
  const mag = magnitude(a);
  if (mag === 0) return a;
  return scale(a, 1 / mag);
}

// ---------------------------------------------------------------------------
// Higher-order element-wise operations
// ---------------------------------------------------------------------------

/** Apply a unary function to each element */
export function mapVec<T, U>(v: FusedVec<T>, f: (value: T) => U): FusedVec<U> {
  const result = new Array<U>(v.length);
  for (let i = 0; i < v.length; i++) {
    result[i] = f(v.data[i]);
  }
  return { data: result, length: v.length };
}

/** Combine two vectors element-wise using a binary function */
export function zipVec<A, B, C>(
  a: FusedVec<A>,
  b: FusedVec<B>,
  f: (a: A, b: B) => C,
): FusedVec<C> {
  const len = Math.min(a.length, b.length);
  const result = new Array<C>(len);
  for (let i = 0; i < len; i++) {
    result[i] = f(a.data[i], b.data[i]);
  }
  return { data: result, length: len };
}

/** Extract the underlying array from a FusedVec */
export function toArray<T>(v: FusedVec<T>): T[] {
  return Array.from(v.data);
}
