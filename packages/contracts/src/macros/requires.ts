/**
 * requires() — Precondition Expression Macro
 *
 * Asserts a condition that must hold before the function body executes.
 * Compiles to an invariant() check or is stripped entirely based on config.
 *
 * @example
 * ```typescript
 * function withdraw(account: Account, amount: Positive): number {
 *   requires(account.balance >= amount, "Insufficient funds");
 *   requires(!account.frozen);
 *   return account.balance - amount;
 * }
 * ```
 *
 * Output (mode: "full"):
 * ```typescript
 * function withdraw(account: Account, amount: Positive): number {
 *   if (!(account.balance >= amount)) throw new PreconditionError("Precondition failed: Insufficient funds");
 *   if (!!account.frozen) throw new PreconditionError("Precondition failed: !account.frozen");
 *   return account.balance - amount;
 * }
 * ```
 *
 * Output (mode: "none"):
 * ```typescript
 * function withdraw(account: Account, amount: Positive): number {
 *   return account.balance - amount;
 * }
 * ```
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry, MacroContext } from "@typesugar/core";
import { shouldEmitCheck } from "../config.js";
import { normalizeExpression } from "../parser/predicate.js";
import { PreconditionError } from "../runtime/errors.js";

/**
 * Runtime requires function — used without the transformer.
 * With the transformer, calls to this are replaced at compile time.
 */
export function requires(condition: boolean, message?: string): void {
  if (!condition) {
    throw new PreconditionError(message ?? "Precondition failed");
  }
}

export const requiresMacro = defineExpressionMacro({
  name: "requires",
  module: "@typesugar/contracts",
  description:
    "Precondition check — asserts a condition at function entry. Strippable in production.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length < 1 || args.length > 2) {
      ctx.reportError(callExpr, "requires() expects 1-2 arguments: requires(condition, message?)");
      return callExpr;
    }

    // If stripping is enabled, remove the call entirely
    if (!shouldEmitCheck("precondition")) {
      return ctx.factory.createVoidExpression(ctx.factory.createNumericLiteral(0));
    }

    const condition = args[0];
    const conditionText = safeGetText(condition);
    const message =
      args.length >= 2
        ? args[1]
        : ctx.factory.createStringLiteral(`Precondition failed: ${conditionText}`);

    // Try compile-time evaluation — if condition is statically true, skip
    if (ctx.isComptime(condition)) {
      const result = ctx.evaluate(condition);
      if (result.kind === "boolean" && result.value === true) {
        return ctx.factory.createVoidExpression(ctx.factory.createNumericLiteral(0));
      }
      if (result.kind === "boolean" && result.value === false) {
        ctx.reportError(callExpr, `Precondition is statically false`);
      }
    }

    // Generate: condition || (() => { throw new PreconditionError(message); })()
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

globalRegistry.register(requiresMacro);
