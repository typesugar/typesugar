/**
 * Conversions - Type conversions between numeric precision types
 *
 * Explicit conversion functions between Rational, BigDecimal, FixedDecimal, and Money.
 * All conversions require explicit scale/rounding parameters to prevent silent precision loss.
 *
 * @example
 * ```typescript
 * import {
 *   rationalToBigDecimal,
 *   bigDecimalToFixed,
 *   fixedToMoney,
 *   moneyToRational,
 * } from "@typesugar/math";
 *
 * const r = rational(1n, 3n);                    // 1/3
 * const bd = rationalToBigDecimal(r, 6);         // 0.333333
 * const fd = bigDecimalToFixed(bd, 2);           // 0.33
 * const m = fixedToMoney(fd, 2, USD);            // $0.33
 * const back = moneyToRational(m, USD);          // 33/100
 * ```
 *
 * @packageDocumentation
 */

import type { Rational } from "./rational.js";
import type { BigDecimal } from "./bigdecimal.js";
import type { FixedDecimal } from "./fixed-decimal.js";
import type { Money } from "./money.js";
import type { CurrencyDef } from "./currencies.js";

import { rational, fromNumber as rationalFromNumber } from "./rational.js";
import { bigDecimal } from "./bigdecimal.js";
import { fixed, fixedRound } from "./fixed-decimal.js";
import { money, moneyFromMajor } from "./money.js";
import { currencyScaleFactor } from "./currencies.js";
import { roundBigInt, roundDiv, type RoundingMode, DEFAULT_ROUNDING_MODE } from "./rounding.js";

// ============================================================================
// Rational Conversions
// ============================================================================

/**
 * Convert Rational to BigDecimal with specified scale.
 *
 * @param r - Rational to convert
 * @param scale - Number of decimal places
 * @param mode - Rounding mode (default HALF_EVEN)
 * @returns BigDecimal approximation
 *
 * @example
 * ```typescript
 * rationalToBigDecimal(rational(1n, 3n), 6);  // 0.333333
 * ```
 */
export function rationalToBigDecimal(
  r: Rational,
  scale: number,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): BigDecimal {
  // unscaled / 10^scale ≈ num/den, rounded once under `mode` (MU-11: this
  // used to truncate).
  return bigDecimal(roundRationalToScale(r, scale, mode), scale);
}

/**
 * Convert a Rational to a FixedDecimal with rounding.
 *
 * @param r - The rational to convert
 * @param scale - Target decimal places
 * @param mode - Rounding mode
 * @returns FixedDecimal approximation
 */
export function rationalToFixed<N extends number>(
  r: Rational,
  scale: N,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): FixedDecimal<N> {
  // Exact: round num·10^scale / den once (MU-5: the old guard-digit version
  // passed an already-over-scaled bigint to `fixed()`, which returns bigints
  // unchanged, so the result was 10^10 too large).
  return roundRationalToScale(r, scale, mode) as FixedDecimal<N>;
}

/**
 * Convert a Rational to Money with rounding.
 *
 * @param r - The rational to convert (in major units)
 * @param currency - Target currency
 * @param mode - Rounding mode
 * @returns Money value
 */
export function rationalToMoney<C extends CurrencyDef>(
  r: Rational,
  currency: C,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): Money<C> {
  // minor units = num · 10^minorUnits / den, rounded under `mode` (MU-11:
  // `mode` was ignored and the division truncated).
  return money(roundRationalToScale(r, currency.minorUnits, mode), currency);
}

/** `round(num · 10^scale / den)` exactly, under `mode`. */
function roundRationalToScale(r: Rational, scale: number, mode: RoundingMode): bigint {
  const n = scale >= 0 ? r.num * 10n ** BigInt(scale) : r.num;
  const d = scale >= 0 ? r.den : r.den * 10n ** BigInt(-scale);
  return roundDiv(n, d, mode);
}

// ============================================================================
// BigDecimal Conversions
// ============================================================================

/**
 * Convert BigDecimal to Rational (exact, no precision loss).
 *
 * @example
 * ```typescript
 * bigDecimalToRational(bigDecimal("0.5"));  // rational(1n, 2n)
 * ```
 */
export function bigDecimalToRational(bd: BigDecimal): Rational {
  // bd = unscaled / 10^scale (a negative scale means trailing zeros)
  if (bd.scale < 0) return rational(bd.unscaled * 10n ** BigInt(-bd.scale), 1n);
  const den = 10n ** BigInt(bd.scale);
  // Simplify by finding GCD
  return rational(bd.unscaled, den);
}

/**
 * Convert BigDecimal to FixedDecimal.
 */
export function bigDecimalToFixed<N extends number>(
  bd: BigDecimal,
  scale: N,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): FixedDecimal<N> {
  // Exact rescale with the requested mode (MU-11: `mode` was mapped to
  // "round" whatever it was).
  return roundBigInt(bd.unscaled, scale, bd.scale, mode) as FixedDecimal<N>;
}

/**
 * Convert a BigDecimal to Money with rounding.
 *
 * @param bd - The BigDecimal to convert (in major units)
 * @param currency - Target currency
 * @param mode - Rounding mode
 * @returns Money value
 */
export function bigDecimalToMoney<C extends CurrencyDef>(
  bd: BigDecimal,
  currency: C,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): Money<C> {
  // Exact rescale; no JS-number round-trip (MU-11).
  return roundBigInt(bd.unscaled, currency.minorUnits, bd.scale, mode) as Money<C>;
}

// ============================================================================
// FixedDecimal Conversions
// ============================================================================

/**
 * Convert FixedDecimal to Rational (exact).
 */
export function fixedToRational<N extends number>(fd: FixedDecimal<N>, scale: N): Rational {
  const den = 10n ** BigInt(scale);
  return rational(fd as bigint, den);
}

/**
 * Convert FixedDecimal to BigDecimal.
 */
export function fixedToBigDecimal<N extends number>(fd: FixedDecimal<N>, scale: N): BigDecimal {
  return bigDecimal(fd as bigint, scale);
}

/**
 * Convert FixedDecimal to Money.
 *
 * Requires that the FixedDecimal scale matches the currency's minor units.
 */
export function fixedToMoney<N extends number, C extends CurrencyDef>(
  fd: FixedDecimal<N>,
  scale: N,
  currency: C,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): Money<C> {
  const targetScale = currency.minorUnits;

  if (scale === targetScale) {
    return fd as bigint as Money<C>;
  }

  // Rescale to currency's minor units
  const rescaled = fixedRound(fd, scale, targetScale as number, mode);
  return rescaled as bigint as Money<C>;
}

// ============================================================================
// Money Conversions
// ============================================================================

/**
 * Convert Money to Rational (exact).
 *
 * @example
 * ```typescript
 * moneyToRational(money(1299, USD), USD);  // rational(1299n, 100n) = 12.99
 * ```
 */
export function moneyToRational<C extends CurrencyDef>(m: Money<C>, currency: C): Rational {
  const den = currencyScaleFactor(currency);
  return rational(m as bigint, den);
}

/**
 * Convert Money to BigDecimal.
 */
export function moneyToBigDecimal<C extends CurrencyDef>(m: Money<C>, currency: C): BigDecimal {
  return bigDecimal(m as bigint, currency.minorUnits);
}

/**
 * Convert Money to FixedDecimal.
 */
export function moneyToFixed<C extends CurrencyDef, N extends number>(
  m: Money<C>,
  currency: C,
  targetScale: N,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): FixedDecimal<N> {
  const sourceScale = currency.minorUnits;

  if (sourceScale === targetScale) {
    return m as bigint as FixedDecimal<N>;
  }

  // Rescale
  return fixedRound(
    m as bigint as FixedDecimal<typeof sourceScale>,
    sourceScale,
    targetScale,
    mode
  );
}

// ============================================================================
// Number Conversions
// ============================================================================

/**
 * Convert a JavaScript number to Rational.
 * Uses continued fraction approximation for clean fractions.
 */
export function numberToRational(n: number, maxDenominator: bigint = 1000000n): Rational {
  return rationalFromNumber(n, maxDenominator);
}

/**
 * Convert a JavaScript number to BigDecimal.
 */
export function numberToBigDecimal(n: number): BigDecimal {
  return bigDecimal(n);
}

/**
 * Convert a JavaScript number to FixedDecimal.
 */
export function numberToFixed<N extends number>(
  n: number,
  scale: N,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): FixedDecimal<N> {
  return fixed(n, scale, mode);
}

/**
 * Convert a JavaScript number to Money.
 */
export function numberToMoney<C extends CurrencyDef>(
  n: number,
  currency: C,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): Money<C> {
  return moneyFromMajor(n, currency, mode);
}
