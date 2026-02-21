/**
 * ensures() — Postcondition Expression Macro
 *
 * Asserts a condition that must hold after the function body executes.
 * Supports old() for referencing pre-call values.
 *
 * The ensures() macro is more complex than requires() because:
 * 1. The check must run AFTER the function body
 * 2. old() calls must be hoisted to BEFORE the body
 * 3. The return value may need to be captured for the check
 *
 * When used as an inline expression macro, ensures() is transformed
 * into a statement that is moved to the end of the function body.
 * The @contract attribute macro handles this more cleanly with
 * labeled blocks.
 *
 * @example
 * ```typescript
 * function increment(counter: Counter): void {
 *   ensures(counter.value === old(counter.value) + 1);
 *   counter.value++;
 * }
 *
 * // Transforms to:
 * function increment(counter: Counter): void {
 *   const __old_0__ = counter.value;
 *   counter.value++;
 *   if (!(counter.value === __old_0__ + 1))
 *     throw new PostconditionError("...");
 * }
 * ```
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry, MacroContext } from "@typesugar/core";
import { shouldEmitCheck } from "../config.js";
import { normalizeExpression } from "../parser/predicate.js";

/**
 * Runtime ensures function — used without the transformer.
 */
export function ensures(condition: boolean, message?: string): void {
  if (!condition) {
    throw new Error(message ?? "Postcondition failed");
  }
}

export const ensuresMacro = defineExpressionMacro({
  name: "ensures",
  module: "@typesugar/contracts",
  description:
    "Postcondition check — asserts a condition after function execution. Supports old(). Strippable in production.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length < 1 || args.length > 2) {
      ctx.reportError(callExpr, "ensures() expects 1-2 arguments: ensures(condition, message?)");
      return callExpr;
    }

    // If stripping is enabled, remove the call entirely
    if (!shouldEmitCheck("postcondition")) {
      return ctx.factory.createVoidExpression(ctx.factory.createNumericLiteral(0));
    }

    const condition = args[0];
    const conditionText = safeGetText(condition);
    const message =
      args.length >= 2
        ? args[1]
        : ctx.factory.createStringLiteral(`Postcondition failed: ${conditionText}`);

    // NOTE: old() hoisting and statement reordering is handled by the
    // @contract attribute macro or by a post-processing pass in the
    // transformer. The ensures() macro itself just generates the check
    // expression. When used standalone (without @contract), old() calls
    // inside the condition are handled by the old() macro (identity fallback).

    // Generate: condition || (() => { throw new PostconditionError(message); })()
    return ctx.factory.createBinaryExpression(
      condition,
      ctx.factory.createToken(ts.SyntaxKind.BarBarToken),
      ctx.factory.createCallExpression(
        ctx.factory.createParenthesizedExpression(
          ctx.factory.createArrowFunction(
            undefined,
            undefined,
            [],
            undefined,
            ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
            ctx.factory.createBlock([
              ctx.factory.createThrowStatement(
                ctx.factory.createNewExpression(ctx.factory.createIdentifier("Error"), undefined, [
                  message,
                ])
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

/**
 * Safely get text representation of a node.
 * Falls back to normalizeExpression for factory-created nodes without source positions.
 */
function safeGetText(node: ts.Expression): string {
  try {
    const text = node.getText?.();
    if (text) return text;
  } catch {
    // Factory-created nodes throw on getText()
  }
  return normalizeExpression(node);
}

globalRegistry.register(ensuresMacro);
