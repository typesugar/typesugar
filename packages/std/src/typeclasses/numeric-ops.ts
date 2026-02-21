/**
 * Generic Numeric Operations
 *
 * Derived operations that work for ANY type with a Numeric, Integral, or Fractional instance.
 * All functions use dictionary-passing style for zero-cost specialization via `specialize()`.
 *
 * Note: Functions that might conflict with concrete versions in extensions/number.ts
 * are named with `With` suffix (e.g., `gcdWith`, `lerpWith`) to indicate they take
 * a typeclass instance parameter.
 *
 * @example
 * ```typescript
 * import { sum, product, pow, gcdWith } from "@typesugar/std";
 * import { numericNumber, integralNumber } from "@typesugar/std";
 *
 * // Works for any Numeric<A>
 * sum([1, 2, 3, 4, 5], numericNumber); // 15
 * product([1, 2, 3, 4], numericNumber); // 24
 * pow(2, 10, numericNumber); // 1024
 *
 * // Works for any Integral<A>
 * gcdWith(48, 18, numericNumber, integralNumber); // 6
 * ```
 */

import type { Numeric, Integral, Fractional } from "./index.js";

// ============================================================================
// Aggregation Operations
// ============================================================================

/**
 * Sum all elements in an iterable.
 *
 * @param xs - Iterable of values to sum
 * @param N - Numeric instance for type A
 * @returns The sum of all elements, or zero() if empty
 */
export function sum<A>(xs: Iterable<A>, N: Numeric<A>): A {
  let acc = N.zero();
  for (const x of xs) {
    acc = N.add(acc, x);
  }
  return acc;
}

/**
 * Multiply all elements in an iterable.
 *
 * @param xs - Iterable of values to multiply
 * @param N - Numeric instance for type A
 * @returns The product of all elements, or one() if empty
 */
export function product<A>(xs: Iterable<A>, N: Numeric<A>): A {
  let acc = N.one();
  for (const x of xs) {
    acc = N.mul(acc, x);
  }
  return acc;
}

// ============================================================================
// Exponentiation
// ============================================================================

/**
 * Raise base to a non-negative integer power using repeated squaring.
 * O(log n) multiplications.
 *
 * @param base - The base value
 * @param exp - Non-negative integer exponent
 * @param N - Numeric instance for type A
 * @returns base^exp
 * @throws RangeError if exp is negative
 */
export function pow<A>(base: A, exp: number, N: Numeric<A>): A {
  if (exp < 0) {
    throw new RangeError("pow: exponent must be non-negative for Numeric types");
  }
  if (exp === 0) return N.one();
  if (exp === 1) return base;

  let result = N.one();
  let b = base;
  let e = exp;

  while (e > 0) {
    if (e & 1) {
      result = N.mul(result, b);
    }
    b = N.mul(b, b);
    e >>>= 1;
  }

  return result;
}

/**
 * Raise base to an integer power (can be negative for Fractional types).
 *
 * @param base - The base value
 * @param exp - Integer exponent (can be negative)
 * @param N - Numeric instance for type A
 * @param F - Fractional instance for type A (needed for negative exponents)
 * @returns base^exp
 */
export function powFrac<A>(base: A, exp: number, N: Numeric<A>, F: Fractional<A>): A {
  if (exp >= 0) {
    return pow(base, exp, N);
  }
  return F.recip(pow(base, -exp, N));
}

// ============================================================================
// Number Theory (requires Integral)
// ============================================================================

/**
 * Greatest common divisor using Euclidean algorithm.
 * Generic version that works for any Integral type.
 *
 * @param a - First value
 * @param b - Second value
 * @param N - Numeric instance for type A
 * @param I - Integral instance for type A
 * @returns The GCD of a and b
 */
export function gcdWith<A>(a: A, b: A, N: Numeric<A>, I: Integral<A>): A {
  a = N.abs(a);
  b = N.abs(b);
  while (N.toNumber(b) !== 0) {
    const t = b;
    b = I.mod(a, b);
    a = t;
  }
  return a;
}

/**
 * Least common multiple.
 * Generic version that works for any Integral type.
 *
 * @param a - First value
 * @param b - Second value
 * @param N - Numeric instance for type A
 * @param I - Integral instance for type A
 * @returns The LCM of a and b
 */
export function lcmWith<A>(a: A, b: A, N: Numeric<A>, I: Integral<A>): A {
  const aNum = N.toNumber(a);
  const bNum = N.toNumber(b);
  if (aNum === 0 || bNum === 0) return N.zero();
  const g = gcdWith(a, b, N, I);
  return N.abs(I.div(N.mul(a, b), g));
}

// ============================================================================
// Comparison-Based Operations
// ============================================================================

/** Simple ordering interface for comparison operations */
export interface Ord<A> {
  compare(a: A, b: A): number;
}

/**
 * Clamp a value to a range [lo, hi].
 * Generic version that works for any Ord type.
 *
 * @param x - Value to clamp
 * @param lo - Lower bound
 * @param hi - Upper bound
 * @param O - Ord instance for type A
 * @returns x clamped to [lo, hi]
 */
export function clampWith<A>(x: A, lo: A, hi: A, O: Ord<A>): A {
  if (O.compare(x, lo) < 0) return lo;
  if (O.compare(x, hi) > 0) return hi;
  return x;
}

/**
 * Return the minimum of two values.
 *
 * @param a - First value
 * @param b - Second value
 * @param O - Ord instance for type A
 * @returns The smaller of a and b
 */
export function min<A>(a: A, b: A, O: Ord<A>): A {
  return O.compare(a, b) <= 0 ? a : b;
}

/**
 * Return the maximum of two values.
 *
 * @param a - First value
 * @param b - Second value
 * @param O - Ord instance for type A
 * @returns The larger of a and b
 */
export function max<A>(a: A, b: A, O: Ord<A>): A {
  return O.compare(a, b) >= 0 ? a : b;
}

/**
 * Return the minimum element of an iterable.
 *
 * @param xs - Non-empty iterable
 * @param O - Ord instance for type A
 * @returns The minimum element
 * @throws Error if iterable is empty
 */
export function minBy<A>(xs: Iterable<A>, O: Ord<A>): A {
  let result: A | undefined;
  let first = true;
  for (const x of xs) {
    if (first) {
      result = x;
      first = false;
    } else if (O.compare(x, result!) < 0) {
      result = x;
    }
  }
  if (first) throw new Error("minBy: empty iterable");
  return result!;
}

/**
 * Return the maximum element of an iterable.
 *
 * @param xs - Non-empty iterable
 * @param O - Ord instance for type A
 * @returns The maximum element
 * @throws Error if iterable is empty
 */
export function maxBy<A>(xs: Iterable<A>, O: Ord<A>): A {
  let result: A | undefined;
  let first = true;
  for (const x of xs) {
    if (first) {
      result = x;
      first = false;
    } else if (O.compare(x, result!) > 0) {
      result = x;
    }
  }
  if (first) throw new Error("maxBy: empty iterable");
  return result!;
}

// ============================================================================
// Interpolation (requires Fractional)
// ============================================================================

/**
 * Linear interpolation between two values.
 * Generic version that works for any Fractional type.
 *
 * @param a - Start value (t=0)
 * @param b - End value (t=1)
 * @param t - Interpolation parameter (0 to 1)
 * @param N - Numeric instance for type A
 * @param F - Fractional instance for type A
 * @returns a + t * (b - a)
 */
export function lerpWith<A>(a: A, b: A, t: A, N: Numeric<A>, F: Fractional<A>): A {
  // a + t * (b - a)
  return N.add(a, N.mul(t, N.sub(b, a)));
}

/**
 * Inverse linear interpolation: find t such that lerp(a, b, t) = value.
 * Generic version that works for any Fractional type.
 *
 * @param a - Start value (t=0)
 * @param b - End value (t=1)
 * @param value - The value to find t for
 * @param N - Numeric instance for type A
 * @param F - Fractional instance for type A
 * @returns t such that lerp(a, b, t) ≈ value
 */
export function inverseLerpWith<A>(a: A, b: A, value: A, N: Numeric<A>, F: Fractional<A>): A {
  // (value - a) / (b - a)
  return F.div(N.sub(value, a), N.sub(b, a));
}

// ============================================================================
// Conversion Helpers
// ============================================================================

/**
 * Convert a bigint to any Numeric type.
 *
 * @param n - Integer value
 * @param N - Numeric instance for type A
 * @returns The value as type A
 */
export function fromInteger<A>(n: bigint, N: Numeric<A>): A {
  return N.fromNumber(Number(n));
}

/**
 * Convert an integer to any Numeric type.
 *
 * @param n - Integer value
 * @param N - Numeric instance for type A
 * @returns The value as type A
 */
export function fromInt<A>(n: number, N: Numeric<A>): A {
  return N.fromNumber(n);
}

// ============================================================================
// Ord Instances for Primitives
// ============================================================================

/** Ord instance for number */
export const ordNumber: Ord<number> = {
  compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
};

/** Ord instance for bigint */
export const ordBigInt: Ord<bigint> = {
  compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
};

/** Ord instance for string */
export const ordString: Ord<string> = {
  compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
};
