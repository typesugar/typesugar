/**
 * Rounding - Rounding modes and utilities for fixed-precision arithmetic
 *
 * Provides comprehensive rounding support for financial and scientific calculations.
 *
 * @example
 * ```typescript
 * import { RoundingMode, roundBigInt } from "@typesugar/math";
 *
 * // Round 250 (representing 2.50) to 1 decimal place
 * roundBigInt(250n, 1, 2, "HALF_EVEN"); // 200n (2.0)
 * roundBigInt(350n, 1, 2, "HALF_EVEN"); // 400n (4.0 - round to even)
 * ```
 */

/**
 * Standard rounding modes for decimal arithmetic.
 *
 * | Mode | Description | Example (→ integer) |
 * |------|-------------|---------------------|
 * | HALF_UP | Round away from zero at 0.5 | 2.5→3, -2.5→-3 |
 * | HALF_DOWN | Round toward zero at 0.5 | 2.5→2, -2.5→-2 |
 * | HALF_EVEN | Round to nearest even at 0.5 (banker's rounding) | 2.5→2, 3.5→4 |
 * | CEIL | Round toward +∞ | 2.1→3, -2.1→-2 |
 * | FLOOR | Round toward -∞ | 2.9→2, -2.9→-3 |
 * | TRUNC | Round toward zero | 2.9→2, -2.9→-2 |
 * | HALF_CEIL | Round toward +∞ at 0.5 | 2.5→3, -2.5→-2 |
 * | HALF_FLOOR | Round toward -∞ at 0.5 | 2.5→2, -2.5→-3 |
 */
export type RoundingMode =
  | "HALF_UP"
  | "HALF_DOWN"
  | "HALF_EVEN"
  | "CEIL"
  | "FLOOR"
  | "TRUNC"
  | "HALF_CEIL"
  | "HALF_FLOOR";

/**
 * Default rounding mode: banker's rounding (HALF_EVEN).
 * This minimizes cumulative rounding error over many operations.
 */
export const DEFAULT_ROUNDING_MODE: RoundingMode = "HALF_EVEN";

/**
 * Round a bigint value from one scale to another.
 *
 * @param value - The unscaled bigint value
 * @param toScale - Target number of decimal places
 * @param fromScale - Current number of decimal places
 * @param mode - Rounding mode to apply
 * @returns Rounded bigint at the target scale
 *
 * @example
 * ```typescript
 * // 12345 at scale 3 = 12.345, round to scale 2 = 12.35
 * roundBigInt(12345n, 2, 3, "HALF_UP"); // 1235n (12.35)
 * ```
 */
export function roundBigInt(
  value: bigint,
  toScale: number,
  fromScale: number,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): bigint {
  if (toScale >= fromScale) {
    // No rounding needed, possibly scaling up
    const scaleDiff = toScale - fromScale;
    return scaleDiff > 0 ? value * 10n ** BigInt(scaleDiff) : value;
  }
  return roundDiv(value, 10n ** BigInt(fromScale - toScale), mode);
}

/**
 * Round the exact rational `numerator / divisor` to an integer under `mode`.
 *
 * This is the single rounding primitive behind `roundBigInt`, `fixedDiv`,
 * `moneyDivide` and the exact conversions. It works for any non-zero divisor
 * (odd, negative, not a power of ten): the tie test compares `2·|remainder|`
 * with `|divisor|`, so there is no floored `divisor / 2` to get wrong (MU-8),
 * and every mode moves the truncated quotient in the direction the mode
 * requires for the sign of the true quotient (MU-4: HALF_CEIL used to add +1
 * to negative values with more than half a unit of remainder).
 *
 * @throws RangeError if `divisor` is zero
 */
export function roundDiv(
  numerator: bigint,
  divisor: bigint,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): bigint {
  if (divisor === 0n) {
    throw new RangeError("Division by zero");
  }
  if (divisor < 0n) {
    numerator = -numerator;
    divisor = -divisor;
  }

  let quotient = numerator / divisor; // truncated toward zero
  const remainder = numerator % divisor; // same sign as numerator
  if (remainder === 0n) {
    return quotient;
  }

  // The true quotient lies strictly between `quotient` and `quotient + away`.
  const negative = numerator < 0n;
  const away = negative ? -1n : 1n;
  const twiceRem = 2n * (remainder < 0n ? -remainder : remainder);
  const half = twiceRem === divisor ? 0 : twiceRem > divisor ? 1 : -1; // vs. 0.5

  switch (mode) {
    case "CEIL":
      if (!negative) quotient += 1n;
      break;
    case "FLOOR":
      if (negative) quotient -= 1n;
      break;
    case "TRUNC":
      break;
    case "HALF_UP":
      if (half >= 0) quotient += away;
      break;
    case "HALF_DOWN":
      if (half > 0) quotient += away;
      break;
    case "HALF_EVEN":
      if (half > 0 || (half === 0 && quotient % 2n !== 0n)) quotient += away;
      break;
    case "HALF_CEIL":
      if (half > 0) quotient += away;
      else if (half === 0 && !negative) quotient += 1n;
      break;
    case "HALF_FLOOR":
      if (half > 0) quotient += away;
      else if (half === 0 && negative) quotient -= 1n;
      break;
  }

  return quotient;
}

/**
 * Round a number to a specified number of decimal places.
 *
 * @param value - The number to round
 * @param places - Number of decimal places
 * @param mode - Rounding mode to apply
 * @returns Rounded number
 *
 * @example
 * ```typescript
 * roundNumber(2.555, 2, "HALF_UP");  // 2.56
 * roundNumber(2.555, 2, "HALF_EVEN"); // 2.56 (5 is odd, round up)
 * roundNumber(2.545, 2, "HALF_EVEN"); // 2.54 (4 is even, round down)
 * ```
 */
export function roundNumber(
  value: number,
  places: number,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE
): number {
  if (!Number.isFinite(value)) {
    return value;
  }

  const factor = Math.pow(10, places);
  const scaled = value * factor;

  switch (mode) {
    case "CEIL":
      return Math.ceil(scaled) / factor;

    case "FLOOR":
      return Math.floor(scaled) / factor;

    case "TRUNC":
      return Math.trunc(scaled) / factor;

    case "HALF_UP": {
      // Math.round rounds away from zero for positive, but we need consistency
      const sign = value < 0 ? -1 : 1;
      return (sign * Math.round(Math.abs(scaled))) / factor;
    }

    case "HALF_DOWN": {
      const intPart = Math.trunc(scaled);
      const fracPart = Math.abs(scaled - intPart);
      if (fracPart <= 0.5) {
        return intPart / factor;
      }
      return (intPart + (scaled > 0 ? 1 : -1)) / factor;
    }

    case "HALF_EVEN": {
      const intPart = Math.trunc(scaled);
      const fracPart = Math.abs(scaled - intPart);
      if (fracPart < 0.5) {
        return intPart / factor;
      }
      if (fracPart > 0.5) {
        return (intPart + (scaled > 0 ? 1 : -1)) / factor;
      }
      // Exactly 0.5: round to even
      const absInt = Math.abs(intPart);
      if (absInt % 2 === 0) {
        return intPart / factor;
      }
      return (intPart + (scaled > 0 ? 1 : -1)) / factor;
    }

    case "HALF_CEIL": {
      const intPart = Math.trunc(scaled);
      const fracPart = scaled - intPart;
      if (fracPart >= 0.5) {
        return (intPart + 1) / factor;
      }
      // More than half below: round down (toward -∞). Exactly -0.5 rounds
      // toward +∞, i.e. stays at the truncated value (MU-4).
      if (fracPart < -0.5) {
        return (intPart - 1) / factor;
      }
      return intPart / factor;
    }

    case "HALF_FLOOR": {
      const intPart = Math.trunc(scaled);
      const fracPart = scaled - intPart;
      if (fracPart <= -0.5) {
        return (intPart - 1) / factor;
      }
      if (fracPart > 0.5) {
        return (intPart + 1) / factor;
      }
      return intPart / factor;
    }
  }
}

/**
 * Check if a rounding mode is valid.
 */
export function isValidRoundingMode(mode: string): mode is RoundingMode {
  return [
    "HALF_UP",
    "HALF_DOWN",
    "HALF_EVEN",
    "CEIL",
    "FLOOR",
    "TRUNC",
    "HALF_CEIL",
    "HALF_FLOOR",
  ].includes(mode);
}
