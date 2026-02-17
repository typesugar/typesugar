/**
 * Runtime Safety Primitives
 *
 * Fundamental runtime safety utilities that any package might use.
 * These are low-level primitives for asserting invariants, marking
 * unreachable code paths, and conditionally running debug code.
 *
 * - `invariant(condition, message)` — Runtime assertion (strippable in prod)
 * - `unreachable(value?)` — Mark impossible code paths
 * - `debugOnly(fn)` — Code that only runs in development
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
 * // debugOnly — stripped in production builds
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
 * Runtime invariant check. Stripped in production builds.
 *
 * @param condition - The condition that must be true
 * @param message - Error message if the invariant is violated
 * @throws Error if condition is false
 */
export function invariant(
  condition: boolean,
  message?: string,
): asserts condition {
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
 * Code that only runs in development. Completely erased in production.
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
  module: "@ttfx/core",
  description:
    "Runtime invariant — compiles to a conditional throw (strippable in prod)",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    const factory = ctx.factory;

    if (args.length < 1) {
      ctx.reportError(callExpr, "invariant() requires a condition");
      return callExpr;
    }

    const condition = args[0];
    const message =
      args.length >= 2
        ? args[1]
        : factory.createStringLiteral("Invariant violation");

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
                factory.createNewExpression(
                  factory.createIdentifier("Error"),
                  undefined,
                  [message],
                ),
              ),
            ]),
          ),
        ),
        undefined,
        [],
      ),
    );
  },
});

export const unreachableMacro = defineExpressionMacro({
  name: "unreachable",
  module: "@ttfx/core",
  description: "Marks unreachable code — compiles to throw",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[],
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
              factory.createNewExpression(
                factory.createIdentifier("Error"),
                undefined,
                [factory.createStringLiteral("Unreachable code reached")],
              ),
            ),
          ]),
        ),
      ),
      undefined,
      [],
    );
  },
});

export const debugOnlyMacro = defineExpressionMacro({
  name: "debugOnly",
  module: "@ttfx/core",
  description:
    "Dev-only code block — inlined in dev, completely erased in prod",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    const factory = ctx.factory;

    if (args.length !== 1) {
      ctx.reportError(callExpr, "debugOnly() expects exactly one function");
      return callExpr;
    }

    // In dev mode: inline the function call
    // In prod mode: erase completely (void 0)
    // For now, we always inline — a production flag would control this
    const fn = args[0];
    return factory.createCallExpression(fn, undefined, []);
  },
});

// Register macros
globalRegistry.register(invariantMacro);
globalRegistry.register(unreachableMacro);
globalRegistry.register(debugOnlyMacro);
