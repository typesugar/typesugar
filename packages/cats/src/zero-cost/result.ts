/**
 * Zero-Cost Result<T, E> - Compiles to discriminated union checks
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry, MacroContext } from "@ttfx/core";

// ============================================================================
// Type-Level API
// ============================================================================

export interface ZeroCostOk<T> {
  readonly ok: true;
  readonly value: T;
}

export interface ZeroCostErr<E> {
  readonly ok: false;
  readonly error: E;
}

export type ZeroCostResult<T, E> = ZeroCostOk<T> | ZeroCostErr<E>;

export const ZeroCostResultOps = {
  ok<T>(value: T): ZeroCostResult<T, never> {
    return { ok: true, value };
  },
  err<E>(error: E): ZeroCostResult<never, E> {
    return { ok: false, error };
  },
  try<T>(fn: () => T): ZeroCostResult<T, Error> {
    try {
      return { ok: true, value: fn() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
    }
  },
  isOk<T, E>(result: ZeroCostResult<T, E>): result is ZeroCostOk<T> {
    return result.ok;
  },
  isErr<T, E>(result: ZeroCostResult<T, E>): result is ZeroCostErr<E> {
    return !result.ok;
  },
} as const;

export const zeroCostResultMacro = defineExpressionMacro({
  name: "ZeroCostResultOps",
  module: "@ttfx/cats",
  description: "Zero-cost Result — compiles to inlined ok/error checks",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    const factory = ctx.factory;
    const expr = callExpr.expression;

    if (
      ts.isPropertyAccessExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      (expr.expression.text === "Result" || expr.expression.text === "ZeroCostResultOps")
    ) {
      const method = expr.name.text;
      if (method === "ok" && args.length === 1) {
        return factory.createObjectLiteralExpression([
          factory.createPropertyAssignment("ok", factory.createTrue()),
          factory.createPropertyAssignment("value", args[0]),
        ]);
      }
      if (method === "err" && args.length === 1) {
        return factory.createObjectLiteralExpression([
          factory.createPropertyAssignment("ok", factory.createFalse()),
          factory.createPropertyAssignment("error", args[0]),
        ]);
      }
      if (method === "isOk" && args.length === 1) {
        return factory.createPropertyAccessExpression(args[0], "ok");
      }
      if (method === "isErr" && args.length === 1) {
        return factory.createPrefixUnaryExpression(
          ts.SyntaxKind.ExclamationToken,
          factory.createPropertyAccessExpression(args[0], "ok"),
        );
      }
    }
    return callExpr;
  },
});

globalRegistry.register(zeroCostResultMacro);
