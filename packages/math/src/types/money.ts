/**
 * Money - Type-Safe Currency with Integer Minor Units
 *
 * A branded bigint representing monetary values in their smallest unit (e.g., cents).
 * Type parameter enforces compile-time currency safety — you can't add USD to EUR.
 *
 * @example
 * ```typescript
 * import { money, USD, EUR, moneyFormat, moneyAllocate } from "@typesugar/math";
 *
 * const price = money(1299, USD);     // $12.99 (stored as 1299 cents)
 * const shipping = money(500, USD);   // $5.00
 * const total = price + shipping;     // Works: same currency
 *
 * const euros = money(999, EUR);
 * // price + euros;                   // Type error! Can't mix USD and EUR
 *
 * // Fair allocation (handles remainders correctly)
 * const [a, b, c] = moneyAllocate(total, [1, 1, 1], USD);
 * // a = 600, b = 600, c = 599 (1799 cents split 3 ways)
 * ```
 *
 * @packageDocumentation
 */

import type { Numeric, Ord } from "@typesugar/std";
import { makeOrd } from "@typesugar/std";
import type { Op } from "@typesugar/core";
import type { CurrencyDef } from "./currencies.js";

/**
 * Eq typeclass - equality comparison.
 */
interface Eq<A> {
  equals(a: A, b: A): boolean;
}
import { currencyScaleFactor } from "./currencies.js";
import { roundBigInt, type RoundingMode, DEFAULT_ROUNDING_MODE } from "./rounding.js";

/**
 * Money type branded by currency.
 *
 * Internally stored as bigint minor units (cents, pence, etc.).
 * The __currency phantom type ensures compile-time currency safety.
 *
 * @typeParam C - Currency definition (e.g., typeof USD, typeof EUR)
 *
 * @example
 * ```typescript
 * type USD_Money = Money<typeof USD>;
 * type EUR_Money = Money<typeof EUR>;
 *
 * declare const usd: USD_Money;
 * declare const eur: EUR_Money;
 *
 * usd + usd; // OK
 * usd + eur; // Type error
 * ```
 */
export type Money<C extends CurrencyDef> = bigint & { readonly __currency: C };

/**
 * Create Money from minor units (cents, pence, etc.).
 *
 * @param minorUnits - Amount in smallest currency unit
 * @param currency - Currency definition
 * @returns Branded Money value
 *
 * @example
 * ```typescript
 * money(1299, USD);  // $12.99
 * money(1000, JPY);  // ¥1000 (JPY has 0 minor units)
 * ```
 */
export function money<C extends CurrencyDef>(minorUnits: bigint | number, _currency: C): Money<C> {
  const value = typeof minorUnits === "number" ? BigInt(Math.round(minorUnits)) : minorUnits;
  return value as Money<C>;
}

/**
 * Create Money from a major unit amount (dollars, euros, etc.).
 *
 * @param majorUnits - Amount in major currency unit (e.g., dollars)
 * @param currency - Currency definition
 * @param mode - Rounding mode for fractional amounts
 * @returns Branded Money value
 *
 * @example
 * ```typescript
 * moneyFromMajor(12.99, USD);   // 1299 cents
 * moneyFromMajor(12.995, USD);  // 1300 cents (rounded)
 * ```
 */
export function moneyFromMajor<C extends CurrencyDef>(
  majorUnits: number | string,
  currency: C,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): Money<C> {
  const scaleFactor = currencyScaleFactor(currency);

  if (typeof majorUnits === "string") {
    return moneyFromString(majorUnits, currency, mode);
  }

  if (!Number.isFinite(majorUnits)) {
    throw new RangeError("Money: cannot convert non-finite number");
  }

  // Scale and round
  const scaled = majorUnits * Number(scaleFactor);
  const rounded = roundBigInt(BigInt(Math.trunc(scaled * 1e10)), 0, 10, mode);

  return rounded as Money<C>;
}

/**
 * Parse Money from a string like "12.99" or "1,234.56".
 */
function moneyFromString<C extends CurrencyDef>(
  s: string,
  currency: C,
  mode: RoundingMode
): Money<C> {
  // Remove currency symbols and thousand separators
  s = s.replace(/[^\d.\-]/g, "");
  const num = parseFloat(s);
  if (!Number.isFinite(num)) {
    throw new RangeError(`Money: invalid string "${s}"`);
  }
  return moneyFromMajor(num, currency, mode);
}

/**
 * Get the raw minor units value from Money.
 */
export function moneyMinorUnits<C extends CurrencyDef>(m: Money<C>): bigint {
  return m as bigint;
}

/**
 * Convert Money to major units as a number.
 *
 * @example
 * ```typescript
 * moneyToMajor(money(1299, USD), USD);  // 12.99
 * ```
 */
export function moneyToMajor<C extends CurrencyDef>(m: Money<C>, currency: C): number {
  return Number(m) / Number(currencyScaleFactor(currency));
}

/**
 * Format Money for display using Intl.NumberFormat.
 *
 * @example
 * ```typescript
 * moneyFormat(money(1299, USD), USD);           // "$12.99"
 * moneyFormat(money(1299, USD), USD, "de-DE");  // "12,99 $"
 * ```
 */
export function moneyFormat<C extends CurrencyDef>(
  m: Money<C>,
  currency: C,
  locale?: string,
  options?: Intl.NumberFormatOptions
): string {
  const majorUnits = moneyToMajor(m, currency);
  const opts: Intl.NumberFormatOptions = {
    style: "currency",
    currency: currency.code,
    minimumFractionDigits: currency.minorUnits,
    maximumFractionDigits: currency.minorUnits,
    ...options,
  };
  return new Intl.NumberFormat(locale, opts).format(majorUnits);
}

/**
 * Format Money as a simple string without locale formatting.
 *
 * @example
 * ```typescript
 * moneyToString(money(1299, USD), USD);  // "12.99"
 * moneyToString(money(-500, USD), USD);  // "-5.00"
 * ```
 */
export function moneyToString<C extends CurrencyDef>(m: Money<C>, currency: C): string {
  const scaleFactor = currencyScaleFactor(currency);
  const minorUnits = currency.minorUnits;

  if (minorUnits === 0) {
    return m.toString();
  }

  const negative = m < 0n;
  const abs = negative ? -m : m;
  const absStr = abs.toString().padStart(minorUnits + 1, "0");

  const intPart = absStr.slice(0, absStr.length - minorUnits) || "0";
  const fracPart = absStr.slice(absStr.length - minorUnits);

  return (negative ? "-" : "") + intPart + "." + fracPart;
}

/**
 * Add two Money values of the same currency.
 */
export function moneyAdd<C extends CurrencyDef>(a: Money<C>, b: Money<C>): Money<C> {
  return ((a as bigint) + (b as bigint)) as Money<C>;
}

/**
 * Subtract two Money values of the same currency.
 */
export function moneySub<C extends CurrencyDef>(a: Money<C>, b: Money<C>): Money<C> {
  return ((a as bigint) - (b as bigint)) as Money<C>;
}

/**
 * Negate a Money value.
 */
export function moneyNegate<C extends CurrencyDef>(m: Money<C>): Money<C> {
  return -m as Money<C>;
}

/**
 * Get the absolute value of Money.
 */
export function moneyAbs<C extends CurrencyDef>(m: Money<C>): Money<C> {
  return (m < 0n ? -m : m) as Money<C>;
}

/**
 * Scale Money by a number (useful for quantities, percentages).
 *
 * @example
 * ```typescript
 * const price = money(1000, USD);  // $10.00
 * moneyScale(price, 3, USD);       // $30.00 (quantity 3)
 * moneyScale(price, 0.1, USD);     // $1.00 (10% of price)
 * ```
 */
export function moneyScale<C extends CurrencyDef>(
  m: Money<C>,
  factor: number | bigint,
  _currency: C,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): Money<C> {
  if (typeof factor === "bigint") {
    return ((m as bigint) * factor) as Money<C>;
  }

  // For fractional factors, use high-precision intermediate
  const scaled = Number(m) * factor;
  const rounded = roundBigInt(BigInt(Math.trunc(scaled * 1e10)), 0, 10, mode);
  return rounded as Money<C>;
}

/**
 * Divide Money by a number.
 */
export function moneyDivide<C extends CurrencyDef>(
  m: Money<C>,
  divisor: number | bigint,
  _currency: C,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): Money<C> {
  if (divisor === 0 || divisor === 0n) {
    throw new RangeError("Money division by zero");
  }

  if (typeof divisor === "bigint") {
    // Integer division with rounding
    const quotient = (m as bigint) / divisor;
    const remainder = (m as bigint) % divisor;

    if (remainder === 0n) {
      return quotient as Money<C>;
    }

    const negative = m < 0n !== divisor < 0n;
    const absDivisor = divisor < 0n ? -divisor : divisor;
    const absRemainder = remainder < 0n ? -remainder : remainder;
    const halfDivisor = absDivisor / 2n;

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
        if (absRemainder >= halfDivisor) {
          result += negative ? -1n : 1n;
        }
        break;
      case "HALF_DOWN":
        if (absRemainder > halfDivisor) {
          result += negative ? -1n : 1n;
        }
        break;
      case "HALF_EVEN":
        if (absRemainder > halfDivisor) {
          result += negative ? -1n : 1n;
        } else if (absRemainder === halfDivisor && absDivisor % 2n === 0n) {
          const absResult = result < 0n ? -result : result;
          if (absResult % 2n !== 0n) {
            result += negative ? -1n : 1n;
          }
        }
        break;
      default:
        if (absRemainder >= halfDivisor) {
          result += negative ? -1n : 1n;
        }
    }

    return result as Money<C>;
  }

  // Fractional divisor
  const scaled = Number(m) / divisor;
  const rounded = roundBigInt(BigInt(Math.trunc(scaled * 1e10)), 0, 10, mode);
  return rounded as Money<C>;
}

/**
 * Compare two Money values of the same currency.
 */
export function moneyCompare<C extends CurrencyDef>(a: Money<C>, b: Money<C>): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Check if two Money values are equal.
 */
export function moneyEquals<C extends CurrencyDef>(a: Money<C>, b: Money<C>): boolean {
  return a === b;
}

/**
 * Check if Money is zero.
 */
export function moneyIsZero<C extends CurrencyDef>(m: Money<C>): boolean {
  return m === 0n;
}

/**
 * Check if Money is positive.
 */
export function moneyIsPositive<C extends CurrencyDef>(m: Money<C>): boolean {
  return m > 0n;
}

/**
 * Check if Money is negative.
 */
export function moneyIsNegative<C extends CurrencyDef>(m: Money<C>): boolean {
  return m < 0n;
}

/**
 * Get the minimum of two Money values.
 */
export function moneyMin<C extends CurrencyDef>(a: Money<C>, b: Money<C>): Money<C> {
  return a < b ? a : b;
}

/**
 * Get the maximum of two Money values.
 */
export function moneyMax<C extends CurrencyDef>(a: Money<C>, b: Money<C>): Money<C> {
  return a > b ? a : b;
}

/**
 * Allocate Money fairly according to ratios (Foemmel's conundrum).
 *
 * This handles the problem of splitting money that can't be divided evenly.
 * The remainder is distributed one unit at a time to the first portions.
 *
 * @param m - Money to allocate
 * @param ratios - Array of ratio weights
 * @param currency - Currency definition
 * @returns Array of Money portions that sum exactly to the input
 *
 * @example
 * ```typescript
 * // Split $10.00 three ways
 * moneyAllocate(money(1000, USD), [1, 1, 1], USD);
 * // Returns [334, 333, 333] (cents) — first person gets the extra cent
 *
 * // Split $100.00 as 50/30/20
 * moneyAllocate(money(10000, USD), [50, 30, 20], USD);
 * // Returns [5000, 3000, 2000] (cents)
 *
 * // Split $10.01 two ways
 * moneyAllocate(money(1001, USD), [1, 1], USD);
 * // Returns [501, 500] (cents)
 * ```
 */
export function moneyAllocate<C extends CurrencyDef>(
  m: Money<C>,
  ratios: readonly number[],
  _currency: C
): Money<C>[] {
  if (ratios.length === 0) {
    return [];
  }

  const total = ratios.reduce((sum, r) => sum + r, 0);
  if (total === 0) {
    throw new RangeError("Money.allocate: ratios sum to zero");
  }

  const amount = m as bigint;
  const results: bigint[] = [];
  let allocated = 0n;

  // First pass: allocate proportionally (truncated)
  for (const ratio of ratios) {
    const portion = (amount * BigInt(ratio)) / BigInt(total);
    results.push(portion);
    allocated += portion;
  }

  // Second pass: distribute remainder one unit at a time
  let remainder = amount - allocated;
  const unit = amount >= 0n ? 1n : -1n;

  for (let i = 0; remainder !== 0n && i < results.length; i++) {
    results[i] += unit;
    remainder -= unit;
  }

  return results as Money<C>[];
}

/**
 * Allocate Money into n equal parts.
 *
 * @example
 * ```typescript
 * moneySplit(money(1000, USD), 3, USD);
 * // Returns [334, 333, 333] (cents)
 * ```
 */
export function moneySplit<C extends CurrencyDef>(m: Money<C>, n: number, currency: C): Money<C>[] {
  if (n <= 0 || !Number.isInteger(n)) {
    throw new RangeError("Money.split: n must be a positive integer");
  }
  const ratios = Array(n).fill(1);
  return moneyAllocate(m, ratios, currency);
}

/**
 * Convert Money from one currency to another using an exchange rate.
 *
 * @param m - Source money
 * @param rate - Exchange rate (target per source, e.g., 0.85 EUR per USD)
 * @param fromCurrency - Source currency
 * @param toCurrency - Target currency
 * @param mode - Rounding mode
 * @returns Money in the target currency
 *
 * @example
 * ```typescript
 * const usd = money(1000, USD);  // $10.00
 * const eur = moneyConvert(usd, 0.85, USD, EUR);  // €8.50
 * ```
 */
export function moneyConvert<From extends CurrencyDef, To extends CurrencyDef>(
  m: Money<From>,
  rate: number,
  fromCurrency: From,
  toCurrency: To,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): Money<To> {
  // Convert to major units, apply rate, convert back to minor units
  const fromMajor = moneyToMajor(m, fromCurrency);
  const toMajor = fromMajor * rate;
  return moneyFromMajor(toMajor, toCurrency, mode);
}

/**
 * Create a Numeric typeclass instance for Money<C>.
 *
 * Note: Multiplication is not meaningful for Money (dollars × dollars = ?).
 * Use moneyScale for scaling by quantities.
 *
 * The mul operation is included for typeclass compatibility but represents
 * scaling by the minor unit value (treating the right operand as a scalar).
 */
export function moneyNumeric<C extends CurrencyDef>(currency: C): Numeric<Money<C>> {
  return {
    add: (a, b) => moneyAdd(a, b) as Money<C> & Op<"+">,
    sub: (a, b) => moneySub(a, b) as Money<C> & Op<"-">,
    mul: (a, b) => {
      return (((a as bigint) * (b as bigint)) / currencyScaleFactor(currency)) as Money<C> &
        Op<"*">;
    },
    div: (a, b) => {
      if ((b as bigint) === 0n) throw new RangeError("Money division by zero");
      return (((a as bigint) * currencyScaleFactor(currency)) / (b as bigint)) as Money<C> &
        Op<"/">;
    },
    pow: (_a, _b) => {
      throw new RangeError("Exponentiation is not meaningful for monetary values");
    },
    negate: moneyNegate,
    abs: moneyAbs,
    signum: (m) => money(m < 0n ? -1n : m > 0n ? 1n : 0n, currency),
    fromNumber: (n) => moneyFromMajor(n, currency),
    toNumber: (m) => moneyToMajor(m, currency),
    zero: () => money(0n, currency),
    one: () => money(currencyScaleFactor(currency), currency),
  };
}

/**
 * Create an Eq typeclass instance for Money<C>.
 */
export function moneyEq<C extends CurrencyDef>(): Eq<Money<C>> {
  return {
    equals: moneyEquals,
  };
}

/**
 * Create an Ord typeclass instance for Money<C>.
 * Uses makeOrd to generate all Op<>-annotated comparison methods.
 */
export function moneyOrd<C extends CurrencyDef>(): Ord<Money<C>> {
  return makeOrd(moneyCompare);
}

/**
 * Sum an array of Money values.
 */
export function moneySum<C extends CurrencyDef>(
  values: readonly Money<C>[],
  _currency: C
): Money<C> {
  let total = 0n;
  for (const v of values) {
    total += v as bigint;
  }
  return total as Money<C>;
}

/**
 * Create Money representing zero in a currency.
 */
export function moneyZero<C extends CurrencyDef>(currency: C): Money<C> {
  return money(0n, currency);
}

/**
 * Calculate percentage of a Money value.
 *
 * @example
 * ```typescript
 * const price = money(10000, USD);  // $100.00
 * moneyPercentage(price, 15, USD);  // $15.00 (15%)
 * ```
 */
export function moneyPercentage<C extends CurrencyDef>(
  m: Money<C>,
  percent: number,
  currency: C,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): Money<C> {
  return moneyScale(m, percent / 100, currency, mode);
}

/**
 * Add a percentage to a Money value (useful for tax).
 *
 * @example
 * ```typescript
 * const price = money(10000, USD);     // $100.00
 * moneyAddPercentage(price, 8.25, USD); // $108.25 (price + 8.25% tax)
 * ```
 */
export function moneyAddPercentage<C extends CurrencyDef>(
  m: Money<C>,
  percent: number,
  currency: C,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): Money<C> {
  const addition = moneyPercentage(m, percent, currency, mode);
  return moneyAdd(m, addition);
}
