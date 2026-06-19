/**
 * Operator Macros
 *
 * Provides named macros for functional composition:
 * - pipe/compose: functional composition macros
 * - getOperatorString: utility to convert TS operator tokens to strings
 *
 * Operator overloading for standard operators (+, -, *, /, etc.) is handled
 * entirely via @op JSDoc tags on typeclass methods. The transformer detects
 * these and rewrites operators globally — no wrapper function needed.
 *
 * The `.sts`-only operators (|> :: <|) and their preprocessor-generated
 * __pipe__/__cons__/__apply__ macros were removed in PEP-047.
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry } from "@typesugar/core";
import { MacroContext } from "@typesugar/core";

// ============================================================================
// pipe() and compose() - Functional composition macros
// ============================================================================

export const pipeMacro = defineExpressionMacro({
  name: "pipe",
  module: "typesugar",
  description: "Pipe a value through a series of functions",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length < 2) {
      ctx.reportError(callExpr, "pipe() requires at least an initial value and one function");
      return callExpr;
    }

    const factory = ctx.factory;

    // pipe(x, f, g, h) => h(g(f(x)))
    let result = args[0];

    for (let i = 1; i < args.length; i++) {
      result = factory.createCallExpression(args[i], undefined, [result]);
    }

    return result;
  },
});

export const composeMacro = defineExpressionMacro({
  name: "compose",
  module: "typesugar",
  description: "Compose functions right-to-left",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length < 1) {
      ctx.reportError(callExpr, "compose() requires at least one function");
      return callExpr;
    }

    const factory = ctx.factory;

    const paramName = ctx.generateUniqueName("x");

    let body: ts.Expression = paramName;
    for (let i = args.length - 1; i >= 0; i--) {
      body = factory.createCallExpression(args[i], undefined, [body]);
    }

    return factory.createArrowFunction(
      undefined,
      undefined,
      [factory.createParameterDeclaration(undefined, undefined, paramName)],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      body
    );
  },
});

// ============================================================================
// Utility
// ============================================================================

/**
 * Convert a binary operator token to its string representation.
 */
export function getOperatorString(kind: ts.SyntaxKind): string | undefined {
  switch (kind) {
    case ts.SyntaxKind.PlusToken:
      return "+";
    case ts.SyntaxKind.MinusToken:
      return "-";
    case ts.SyntaxKind.AsteriskToken:
      return "*";
    case ts.SyntaxKind.SlashToken:
      return "/";
    case ts.SyntaxKind.PercentToken:
      return "%";
    case ts.SyntaxKind.AsteriskAsteriskToken:
      return "**";
    case ts.SyntaxKind.LessThanToken:
      return "<";
    case ts.SyntaxKind.LessThanEqualsToken:
      return "<=";
    case ts.SyntaxKind.GreaterThanToken:
      return ">";
    case ts.SyntaxKind.GreaterThanEqualsToken:
      return ">=";
    case ts.SyntaxKind.EqualsEqualsToken:
      return "==";
    case ts.SyntaxKind.EqualsEqualsEqualsToken:
      return "===";
    case ts.SyntaxKind.ExclamationEqualsToken:
      return "!=";
    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
      return "!==";
    case ts.SyntaxKind.AmpersandToken:
      return "&";
    case ts.SyntaxKind.BarToken:
      return "|";
    case ts.SyntaxKind.CaretToken:
      return "^";
    case ts.SyntaxKind.LessThanLessThanToken:
      return "<<";
    case ts.SyntaxKind.GreaterThanGreaterThanToken:
      return ">>";
    default:
      return undefined;
  }
}

// Register macros
globalRegistry.register(pipeMacro);
globalRegistry.register(composeMacro);
