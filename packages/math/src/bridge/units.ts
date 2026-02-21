/**
 * Units Bridge
 *
 * Integration between @typesugar/units and @typesugar/math.
 *
 * Note on Numeric: Unit<D> cannot have a proper Numeric instance because:
 * - add/sub require the same dimension D
 * - mul/div change dimensions (MulDimensions, DivDimensions)
 * - Numeric assumes all ops return the same type
 *
 * Instead, we provide conversion helpers between Unit and Rational
 * for cases where you need exact arithmetic on the numeric value.
 */

import type { Unit, Dimensions, DimExp } from "@typesugar/units";
import type { Rational } from "../types/rational.js";
import { rational, toNumber } from "../types/rational.js";

/**
 * Extract the numeric value of a unit as a Rational.
 *
 * Since Unit stores its value as a number, this converts that number
 * to a rational approximation. Use this when you need exact arithmetic
 * on unit values.
 *
 * @example
 * ```typescript
 * const dist = meters(1.5);
 * const r = unitToRational(dist); // 3/2
 * ```
 */
export function unitToRational<
  D extends Dimensions<DimExp, DimExp, DimExp, DimExp, DimExp, DimExp, DimExp>,
>(u: Unit<D>): Rational {
  return rational(BigInt(Math.round(u.value * 1000000)), 1000000n);
}

/**
 * Create a unit from a rational value.
 *
 * Converts the rational to a floating-point number for the unit's value.
 *
 * @param r - The rational number representing the magnitude
 * @param symbol - Display symbol for the unit (e.g., "m", "kg")
 * @returns A new Unit with the given value and symbol
 *
 * @example
 * ```typescript
 * const half = rational(1n, 2n);
 * const halfMeter = rationalToUnit<Length>(half, "m");
 * ```
 */
export function rationalToUnit<
  D extends Dimensions<DimExp, DimExp, DimExp, DimExp, DimExp, DimExp, DimExp>,
>(r: Rational, symbol: string = ""): Unit<D> {
  // Import Unit dynamically to avoid circular deps at module level
  const { Unit } = require("@typesugar/units") as {
    Unit: new (value: number, symbol?: string) => Unit<D>;
  };
  return new Unit(toNumber(r), symbol);
}

/**
 * Convert a unit's value to a rational with a specific denominator bound.
 *
 * This gives more control over precision than the default unitToRational.
 *
 * @param u - The unit to convert
 * @param maxDenominator - Maximum denominator for the rational approximation
 */
export function unitToRationalPrecise<
  D extends Dimensions<DimExp, DimExp, DimExp, DimExp, DimExp, DimExp, DimExp>,
>(u: Unit<D>, maxDenominator: bigint = 1000000n): Rational {
  const { fromNumber } = require("../types/rational.js") as {
    fromNumber: (n: number, max?: bigint) => Rational;
  };
  return fromNumber(u.value, maxDenominator);
}

/**
 * Scale a unit by a rational factor.
 *
 * Useful for exact scaling without floating-point accumulation.
 *
 * @example
 * ```typescript
 * const meter = meters(1);
 * const third = rational(1n, 3n);
 * const thirdMeter = scaleByRational(meter, third);
 * ```
 */
export function scaleByRational<
  D extends Dimensions<DimExp, DimExp, DimExp, DimExp, DimExp, DimExp, DimExp>,
>(u: Unit<D>, r: Rational): Unit<D> {
  return u.scale(toNumber(r));
}
