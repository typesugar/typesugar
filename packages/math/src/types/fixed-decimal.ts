/**
 * FixedDecimal - Fixed-Point Decimal with Compile-Time Scale
 *
 * A branded bigint representing a decimal with N decimal places.
 * All arithmetic operations automatically round to maintain the fixed scale.
 *
 * @example
 * ```typescript
 * import { fixed, fixedNumeric } from "@typesugar/math";
 *
 * // Create fixed decimals with 2 decimal places
 * const price = fixed(12.34, 2);    // 1234n internally
 * const taxRate = fixed(0.08, 2);   // 8n internally
 *
 * // Arithmetic auto-rounds to 2 decimals
 * const tax = fixedNumeric(2).mul(price, taxRate);  // 0.99 (rounded from 0.9872)
 * const total = fixedNumeric(2).add(price, tax);    // 13.33
 * ```
 *
 * @packageDocumentation
 */

import type { Numeric, Integral, Ord } from "@typesugar/std";
import { makeOrd } from "@typesugar/std";
import type { Op } from "@typesugar/core";
import { roundBigInt, type RoundingMode, DEFAULT_ROUNDING_MODE } from "./rounding.js";

/**
 * Eq typeclass - equality comparison.
 */
export interface Eq<A> {
  equals(a: A, b: A): boolean;
}

/**
 * A fixed-point decimal with N decimal places.
 *
 * Internally stored as a bigint scaled by 10^N.
 * The __scale brand ensures type-level tracking of decimal places.
 *
 * @typeParam N - Number of decimal places (compile-time constant)
 *
 * @example
 * ```typescript
 * type Price = FixedDecimal<2>;  // 2 decimal places for money
 * type Rate = FixedDecimal<4>;   // 4 decimal places for interest rates
 * ```
 */
export type FixedDecimal<N extends number> = bigint & { readonly __scale: N };

/**
 * Configuration for fixed-decimal arithmetic operations.
 */
export interface FixedDecimalConfig {
  /** Rounding mode for operations that need rounding (multiplication, division) */
  roundingMode: RoundingMode;
}

/**
 * Default configuration for fixed-decimal operations.
 */
export const defaultConfig: FixedDecimalConfig = {
  roundingMode: DEFAULT_ROUNDING_MODE,
};

/**
 * Internal scale factor cache to avoid repeated computation.
 */
const scaleFactors: Map<number, bigint> = new Map();

function getScaleFactor(scale: number): bigint {
  let factor = scaleFactors.get(scale);
  if (factor === undefined) {
    factor = 10n ** BigInt(scale);
    scaleFactors.set(scale, factor);
  }
  return factor;
}

/**
 * Create a FixedDecimal from a number, string, or bigint.
 *
 * @param value - Input value to convert
 * @param scale - Number of decimal places
 * @param mode - Rounding mode for conversion (default: HALF_EVEN)
 * @returns FixedDecimal with the specified scale
 *
 * @example
 * ```typescript
 * fixed(12.34, 2);     // 1234n as FixedDecimal<2>
 * fixed("12.345", 2);  // 1235n as FixedDecimal<2> (rounded)
 * fixed(1234n, 2);     // 1234n as FixedDecimal<2> (assumes already scaled)
 * ```
 */
export function fixed<N extends number>(
  value: number | string | bigint,
  scale: N,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): FixedDecimal<N> {
  const scaleFactor = getScaleFactor(scale);

  if (typeof value === "bigint") {
    // Assume already at correct scale
    return value as FixedDecimal<N>;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError("FixedDecimal: cannot convert non-finite number");
    }
    // Convert via scaled integer
    const scaled = value * Number(scaleFactor);
    // Round to integer
    const rounded = roundBigInt(BigInt(Math.trunc(scaled * 1e10)), 0, 10, mode);
    return rounded as FixedDecimal<N>;
  }

  // String parsing
  return fixedFromString(value, scale, mode);
}

/**
 * Parse a string into a FixedDecimal.
 */
function fixedFromString<N extends number>(
  s: string,
  scale: N,
  mode: RoundingMode
): FixedDecimal<N> {
  s = s.trim();

  // Handle scientific notation
  const eIndex = s.toLowerCase().indexOf("e");
  if (eIndex !== -1) {
    const mantissa = s.slice(0, eIndex);
    const exponent = parseInt(s.slice(eIndex + 1), 10);
    const base = fixedFromString(mantissa, scale + Math.max(0, -exponent), mode);
    if (exponent >= 0) {
      return (base * 10n ** BigInt(exponent)) as FixedDecimal<N>;
    }
    // Negative exponent already handled by increased scale
    return base as unknown as FixedDecimal<N>;
  }

  const negative = s.startsWith("-");
  if (negative || s.startsWith("+")) {
    s = s.slice(1);
  }

  const dotIndex = s.indexOf(".");
  let unscaled: bigint;
  let inputScale: number;

  if (dotIndex === -1) {
    unscaled = BigInt(s);
    inputScale = 0;
  } else {
    const intPart = s.slice(0, dotIndex) || "0";
    const fracPart = s.slice(dotIndex + 1);
    unscaled = BigInt(intPart + fracPart);
    inputScale = fracPart.length;
  }

  if (negative) {
    unscaled = -unscaled;
  }

  // Adjust to target scale
  const result = roundBigInt(unscaled, scale, inputScale, mode);
  return result as FixedDecimal<N>;
}

/**
 * Create a FixedDecimal representing zero.
 */
export function fixedZero<N extends number>(scale: N): FixedDecimal<N> {
  return 0n as FixedDecimal<N>;
}

/**
 * Create a FixedDecimal representing one.
 */
export function fixedOne<N extends number>(scale: N): FixedDecimal<N> {
  return getScaleFactor(scale) as FixedDecimal<N>;
}

/**
 * Convert a FixedDecimal to a JavaScript number.
 */
export function fixedToNumber<N extends number>(fd: FixedDecimal<N>, scale: N): number {
  return Number(fd) / Number(getScaleFactor(scale));
}

/**
 * Convert a FixedDecimal to a string representation.
 */
export function fixedToString<N extends number>(fd: FixedDecimal<N>, scale: N): string {
  const scaleFactor = getScaleFactor(scale);

  if (scale === 0) {
    return fd.toString();
  }

  const negative = fd < 0n;
  const abs = negative ? -fd : fd;
  const absStr = abs.toString().padStart(scale + 1, "0");

  const intPart = absStr.slice(0, absStr.length - scale) || "0";
  const fracPart = absStr.slice(absStr.length - scale);

  return (negative ? "-" : "") + intPart + "." + fracPart;
}

/**
 * Format a FixedDecimal with locale-specific formatting.
 */
export function fixedFormat<N extends number>(
  fd: FixedDecimal<N>,
  scale: N,
  locale?: string,
  options?: Intl.NumberFormatOptions
): string {
  const num = fixedToNumber(fd, scale);
  const opts: Intl.NumberFormatOptions = {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
    ...options,
  };
  return new Intl.NumberFormat(locale, opts).format(num);
}

/**
 * Round a FixedDecimal to fewer decimal places.
 */
export function fixedRound<N extends number, M extends number>(
  fd: FixedDecimal<N>,
  fromScale: N,
  toScale: M,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): FixedDecimal<M> {
  const result = roundBigInt(fd as bigint, toScale, fromScale, mode);
  return result as FixedDecimal<M>;
}

/**
 * Change the scale of a FixedDecimal.
 */
export function fixedRescale<N extends number, M extends number>(
  fd: FixedDecimal<N>,
  fromScale: N,
  toScale: M,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): FixedDecimal<M> {
  return fixedRound(fd, fromScale, toScale, mode);
}

/**
 * Compare two FixedDecimals of the same scale.
 */
export function fixedCompare<N extends number>(a: FixedDecimal<N>, b: FixedDecimal<N>): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Check if two FixedDecimals are equal.
 */
export function fixedEquals<N extends number>(a: FixedDecimal<N>, b: FixedDecimal<N>): boolean {
  return a === b;
}

/**
 * Get the absolute value of a FixedDecimal.
 */
export function fixedAbs<N extends number>(fd: FixedDecimal<N>): FixedDecimal<N> {
  return (fd < 0n ? -fd : fd) as FixedDecimal<N>;
}

/**
 * Negate a FixedDecimal.
 */
export function fixedNegate<N extends number>(fd: FixedDecimal<N>): FixedDecimal<N> {
  return -fd as FixedDecimal<N>;
}

/**
 * Get the sign of a FixedDecimal (-1, 0, or 1).
 */
export function fixedSignum<N extends number>(fd: FixedDecimal<N>): -1 | 0 | 1 {
  return fd < 0n ? -1 : fd > 0n ? 1 : 0;
}

/**
 * Check if a FixedDecimal is zero.
 */
export function fixedIsZero<N extends number>(fd: FixedDecimal<N>): boolean {
  return fd === 0n;
}

/**
 * Check if a FixedDecimal is positive.
 */
export function fixedIsPositive<N extends number>(fd: FixedDecimal<N>): boolean {
  return fd > 0n;
}

/**
 * Check if a FixedDecimal is negative.
 */
export function fixedIsNegative<N extends number>(fd: FixedDecimal<N>): boolean {
  return fd < 0n;
}

/**
 * Add two FixedDecimals of the same scale.
 */
export function fixedAdd<N extends number>(
  a: FixedDecimal<N>,
  b: FixedDecimal<N>
): FixedDecimal<N> {
  return ((a as bigint) + (b as bigint)) as FixedDecimal<N>;
}

/**
 * Subtract two FixedDecimals of the same scale.
 */
export function fixedSub<N extends number>(
  a: FixedDecimal<N>,
  b: FixedDecimal<N>
): FixedDecimal<N> {
  return ((a as bigint) - (b as bigint)) as FixedDecimal<N>;
}

/**
 * Multiply two FixedDecimals, auto-rounding to maintain scale.
 */
export function fixedMul<N extends number>(
  a: FixedDecimal<N>,
  b: FixedDecimal<N>,
  scale: N,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): FixedDecimal<N> {
  // a * b gives scale 2N, need to round back to N
  const product = (a as bigint) * (b as bigint);
  return roundBigInt(product, scale, scale * 2, mode) as FixedDecimal<N>;
}

/**
 * Divide two FixedDecimals, auto-rounding to maintain scale.
 */
export function fixedDiv<N extends number>(
  a: FixedDecimal<N>,
  b: FixedDecimal<N>,
  scale: N,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): FixedDecimal<N> {
  if (b === 0n) {
    throw new RangeError("FixedDecimal division by zero");
  }

  // To maintain precision: multiply dividend by scale factor first
  const scaleFactor = getScaleFactor(scale);
  const scaled = (a as bigint) * scaleFactor;
  const quotient = scaled / (b as bigint);
  const remainder = scaled % (b as bigint);

  // Apply rounding based on remainder
  if (remainder === 0n) {
    return quotient as FixedDecimal<N>;
  }

  const negative = a < 0n !== b < 0n;
  const absRemainder = remainder < 0n ? -remainder : remainder;
  const absB = b < 0n ? -b : b;
  const halfB = absB / 2n;
  const isExactlyHalf = absRemainder === halfB && absB % 2n === 0n;
  const moreThanHalf = absRemainder > halfB;

  let result = quotient;

  switch (mode) {
    case "CEIL":
      if (!negative && remainder !== 0n) result += 1n;
      break;
    case "FLOOR":
      if (negative && remainder !== 0n) result -= 1n;
      break;
    case "TRUNC":
      break;
    case "HALF_UP":
      if (moreThanHalf || isExactlyHalf) {
        result += negative ? -1n : 1n;
      }
      break;
    case "HALF_DOWN":
      if (moreThanHalf) {
        result += negative ? -1n : 1n;
      }
      break;
    case "HALF_EVEN":
      if (moreThanHalf) {
        result += negative ? -1n : 1n;
      } else if (isExactlyHalf) {
        const absResult = result < 0n ? -result : result;
        if (absResult % 2n !== 0n) {
          result += negative ? -1n : 1n;
        }
      }
      break;
    case "HALF_CEIL":
      if (moreThanHalf || (isExactlyHalf && !negative)) {
        result += 1n;
      }
      break;
    case "HALF_FLOOR":
      if (moreThanHalf) {
        result += negative ? -1n : 1n;
      } else if (isExactlyHalf && negative) {
        result -= 1n;
      }
      break;
  }

  return result as FixedDecimal<N>;
}

/**
 * Integer division of FixedDecimals (result is integer part only).
 */
export function fixedQuot<N extends number>(
  a: FixedDecimal<N>,
  b: FixedDecimal<N>
): FixedDecimal<N> {
  if (b === 0n) {
    throw new RangeError("FixedDecimal division by zero");
  }
  return ((a as bigint) / (b as bigint)) as FixedDecimal<N>;
}

/**
 * Modulo operation on FixedDecimals.
 */
export function fixedMod<N extends number>(
  a: FixedDecimal<N>,
  b: FixedDecimal<N>
): FixedDecimal<N> {
  if (b === 0n) {
    throw new RangeError("FixedDecimal division by zero");
  }
  return ((a as bigint) % (b as bigint)) as FixedDecimal<N>;
}

/**
 * Scale a FixedDecimal by a number (useful for percentages, quantities).
 */
export function fixedScale<N extends number>(
  fd: FixedDecimal<N>,
  multiplier: number,
  scale: N,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): FixedDecimal<N> {
  // Convert multiplier to same-scale fixed decimal and multiply
  const scaledMultiplier = fixed(multiplier, scale, mode);
  return fixedMul(fd, scaledMultiplier, scale, mode);
}

/**
 * Compute the minimum of two FixedDecimals.
 */
export function fixedMin<N extends number>(
  a: FixedDecimal<N>,
  b: FixedDecimal<N>
): FixedDecimal<N> {
  return a < b ? a : b;
}

/**
 * Compute the maximum of two FixedDecimals.
 */
export function fixedMax<N extends number>(
  a: FixedDecimal<N>,
  b: FixedDecimal<N>
): FixedDecimal<N> {
  return a > b ? a : b;
}

/**
 * Clamp a FixedDecimal to a range.
 */
export function fixedClamp<N extends number>(
  fd: FixedDecimal<N>,
  lo: FixedDecimal<N>,
  hi: FixedDecimal<N>
): FixedDecimal<N> {
  return fd < lo ? lo : fd > hi ? hi : fd;
}

/**
 * Create a Numeric typeclass instance for FixedDecimal<N>.
 *
 * Operations automatically round to maintain the fixed scale.
 *
 * @param scale - Number of decimal places
 * @param mode - Rounding mode for multiply/divide (default: HALF_EVEN)
 */
export function fixedNumeric<N extends number>(
  scale: N,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): Numeric<FixedDecimal<N>> {
  return {
    add: (a, b) => fixedAdd(a, b) as FixedDecimal<N> & Op<"+">,
    sub: (a, b) => fixedSub(a, b) as FixedDecimal<N> & Op<"-">,
    mul: (a, b) => fixedMul(a, b, scale, mode) as FixedDecimal<N> & Op<"*">,
    negate: fixedNegate,
    abs: fixedAbs,
    signum: (a) => fixed(fixedSignum(a), scale),
    fromNumber: (n) => fixed(n, scale, mode),
    toNumber: (a) => fixedToNumber(a, scale),
    zero: () => fixedZero(scale),
    one: () => fixedOne(scale),
  };
}

/**
 * Create an Integral typeclass instance for FixedDecimal<N>.
 */
export function fixedIntegral<N extends number>(
  scale: N,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): Integral<FixedDecimal<N>> {
  return {
    div: (a, b) => fixedDiv(a, b, scale, mode) as FixedDecimal<N> & Op<"/">,
    mod: (a, b) => fixedMod(a, b) as FixedDecimal<N> & Op<"%">,
    quot: fixedQuot,
    rem: fixedMod,
    divMod: (a, b) => [fixedQuot(a, b), fixedMod(a, b)],
    toInteger: (a) => a as bigint,
  };
}

/**
 * Create an Eq typeclass instance for FixedDecimal<N>.
 */
export function fixedEq<N extends number>(): Eq<FixedDecimal<N>> {
  return {
    equals: fixedEquals,
  };
}

/**
 * Create an Ord typeclass instance for FixedDecimal<N>.
 * Uses makeOrd to generate all Op<>-annotated comparison methods.
 */
export function fixedOrd<N extends number>(): Ord<FixedDecimal<N>> {
  return makeOrd(fixedCompare);
}

/**
 * Pre-configured instances for common scales.
 */
export const fixedNumeric2 = fixedNumeric(2);
export const fixedNumeric4 = fixedNumeric(4);
export const fixedNumeric6 = fixedNumeric(6);
export const fixedNumeric8 = fixedNumeric(8);

export const fixedIntegral2 = fixedIntegral(2);
export const fixedIntegral4 = fixedIntegral(4);
