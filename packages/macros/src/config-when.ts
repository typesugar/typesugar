/**
 * config.when Macros
 *
 * Compile-time conditionals based on the unified configuration system.
 * Uses config.evaluate() from @typesugar/core for condition evaluation.
 *
 * - config.when(condition, thenValue, elseValue?) — expression macro
 * - @config.when(condition) — attribute macro for conditional declarations
 *
 * @example
 * ```typescript
 * import { config } from "@typesugar/core";
 *
 * const debug = config.when("debug", () => collectDebugInfo());
 * const mode = config.when("contracts.mode == 'full'", "verbose", "quiet");
 *
 * @config.when("features.experimental")
 * class ExperimentalFeature { }
 * ```
 */

import * as ts from "typescript";
import {
  config,
  defineExpressionMacro,
  defineAttributeMacro,
  globalRegistry,
  stripDecorator,
  type MacroContext,
  type AttributeTarget,
} from "@typesugar/core";

// =============================================================================
// config.when Expression Macro
// =============================================================================

export const configWhenMacro = defineExpressionMacro({
  name: "config.when",
  module: "@typesugar/core",
  exportName: "when", // config.when is the "when" property of config
  description: "Conditional compilation based on configuration",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length < 2 || args.length > 3) {
      ctx.reportError(
        callExpr,
        "config.when expects 2-3 arguments: config.when(condition, thenValue, elseValue?)"
      );
      return callExpr;
    }

    const conditionArg = args[0];
    const thenArg = args[1];
    const elseArg = args[2];

    // Extract condition string
    let condition: string;
    if (ts.isStringLiteral(conditionArg)) {
      condition = conditionArg.text;
    } else {
      ctx.reportError(callExpr, "config.when: first argument must be a string literal");
      return callExpr;
    }

    const isActive = config.evaluate(condition);

    if (isActive) {
      if (ts.isArrowFunction(thenArg) || ts.isFunctionExpression(thenArg)) {
        return ctx.factory.createCallExpression(
          ctx.factory.createParenthesizedExpression(thenArg),
          undefined,
          []
        );
      }
      return thenArg;
    } else {
      if (elseArg) {
        if (ts.isArrowFunction(elseArg) || ts.isFunctionExpression(elseArg)) {
          return ctx.factory.createCallExpression(
            ctx.factory.createParenthesizedExpression(elseArg),
            undefined,
            []
          );
        }
        return elseArg;
      }
      return ctx.factory.createIdentifier("undefined");
    }
  },
});

// =============================================================================
// @config.when Attribute Macro
// =============================================================================

export const configWhenAttrMacro = defineAttributeMacro({
  name: "config.when",
  module: "@typesugar/core",
  exportName: "when",
  description: "Conditionally include a declaration based on configuration",
  validTargets: ["class", "method", "property", "function"] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    if (args.length !== 1) {
      ctx.reportError(decorator, "@config.when expects one argument: @config.when(condition)");
      return target;
    }

    const conditionArg = args[0];

    let condition: string;
    if (ts.isStringLiteral(conditionArg)) {
      condition = conditionArg.text;
    } else {
      ctx.reportError(decorator, "@config.when: argument must be a string literal");
      return target;
    }

    const isActive = config.evaluate(condition);

    if (isActive) {
      return stripDecorator(ctx, target, decorator);
    } else {
      return ctx.factory.createEmptyStatement();
    }
  },
});

// =============================================================================
// Register Macros
// =============================================================================

globalRegistry.register(configWhenMacro);
globalRegistry.register(configWhenAttrMacro);
