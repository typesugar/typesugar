/**
 * Static Assertion and Compile-Time Diagnostic Macros
 *
 * Provides compile-time assertions and diagnostic emission:
 * - `staticAssert(condition, message)` — fails compilation if condition is false
 * - `compileError(message)` — unconditionally emits a compile error
 * - `compileWarning(message)` — unconditionally emits a compile warning
 *
 * Inspired by: Rust's `compile_error!`, `static_assert!`, C++ `static_assert`
 *
 * @example
 * ```typescript
 * import { staticAssert, compileError, compileWarning } from "typesugar";
 *
 * staticAssert(comptime(() => MAX_SIZE <= 1024), "MAX_SIZE must be <= 1024");
 *
 * compileWarning("This module is deprecated, use newModule instead");
 *
 * // In unreachable code:
 * compileError("This code path should never be reached");
 * ```
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry } from "@typesugar/core";
import { MacroContext } from "@typesugar/core";
import { MacroContextImpl } from "@typesugar/core";

// =============================================================================
// staticAssert — Compile-time assertion
// =============================================================================

export const staticAssertMacro = defineExpressionMacro({
  name: "staticAssert",
  module: "typemacro",
  description:
    "Assert a condition at compile time. Fails compilation with a message if the condition is false.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length < 1 || args.length > 2) {
      ctx.reportError(
        callExpr,
        "staticAssert expects 1-2 arguments: staticAssert(condition, message?)"
      );
      return ctx.factory.createIdentifier("undefined");
    }

    const conditionArg = args[0];
    const messageArg = args[1];

    // Extract the message string (if provided)
    let message = "Static assertion failed";
    if (messageArg) {
      if (ts.isStringLiteral(messageArg)) {
        message = messageArg.text;
      } else if (ts.isNoSubstitutionTemplateLiteral(messageArg)) {
        message = messageArg.text;
      } else {
        // Try to evaluate the message at compile time
        const msgResult = ctx.evaluate(messageArg);
        if (msgResult.kind === "string") {
          message = msgResult.value;
        }
      }
    }

    // Evaluate the condition at compile time
    const result = ctx.evaluate(conditionArg);

    if (result.kind === "error") {
      // Can't evaluate at compile time — try checking if it's a boolean literal
      if (conditionArg.kind === ts.SyntaxKind.FalseKeyword) {
        ctx.reportError(callExpr, `staticAssert: ${message}`);
      } else if (conditionArg.kind === ts.SyntaxKind.TrueKeyword) {
        // Assertion passes — remove the call
      } else {
        ctx.reportError(
          callExpr,
          `staticAssert: Cannot evaluate condition at compile time. ` +
            `The condition must be a compile-time constant. ` +
            `Original message: ${message}`
        );
      }
      return ctx.factory.createIdentifier("undefined");
    }

    // Convert to boolean
    const boolValue = comptimeToBoolean(result);

    if (boolValue === false) {
      ctx.reportError(callExpr, `staticAssert: ${message}`);
    } else if (boolValue === null) {
      ctx.reportError(
        callExpr,
        `staticAssert: Cannot convert ${result.kind} to boolean for assertion. ` +
          `Original message: ${message}`
      );
    }

    // Assertion passes (or error reported) — remove the call entirely
    return ctx.factory.createIdentifier("undefined");
  },
});

// =============================================================================
// compileError — Unconditional compile-time error
// =============================================================================

export const compileErrorMacro = defineExpressionMacro({
  name: "compileError",
  module: "typemacro",
  description:
    "Unconditionally emit a compile-time error. Useful for marking unreachable code or deprecated APIs.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length !== 1) {
      ctx.reportError(callExpr, "compileError expects exactly one argument: compileError(message)");
      return ctx.factory.createIdentifier("undefined");
    }

    const message = extractStringArg(ctx, args[0], "compileError");
    ctx.reportError(callExpr, message);

    return ctx.factory.createIdentifier("undefined");
  },
});

// =============================================================================
// compileWarning — Unconditional compile-time warning
// =============================================================================

export const compileWarningMacro = defineExpressionMacro({
  name: "compileWarning",
  module: "typemacro",
  description:
    "Unconditionally emit a compile-time warning. Useful for deprecation notices or performance hints.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length !== 1) {
      ctx.reportError(
        callExpr,
        "compileWarning expects exactly one argument: compileWarning(message)"
      );
      return ctx.factory.createIdentifier("undefined");
    }

    const message = extractStringArg(ctx, args[0], "compileWarning");
    ctx.reportWarning(callExpr, message);

    // Remove the call — warnings don't produce runtime code
    return ctx.factory.createIdentifier("undefined");
  },
});

// =============================================================================
// Helpers
// =============================================================================

/**
 * Extract a string from a macro argument, supporting string literals
 * and compile-time evaluation.
 */
function extractStringArg(ctx: MacroContext, arg: ts.Expression, macroName: string): string {
  if (ts.isStringLiteral(arg)) {
    return arg.text;
  }

  if (ts.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.text;
  }

  // Try compile-time evaluation
  const result = ctx.evaluate(arg);
  if (result.kind === "string") {
    return result.value;
  }

  return `[${macroName}: could not evaluate message at compile time]`;
}

/**
 * Convert a ComptimeValue to a boolean (mirrors context.ts logic).
 */
function comptimeToBoolean(value: import("../core/types.js").ComptimeValue): boolean | null {
  switch (value.kind) {
    case "boolean":
      return value.value;
    case "number":
      return value.value !== 0;
    case "string":
      return value.value !== "";
    case "null":
    case "undefined":
      return false;
    case "array":
    case "object":
    case "function":
      return true;
    default:
      return null;
  }
}

// =============================================================================
// Register macros
// =============================================================================

globalRegistry.register(staticAssertMacro);
globalRegistry.register(compileErrorMacro);
globalRegistry.register(compileWarningMacro);
