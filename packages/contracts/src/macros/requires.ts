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
import {
  defineExpressionMacro,
  globalRegistry,
  MacroContext,
  isSyntheticNode,
} from "@typesugar/core";
import { getContractConfig, shouldEmitCheck } from "../config.js";
import { normalizeExpression } from "../parser/predicate.js";
import { tryProve } from "../prover/index.js";

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

    // Compile-time proof from the parameters' refinement types, as the
    // `requires:` block form does (docs review A#19). Only for a requires()
    // at function entry, where the parameter facts still hold.
    if (getContractConfig().proveAtCompileTime) {
      const fn = entryFunctionOf(callExpr);
      if (fn) {
        const proof = tryProve(
          ctx,
          {
            expression: condition,
            normalized: normalizeExpression(condition),
            sourceText: conditionText,
          },
          fn
        );
        if (proof.proven) {
          return ctx.factory.createVoidExpression(ctx.factory.createNumericLiteral(0));
        }
      }
    }

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
                ctx.factory.createNewExpression(
                  ctx.ensureImport("PreconditionError", "@typesugar/contracts"),
                  undefined,
                  [message]
                )
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
 * The function/method whose entry this `requires(...)` call is at: the call is
 * a statement directly in the function body, preceded only by other
 * `requires(...)` statements (nothing can have reassigned a parameter yet).
 * Undefined otherwise, or for a synthetic node (no real parent chain).
 */
function entryFunctionOf(
  callExpr: ts.CallExpression
): ts.FunctionDeclaration | ts.MethodDeclaration | undefined {
  if (isSyntheticNode(callExpr)) return undefined;
  const stmt = callExpr.parent;
  if (!stmt || !ts.isExpressionStatement(stmt) || stmt.expression !== callExpr) return undefined;
  const body = stmt.parent;
  if (!body || !ts.isBlock(body)) return undefined;
  const fn = body.parent;
  if (!fn || (!ts.isFunctionDeclaration(fn) && !ts.isMethodDeclaration(fn)) || fn.body !== body) {
    return undefined;
  }
  for (const prior of body.statements) {
    if (prior === stmt) return fn;
    const isRequires =
      ts.isExpressionStatement(prior) &&
      ts.isCallExpression(prior.expression) &&
      ts.isIdentifier(prior.expression.expression) &&
      prior.expression.expression.text === "requires";
    if (!isRequires) return undefined;
  }
  return undefined;
}

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
