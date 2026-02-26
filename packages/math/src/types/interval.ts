/**
 * Interval - Interval arithmetic for bounds tracking
 *
 * Intervals represent ranges [lo, hi] and support arithmetic operations
 * that correctly propagate bounds. This is useful for:
 * - Numerical error analysis
 * - Range queries
 * - Constraint propagation
 * - Verified numerical computing
 *
 * @example
 * ```typescript
 * const a = interval(1, 2);  // [1, 2]
 * const b = interval(3, 4);  // [3, 4]
 * const sum = numericInterval.add(a, b);  // [4, 6]
 * const prod = numericInterval.mul(a, b);  // [3, 8]
 * ```
 */

import type { Numeric, Ord } from "@typesugar/std";
import type { Op } from "@typesugar/core";
import { registerInstanceWithMeta } from "@typesugar/macros";

// ============================================================================
// Type Definition
// ============================================================================

/**
 * An interval [lo, hi] representing all values x where lo ≤ x ≤ hi.
 */
export interface Interval {
  readonly lo: number;
  readonly hi: number;
}

// ============================================================================
// Constructors
// ============================================================================

/**
 * Create an interval [lo, hi].
 *
 * @throws RangeError if lo > hi
 */
export function interval(lo: number, hi: number): Interval {
  if (lo > hi) {
    throw new RangeError(`Invalid interval: lo (${lo}) > hi (${hi})`);
  }
  return { lo, hi };
}

/** Create a point interval [x, x]. */
export function point(x: number): Interval {
  return { lo: x, hi: x };
}

/** The entire real line (-∞, +∞). */
export const entire: Interval = { lo: -Infinity, hi: Infinity };

/** The empty interval (NaN bounds signal empty). */
export const empty: Interval = { lo: NaN, hi: NaN };

/** Check if an interval is empty. */
export function isEmpty(i: Interval): boolean {
  return Number.isNaN(i.lo) || Number.isNaN(i.hi);
}

/** Check if an interval is a single point. */
export function isPoint(i: Interval): boolean {
  return i.lo === i.hi;
}

// ============================================================================
// Queries
// ============================================================================

/** Check if a point is contained in the interval. */
export function contains(i: Interval, x: number): boolean {
  return x >= i.lo && x <= i.hi;
}

/** Check if interval a contains interval b entirely. */
export function containsInterval(a: Interval, b: Interval): boolean {
  return a.lo <= b.lo && b.hi <= a.hi;
}

/** Check if two intervals overlap. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.lo <= b.hi && b.lo <= a.hi;
}

/** Width of the interval (hi - lo). */
export function width(i: Interval): number {
  return i.hi - i.lo;
}

/** Midpoint of the interval. */
export function midpoint(i: Interval): number {
  return (i.lo + i.hi) / 2;
}

/** Radius of the interval (half the width). */
export function radius(i: Interval): number {
  return (i.hi - i.lo) / 2;
}

/** Magnitude (max absolute value of endpoints). */
export function magnitude(i: Interval): number {
  return Math.max(Math.abs(i.lo), Math.abs(i.hi));
}

/** Mignitude (min absolute value if interval doesn't contain 0). */
export function mignitude(i: Interval): number {
  if (i.lo <= 0 && i.hi >= 0) return 0;
  return Math.min(Math.abs(i.lo), Math.abs(i.hi));
}

// ============================================================================
// Set Operations
// ============================================================================

/**
 * Hull of two intervals - smallest interval containing both.
 */
export function hull(a: Interval, b: Interval): Interval {
  if (isEmpty(a)) return b;
  if (isEmpty(b)) return a;
  return { lo: Math.min(a.lo, b.lo), hi: Math.max(a.hi, b.hi) };
}

/**
 * Intersection of two intervals.
 * Returns null if intervals don't overlap.
 */
export function intersect(a: Interval, b: Interval): Interval | null {
  const lo = Math.max(a.lo, b.lo);
  const hi = Math.min(a.hi, b.hi);
  if (lo > hi) return null;
  return { lo, hi };
}

// ============================================================================
// Arithmetic Operations
// ============================================================================

/**
 * Interval addition: [a,b] + [c,d] = [a+c, b+d]
 */
export function add(a: Interval, b: Interval): Interval {
  return { lo: a.lo + b.lo, hi: a.hi + b.hi };
}

/**
 * Interval subtraction: [a,b] - [c,d] = [a-d, b-c]
 */
export function sub(a: Interval, b: Interval): Interval {
  return { lo: a.lo - b.hi, hi: a.hi - b.lo };
}

/**
 * Interval multiplication: [a,b] * [c,d] = [min(ac,ad,bc,bd), max(ac,ad,bc,bd)]
 */
export function mul(a: Interval, b: Interval): Interval {
  const products = [a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi];
  return {
    lo: Math.min(...products),
    hi: Math.max(...products),
  };
}

/**
 * Interval division: [a,b] / [c,d]
 *
 * If [c,d] contains 0, the result is (-∞, +∞) or split intervals.
 * For simplicity, this implementation returns the hull when dividing by
 * an interval containing zero.
 */
export function div(a: Interval, b: Interval): Interval {
  if (b.lo <= 0 && b.hi >= 0) {
    // Division by interval containing zero
    if (b.lo === 0 && b.hi === 0) {
      // Division by exactly zero
      return { lo: NaN, hi: NaN };
    }
    if (b.lo === 0) {
      // [c,d] with c=0, so 1/[c,d] = [1/d, +∞)
      return { lo: -Infinity, hi: Infinity };
    }
    if (b.hi === 0) {
      // [c,d] with d=0, so 1/[c,d] = (-∞, 1/c]
      return { lo: -Infinity, hi: Infinity };
    }
    // General case: interval straddles zero
    return { lo: -Infinity, hi: Infinity };
  }

  // Normal division: b doesn't contain zero
  const invB = { lo: 1 / b.hi, hi: 1 / b.lo };
  return mul(a, invB);
}

/**
 * Negate an interval: -[a,b] = [-b, -a]
 */
export function negate(i: Interval): Interval {
  return { lo: -i.hi, hi: -i.lo };
}

/**
 * Absolute value of an interval.
 */
export function abs(i: Interval): Interval {
  if (i.lo >= 0) return i;
  if (i.hi <= 0) return negate(i);
  return { lo: 0, hi: Math.max(-i.lo, i.hi) };
}

/**
 * Square of an interval.
 */
export function square(i: Interval): Interval {
  if (i.lo >= 0) {
    return { lo: i.lo * i.lo, hi: i.hi * i.hi };
  }
  if (i.hi <= 0) {
    return { lo: i.hi * i.hi, hi: i.lo * i.lo };
  }
  // Interval contains zero
  return { lo: 0, hi: Math.max(i.lo * i.lo, i.hi * i.hi) };
}

/**
 * Square root of an interval.
 */
export function sqrt(i: Interval): Interval {
  if (i.hi < 0) {
    return empty;
  }
  return {
    lo: i.lo <= 0 ? 0 : Math.sqrt(i.lo),
    hi: Math.sqrt(i.hi),
  };
}

/**
 * Power of an interval (integer exponent).
 */
export function pow(i: Interval, n: number): Interval {
  if (n === 0) return point(1);
  if (n === 1) return i;
  if (n === 2) return square(i);

  if (n % 2 === 0) {
    // Even power
    const absI = abs(i);
    return { lo: Math.pow(absI.lo, n), hi: Math.pow(absI.hi, n) };
  } else {
    // Odd power
    return { lo: Math.pow(i.lo, n), hi: Math.pow(i.hi, n) };
  }
}

// ============================================================================
// Typeclass Instances
// ============================================================================

/**
 * Numeric instance for intervals.
 */
export const numericInterval: Numeric<Interval> = {
  add: (a, b) => add(a, b) as Interval & Op<"+">,
  sub: (a, b) => sub(a, b) as Interval & Op<"-">,
  mul: (a, b) => mul(a, b) as Interval & Op<"*">,
  div: (a, b) => div(a, b) as Interval & Op<"/">,
  pow: (a, b) => {
    const n = Math.round(midpoint(b));
    if (n === 0) return point(1) as Interval & Op<"**">;
    let result: Interval = a;
    for (let i = 1; i < Math.abs(n); i++) result = mul(result, a);
    if (n < 0) result = div(point(1), result);
    return result as Interval & Op<"**">;
  },
  negate,
  abs,
  signum: (i) => {
    if (i.lo > 0) return point(1);
    if (i.hi < 0) return point(-1);
    return interval(-1, 1);
  },
  fromNumber: point,
  toNumber: midpoint,
  zero: () => point(0),
  one: () => point(1),
};

registerInstanceWithMeta({
  typeclassName: "Numeric",
  forType: "Interval",
  instanceName: "numericInterval",
  derived: false,
});

/**
 * Ord instance for intervals (by lower bound, then upper bound).
 */
export const ordInterval: Ord<Interval> = {
  equals: (a, b) => a.lo === b.lo && a.hi === b.hi,
  notEquals: (a, b) => a.lo !== b.lo || a.hi !== b.hi,
  compare: (a, b) => {
    if (a.lo !== b.lo) return a.lo < b.lo ? -1 : 1;
    if (a.hi !== b.hi) return a.hi < b.hi ? -1 : 1;
    return 0;
  },
  lessThan: (a, b) => {
    if (a.lo !== b.lo) return a.lo < b.lo;
    return a.hi < b.hi;
  },
  lessThanOrEqual: (a, b) => {
    if (a.lo !== b.lo) return a.lo < b.lo;
    return a.hi <= b.hi;
  },
  greaterThan: (a, b) => {
    if (a.lo !== b.lo) return a.lo > b.lo;
    return a.hi > b.hi;
  },
  greaterThanOrEqual: (a, b) => {
    if (a.lo !== b.lo) return a.lo > b.lo;
    return a.hi >= b.hi;
  },
};

registerInstanceWithMeta({
  typeclassName: "Ord",
  forType: "Interval",
  instanceName: "ordInterval",
  derived: false,
});

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if two intervals are equal.
 */
export function equals(a: Interval, b: Interval): boolean {
  return a.lo === b.lo && a.hi === b.hi;
}

/**
 * Check if two intervals are approximately equal.
 */
export function approxEquals(a: Interval, b: Interval, tolerance = 1e-10): boolean {
  return Math.abs(a.lo - b.lo) <= tolerance && Math.abs(a.hi - b.hi) <= tolerance;
}

/**
 * Pretty-print an interval.
 */
export function toString(i: Interval): string {
  if (isEmpty(i)) return "∅";
  if (isPoint(i)) return `{${i.lo}}`;
  return `[${i.lo}, ${i.hi}]`;
}

/**
 * Widen an interval by a given amount on each side.
 */
export function widen(i: Interval, delta: number): Interval {
  return { lo: i.lo - delta, hi: i.hi + delta };
}

/**
 * Narrow an interval by a given amount on each side.
 * Returns null if the interval becomes invalid.
 */
export function narrow(i: Interval, delta: number): Interval | null {
  const lo = i.lo + delta;
  const hi = i.hi - delta;
  if (lo > hi) return null;
  return { lo, hi };
}
