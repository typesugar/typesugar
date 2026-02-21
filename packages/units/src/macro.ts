/**
 * Units Macro - Parse unit literals at compile time
 *
 * Usage:
 *   const distance = units`5 meters`;
 *   const speed = units`100 km/h`;
 *   const force = units`9.8 N`;
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry, MacroContext } from "@typesugar/core";

// Map of unit strings to constructor function names
const UNIT_MAP: Record<string, { fn: string; factor: number }> = {
  // Length
  m: { fn: "meters", factor: 1 },
  meter: { fn: "meters", factor: 1 },
  meters: { fn: "meters", factor: 1 },
  km: { fn: "kilometers", factor: 1 },
  kilometer: { fn: "kilometers", factor: 1 },
  kilometers: { fn: "kilometers", factor: 1 },
  cm: { fn: "centimeters", factor: 1 },
  centimeter: { fn: "centimeters", factor: 1 },
  centimeters: { fn: "centimeters", factor: 1 },
  mm: { fn: "millimeters", factor: 1 },
  millimeter: { fn: "millimeters", factor: 1 },
  millimeters: { fn: "millimeters", factor: 1 },
  ft: { fn: "feet", factor: 1 },
  foot: { fn: "feet", factor: 1 },
  feet: { fn: "feet", factor: 1 },
  in: { fn: "inches", factor: 1 },
  inch: { fn: "inches", factor: 1 },
  inches: { fn: "inches", factor: 1 },
  mi: { fn: "miles", factor: 1 },
  mile: { fn: "miles", factor: 1 },
  miles: { fn: "miles", factor: 1 },

  // Mass
  kg: { fn: "kilograms", factor: 1 },
  kilogram: { fn: "kilograms", factor: 1 },
  kilograms: { fn: "kilograms", factor: 1 },
  g: { fn: "grams", factor: 1 },
  gram: { fn: "grams", factor: 1 },
  grams: { fn: "grams", factor: 1 },
  mg: { fn: "milligrams", factor: 1 },
  milligram: { fn: "milligrams", factor: 1 },
  milligrams: { fn: "milligrams", factor: 1 },
  lb: { fn: "pounds", factor: 1 },
  lbs: { fn: "pounds", factor: 1 },
  pound: { fn: "pounds", factor: 1 },
  pounds: { fn: "pounds", factor: 1 },

  // Time
  s: { fn: "seconds", factor: 1 },
  sec: { fn: "seconds", factor: 1 },
  second: { fn: "seconds", factor: 1 },
  seconds: { fn: "seconds", factor: 1 },
  min: { fn: "minutes", factor: 1 },
  minute: { fn: "minutes", factor: 1 },
  minutes: { fn: "minutes", factor: 1 },
  h: { fn: "hours", factor: 1 },
  hr: { fn: "hours", factor: 1 },
  hour: { fn: "hours", factor: 1 },
  hours: { fn: "hours", factor: 1 },
  d: { fn: "days", factor: 1 },
  day: { fn: "days", factor: 1 },
  days: { fn: "days", factor: 1 },
  ms: { fn: "milliseconds", factor: 1 },
  millisecond: { fn: "milliseconds", factor: 1 },
  milliseconds: { fn: "milliseconds", factor: 1 },

  // Velocity
  "m/s": { fn: "metersPerSecond", factor: 1 },
  "km/h": { fn: "kilometersPerHour", factor: 1 },
  kph: { fn: "kilometersPerHour", factor: 1 },
  mph: { fn: "milesPerHour", factor: 1 },

  // Acceleration
  "m/s²": { fn: "metersPerSecondSquared", factor: 1 },
  "m/s^2": { fn: "metersPerSecondSquared", factor: 1 },

  // Force
  N: { fn: "newtons", factor: 1 },
  newton: { fn: "newtons", factor: 1 },
  newtons: { fn: "newtons", factor: 1 },

  // Energy
  J: { fn: "joules", factor: 1 },
  joule: { fn: "joules", factor: 1 },
  joules: { fn: "joules", factor: 1 },
  kJ: { fn: "kilojoules", factor: 1 },
  kilojoule: { fn: "kilojoules", factor: 1 },
  kilojoules: { fn: "kilojoules", factor: 1 },
  cal: { fn: "calories", factor: 1 },
  calorie: { fn: "calories", factor: 1 },
  calories: { fn: "calories", factor: 1 },
  kcal: { fn: "kilocalories", factor: 1 },
  kilocalorie: { fn: "kilocalories", factor: 1 },
  kilocalories: { fn: "kilocalories", factor: 1 },

  // Power
  W: { fn: "watts", factor: 1 },
  watt: { fn: "watts", factor: 1 },
  watts: { fn: "watts", factor: 1 },
  kW: { fn: "kilowatts", factor: 1 },
  kilowatt: { fn: "kilowatts", factor: 1 },
  kilowatts: { fn: "kilowatts", factor: 1 },

  // Temperature
  K: { fn: "kelvin", factor: 1 },
  kelvin: { fn: "kelvin", factor: 1 },
  "°C": { fn: "celsius", factor: 1 },
  C: { fn: "celsius", factor: 1 },
  celsius: { fn: "celsius", factor: 1 },

  // Pressure
  Pa: { fn: "pascals", factor: 1 },
  pascal: { fn: "pascals", factor: 1 },
  pascals: { fn: "pascals", factor: 1 },
  kPa: { fn: "kilopascals", factor: 1 },
  kilopascal: { fn: "kilopascals", factor: 1 },
  kilopascals: { fn: "kilopascals", factor: 1 },
  atm: { fn: "atmospheres", factor: 1 },
  atmosphere: { fn: "atmospheres", factor: 1 },
  atmospheres: { fn: "atmospheres", factor: 1 },
};

/**
 * Parse a unit literal string like "5 meters" or "100 km/h"
 */
function parseUnitLiteral(text: string): { value: number; unit: string } | null {
  const trimmed = text.trim();

  // Try to match: number followed by optional whitespace and unit
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*(.+)?$/i);

  if (!match) {
    return null;
  }

  const value = parseFloat(match[1]);
  const unit = match[2]?.trim() || "";

  return { value, unit };
}

/**
 * Units tagged template macro
 *
 * units`5 meters` => meters(5)
 * units`100 km/h` => kilometersPerHour(100)
 */
export const unitsMacro = defineExpressionMacro({
  name: "units",
  description: "Parse unit literals at compile time",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const factory = ctx.factory;

    // Handle tagged template literal
    if (args.length === 1 && ts.isTemplateLiteral(args[0])) {
      const template = args[0];

      // Simple case: no substitutions
      if (ts.isNoSubstitutionTemplateLiteral(template)) {
        return parseAndCreateUnit(ctx, template.text, callExpr);
      }

      // Template with substitutions - we need to handle this differently
      // For now, error on complex templates
      ctx.reportError(callExpr, "units template literals with substitutions are not yet supported");
      return callExpr;
    }

    // Handle direct string argument: units("5 meters")
    if (args.length === 1 && ts.isStringLiteral(args[0])) {
      return parseAndCreateUnit(ctx, args[0].text, callExpr);
    }

    // Handle number + unit string: units(5, "meters")
    if (args.length === 2) {
      const valueArg = args[0];
      const unitArg = args[1];

      if (ts.isStringLiteral(unitArg)) {
        const unitText = unitArg.text.trim();
        const unitInfo = UNIT_MAP[unitText];

        if (!unitInfo) {
          ctx.reportError(callExpr, `Unknown unit: ${unitText}`);
          return callExpr;
        }

        // Generate: unitFn(value * factor)
        if (ts.isNumericLiteral(valueArg)) {
          const value = parseFloat(valueArg.text) * unitInfo.factor;
          return factory.createCallExpression(factory.createIdentifier(unitInfo.fn), undefined, [
            factory.createNumericLiteral(value),
          ]);
        }

        // If value isn't a literal, generate: unitFn(value)
        return factory.createCallExpression(factory.createIdentifier(unitInfo.fn), undefined, [
          valueArg,
        ]);
      }
    }

    ctx.reportError(
      callExpr,
      "Invalid units() call - expected a string literal or tagged template"
    );
    return callExpr;
  },
});

/**
 * Helper to parse a unit string and create the appropriate function call
 */
function parseAndCreateUnit(ctx: MacroContext, text: string, errorNode: ts.Node): ts.Expression {
  const factory = ctx.factory;
  const parsed = parseUnitLiteral(text);

  if (!parsed) {
    ctx.reportError(errorNode, `Invalid unit literal: ${text}`);
    return errorNode as ts.Expression;
  }

  const { value, unit } = parsed;

  // If no unit specified, just return the number
  if (!unit) {
    return factory.createNumericLiteral(value);
  }

  const unitInfo = UNIT_MAP[unit];

  if (!unitInfo) {
    ctx.reportError(errorNode, `Unknown unit: ${unit}`);
    return errorNode as ts.Expression;
  }

  const finalValue = value * unitInfo.factor;

  return factory.createCallExpression(factory.createIdentifier(unitInfo.fn), undefined, [
    factory.createNumericLiteral(finalValue),
  ]);
}

// ============================================================================
// Register
// ============================================================================

export function register(): void {
  globalRegistry.register(unitsMacro);
}

// Auto-register
register();
