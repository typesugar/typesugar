/**
 * BigDecimal - Arbitrary Precision Decimals
 *
 * Exact decimal arithmetic using bigint storage with explicit scale.
 * Value = unscaled * 10^(-scale)
 *
 * @example
 * ```typescript
 * const a = bigDecimal("123.456"); // unscaled=123456, scale=3
 * const b = bigDecimal(100, 2);    // unscaled=100, scale=2 → 1.00
 * const sum = numericBigDecimal.add(a, b);
 * ```
 */

import type { Numeric, Ord } from "@typesugar/std";
import type { Op } from "@typesugar/core";

/**
 * Arbitrary precision decimal number.
 * value = unscaled * 10^(-scale)
 *
 * @example
 * - { unscaled: 123n, scale: 0 } = 123
 * - { unscaled: 123n, scale: 2 } = 1.23
 * - { unscaled: -456n, scale: 3 } = -0.456
 */
export interface BigDecimal {
  readonly unscaled: bigint;
  readonly scale: number;
}

/**
 * Create a BigDecimal from various inputs.
 *
 * @param value - bigint, number, or string representation
 * @param scale - decimal places (for bigint input); ignored for string/number
 */
export function bigDecimal(value: bigint | number | string, scale?: number): BigDecimal {
  if (typeof value === "string") {
    return fromString(value);
  }

  if (typeof value === "number") {
    return fromNumber(value);
  }

  // bigint with explicit scale
  return { unscaled: value, scale: scale ?? 0 };
}

/**
 * Parse a BigDecimal from a string like "123.456" or "-0.001" or "1e-5".
 */
export function fromString(s: string): BigDecimal {
  s = s.trim();

  // Handle scientific notation
  const eIndex = s.toLowerCase().indexOf("e");
  if (eIndex !== -1) {
    const mantissa = s.slice(0, eIndex);
    const exponent = parseInt(s.slice(eIndex + 1), 10);
    const base = fromString(mantissa);
    // Adjust scale by exponent
    return { unscaled: base.unscaled, scale: base.scale - exponent };
  }

  const negative = s.startsWith("-");
  if (negative || s.startsWith("+")) {
    s = s.slice(1);
  }

  const dotIndex = s.indexOf(".");
  let unscaled: bigint;
  let scale: number;

  if (dotIndex === -1) {
    // No decimal point
    unscaled = BigInt(s);
    scale = 0;
  } else {
    // Remove the dot and calculate scale
    const intPart = s.slice(0, dotIndex);
    const fracPart = s.slice(dotIndex + 1);
    unscaled = BigInt(intPart + fracPart);
    scale = fracPart.length;
  }

  return { unscaled: negative ? -unscaled : unscaled, scale };
}

/**
 * Create a BigDecimal from a JavaScript number.
 * Uses string conversion to preserve decimal representation.
 */
function fromNumber(n: number): BigDecimal {
  if (!Number.isFinite(n)) {
    throw new RangeError("BigDecimal: cannot convert non-finite number");
  }

  // Use string conversion to preserve decimal places
  const s = n.toString();
  return fromString(s);
}

/**
 * Convert a BigDecimal to a JavaScript number.
 * May lose precision for large values.
 */
export function toNumber(bd: BigDecimal): number {
  if (bd.scale === 0) {
    return Number(bd.unscaled);
  }
  if (bd.scale > 0) {
    return Number(bd.unscaled) / Math.pow(10, bd.scale);
  }
  return Number(bd.unscaled) * Math.pow(10, -bd.scale);
}

/**
 * Format a BigDecimal as a string with exactly the specified decimal places.
 */
export function toFixed(bd: BigDecimal, places: number): string {
  const scaled = setScale(bd, places);
  return formatWithScale(scaled);
}

/**
 * Convert a BigDecimal to string representation.
 */
export function toString(bd: BigDecimal): string {
  return formatWithScale(normalize(bd));
}

/**
 * Internal: format a BigDecimal with its current scale.
 */
function formatWithScale(bd: BigDecimal): string {
  if (bd.scale <= 0) {
    const zeros = "0".repeat(-bd.scale);
    return bd.unscaled.toString() + zeros;
  }

  const negative = bd.unscaled < 0n;
  const absStr = (negative ? -bd.unscaled : bd.unscaled).toString();

  if (absStr.length <= bd.scale) {
    // Need leading zeros after decimal
    const leadingZeros = "0".repeat(bd.scale - absStr.length);
    return (negative ? "-" : "") + "0." + leadingZeros + absStr;
  }

  const intPart = absStr.slice(0, absStr.length - bd.scale);
  const fracPart = absStr.slice(absStr.length - bd.scale);
  return (negative ? "-" : "") + intPart + "." + fracPart;
}

/**
 * Remove trailing zeros from the fractional part.
 */
function normalize(bd: BigDecimal): BigDecimal {
  if (bd.unscaled === 0n) {
    return { unscaled: 0n, scale: 0 };
  }

  let unscaled = bd.unscaled;
  let scale = bd.scale;

  while (scale > 0 && unscaled % 10n === 0n) {
    unscaled /= 10n;
    scale--;
  }

  return { unscaled, scale };
}

/**
 * Adjust a BigDecimal to a specific scale.
 */
function setScale(bd: BigDecimal, newScale: number): BigDecimal {
  if (newScale === bd.scale) {
    return bd;
  }

  if (newScale > bd.scale) {
    // Increase scale by multiplying unscaled
    const factor = 10n ** BigInt(newScale - bd.scale);
    return { unscaled: bd.unscaled * factor, scale: newScale };
  }

  // Decrease scale by dividing (rounds toward zero)
  const factor = 10n ** BigInt(bd.scale - newScale);
  return { unscaled: bd.unscaled / factor, scale: newScale };
}

/**
 * Align two BigDecimals to the same scale (the larger of the two).
 */
function alignScales(a: BigDecimal, b: BigDecimal): [BigDecimal, BigDecimal] {
  const maxScale = Math.max(a.scale, b.scale);
  return [setScale(a, maxScale), setScale(b, maxScale)];
}

/**
 * Divide two BigDecimals with explicit result scale.
 *
 * @param a - Dividend
 * @param b - Divisor
 * @param scale - Number of decimal places in result
 */
export function divWithScale(a: BigDecimal, b: BigDecimal, scale: number): BigDecimal {
  if (b.unscaled === 0n) {
    throw new RangeError("BigDecimal division by zero");
  }

  // To get `scale` decimal places: multiply a by 10^(scale + b.scale - a.scale)
  // then divide by b.unscaled
  const scaleFactor = scale + b.scale - a.scale;
  let dividend = a.unscaled;

  if (scaleFactor > 0) {
    dividend *= 10n ** BigInt(scaleFactor);
  } else if (scaleFactor < 0) {
    dividend /= 10n ** BigInt(-scaleFactor);
  }

  return { unscaled: dividend / b.unscaled, scale };
}

/**
 * Round a BigDecimal to a specified number of decimal places.
 *
 * @param bd - BigDecimal to round
 * @param places - Number of decimal places
 * @param mode - Rounding mode: 'floor' (toward -∞), 'ceil' (toward +∞), 'round' (half-even)
 */
export function round(
  bd: BigDecimal,
  places: number,
  mode: "floor" | "ceil" | "round" = "round"
): BigDecimal {
  if (places >= bd.scale) {
    return bd;
  }

  const scaleDiff = bd.scale - places;
  const divisor = 10n ** BigInt(scaleDiff);
  let quotient = bd.unscaled / divisor;
  const remainder = bd.unscaled % divisor;

  if (remainder === 0n) {
    return { unscaled: quotient, scale: places };
  }

  const negative = bd.unscaled < 0n;
  const absRemainder = remainder < 0n ? -remainder : remainder;
  const halfDivisor = divisor / 2n;

  switch (mode) {
    case "floor":
      if (negative && remainder !== 0n) {
        quotient -= 1n;
      }
      break;

    case "ceil":
      if (!negative && remainder !== 0n) {
        quotient += 1n;
      }
      break;

    case "round":
      // Round half to even (banker's rounding)
      if (absRemainder > halfDivisor) {
        quotient += negative ? -1n : 1n;
      } else if (absRemainder === halfDivisor) {
        // Round to nearest even
        if (quotient % 2n !== 0n) {
          quotient += negative ? -1n : 1n;
        }
      }
      break;
  }

  return { unscaled: quotient, scale: places };
}

/**
 * Numeric instance for BigDecimal.
 * Note: Division is not included because it requires explicit scale.
 */
export const numericBigDecimal: Numeric<BigDecimal> = {
  add: (a, b) => {
    const [aa, bb] = alignScales(a, b);
    return normalize({
      unscaled: aa.unscaled + bb.unscaled,
      scale: aa.scale,
    }) as BigDecimal & Op<"+">;
  },

  sub: (a, b) => {
    const [aa, bb] = alignScales(a, b);
    return normalize({
      unscaled: aa.unscaled - bb.unscaled,
      scale: aa.scale,
    }) as BigDecimal & Op<"-">;
  },

  mul: (a, b) =>
    normalize({
      unscaled: a.unscaled * b.unscaled,
      scale: a.scale + b.scale,
    }) as BigDecimal & Op<"*">,

  negate: (a) => ({ unscaled: -a.unscaled, scale: a.scale }),

  abs: (a) => ({ unscaled: a.unscaled < 0n ? -a.unscaled : a.unscaled, scale: a.scale }),

  signum: (a) =>
    a.unscaled < 0n
      ? { unscaled: -1n, scale: 0 }
      : a.unscaled > 0n
        ? { unscaled: 1n, scale: 0 }
        : { unscaled: 0n, scale: 0 },

  fromNumber: (n) => fromNumber(n),

  toNumber,

  zero: () => ({ unscaled: 0n, scale: 0 }),

  one: () => ({ unscaled: 1n, scale: 0 }),
};

/**
 * Ord instance for BigDecimal.
 */
export const ordBigDecimal: Ord<BigDecimal> = {
  equals: (a, b) => {
    const [aa, bb] = alignScales(a, b);
    return aa.unscaled === bb.unscaled;
  },
  notEquals: (a, b) => {
    const [aa, bb] = alignScales(a, b);
    return aa.unscaled !== bb.unscaled;
  },
  compare: (a, b) => {
    const [aa, bb] = alignScales(a, b);
    return aa.unscaled < bb.unscaled ? -1 : aa.unscaled > bb.unscaled ? 1 : 0;
  },
  lessThan: (a, b) => {
    const [aa, bb] = alignScales(a, b);
    return aa.unscaled < bb.unscaled;
  },
  lessThanOrEqual: (a, b) => {
    const [aa, bb] = alignScales(a, b);
    return aa.unscaled <= bb.unscaled;
  },
  greaterThan: (a, b) => {
    const [aa, bb] = alignScales(a, b);
    return aa.unscaled > bb.unscaled;
  },
  greaterThanOrEqual: (a, b) => {
    const [aa, bb] = alignScales(a, b);
    return aa.unscaled >= bb.unscaled;
  },
};

/**
 * Check if two BigDecimals are equal in value.
 */
export function equals(a: BigDecimal, b: BigDecimal): boolean {
  const [aa, bb] = alignScales(a, b);
  return aa.unscaled === bb.unscaled;
}

/**
 * Check if a BigDecimal is zero.
 */
export function isZero(bd: BigDecimal): boolean {
  return bd.unscaled === 0n;
}

/**
 * Check if a BigDecimal is positive.
 */
export function isPositive(bd: BigDecimal): boolean {
  return bd.unscaled > 0n;
}

/**
 * Check if a BigDecimal is negative.
 */
export function isNegative(bd: BigDecimal): boolean {
  return bd.unscaled < 0n;
}

/**
 * Check if a BigDecimal represents an integer.
 */
export function isInteger(bd: BigDecimal): boolean {
  if (bd.scale <= 0) return true;
  const norm = normalize(bd);
  return norm.scale <= 0;
}

/**
 * Get the integer part of a BigDecimal.
 */
export function integerPart(bd: BigDecimal): bigint {
  if (bd.scale <= 0) {
    return bd.unscaled * 10n ** BigInt(-bd.scale);
  }
  return bd.unscaled / 10n ** BigInt(bd.scale);
}

/**
 * Get the fractional part of a BigDecimal as another BigDecimal.
 */
export function fractionalPart(bd: BigDecimal): BigDecimal {
  if (bd.scale <= 0) {
    return { unscaled: 0n, scale: 0 };
  }

  const factor = 10n ** BigInt(bd.scale);
  const intPart = bd.unscaled / factor;
  return { unscaled: bd.unscaled - intPart * factor, scale: bd.scale };
}

/**
 * Compute the power of a BigDecimal to a non-negative integer exponent.
 */
export function pow(bd: BigDecimal, exp: number): BigDecimal {
  if (exp < 0 || !Number.isInteger(exp)) {
    throw new RangeError("BigDecimal.pow: exponent must be a non-negative integer");
  }

  if (exp === 0) return { unscaled: 1n, scale: 0 };
  if (exp === 1) return bd;

  let result: BigDecimal = { unscaled: 1n, scale: 0 };
  let base = bd;
  let e = exp;

  while (e > 0) {
    if (e & 1) {
      result = numericBigDecimal.mul(result, base);
    }
    base = numericBigDecimal.mul(base, base);
    e >>>= 1;
  }

  return normalize(result);
}

/**
 * Compare the magnitude (absolute value) of two BigDecimals.
 */
export function compareMagnitude(a: BigDecimal, b: BigDecimal): number {
  const absA = numericBigDecimal.abs(a);
  const absB = numericBigDecimal.abs(b);
  return ordBigDecimal.compare(absA, absB);
}

/**
 * Return the minimum of two BigDecimals.
 */
export function min(a: BigDecimal, b: BigDecimal): BigDecimal {
  return ordBigDecimal.compare(a, b) <= 0 ? a : b;
}

/**
 * Return the maximum of two BigDecimals.
 */
export function max(a: BigDecimal, b: BigDecimal): BigDecimal {
  return ordBigDecimal.compare(a, b) >= 0 ? a : b;
}

/**
 * Common BigDecimal constants.
 */
export const ZERO: BigDecimal = { unscaled: 0n, scale: 0 };
export const ONE: BigDecimal = { unscaled: 1n, scale: 0 };
export const TEN: BigDecimal = { unscaled: 10n, scale: 0 };
