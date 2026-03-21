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
import { UNIT_ALIASES } from "./unit-aliases.js";

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
        const fnName = UNIT_ALIASES[unitText];

        if (!fnName) {
          ctx.reportError(callExpr, `Unknown unit: ${unitText}`);
          return callExpr;
        }

        // Generate: unitFn(value)
        return factory.createCallExpression(factory.createIdentifier(fnName), undefined, [
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

  const fnName = UNIT_ALIASES[unit];

  if (!fnName) {
    ctx.reportError(errorNode, `Unknown unit: ${unit}`);
    return errorNode as ts.Expression;
  }

  return factory.createCallExpression(factory.createIdentifier(fnName), undefined, [
    factory.createNumericLiteral(value),
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
