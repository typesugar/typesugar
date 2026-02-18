/**
 * Unified Configuration System
 *
 * Provides a centralized configuration API for ttfx macros and user code.
 * Configuration is loaded from (in priority order):
 *
 * 1. Environment variables: TTFX_* (highest priority, for CI overrides)
 * 2. Config files: ttfx.config.ts, .ttfxrc, .ttfxrc.json, etc.
 * 3. package.json: "ttfx" key
 * 4. Programmatic: config.set() calls
 * 5. Defaults (lowest priority)
 *
 * @example
 * ```typescript
 * import { config } from "ttfx";
 *
 * // Read config values
 * config.get("debug")                    // → boolean
 * config.get("contracts.mode")           // → "full" | "none" | ...
 * config.get("features.experimental")    // → boolean
 *
 * // Conditional compilation (expression)
 * const x = config.when("debug", () => expensiveDebugStuff());
 *
 * // Conditional compilation (decorator)
 * @config.when("features.experimental")
 * class ExperimentalFeature { }
 * ```
 *
 * @example Config file (ttfx.config.ts)
 * ```typescript
 * import { defineConfig } from "ttfx";
 *
 * export default defineConfig({
 *   debug: true,
 *   contracts: {
 *     mode: "full",
 *     proveAtCompileTime: true,
 *   },
 * });
 * ```
 */

import * as ts from "typescript";
import { cosmiconfig, cosmiconfigSync } from "cosmiconfig";
import {
  defineExpressionMacro,
  defineAttributeMacro,
  globalRegistry,
} from "./registry.js";
import type { MacroContext, AttributeTarget } from "./types.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Contract configuration options.
 */
export interface ContractsConfig {
  /** "full" = all checks, "assertions" = invariants only, "none" = stripped */
  mode?: "full" | "assertions" | "none";
  /** Attempt compile-time proofs to eliminate runtime checks */
  proveAtCompileTime?: boolean;
  /** Fine-grained stripping per contract type */
  strip?: {
    preconditions?: boolean;
    postconditions?: boolean;
    invariants?: boolean;
  };
  /** Warning configuration for decidability fallback (Coq-inspired) */
  decidabilityWarnings?: {
    /** Emit warning when compile-time predicates fall back to runtime */
    warnOnFallback?: "error" | "warn" | "info" | "off";
    /** Emit info when decidable predicates need SMT solver */
    warnOnSMT?: "error" | "warn" | "info" | "off";
    /** List of brands to ignore warnings for */
    ignoreBrands?: string[];
  };
}

/**
 * Full ttfx configuration schema.
 */
export interface TtfxConfig {
  /** Enable debug mode */
  debug?: boolean;
  /** Contract system configuration */
  contracts?: ContractsConfig;
  /** Feature flags */
  features?: Record<string, boolean>;
  /** Custom user configuration */
  [key: string]: unknown;
}

// ============================================================================
// Global State
// ============================================================================

let configStore: TtfxConfig = {};
let configLoaded = false;
let configFilePath: string | undefined;

// ============================================================================
// Config File Loading (cosmiconfig)
// ============================================================================

const MODULE_NAME = "ttfx";

/**
 * Load configuration synchronously from files.
 * Uses cosmiconfig to search for config in standard locations.
 */
function loadConfigFromFiles(): TtfxConfig {
  try {
    const explorer = cosmiconfigSync(MODULE_NAME, {
      searchPlaces: [
        "package.json",
        `.${MODULE_NAME}rc`,
        `.${MODULE_NAME}rc.json`,
        `.${MODULE_NAME}rc.yaml`,
        `.${MODULE_NAME}rc.yml`,
        `.${MODULE_NAME}rc.js`,
        `.${MODULE_NAME}rc.cjs`,
        `.${MODULE_NAME}rc.mjs`,
        `.${MODULE_NAME}rc.ts`,
        `${MODULE_NAME}.config.js`,
        `${MODULE_NAME}.config.cjs`,
        `${MODULE_NAME}.config.mjs`,
        `${MODULE_NAME}.config.ts`,
      ],
    });

    const result = explorer.search();
    if (result && !result.isEmpty) {
      configFilePath = result.filepath;
      return result.config as TtfxConfig;
    }
  } catch (error) {
    // Config file errors shouldn't crash — just use defaults
    if (process.env.NODE_ENV === "development") {
      console.warn(`[ttfx] Failed to load config file:`, error);
    }
  }

  return {};
}

// ============================================================================
// Environment Variable Loading
// ============================================================================

/**
 * Load configuration from environment variables.
 * Variables prefixed with TTFX_ are parsed into the config object.
 *
 * Examples:
 *   TTFX_DEBUG=1                        → { debug: true }
 *   TTFX_CONTRACTS_MODE=none            → { contracts: { mode: "none" } }
 *   TTFX_CONTRACTS__STRIP__PRECONDITIONS=1 → { contracts: { strip: { preconditions: true } } }
 */
function loadConfigFromEnv(): TtfxConfig {
  const envConfig: TtfxConfig = {};
  const PREFIX = "TTFX_";

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(PREFIX) || value === undefined) continue;

    // Convert TTFX_CONTRACTS_MODE to contracts.mode
    // Double underscore __ becomes nested object separator
    const configPath = key
      .slice(PREFIX.length)
      .toLowerCase()
      .replace(/__/g, ".")
      .replace(/_/g, ".");

    // Parse value
    let parsedValue: unknown;
    if (value === "1" || value === "true") {
      parsedValue = true;
    } else if (value === "0" || value === "false" || value === "") {
      parsedValue = false;
    } else if (/^\d+$/.test(value)) {
      parsedValue = parseInt(value, 10);
    } else {
      parsedValue = value;
    }

    setNestedValue(envConfig, configPath, parsedValue);
  }

  return envConfig;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Set a nested value using dot notation.
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

/**
 * Get a nested value using dot notation.
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Deep merge objects (right takes precedence).
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (
      typeof sourceValue === "object" &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === "object" &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>,
      );
    } else {
      result[key] = sourceValue;
    }
  }

  return result;
}

// ============================================================================
// Config Initialization
// ============================================================================

/**
 * Initialize configuration from all sources.
 * Priority: env vars > config files > programmatic > defaults
 */
function initializeConfig(): void {
  if (configLoaded) return;

  const defaults: TtfxConfig = {
    debug: false,
    contracts: {
      mode: "full",
      proveAtCompileTime: false,
      strip: {},
    },
    features: {},
  };

  const fileConfig = loadConfigFromFiles();
  const envConfig = loadConfigFromEnv();

  // Merge: defaults < fileConfig < envConfig
  configStore = deepMerge(
    deepMerge(defaults, fileConfig),
    envConfig,
  ) as TtfxConfig;

  configLoaded = true;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get a configuration value by path.
 *
 * @param path - Dot-notation path (e.g., "contracts.mode", "debug")
 * @returns The configuration value, or undefined if not set
 *
 * @example
 * config.get("debug")              // → true
 * config.get("contracts.mode")     // → "full"
 * config.get("features.experimental") // → false
 */
function get<T = unknown>(path: string): T | undefined {
  initializeConfig();
  return getNestedValue(configStore, path) as T | undefined;
}

/**
 * Set configuration values programmatically.
 * Merges with existing configuration.
 *
 * @param values - Partial configuration to merge
 *
 * @example
 * config.set({ debug: true });
 * config.set({ contracts: { mode: "none" } });
 */
function set(values: Partial<TtfxConfig>): void {
  initializeConfig();
  configStore = deepMerge(configStore, values) as TtfxConfig;
}

/**
 * Check if a configuration path has a truthy value.
 *
 * @param path - Dot-notation path
 * @returns True if the value is truthy
 */
function has(path: string): boolean {
  return !!get(path);
}

/**
 * Get all configuration values.
 */
function getAll(): Readonly<TtfxConfig> {
  initializeConfig();
  return configStore;
}

/**
 * Get the path to the loaded config file (if any).
 */
function getConfigFilePath(): string | undefined {
  initializeConfig();
  return configFilePath;
}

/**
 * Reset configuration to defaults (mainly for testing).
 */
function reset(): void {
  configStore = {};
  configLoaded = false;
  configFilePath = undefined;
}

// ============================================================================
// Condition Evaluator
// ============================================================================

/**
 * Evaluate a condition string against the configuration.
 *
 * Supports:
 * - Simple path: "debug" → truthy check
 * - Negation: "!debug"
 * - Equality: "contracts.mode == 'none'"
 * - Inequality: "contracts.mode != 'none'"
 * - AND: "debug && contracts.proveAtCompileTime"
 * - OR: "debug || test"
 * - Parentheses: "(debug || test) && !production"
 */
function evaluate(condition: string): boolean {
  initializeConfig();
  return evaluateExpr(condition.trim());
}

function evaluateExpr(expr: string): boolean {
  expr = expr.trim();

  // Handle OR (lowest precedence)
  const orParts = splitTopLevel(expr, "||");
  if (orParts.length > 1) {
    return orParts.some((part) => evaluateExpr(part));
  }

  // Handle AND
  const andParts = splitTopLevel(expr, "&&");
  if (andParts.length > 1) {
    return andParts.every((part) => evaluateExpr(part));
  }

  // Handle parentheses
  if (expr.startsWith("(") && findMatchingParen(expr, 0) === expr.length - 1) {
    return evaluateExpr(expr.slice(1, -1));
  }

  // Handle negation
  if (expr.startsWith("!")) {
    return !evaluateExpr(expr.slice(1));
  }

  // Handle equality: key == 'value'
  const eqMatch = expr.match(/^([\w.]+)\s*==\s*['"](.+)['"]\s*$/);
  if (eqMatch) {
    return String(get(eqMatch[1])) === eqMatch[2];
  }

  // Handle inequality: key != 'value'
  const neqMatch = expr.match(/^([\w.]+)\s*!=\s*['"](.+)['"]\s*$/);
  if (neqMatch) {
    return String(get(neqMatch[1])) !== neqMatch[2];
  }

  // Simple path — truthy check
  return !!get(expr);
}

function splitTopLevel(expr: string, op: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === "(") depth++;
    else if (expr[i] === ")") depth--;

    if (depth === 0 && expr.slice(i, i + op.length) === op) {
      parts.push(current);
      current = "";
      i += op.length - 1;
    } else {
      current += expr[i];
    }
  }

  parts.push(current);
  return parts;
}

function findMatchingParen(expr: string, start: number): number {
  let depth = 0;
  for (let i = start; i < expr.length; i++) {
    if (expr[i] === "(") depth++;
    else if (expr[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// ============================================================================
// config.when() — Runtime Conditional
// ============================================================================

/**
 * Conditional value based on configuration.
 * At compile time (with transformer), dead branches are eliminated.
 * At runtime, returns the appropriate value based on the condition.
 *
 * @param condition - Condition string to evaluate
 * @param thenValue - Value or factory if condition is true
 * @param elseValue - Value or factory if condition is false (optional)
 *
 * @example
 * const debug = config.when("debug", () => collectDebugInfo());
 * const mode = config.when("contracts.mode == 'full'", "verbose", "quiet");
 */
function when<T, U = undefined>(
  condition: string,
  thenValue: T | (() => T),
  elseValue?: U | (() => U),
): T | U | undefined {
  const isActive = evaluate(condition);

  if (isActive) {
    return typeof thenValue === "function"
      ? (thenValue as () => T)()
      : thenValue;
  } else if (elseValue !== undefined) {
    return typeof elseValue === "function"
      ? (elseValue as () => U)()
      : elseValue;
  }

  return undefined;
}

// ============================================================================
// @config.when() — Decorator
// ============================================================================

/**
 * Decorator factory for conditional compilation.
 * At compile time (with transformer), declarations are removed if condition is false.
 * At runtime (without transformer), this is a no-op that returns the target.
 *
 * @param condition - Condition string to evaluate
 *
 * @example
 * @config.when("features.experimental")
 * class ExperimentalFeature { }
 *
 * @config.when("debug")
 * function debugOnly() { }
 */
when.decorator = function whenDecorator(condition: string) {
  return function <T>(
    target: T,
    _context?: ClassDecoratorContext | ClassMethodDecoratorContext,
  ): T {
    // At runtime without transformer, always return target
    // The transformer handles actual removal
    return target;
  };
};

// ============================================================================
// Macros (Compile-time)
// ============================================================================

/**
 * config.when expression macro — compile-time conditional.
 */
export const configWhenMacro = defineExpressionMacro({
  name: "config.when",
  module: "ttfx",
  description: "Conditional compilation based on configuration",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    if (args.length < 2 || args.length > 3) {
      ctx.reportError(
        callExpr,
        "config.when expects 2-3 arguments: config.when(condition, thenValue, elseValue?)",
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
      ctx.reportError(
        callExpr,
        "config.when: first argument must be a string literal",
      );
      return callExpr;
    }

    const isActive = evaluate(condition);

    if (isActive) {
      if (ts.isArrowFunction(thenArg) || ts.isFunctionExpression(thenArg)) {
        return ctx.factory.createCallExpression(
          ctx.factory.createParenthesizedExpression(thenArg),
          undefined,
          [],
        );
      }
      return thenArg;
    } else {
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

/**
 * @config.when attribute macro — compile-time conditional declaration.
 */
export const configWhenAttrMacro = defineAttributeMacro({
  name: "config.when",
  module: "ttfx",
  description: "Conditionally include a declaration based on configuration",
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
        "@config.when expects one argument: @config.when(condition)",
      );
      return target;
    }

    const conditionArg = args[0];

    let condition: string;
    if (ts.isStringLiteral(conditionArg)) {
      condition = conditionArg.text;
    } else {
      ctx.reportError(
        decorator,
        "@config.when: argument must be a string literal",
      );
      return target;
    }

    const isActive = evaluate(condition);

    if (isActive) {
      return stripDecorator(ctx, target, decorator);
    } else {
      return ctx.factory.createEmptyStatement();
    }
  },
});

/**
 * Strip a decorator from a declaration.
 */
function stripDecorator(
  ctx: MacroContext,
  target: ts.Declaration,
  decoratorToRemove: ts.Decorator,
): ts.Node {
  if (!ts.canHaveDecorators(target)) return target;

  const existingDecorators = ts.getDecorators(target);
  if (!existingDecorators) return target;

  const remainingDecorators = existingDecorators.filter(
    (d) => d !== decoratorToRemove,
  );

  const existingModifiers = ts.canHaveModifiers(target)
    ? ts.getModifiers(target)
    : undefined;

  const newModifiers = [...remainingDecorators, ...(existingModifiers ?? [])];

  if (ts.isMethodDeclaration(target)) {
    return ctx.factory.updateMethodDeclaration(
      target,
      newModifiers.length > 0 ? newModifiers : undefined,
      target.asteriskToken,
      target.name,
      target.questionToken,
      target.typeParameters,
      target.parameters,
      target.type,
      target.body,
    );
  }

  if (ts.isPropertyDeclaration(target)) {
    return ctx.factory.updatePropertyDeclaration(
      target,
      newModifiers.length > 0 ? newModifiers : undefined,
      target.name,
      target.questionToken ?? target.exclamationToken,
      target.type,
      target.initializer,
    );
  }

  if (ts.isClassDeclaration(target)) {
    return ctx.factory.updateClassDeclaration(
      target,
      newModifiers.length > 0 ? newModifiers : undefined,
      target.name,
      target.typeParameters,
      target.heritageClauses,
      target.members,
    );
  }

  if (ts.isFunctionDeclaration(target)) {
    return ctx.factory.updateFunctionDeclaration(
      target,
      newModifiers.length > 0 ? newModifiers : undefined,
      target.asteriskToken,
      target.name,
      target.typeParameters,
      target.parameters,
      target.type,
      target.body,
    );
  }

  return target;
}

// ============================================================================
// Register Macros
// ============================================================================

globalRegistry.register(configWhenMacro);
globalRegistry.register(configWhenAttrMacro);

// ============================================================================
// Export: config object
// ============================================================================

/**
 * Unified configuration API.
 */
export const config = {
  get,
  set,
  has,
  getAll,
  getConfigFilePath,
  reset,
  evaluate,
  when: Object.assign(when, { decorator: when.decorator }),
} as const;

// ============================================================================
// Export: defineConfig helper
// ============================================================================

/**
 * Helper for creating type-safe configuration files.
 *
 * @example
 * // ttfx.config.ts
 * import { defineConfig } from "ttfx";
 *
 * export default defineConfig({
 *   debug: true,
 *   contracts: { mode: "full" },
 * });
 */
export function defineConfig(config: TtfxConfig): TtfxConfig {
  return config;
}
