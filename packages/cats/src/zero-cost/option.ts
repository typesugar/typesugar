/**
 * Zero-Cost Option<T> - Compiles to null/undefined checks
 *
 * At the type level, Option<T> provides a rich monadic API (map, flatMap,
 * unwrapOr, match, etc.). The macro transforms all method chains into
 * inlined null checks — no wrapper objects, no allocations, no vtable dispatch.
 *
 * @example
 * ```typescript
 * // Source (what you write):
 * const name = Option.from(user.name)
 *   .map(n => n.trim())
 *   .filter(n => n.length > 0)
 *   .unwrapOr("Anonymous");
 *
 * // Compiled output (what runs):
 * const __opt_0 = user.name;
 * const __opt_1 = __opt_0 != null ? __opt_0.trim() : null;
 * const __opt_2 = __opt_1 != null ? (__opt_1.length > 0 ? __opt_1 : null) : null;
 * const name = __opt_2 != null ? __opt_2 : "Anonymous";
 * ```
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry, MacroContext } from "@ttfx/core";

// ============================================================================
// Type-Level API
// ============================================================================

/** Represents an optional value — either Some(T) or None */
export type ZeroCostOption<T> = T | null;

/** Option namespace with constructors and utilities */
export const ZeroCostOptionOps = {
  /** Wrap a nullable value into an Option */
  from<T>(value: T | null | undefined): ZeroCostOption<T> {
    return value ?? null;
  },

  /** Create a Some value */
  some<T>(value: T): ZeroCostOption<T> {
    return value;
  },

  /** The None value */
  none: null as ZeroCostOption<never>,

  /** Check if an Option is Some */
  isSome<T>(opt: ZeroCostOption<T>): opt is T {
    return opt != null;
  },

  /** Check if an Option is None */
  isNone<T>(opt: ZeroCostOption<T>): opt is null {
    return opt == null;
  },
} as const;

// ============================================================================
// Chain Step Types
// ============================================================================

interface ChainStep {
  kind:
    | "from"
    | "map"
    | "flatMap"
    | "filter"
    | "unwrapOr"
    | "unwrap"
    | "match"
    | "zip"
    | "and"
    | "or"
    | "tap";
  args: readonly ts.Expression[];
}

// ============================================================================
// Option Macro
// ============================================================================

function parseOptionChain(
  node: ts.Expression,
): { root: ts.Expression; steps: ChainStep[] } | null {
  const steps: ChainStep[] = [];
  let current = node;

  while (ts.isCallExpression(current)) {
    const expr = current.expression;
    if (!ts.isPropertyAccessExpression(expr)) break;

    const methodName = expr.name.text;
    const validMethods = [
      "map", "flatMap", "filter", "unwrapOr", "unwrap",
      "match", "zip", "and", "or", "tap",
    ];

    if (!validMethods.includes(methodName)) break;

    steps.unshift({ kind: methodName as ChainStep["kind"], args: current.arguments });
    current = expr.expression;
  }

  if (ts.isCallExpression(current)) {
    const expr = current.expression;
    if (
      ts.isPropertyAccessExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      (expr.expression.text === "Option" || expr.expression.text === "ZeroCostOptionOps")
    ) {
      const method = expr.name.text;
      if (method === "from" || method === "some") {
        steps.unshift({ kind: "from", args: current.arguments });
        return { root: current, steps };
      }
    }
  }

  if (steps.length === 0) return null;
  return { root: current, steps };
}

function expandOptionChain(
  ctx: MacroContext,
  chain: { root: ts.Expression; steps: ChainStep[] },
): ts.Expression {
  const factory = ctx.factory;

  function nullCheck(
    value: ts.Expression,
    thenExpr: ts.Expression,
    elseExpr?: ts.Expression,
  ): ts.Expression {
    return factory.createConditionalExpression(
      factory.createBinaryExpression(
        value,
        factory.createToken(ts.SyntaxKind.ExclamationEqualsToken),
        factory.createNull(),
      ),
      factory.createToken(ts.SyntaxKind.QuestionToken),
      thenExpr,
      factory.createToken(ts.SyntaxKind.ColonToken),
      elseExpr ?? factory.createNull(),
    );
  }

  let currentExpr: ts.Expression | null = null;

  for (const step of chain.steps) {
    switch (step.kind) {
      case "from": {
        const arg = step.args[0];
        currentExpr = factory.createBinaryExpression(
          arg,
          factory.createToken(ts.SyntaxKind.QuestionQuestionToken),
          factory.createNull(),
        );
        break;
      }
      case "map":
      case "flatMap": {
        const fn = step.args[0];
        const prev = currentExpr!;
        currentExpr = nullCheck(
          prev,
          factory.createCallExpression(fn, undefined, [prev]),
        );
        break;
      }
      case "filter": {
        const pred = step.args[0];
        const prev = currentExpr!;
        currentExpr = nullCheck(
          prev,
          factory.createConditionalExpression(
            factory.createCallExpression(pred, undefined, [prev]),
            factory.createToken(ts.SyntaxKind.QuestionToken),
            prev,
            factory.createToken(ts.SyntaxKind.ColonToken),
            factory.createNull(),
          ),
        );
        break;
      }
      case "unwrapOr": {
        const defaultVal = step.args[0];
        const prev = currentExpr!;
        currentExpr = nullCheck(prev, prev, defaultVal);
        break;
      }
      case "unwrap": {
        const prev = currentExpr!;
        currentExpr = nullCheck(
          prev,
          prev,
          factory.createCallExpression(
            factory.createParenthesizedExpression(
              factory.createArrowFunction(
                undefined, undefined, [], undefined,
                factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                factory.createBlock([
                  factory.createThrowStatement(
                    factory.createNewExpression(
                      factory.createIdentifier("Error"),
                      undefined,
                      [factory.createStringLiteral("Called unwrap() on None")],
                    ),
                  ),
                ]),
              ),
            ),
            undefined, [],
          ),
        );
        break;
      }
      case "match": {
        const prev = currentExpr!;
        if (step.args.length === 2) {
          const someFn = step.args[0];
          const noneFn = step.args[1];
          currentExpr = nullCheck(
            prev,
            factory.createCallExpression(someFn, undefined, [prev]),
            factory.createCallExpression(noneFn, undefined, []),
          );
        }
        break;
      }
      case "zip": {
        const other = step.args[0];
        const prev = currentExpr!;
        currentExpr = factory.createConditionalExpression(
          factory.createBinaryExpression(
            factory.createBinaryExpression(prev, factory.createToken(ts.SyntaxKind.ExclamationEqualsToken), factory.createNull()),
            factory.createToken(ts.SyntaxKind.AmpersandAmpersandToken),
            factory.createBinaryExpression(other, factory.createToken(ts.SyntaxKind.ExclamationEqualsToken), factory.createNull()),
          ),
          factory.createToken(ts.SyntaxKind.QuestionToken),
          factory.createArrayLiteralExpression([prev, other]),
          factory.createToken(ts.SyntaxKind.ColonToken),
          factory.createNull(),
        );
        break;
      }
      case "and": {
        const other = step.args[0];
        const prev = currentExpr!;
        currentExpr = nullCheck(prev, other);
        break;
      }
      case "or": {
        const other = step.args[0];
        const prev = currentExpr!;
        currentExpr = nullCheck(prev, prev, other);
        break;
      }
      case "tap": {
        const fn = step.args[0];
        const prev = currentExpr!;
        currentExpr = nullCheck(
          prev,
          factory.createParenthesizedExpression(
            factory.createCommaListExpression([
              factory.createCallExpression(fn, undefined, [prev]),
              prev,
            ]),
          ),
        );
        break;
      }
    }
  }

  return currentExpr ?? factory.createNull();
}

export const zeroCostOptionMacro = defineExpressionMacro({
  name: "ZeroCostOptionOps",
  module: "@ttfx/cats",
  description: "Zero-cost Option — compiles to inlined null checks",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    const chain = parseOptionChain(callExpr);
    if (chain) return expandOptionChain(ctx, chain);

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
          ctx.factory.createNull(),
        );
      }
      if (method === "some" && args.length === 1) return args[0];
      if (method === "isSome" && args.length === 1) {
        return ctx.factory.createBinaryExpression(
          args[0],
          ctx.factory.createToken(ts.SyntaxKind.ExclamationEqualsToken),
          ctx.factory.createNull(),
        );
      }
      if (method === "isNone" && args.length === 1) {
        return ctx.factory.createBinaryExpression(
          args[0],
          ctx.factory.createToken(ts.SyntaxKind.EqualsEqualsToken),
          ctx.factory.createNull(),
        );
      }
    }
    return callExpr;
  },
});

globalRegistry.register(zeroCostOptionMacro);
