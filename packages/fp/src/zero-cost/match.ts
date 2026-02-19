/**
 * Zero-Cost Exhaustive Pattern Matching
 *
 * Compiles match expressions into optimized if/else chains.
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry, MacroContext } from "@ttfx/core";

// ============================================================================
// Type-Level API
// ============================================================================

type DiscriminantOf<T, K extends keyof T> =
  T extends Record<K, infer V> ? (V extends string ? V : never) : never;

type MatchHandlers<T, K extends keyof T, R> = {
  [V in DiscriminantOf<T, K>]: (value: Extract<T, Record<K, V>>) => R;
};

type LiteralHandlers<T extends string | number, R> = {
  [K in T]?: () => R;
} & { _?: () => R };

type GuardArm<T, R> = [(value: T) => boolean, (value: T) => R];

export function match<T extends Record<string, unknown>, K extends keyof T, R>(
  value: T,
  handlers: MatchHandlers<T, K, R>,
  discriminant?: K,
): R {
  const key = (discriminant ?? "kind") as K;
  const tag = value[key] as string;
  const handler = (handlers as Record<string, (v: T) => R>)[tag];
  if (!handler) throw new Error(`No handler for: ${String(tag)}`);
  return handler(value);
}

export function matchLiteral<T extends string | number, R>(
  value: T,
  handlers: LiteralHandlers<T, R>,
): R {
  const handler = (handlers as Record<string | number, (() => R) | undefined>)[value];
  if (handler) return handler();
  const wildcard = (handlers as Record<string, (() => R) | undefined>)["_"];
  if (wildcard) return wildcard();
  throw new Error(`No handler for: ${value}`);
}

export function matchGuard<T, R>(value: T, arms: GuardArm<T, R>[]): R {
  for (const [pred, handler] of arms) {
    if (pred(value)) return handler(value);
  }
  throw new Error("No matching guard");
}

// ============================================================================
// Macros
// ============================================================================

export const matchMacro = defineExpressionMacro({
  name: "match",
  module: "@ttfx/fp",
  description: "Zero-cost pattern matching — compiles to if/else chains",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    const factory = ctx.factory;
    if (args.length < 2) {
      ctx.reportError(callExpr, "match() requires value and handlers");
      return callExpr;
    }

    const value = args[0];
    const handlersArg = args[1];
    const discriminant = args.length >= 3 ? args[2] : undefined;
    let keyName = "kind";
    if (discriminant && ts.isStringLiteral(discriminant)) keyName = discriminant.text;

    if (!ts.isObjectLiteralExpression(handlersArg)) {
      ctx.reportError(handlersArg, "match() handlers must be object literal");
      return callExpr;
    }

    const properties = handlersArg.properties.filter(
      (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p),
    );

    let result: ts.Expression = factory.createCallExpression(
      factory.createParenthesizedExpression(
        factory.createArrowFunction(
          undefined, undefined, [], undefined,
          factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          factory.createBlock([
            factory.createThrowStatement(
              factory.createNewExpression(factory.createIdentifier("Error"), undefined,
                [factory.createStringLiteral("Non-exhaustive match")]),
            ),
          ]),
        ),
      ),
      undefined, [],
    );

    for (let i = properties.length - 1; i >= 0; i--) {
      const prop = properties[i];
      const propName = ts.isIdentifier(prop.name) ? prop.name.text
        : ts.isStringLiteral(prop.name) ? prop.name.text : null;
      if (!propName) continue;

      const handler = prop.initializer;
      if (propName === "_") {
        result = factory.createCallExpression(handler, undefined, [value]);
        continue;
      }

      const condition = factory.createBinaryExpression(
        factory.createPropertyAccessExpression(value, keyName),
        factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
        factory.createStringLiteral(propName),
      );
      const thenExpr = factory.createCallExpression(handler, undefined, [value]);
      result = factory.createConditionalExpression(
        condition,
        factory.createToken(ts.SyntaxKind.QuestionToken),
        thenExpr,
        factory.createToken(ts.SyntaxKind.ColonToken),
        result,
      );
    }
    return result;
  },
});

export const matchLiteralMacro = defineExpressionMacro({
  name: "matchLiteral",
  module: "@ttfx/fp",
  description: "Zero-cost literal matching — compiles to equality checks",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    const factory = ctx.factory;
    if (args.length !== 2) {
      ctx.reportError(callExpr, "matchLiteral() requires value and handlers");
      return callExpr;
    }

    const value = args[0];
    const handlersArg = args[1];
    if (!ts.isObjectLiteralExpression(handlersArg)) {
      ctx.reportError(handlersArg, "matchLiteral() handlers must be object literal");
      return callExpr;
    }

    const properties = handlersArg.properties.filter(
      (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p),
    );

    let wildcardHandler: ts.Expression | undefined;
    const cases: Array<{ literal: ts.Expression; handler: ts.Expression }> = [];

    for (const prop of properties) {
      const propName = ts.isIdentifier(prop.name) ? prop.name.text
        : ts.isStringLiteral(prop.name) ? prop.name.text
        : ts.isNumericLiteral(prop.name) ? prop.name.text : null;
      if (!propName) continue;

      if (propName === "_") {
        wildcardHandler = prop.initializer;
        continue;
      }

      const num = Number(propName);
      const literal = !isNaN(num)
        ? factory.createNumericLiteral(num)
        : factory.createStringLiteral(propName);
      cases.push({ literal, handler: prop.initializer });
    }

    let result: ts.Expression = wildcardHandler
      ? factory.createCallExpression(wildcardHandler, undefined, [])
      : factory.createCallExpression(
          factory.createParenthesizedExpression(
            factory.createArrowFunction(
              undefined, undefined, [], undefined,
              factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
              factory.createBlock([
                factory.createThrowStatement(
                  factory.createNewExpression(factory.createIdentifier("Error"), undefined,
                    [factory.createStringLiteral("Non-exhaustive matchLiteral")]),
                ),
              ]),
            ),
          ),
          undefined, [],
        );

    for (let i = cases.length - 1; i >= 0; i--) {
      const { literal, handler } = cases[i];
      const condition = factory.createBinaryExpression(
        value,
        factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
        literal,
      );
      const thenExpr = factory.createCallExpression(handler, undefined, []);
      result = factory.createConditionalExpression(
        condition,
        factory.createToken(ts.SyntaxKind.QuestionToken),
        thenExpr,
        factory.createToken(ts.SyntaxKind.ColonToken),
        result,
      );
    }
    return result;
  },
});

export const matchGuardMacro = defineExpressionMacro({
  name: "matchGuard",
  module: "@ttfx/fp",
  description: "Zero-cost guard matching — compiles to predicate checks",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    const factory = ctx.factory;
    if (args.length !== 2) {
      ctx.reportError(callExpr, "matchGuard() requires value and arms");
      return callExpr;
    }

    const value = args[0];
    const armsArg = args[1];
    if (!ts.isArrayLiteralExpression(armsArg)) {
      ctx.reportError(armsArg, "matchGuard() arms must be array literal");
      return callExpr;
    }

    const arms: Array<{ predicate: ts.Expression; handler: ts.Expression }> = [];
    for (const element of armsArg.elements) {
      if (!ts.isArrayLiteralExpression(element) || element.elements.length !== 2) {
        ctx.reportError(element, "Each arm must be [predicate, handler]");
        continue;
      }
      arms.push({ predicate: element.elements[0], handler: element.elements[1] });
    }

    let result: ts.Expression = factory.createCallExpression(
      factory.createParenthesizedExpression(
        factory.createArrowFunction(
          undefined, undefined, [], undefined,
          factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          factory.createBlock([
            factory.createThrowStatement(
              factory.createNewExpression(factory.createIdentifier("Error"), undefined,
                [factory.createStringLiteral("No matching guard")]),
            ),
          ]),
        ),
      ),
      undefined, [],
    );

    for (let i = arms.length - 1; i >= 0; i--) {
      const { predicate, handler } = arms[i];
      const condition = factory.createCallExpression(predicate, undefined, [value]);
      const thenExpr = factory.createCallExpression(handler, undefined, [value]);
      result = factory.createConditionalExpression(
        condition,
        factory.createToken(ts.SyntaxKind.QuestionToken),
        thenExpr,
        factory.createToken(ts.SyntaxKind.ColonToken),
        result,
      );
    }
    return result;
  },
});

globalRegistry.register(matchMacro);
globalRegistry.register(matchLiteralMacro);
globalRegistry.register(matchGuardMacro);
