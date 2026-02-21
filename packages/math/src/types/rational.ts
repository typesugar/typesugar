/**
 * Rational Numbers
 *
 * Exact rational arithmetic using bigint numerator and denominator.
 * All operations return normalized (reduced) form with positive denominator.
 *
 * @example
 * ```typescript
 * const half = rational(1n, 2n);
 * const third = rational(1n, 3n);
 * const sum = numericRational.add(half, third); // 5/6
 * ```
 */

import type { Numeric, Fractional, Ord } from "@typesugar/std";
import type { Op } from "@typesugar/core";

/**
 * Exact rational number represented as num/den.
 * Invariants:
 * - den > 0 (denominator always positive)
 * - gcd(|num|, den) = 1 (always in reduced form)
 */
export interface Rational {
  readonly num: bigint;
  readonly den: bigint;
}

/**
 * Compute GCD of two bigints using Euclidean algorithm.
 */
function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

/**
 * Normalize a rational: reduce to lowest terms, ensure positive denominator.
 */
function normalize(num: bigint, den: bigint): Rational {
  if (den === 0n) {
    throw new RangeError("Rational: denominator cannot be zero");
  }

  if (num === 0n) {
    return { num: 0n, den: 1n };
  }

  // Ensure positive denominator
  if (den < 0n) {
    num = -num;
    den = -den;
  }

  // Reduce to lowest terms
  const g = gcd(num, den);
  return {
    num: num / g,
    den: den / g,
  };
}

/**
 * Create a rational number from bigint numerator and denominator.
 * Auto-reduces and normalizes sign.
 *
 * @param num - Numerator (bigint or number)
 * @param den - Denominator (bigint or number), defaults to 1
 * @returns Normalized rational in lowest terms
 * @throws RangeError if denominator is zero
 */
export function rational(num: bigint | number, den: bigint | number = 1n): Rational {
  const n = typeof num === "number" ? BigInt(Math.trunc(num)) : num;
  const d = typeof den === "number" ? BigInt(Math.trunc(den)) : den;
  return normalize(n, d);
}

/**
 * Convenience constructor for rationals from numbers.
 * Equivalent to rational(num, den) with number arguments.
 */
export function rat(num: number, den: number = 1): Rational {
  return rational(BigInt(Math.trunc(num)), BigInt(Math.trunc(den)));
}

/**
 * Convert a floating-point number to a rational approximation.
 * Uses continued fraction expansion to find the best approximation
 * within the given denominator bound.
 *
 * @param n - Number to convert
 * @param maxDenominator - Maximum denominator allowed (default: 1000000)
 * @returns Rational approximation of n
 */
export function fromNumber(n: number, maxDenominator: bigint = 1000000n): Rational {
  if (!Number.isFinite(n)) {
    throw new RangeError("fromNumber: cannot convert non-finite number");
  }

  if (Number.isInteger(n)) {
    return rational(BigInt(n), 1n);
  }

  const negative = n < 0;
  n = Math.abs(n);

  // Continued fraction expansion
  // We compute successive convergents p[k]/q[k] until q exceeds maxDenominator
  let p0 = 0n;
  let q0 = 1n;
  let p1 = 1n;
  let q1 = 0n;

  let x = n;
  const maxIterations = 100;

  for (let i = 0; i < maxIterations; i++) {
    const a = BigInt(Math.floor(x));

    // Compute next convergent: p[k] = a[k] * p[k-1] + p[k-2]
    const p2 = a * p1 + p0;
    const q2 = a * q1 + q0;

    if (q2 > maxDenominator) {
      // q2 exceeds limit; find best semi-convergent
      // The last valid convergent is p1/q1
      // We can try a semi-convergent with a smaller a value
      const aMax = (maxDenominator - q0) / q1;
      if (aMax > 0n) {
        const pSemi = aMax * p1 + p0;
        const qSemi = aMax * q1 + q0;

        // Compare semi-convergent with last convergent
        const errSemi = Math.abs(Number(pSemi) / Number(qSemi) - n);
        const errLast = Math.abs(Number(p1) / Number(q1) - n);

        if (errSemi < errLast) {
          return normalize(negative ? -pSemi : pSemi, qSemi);
        }
      }
      return normalize(negative ? -p1 : p1, q1);
    }

    // Check if we've converged
    const approx = Number(p2) / Number(q2);
    if (Math.abs(approx - n) < 1e-15) {
      return normalize(negative ? -p2 : p2, q2);
    }

    // Prepare for next iteration
    p0 = p1;
    q0 = q1;
    p1 = p2;
    q1 = q2;

    // Compute fractional part for next coefficient
    const frac = x - Math.floor(x);
    if (frac < 1e-15) {
      break;
    }
    x = 1 / frac;
  }

  return normalize(negative ? -p1 : p1, q1);
}

/**
 * Convert a rational to a floating-point number.
 * May lose precision for large numerators/denominators.
 */
export function toNumber(r: Rational): number {
  return Number(r.num) / Number(r.den);
}

/**
 * Check if a rational represents an integer (denominator is 1).
 */
export function isInteger(r: Rational): boolean {
  return r.den === 1n;
}

/**
 * Format a rational as a string "num/den" or just "num" if integer.
 */
export function toString(r: Rational): string {
  if (r.den === 1n) {
    return r.num.toString();
  }
  return `${r.num}/${r.den}`;
}

/**
 * Numeric instance for Rational numbers.
 * Supports add, sub, mul with exact arithmetic.
 */
export const numericRational: Numeric<Rational> = {
  add: (a, b) => normalize(a.num * b.den + b.num * a.den, a.den * b.den) as Rational & Op<"+">,

  sub: (a, b) => normalize(a.num * b.den - b.num * a.den, a.den * b.den) as Rational & Op<"-">,

  mul: (a, b) => normalize(a.num * b.num, a.den * b.den) as Rational & Op<"*">,

  negate: (a) => ({ num: -a.num, den: a.den }),

  abs: (a) => ({ num: a.num < 0n ? -a.num : a.num, den: a.den }),

  signum: (a) =>
    a.num < 0n ? { num: -1n, den: 1n } : a.num > 0n ? { num: 1n, den: 1n } : { num: 0n, den: 1n },

  fromNumber: (n) => fromNumber(n),

  toNumber,

  zero: () => ({ num: 0n, den: 1n }),

  one: () => ({ num: 1n, den: 1n }),
};

/**
 * Fractional instance for Rational numbers.
 * Supports exact division.
 */
export const fractionalRational: Fractional<Rational> = {
  div: (a, b) => {
    if (b.num === 0n) {
      throw new RangeError("Rational division by zero");
    }
    return normalize(a.num * b.den, a.den * b.num) as Rational & Op<"/">;
  },

  recip: (a) => {
    if (a.num === 0n) {
      throw new RangeError("Rational reciprocal of zero");
    }
    return normalize(a.den, a.num);
  },

  fromRational: (num, den) => rational(BigInt(Math.trunc(num)), BigInt(Math.trunc(den))),
};

/**
 * Ord instance for Rational numbers.
 * Compares by cross-multiplication to avoid floating-point.
 */
export const ordRational: Ord<Rational> = {
  compare: (a, b) => {
    // a/b vs c/d => compare a*d vs c*b
    const lhs = a.num * b.den;
    const rhs = b.num * a.den;
    return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
  },
};

/**
 * Check equality of two rationals.
 */
export function equals(a: Rational, b: Rational): boolean {
  return a.num === b.num && a.den === b.den;
}

/**
 * Check if a rational is zero.
 */
export function isZero(r: Rational): boolean {
  return r.num === 0n;
}

/**
 * Check if a rational is positive.
 */
export function isPositive(r: Rational): boolean {
  return r.num > 0n;
}

/**
 * Check if a rational is negative.
 */
export function isNegative(r: Rational): boolean {
  return r.num < 0n;
}

/**
 * Floor of a rational (largest integer <= r).
 */
export function floor(r: Rational): bigint {
  if (r.num >= 0n) {
    return r.num / r.den;
  }
  return (r.num - r.den + 1n) / r.den;
}

/**
 * Ceiling of a rational (smallest integer >= r).
 */
export function ceil(r: Rational): bigint {
  if (r.num >= 0n) {
    return (r.num + r.den - 1n) / r.den;
  }
  return r.num / r.den;
}

/**
 * Truncate a rational toward zero.
 */
export function trunc(r: Rational): bigint {
  return r.num / r.den;
}

/**
 * Compute the power of a rational to an integer exponent.
 */
export function pow(r: Rational, exp: number): Rational {
  if (exp === 0) return { num: 1n, den: 1n };

  const absExp = Math.abs(exp);
  let resultNum = 1n;
  let resultDen = 1n;
  let baseNum = r.num;
  let baseDen = r.den;
  let e = absExp;

  while (e > 0) {
    if (e & 1) {
      resultNum *= baseNum;
      resultDen *= baseDen;
    }
    baseNum *= baseNum;
    baseDen *= baseDen;
    e >>>= 1;
  }

  if (exp < 0) {
    if (resultNum === 0n) {
      throw new RangeError("Rational: negative power of zero");
    }
    return normalize(resultDen, resultNum);
  }

  return normalize(resultNum, resultDen);
}
