/**
 * Unified Configuration System
 *
 * Provides a centralized configuration API for typesugar macros.
 * Configuration is loaded from (in priority order):
 *
 * 1. Environment variables: TYPESUGAR_* (highest priority, for CI overrides)
 * 2. Config files: typesugar.config.ts, .typesugarrc, etc. (when cosmiconfig is available)
 * 3. Programmatic: config.set() calls
 * 4. Defaults (lowest priority)
 *
 * @example
 * ```typescript
 * import { config } from "@typesugar/core";
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
 * Resolution mode for typeclass and operator lookup.
 */
export type ResolutionMode = "automatic" | "import-scoped" | "explicit";

/**
 * Resolution configuration.
 */
export interface ResolutionConfig {
  /** Global resolution mode */
  mode?: ResolutionMode;
  /** Per-file overrides (glob patterns) */
  fileOverrides?: Record<string, ResolutionMode>;
  /** Typeclasses available without import in automatic mode */
  prelude?: string[];
  /** Enable resolution tracing */
  trace?: boolean;
}

/**
 * Full typesugar configuration schema.
 */
export interface TypesugarConfig {
  /** Enable debug mode */
  debug?: boolean;
  /** Contract system configuration */
  contracts?: ContractsConfig;
  /** Resolution configuration */
  resolution?: ResolutionConfig;
  /** Feature flags */
  features?: Record<string, boolean>;
  /** Custom user configuration */
  [key: string]: unknown;
}

// ============================================================================
// Global State
// ============================================================================

let configStore: TypesugarConfig = {};
let configLoaded = false;
let configFilePath: string | undefined;

// ============================================================================
// Environment Variable Loading
// ============================================================================

/**
 * Load configuration from environment variables.
 * Variables prefixed with TYPESUGAR_ are parsed into the config object.
 *
 * Examples:
 *   TYPESUGAR_DEBUG=1                        → { debug: true }
 *   TYPESUGAR_CONTRACTS_MODE=none            → { contracts: { mode: "none" } }
 */
function loadConfigFromEnv(): TypesugarConfig {
  const envConfig: TypesugarConfig = {};
  const PREFIX = "TYPESUGAR_";

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(PREFIX) || value === undefined) continue;

    // Convert TYPESUGAR_CONTRACTS_MODE to contracts.mode
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
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
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
  source: Record<string, unknown>
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
        sourceValue as Record<string, unknown>
      );
    } else {
      result[key] = sourceValue;
    }
  }

  return result;
}

// ============================================================================
// Config File Loading (optional cosmiconfig)
// ============================================================================

const MODULE_NAME = "typesugar";

/**
 * Load configuration from files when cosmiconfig is available.
 * Uses dynamic import to avoid adding cosmiconfig as a required dependency.
 */
function loadConfigFromFiles(): TypesugarConfig {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { cosmiconfigSync } = require("cosmiconfig") as {
      cosmiconfigSync: (
        name: string,
        options: { searchPlaces: string[] }
      ) => {
        search: () => { filepath?: string; config?: TypesugarConfig; isEmpty?: boolean } | null;
      };
    };
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
    if (result && !result.isEmpty && result.config) {
      configFilePath = result.filepath;
      return result.config as TypesugarConfig;
    }
  } catch {
    // cosmiconfig not installed or config file error — use empty
  }
  return {};
}

// ============================================================================
// Config Initialization
// ============================================================================

/**
 * Initialize configuration from all sources.
 */
function initializeConfig(): void {
  if (configLoaded) return;

  const defaults: TypesugarConfig = {
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
  configStore = deepMerge(deepMerge(defaults, fileConfig), envConfig) as TypesugarConfig;
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
function set(values: Partial<TypesugarConfig>): void {
  initializeConfig();
  configStore = deepMerge(configStore, values) as TypesugarConfig;
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
function getAll(): Readonly<TypesugarConfig> {
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
  elseValue?: U | (() => U)
): T | U | undefined {
  const isActive = evaluate(condition);

  if (isActive) {
    return typeof thenValue === "function" ? (thenValue as () => T)() : thenValue;
  } else if (elseValue !== undefined) {
    return typeof elseValue === "function" ? (elseValue as () => U)() : elseValue;
  }

  return undefined;
}

// ============================================================================
// Resolution Mode Helpers
// ============================================================================

/**
 * Get the resolution mode for a specific file.
 * Checks file overrides first, then falls back to global mode.
 */
function getResolutionModeForFile(fileName: string): ResolutionMode {
  const resolution = get<ResolutionConfig>("resolution");
  if (!resolution) return "automatic";

  // Check file overrides
  if (resolution.fileOverrides) {
    for (const [pattern, mode] of Object.entries(resolution.fileOverrides)) {
      if (matchGlob(fileName, pattern)) {
        return mode;
      }
    }
  }

  return resolution.mode ?? "automatic";
}

/**
 * Simple glob matching for file overrides.
 */
function matchGlob(fileName: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(fileName);
}

/**
 * Check if a typeclass is in the prelude.
 */
function isInPrelude(typeclassName: string): boolean {
  const resolution = get<ResolutionConfig>("resolution");
  const prelude = resolution?.prelude ?? [
    "Eq",
    "Ord",
    "Show",
    "Clone",
    "Debug",
    "Hash",
    "Default",
    "Semigroup",
    "Monoid",
  ];
  return prelude.includes(typeclassName);
}

/**
 * Check if resolution tracing is enabled.
 */
function isTracingEnabled(): boolean {
  const resolution = get<ResolutionConfig>("resolution");
  return resolution?.trace ?? false;
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
  getConfigFilePath,
  reset,
  evaluate,
  when,
  getResolutionModeForFile,
  isInPrelude,
  isTracingEnabled,
} as const;

/**
 * Helper for creating type-safe configuration files.
 */
export function defineConfig(cfg: TypesugarConfig): TypesugarConfig {
  return cfg;
}
