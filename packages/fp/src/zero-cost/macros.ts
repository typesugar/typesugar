/**
 * Compile-time macros for `@typesugar/fp/zero-cost`.
 *
 * Kept out of the runtime modules (`./option.ts`, `./result.ts`) because they
 * import `typescript` and `@typesugar/core`; this file is only loaded through
 * `@typesugar/fp/macros` (the package's `typesugar.macros` manifest entry).
 *
 * Each expansion uses each argument exactly once, so no hygienic temporaries
 * are needed. (A method-chain expansion — `Option.from(x).map(f).unwrapOr(d)`
 * — used to live here; it duplicated the previous step's expression at every
 * step, re-evaluating side effects, and was removed rather than shipped.)
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry, MacroContext } from "@typesugar/core";

export const zeroCostOptionMacro = defineExpressionMacro({
  name: "ZeroCostOptionOps",
  module: "@typesugar/fp",
  description: "Zero-cost Option — compiles to inlined null checks",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const expr = callExpr.expression;
    if (
      ts.isPropertyAccessExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      (expr.expression.text === "Option" || expr.expression.text === "ZeroCostOptionOps")
    ) {
      const method = expr.name.text;
      if (method === "from" && args.length === 1) {
        return ctx.factory.createBinaryExpression(
          args[0],
          ctx.factory.createToken(ts.SyntaxKind.QuestionQuestionToken),
          ctx.factory.createNull()
        );
      }
      if (method === "some" && args.length === 1) return args[0];
      if (method === "isSome" && args.length === 1) {
        return ctx.factory.createBinaryExpression(
          args[0],
          ctx.factory.createToken(ts.SyntaxKind.ExclamationEqualsToken),
          ctx.factory.createNull()
        );
      }
      if (method === "isNone" && args.length === 1) {
        return ctx.factory.createBinaryExpression(
          args[0],
          ctx.factory.createToken(ts.SyntaxKind.EqualsEqualsToken),
          ctx.factory.createNull()
        );
      }
    }
    return callExpr;
  },
});

globalRegistry.register(zeroCostOptionMacro);

export const zeroCostResultMacro = defineExpressionMacro({
  name: "ZeroCostResultOps",
  module: "@typesugar/fp",
  description: "Zero-cost Result — compiles to inlined ok/error checks",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
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
          factory.createPropertyAccessExpression(args[0], "ok")
        );
      }
    }
    return callExpr;
  },
});

globalRegistry.register(zeroCostResultMacro);
