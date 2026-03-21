/**
 * @typesugar/units - Type-Safe Physical Units Library
 *
 * A compile-time unit system inspired by boost::units.
 * Provides type-safe arithmetic operations that verify unit compatibility
 * at compile time.
 *
 * @example
 * ```typescript
 * import { meters, seconds, kilograms, units } from "@typesugar/units";
 *
 * const distance = meters(100);
 * const time = seconds(10);
 * const velocity = distance.div(time); // Type: Unit<Velocity>
 *
 * // Compile error: can't add meters and seconds
 * // const invalid = distance.add(time);
 *
 * // Using the units macro:
 * const speed = units`100 km/h`;  // Parsed at compile time
 * ```
 */

// Re-export everything from types
export * from "./types.js";

// Re-export macro
export { unitsMacro, register } from "./macro.js";

// ============================================================================
// Fallback units function for non-macro usage
// ============================================================================

import {
  Unit,
  DimExp,
  Dimensions,
  meters,
  kilometers,
  centimeters,
  millimeters,
  feet,
  inches,
  miles,
  kilograms,
  grams,
  milligrams,
  pounds,
  seconds,
  minutes,
  hours,
  days,
  milliseconds,
  metersPerSecond,
  kilometersPerHour,
  milesPerHour,
  metersPerSecondSquared,
  newtons,
  joules,
  kilojoules,
  calories,
  kilocalories,
  watts,
  kilowatts,
  kelvin,
  celsius,
  fahrenheit,
  hertz,
  kilohertz,
  megahertz,
  gigahertz,
  volts,
  millivolts,
  kilovolts,
  ohms,
  kilohms,
  megohms,
  pascals,
  kilopascals,
  atmospheres,
} from "./types.js";
import { UNIT_ALIASES } from "./unit-aliases.js";

// Map from constructor name to runtime function
const CONSTRUCTORS_BY_NAME: Record<
  string,
  (v: number) => Unit<Dimensions<DimExp, DimExp, DimExp, DimExp, DimExp, DimExp, DimExp>>
> = {
  meters,
  kilometers,
  centimeters,
  millimeters,
  feet,
  inches,
  miles,
  kilograms,
  grams,
  milligrams,
  pounds,
  seconds,
  minutes,
  hours,
  days,
  milliseconds,
  metersPerSecond,
  kilometersPerHour,
  milesPerHour,
  metersPerSecondSquared,
  newtons,
  joules,
  kilojoules,
  calories,
  kilocalories,
  watts,
  kilowatts,
  kelvin,
  celsius,
  fahrenheit,
  hertz,
  kilohertz,
  megahertz,
  gigahertz,
  volts,
  millivolts,
  kilovolts,
  ohms,
  kilohms,
  megohms,
  pascals,
  kilopascals,
  atmospheres,
};

// Build UNIT_CONSTRUCTORS from the shared alias map
const UNIT_CONSTRUCTORS: Record<
  string,
  (v: number) => Unit<Dimensions<DimExp, DimExp, DimExp, DimExp, DimExp, DimExp, DimExp>>
> = {};
for (const [alias, fnName] of Object.entries(UNIT_ALIASES)) {
  UNIT_CONSTRUCTORS[alias] = CONSTRUCTORS_BY_NAME[fnName];
}

/**
 * Tagged template function for units - fallback when macro transform isn't applied.
 *
 * @example
 * ```typescript
 * const distance = units`100 meters`;
 * const speed = units`60 km/h`;
 * ```
 */
export function units(
  strings: TemplateStringsArray
): Unit<Dimensions<DimExp, DimExp, DimExp, DimExp, DimExp, DimExp, DimExp>> {
  const text = strings[0].trim();
  const match = text.match(/^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*(.+)?$/i);

  if (!match) {
    throw new Error(`Invalid unit literal: ${text}`);
  }

  const value = parseFloat(match[1]);
  const unitStr = match[2]?.trim() || "";

  if (!unitStr) {
    // Return dimensionless
    return new Unit(value);
  }

  const constructor = UNIT_CONSTRUCTORS[unitStr];
  if (!constructor) {
    throw new Error(`Unknown unit: ${unitStr}`);
  }

  return constructor(value);
}
