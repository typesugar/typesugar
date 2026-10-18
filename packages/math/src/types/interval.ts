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
// ----------------------------------------------------------------------------
// Directed rounding (MU-14)
//
// JS has no rounding-mode control, so every endpoint is computed round-to-
// nearest and then pushed outward by one ulp — but only when the operation was
// actually inexact. Exactness is decided with error-free transformations
// (TwoSum for +/−, Dekker's TwoProduct for ×, and a TwoProduct residual for ÷
// and √), so exact results such as 1+2 or [1,2]·[3,4] stay tight while
// inexact ones (0.1+0.2) are guaranteed to contain the true result. Where an
// error-free transformation is not valid (operands near overflow/underflow),
// the result is widened by one ulp unconditionally, which is still sound
// because IEEE +, −, ×, ÷ and √ are correctly rounded (error ≤ ½ ulp).
// ----------------------------------------------------------------------------

const f64 = new Float64Array(1);
const i64 = new BigInt64Array(f64.buffer);

/** Smallest double greater than x (x for +∞ and NaN). */
function nextUp(x: number): number {
  if (Number.isNaN(x) || x === Infinity) return x;
  if (x === 0) return Number.MIN_VALUE;
  f64[0] = x;
  i64[0] += x > 0 ? 1n : -1n;
  return f64[0];
}

/** Largest double less than x (x for −∞ and NaN). */
function nextDown(x: number): number {
  return -nextUp(-x);
}

const SPLITTER = 134217729; // 2^27 + 1
const SAFE_MAX = 2 ** 500; // Dekker splitting / products stay finite below this
const SAFE_MIN = 2 ** -500; // …and the error terms stay normal above this

function inSafeRange(x: number): boolean {
  const a = Math.abs(x);
  return a === 0 || (a >= SAFE_MIN && a <= SAFE_MAX);
}

/** Exact error of the rounded product: a·b = p + err (Dekker / Veltkamp). */
function twoProductErr(a: number, b: number, p: number): number {
  const ca = SPLITTER * a;
  const ah = ca - (ca - a);
  const al = a - ah;
  const cb = SPLITTER * b;
  const bh = cb - (cb - b);
  const bl = b - bh;
  return ah * bh - p + ah * bl + al * bh + al * bl;
}

/** Bound for a rounded result `r` of finite operands whose float result overflowed. */
function overflowBound(r: number, dir: "down" | "up"): number {
  // The exact result is finite; ±∞ is only a valid bound in the outward direction.
  if (r === Infinity) return dir === "up" ? Infinity : Number.MAX_VALUE;
  return dir === "down" ? -Infinity : -Number.MAX_VALUE;
}

/** Round the exact result outward given the sign of (exact − rounded). */
function directed(r: number, errSign: number, dir: "down" | "up"): number {
  if (dir === "down") return errSign < 0 ? nextDown(r) : r;
  return errSign > 0 ? nextUp(r) : r;
}

function addDir(a: number, b: number, dir: "down" | "up"): number {
  const s = a + b;
  if (!Number.isFinite(s)) {
    return Number.isFinite(a) && Number.isFinite(b) ? overflowBound(s, dir) : s;
  }
  // TwoSum: exact error of the rounded sum (no overflow here).
  const bb = s - a;
  const err = a - (s - bb) + (b - bb);
  return directed(s, Math.sign(err), dir);
}

function mulDir(a: number, b: number, dir: "down" | "up"): number {
  // 0 · ±∞ is 0 for interval endpoints (the factor is exactly zero), not NaN.
  if (a === 0 || b === 0) return 0;
  const p = a * b;
  if (!Number.isFinite(p)) {
    return Number.isFinite(a) && Number.isFinite(b) ? overflowBound(p, dir) : p;
  }
  if (!inSafeRange(a) || !inSafeRange(b) || !inSafeRange(p)) {
    return dir === "down" ? nextDown(p) : nextUp(p);
  }
  return directed(p, Math.sign(twoProductErr(a, b, p)), dir);
}

function divDir(a: number, b: number, dir: "down" | "up"): number {
  const q = a / b;
  if (!Number.isFinite(q)) {
    return Number.isFinite(a) && Number.isFinite(b) ? overflowBound(q, dir) : q;
  }
  if (!Number.isFinite(a) || !Number.isFinite(b)) return q; // ±∞/x or x/±∞: exact
  if (q === 0 && a === 0) return 0;
  if (!inSafeRange(a) || !inSafeRange(b) || !inSafeRange(q) || q === 0) {
    return dir === "down" ? nextDown(q) : nextUp(q);
  }
  // Residual r = a − q·b, exactly; sign(a/b − q) = sign(r) · sign(b).
  const p = q * b;
  const r = a - p - twoProductErr(q, b, p);
  return directed(q, Math.sign(r) * Math.sign(b), dir);
}

function sqrtDir(x: number, dir: "down" | "up"): number {
  const s = Math.sqrt(x);
  if (x === 0 || !Number.isFinite(s)) return s;
  if (!inSafeRange(x) || !inSafeRange(s)) {
    return dir === "down" ? Math.max(0, nextDown(s)) : nextUp(s);
  }
  // Residual x − s², exactly; its sign is the sign of (√x − s).
  const p = s * s;
  const r = x - p - twoProductErr(s, s, p);
  return directed(s, Math.sign(r), dir);
}

/** x^n for x >= 0 and integer n >= 1, bounded in direction `dir`. */
function powNonNegDir(x: number, n: number, dir: "down" | "up"): number {
  let result = 1;
  let base = x;
  let e = n;
  while (e > 0) {
    if (e % 2 === 1) result = mulDir(result, base, dir);
    e = Math.floor(e / 2);
    if (e > 0) base = mulDir(base, base, dir);
  }
  return result;
}

export function add(a: Interval, b: Interval): Interval {
  return { lo: addDir(a.lo, b.lo, "down"), hi: addDir(a.hi, b.hi, "up") };
}

export function sub(a: Interval, b: Interval): Interval {
  return { lo: addDir(a.lo, -b.hi, "down"), hi: addDir(a.hi, -b.lo, "up") };
}

export function mul(a: Interval, b: Interval): Interval {
  if (isEmpty(a) || isEmpty(b)) return empty;
  const pairs: Array<[number, number]> = [
    [a.lo, b.lo],
    [a.lo, b.hi],
    [a.hi, b.lo],
    [a.hi, b.hi],
  ];
  return {
    lo: Math.min(...pairs.map(([x, y]) => mulDir(x, y, "down"))),
    hi: Math.max(...pairs.map(([x, y]) => mulDir(x, y, "up"))),
  };
}

export function div(a: Interval, b: Interval): Interval {
  if (b.lo <= 0 && b.hi >= 0) {
    // Division by interval containing zero
    if (b.lo === 0 && b.hi === 0) {
      // Division by exactly zero
      return { lo: NaN, hi: NaN };
    }
    // Any interval touching or straddling zero: the quotient is unbounded.
    return { lo: -Infinity, hi: Infinity };
  }

  // Normal division: b doesn't contain zero
  const pairs: Array<[number, number]> = [
    [a.lo, b.lo],
    [a.lo, b.hi],
    [a.hi, b.lo],
    [a.hi, b.hi],
  ];
  return {
    lo: Math.min(...pairs.map(([x, y]) => divDir(x, y, "down"))),
    hi: Math.max(...pairs.map(([x, y]) => divDir(x, y, "up"))),
  };
}

export function negate(i: Interval): Interval {
  return { lo: -i.hi, hi: -i.lo };
}

export function abs(i: Interval): Interval {
  if (i.lo >= 0) return i;
  if (i.hi <= 0) return negate(i);
  return { lo: 0, hi: Math.max(-i.lo, i.hi) };
}

export function square(i: Interval): Interval {
  if (i.lo >= 0) {
    return { lo: mulDir(i.lo, i.lo, "down"), hi: mulDir(i.hi, i.hi, "up") };
  }
  if (i.hi <= 0) {
    return { lo: mulDir(i.hi, i.hi, "down"), hi: mulDir(i.lo, i.lo, "up") };
  }
  // Interval contains zero
  return { lo: 0, hi: Math.max(mulDir(i.lo, i.lo, "up"), mulDir(i.hi, i.hi, "up")) };
}

export function sqrt(i: Interval): Interval {
  if (i.hi < 0) {
    return empty;
  }
  return {
    lo: i.lo <= 0 ? 0 : sqrtDir(i.lo, "down"),
    hi: sqrtDir(i.hi, "up"),
  };
}

/**
 * Integer powers are computed by directed repeated multiplication, so they
 * contain the exact result. Non-integer exponents go through `Math.pow`,
 * which is not guaranteed correctly rounded; those endpoints are widened by
 * two ulps, a heuristic bound rather than a proof.
 */
export function pow(i: Interval, n: number): Interval {
  if (n === 0) return point(1);
  if (n === 1) return i;
  if (n === 2) return square(i);

  if (Number.isInteger(n)) {
    if (n < 0) return div(point(1), pow(i, -n));
    if (n % 2 === 0) {
      // Even power
      const absI = abs(i);
      return { lo: powNonNegDir(absI.lo, n, "down"), hi: powNonNegDir(absI.hi, n, "up") };
    }
    // Odd power: monotone increasing; x^n = −(|x|^n) for x < 0.
    const lo = i.lo >= 0 ? powNonNegDir(i.lo, n, "down") : -powNonNegDir(-i.lo, n, "up");
    const hi = i.hi >= 0 ? powNonNegDir(i.hi, n, "up") : -powNonNegDir(-i.hi, n, "down");
    return { lo, hi };
  }

  const widenDown = (x: number) => nextDown(nextDown(x));
  const widenUp = (x: number) => nextUp(nextUp(x));
  return { lo: widenDown(Math.pow(i.lo, n)), hi: widenUp(Math.pow(i.hi, n)) };
}

// ============================================================================
// Typeclass Instances
// ============================================================================

/**
 * Numeric instance for intervals.
 */
/** @impl Numeric<Interval> */
export const numericInterval: Numeric<Interval> = {
  add: (a, b) => add(a, b),
  sub: (a, b) => sub(a, b),
  mul: (a, b) => mul(a, b),
  div: (a, b) => div(a, b),
  pow: (a, b) => {
    const n = Math.round(midpoint(b));
    if (n === 0) return point(1);
    let result: Interval = a;
    for (let i = 1; i < Math.abs(n); i++) result = mul(result, a);
    if (n < 0) result = div(point(1), result);
    return result;
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
/**
 * Ord instance for intervals (by lower bound, then upper bound).
 */
/** @impl Ord<Interval> */
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
