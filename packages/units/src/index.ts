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
  Length,
  Mass,
  Time,
  Velocity,
  Acceleration,
  Force,
  Energy,
  Power,
  Temperature,
  Pressure,
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
  pascals,
  kilopascals,
  atmospheres,
  DimExp,
  Dimensions,
} from "./types.js";

// Unit constructor map for runtime fallback
const UNIT_CONSTRUCTORS: Record<
  string,
  (v: number) => Unit<Dimensions<DimExp, DimExp, DimExp, DimExp, DimExp, DimExp, DimExp>>
> = {
  m: meters,
  meter: meters,
  meters: meters,
  km: kilometers,
  kilometer: kilometers,
  kilometers: kilometers,
  cm: centimeters,
  centimeter: centimeters,
  centimeters: centimeters,
  mm: millimeters,
  millimeter: millimeters,
  millimeters: millimeters,
  ft: feet,
  foot: feet,
  feet: feet,
  in: inches,
  inch: inches,
  inches: inches,
  mi: miles,
  mile: miles,
  miles: miles,
  kg: kilograms,
  kilogram: kilograms,
  kilograms: kilograms,
  g: grams,
  gram: grams,
  grams: grams,
  mg: milligrams,
  milligram: milligrams,
  milligrams: milligrams,
  lb: pounds,
  lbs: pounds,
  pound: pounds,
  pounds: pounds,
  s: seconds,
  sec: seconds,
  second: seconds,
  seconds: seconds,
  min: minutes,
  minute: minutes,
  minutes: minutes,
  h: hours,
  hr: hours,
  hour: hours,
  hours: hours,
  d: days,
  day: days,
  days: days,
  ms: milliseconds,
  millisecond: milliseconds,
  milliseconds: milliseconds,
  "m/s": metersPerSecond,
  "km/h": kilometersPerHour,
  kph: kilometersPerHour,
  mph: milesPerHour,
  "m/s²": metersPerSecondSquared,
  "m/s^2": metersPerSecondSquared,
  N: newtons,
  newton: newtons,
  newtons: newtons,
  J: joules,
  joule: joules,
  joules: joules,
  kJ: kilojoules,
  kilojoule: kilojoules,
  kilojoules: kilojoules,
  cal: calories,
  calorie: calories,
  calories: calories,
  kcal: kilocalories,
  kilocalorie: kilocalories,
  kilocalories: kilocalories,
  W: watts,
  watt: watts,
  watts: watts,
  kW: kilowatts,
  kilowatt: kilowatts,
  kilowatts: kilowatts,
  K: kelvin,
  kelvin: kelvin,
  "°C": celsius,
  C: celsius,
  celsius: celsius,
  Pa: pascals,
  pascal: pascals,
  pascals: pascals,
  kPa: kilopascals,
  kilopascal: kilopascals,
  kilopascals: kilopascals,
  atm: atmospheres,
  atmosphere: atmospheres,
  atmospheres: atmospheres,
};

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
