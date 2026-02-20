/**
 * Conditional Compilation Macros
 *
 * Provides Rust-style `#[cfg(...)]` conditional compilation for TypeScript:
 * - `cfg(condition, value)` — include value only when condition is true
 * - `cfgAttr` — attribute macro to conditionally include declarations
 *
 * Conditions are evaluated against a configuration object that can be set via:
 * - Transformer config in tsconfig.json: `{ "cfg": { "debug": true } }`
 * - Environment variables: `TYPESUGAR_CFG_DEBUG=1`
 * - `typesugar.config.ts` / `typesugar.config.json`
 *
 * Inspired by: Rust `#[cfg(...)]`, C `#ifdef`, Zig `@import("builtin")`
 *
 * @example
 * ```typescript
 * import { cfg } from "typesugar";
 *
 * // Expression-level: evaluates to the expression or undefined
 * const debugInfo = cfg("debug", () => collectDebugInfo());
 *
 * // With complex conditions
 * const result = cfg("platform.node && !test", () => {
 *   return initNodeServer();
 * });
 * ```
 */

import * as ts from "typescript";
import {
  defineExpressionMacro,
  defineAttributeMacro,
  globalRegistry,
} from "../core/registry.js";
import { MacroContext, AttributeTarget } from "../core/types.js";
import {
  stripDecorator,
  evaluateConditionExpr,
  splitTopLevel,
  findMatchingParen,
  getNestedValue,
} from "../core/ast-utils.js";

// =============================================================================
// Configuration Store
// =============================================================================

/**
 * Global configuration for conditional compilation.
 * Populated from environment variables, config files, and transformer options.
 */
let cfgConfig: Record<string, unknown> = {};
let cfgInitialized = false;

/**
 * Set the configuration for conditional compilation.
 * Called by the transformer during initialization.
 */
export function setCfgConfig(config: Record<string, unknown>): void {
  cfgConfig = { ...config };
  cfgInitialized = true;
}

/**
 * Get the current cfg configuration.
 */
export function getCfgConfig(): Record<string, unknown> {
  if (!cfgInitialized) {
    initializeFromEnvironment();
  }
  return cfgConfig;
}

/**
 * Initialize cfg configuration from environment variables.
 * Environment variables prefixed with TYPESUGAR_CFG_ are included.
 * E.g., TYPESUGAR_CFG_DEBUG=1 → { debug: true }
 */
function initializeFromEnvironment(): void {
  cfgInitialized = true;

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("TYPESUGAR_CFG_")) {
      const cfgKey = key
        .slice("TYPESUGAR_CFG_".length)
        .toLowerCase()
        .replace(/__/g, ".");

      // Parse value: "1", "true" → true; "0", "false" → false; else string
      if (value === "1" || value === "true") {
        setNestedValue(cfgConfig, cfgKey, true);
      } else if (value === "0" || value === "false" || value === "") {
        setNestedValue(cfgConfig, cfgKey, false);
      } else {
        setNestedValue(cfgConfig, cfgKey, value);
      }
    }
  }
}

/**
 * Set a nested value in a config object using dot notation.
 * E.g., setNestedValue(obj, "platform.node", true) → obj.platform.node = true
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (typeof current[part] !== "object" || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

// =============================================================================
// Condition Evaluator
// =============================================================================

/**
 * Evaluate a cfg condition string against the current configuration.
 *
 * Supports:
 * - Simple key: "debug" → truthy check on config.debug
 * - Negation: "!test" → falsy check
 * - Dotted path: "platform.node" → config.platform.node
 * - AND: "debug && !production"
 * - OR: "debug || test"
 * - Equality: "platform == 'browser'"
 * - Inequality: "platform != 'node'"
 * - Parentheses: "(debug || test) && !production"
 */
export function evaluateCfgCondition(condition: string): boolean {
  const config = getCfgConfig();
  return evaluateConditionExpr(condition.trim(), config);
}

// =============================================================================
// cfg() — Expression-level conditional compilation
// =============================================================================

export const cfgMacro = defineExpressionMacro({
  name: "cfg",
  module: "typemacro",
  description:
    "Conditional compilation: include an expression only when a condition is true at compile time.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    if (args.length < 2 || args.length > 3) {
      ctx.reportError(
        callExpr,
        "cfg expects 2-3 arguments: cfg(condition, thenValue, elseValue?)",
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
    } else if (ts.isNoSubstitutionTemplateLiteral(conditionArg)) {
      condition = conditionArg.text;
    } else {
      ctx.reportError(
        callExpr,
        "cfg: first argument must be a string literal condition",
      );
      return callExpr;
    }

    // Evaluate the condition
    const isActive = evaluateCfgCondition(condition);

    if (isActive) {
      // Condition is true — expand the then branch
      if (ts.isArrowFunction(thenArg) || ts.isFunctionExpression(thenArg)) {
        // If it's a callback, invoke it: (() => expr)()
        return ctx.factory.createCallExpression(
          ctx.factory.createParenthesizedExpression(thenArg),
          undefined,
          [],
        );
      }
      return thenArg;
    } else {
      // Condition is false — use else branch or undefined
      if (elseArg) {
        if (ts.isArrowFunction(elseArg) || ts.isFunctionExpression(elseArg)) {
          return ctx.factory.createCallExpression(
            ctx.factory.createParenthesizedExpression(elseArg),
            undefined,
            [],
          );
        }
        return elseArg;
      }
      return ctx.factory.createIdentifier("undefined");
    }
  },
});

// =============================================================================
// @cfgAttr — Attribute-level conditional compilation
// =============================================================================

export const cfgAttrMacro = defineAttributeMacro({
  name: "cfgAttr",
  module: "typemacro",
  description:
    "Conditionally include a declaration based on a compile-time condition.",
  validTargets: [
    "class",
    "method",
    "property",
    "function",
  ] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[],
  ): ts.Node | ts.Node[] {
    if (args.length !== 1) {
      ctx.reportError(
        decorator,
        "@cfgAttr expects exactly one argument: @cfgAttr(condition)",
      );
      return target;
    }

    const conditionArg = args[0];

    // Extract condition string
    let condition: string;
    if (ts.isStringLiteral(conditionArg)) {
      condition = conditionArg.text;
    } else if (ts.isNoSubstitutionTemplateLiteral(conditionArg)) {
      condition = conditionArg.text;
    } else {
      ctx.reportError(
        decorator,
        "@cfgAttr: argument must be a string literal condition",
      );
      return target;
    }

    const isActive = evaluateCfgCondition(condition);

    if (isActive) {
      // Condition is true — keep the declaration (strip the decorator)
      return stripDecorator(ctx, target, decorator);
    } else {
      // Condition is false — remove the declaration entirely
      // Return an empty statement to effectively remove it
      return ctx.factory.createEmptyStatement();
    }
  },
});

// =============================================================================
// Register macros
// =============================================================================

globalRegistry.register(cfgMacro);
globalRegistry.register(cfgAttrMacro);
