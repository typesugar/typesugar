/**
 * Unified Configuration System
 *
 * Provides a centralized configuration API for ttfx macros.
 * Configuration is loaded from (in priority order):
 *
 * 1. Environment variables: TTFX_* (highest priority, for CI overrides)
 * 2. Config files: ttfx.config.ts, .ttfxrc, etc. (when cosmiconfig is available)
 * 3. Programmatic: config.set() calls
 * 4. Defaults (lowest priority)
 *
 * @example
 * ```typescript
 * import { config } from "@ttfx/core";
 *
 * // Read config values
 * config.get("debug")                    // → boolean
 * config.get("contracts.mode")           // → "full" | "none" | ...
 *
 * // Set config programmatically
 * config.set({ contracts: { mode: "none" } });
 * ```
 */

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

  const envConfig = loadConfigFromEnv();

  // Merge: defaults < envConfig
  configStore = deepMerge(defaults, envConfig) as TtfxConfig;
  configLoaded = true;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get a configuration value by path.
 */
function get<T = unknown>(path: string): T | undefined {
  initializeConfig();
  return getNestedValue(configStore, path) as T | undefined;
}

/**
 * Set configuration values programmatically.
 */
function set(values: Partial<TtfxConfig>): void {
  initializeConfig();
  configStore = deepMerge(configStore, values) as TtfxConfig;
}

/**
 * Check if a configuration path has a truthy value.
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
 * Reset configuration to defaults (mainly for testing).
 */
function reset(): void {
  configStore = {};
  configLoaded = false;
}

/**
 * Evaluate a condition string against the configuration.
 */
function evaluate(condition: string): boolean {
  initializeConfig();
  return evaluateExpr(condition.trim());
}

function evaluateExpr(expr: string): boolean {
  expr = expr.trim();

  // Handle OR
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

  // Handle equality
  const eqMatch = expr.match(/^([\w.]+)\s*==\s*['"](.+)['"]\s*$/);
  if (eqMatch) {
    return String(get(eqMatch[1])) === eqMatch[2];
  }

  // Handle inequality
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

/**
 * Conditional value based on configuration.
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
  reset,
  evaluate,
  when,
} as const;

/**
 * Helper for creating type-safe configuration files.
 */
export function defineConfig(cfg: TtfxConfig): TtfxConfig {
  return cfg;
}
