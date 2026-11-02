/**
 * Runtime Safety Primitives
 *
 * Fundamental runtime safety utilities that any package might use.
 * These are low-level primitives for asserting invariants, marking
 * unreachable code paths, and conditionally running debug code.
 *
 * - `invariant(condition, message)` — Runtime assertion
 * - `unreachable(value?)` — Mark impossible code paths
 * - `debugOnly(fn)` — Code meant for development only
 *
 * NOT STRIPPED IN PRODUCTION (1.0): there is no production flag yet.
 * `invariant` always compiles to a check and `debugOnly(fn)` always compiles
 * to `fn()` — in every build. Don't put work you can't afford in production
 * inside them (deep review core #54).
 *
 * @example
 * ```typescript
 * // Invariant — fails fast if condition is false
 * function divide(a: number, b: number): number {
 *   invariant(b !== 0, "Division by zero");
 *   return a / b;
 * }
 *
 * // Unreachable — for exhaustiveness checking
 * type Shape = { kind: "circle" } | { kind: "square" };
 * function area(shape: Shape): number {
 *   switch (shape.kind) {
 *     case "circle": return Math.PI;
 *     case "square": return 1;
 *     default: unreachable(shape); // Type error if Shape is extended
 *   }
 * }
 *
 * // debugOnly — intended to be dev-only; NOT yet stripped, runs in every build
 * debugOnly(() => {
 *   console.log("Internal state:", state);
 *   validateDeepInvariants(state);
 * });
 * ```
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry, MacroContext } from "./index.js";

// ============================================================================
// Runtime API
// ============================================================================

/**
 * Runtime invariant check. Always runs: there is no production stripping yet.
 *
 * @param condition - The condition that must be true
 * @param message - Error message if the invariant is violated
 * @throws Error if condition is false
 */
export function invariant(condition: boolean, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message ?? "Invariant violation");
  }
}

/**
 * Mark a code path as unreachable. Useful for exhaustiveness checking.
 * At runtime, throws if somehow reached.
 *
 * @param _value - A value of type `never` (for type-level exhaustiveness)
 * @throws Error always (this function should never be called)
 */
export function unreachable(_value?: never): never {
  throw new Error("Unreachable code reached");
}

/**
 * Code intended to run only in development. NOT erased yet: the macro
 * expands `debugOnly(fn)` to `fn()` and the runtime function calls `fn`, in
 * every build, because there is no production flag yet.
 *
 * @param fn - A function to execute in development only
 */
export function debugOnly(fn: () => void): void {
  fn();
}

// ============================================================================
// Macros
// ============================================================================

export const invariantMacro = defineExpressionMacro({
  name: "invariant",
  module: "@typesugar/core",
  description: "Runtime invariant — compiles to a conditional throw (not stripped in prod)",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const factory = ctx.factory;

    if (args.length < 1) {
      ctx.reportError(callExpr, "invariant() requires a condition");
      return callExpr;
    }

    const condition = args[0];
    const message = args.length >= 2 ? args[1] : factory.createStringLiteral("Invariant violation");

    // Compile to: condition || (() => { throw new Error(message); })()
    return factory.createBinaryExpression(
      condition,
      factory.createToken(ts.SyntaxKind.BarBarToken),
      factory.createCallExpression(
        factory.createParenthesizedExpression(
          factory.createArrowFunction(
            undefined,
            undefined,
            [],
            undefined,
            factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
            factory.createBlock([
              factory.createThrowStatement(
                factory.createNewExpression(factory.createIdentifier("Error"), undefined, [message])
              ),
            ])
          )
        ),
        undefined,
        []
      )
    );
  },
});

export const unreachableMacro = defineExpressionMacro({
  name: "unreachable",
  module: "@typesugar/core",
  description: "Marks unreachable code — compiles to throw",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[]
  ): ts.Expression {
    const factory = ctx.factory;

    // Compile to an IIFE that throws
    return factory.createCallExpression(
      factory.createParenthesizedExpression(
        factory.createArrowFunction(
          undefined,
          undefined,
          [],
          undefined,
          factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          factory.createBlock([
            factory.createThrowStatement(
              factory.createNewExpression(factory.createIdentifier("Error"), undefined, [
                factory.createStringLiteral("Unreachable code reached"),
              ])
            ),
          ])
        )
      ),
      undefined,
      []
    );
  },
});

export const debugOnlyMacro = defineExpressionMacro({
  name: "debugOnly",
  module: "@typesugar/core",
  description: "Dev-only code block — currently inlined in every build (no prod stripping yet)",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const factory = ctx.factory;

    if (args.length !== 1) {
      ctx.reportError(callExpr, "debugOnly() expects exactly one function");
      return callExpr;
    }

    // Always inline: there is no production flag yet, so this is NOT erased
    // in production (documented above; a 1.0 gap, deep review core #54).
    const fn = args[0];
    return factory.createCallExpression(fn, undefined, []);
  },
});

// Register macros
globalRegistry.register(invariantMacro);
globalRegistry.register(unreachableMacro);
globalRegistry.register(debugOnlyMacro);
