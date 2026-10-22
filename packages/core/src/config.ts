/**
 * Unified Configuration System
 *
 * Provides a centralized configuration API for typesugar macros.
 * Configuration is loaded from (in priority order):
 *
 * 1. Environment variables: TYPESUGAR_* (highest priority, for CI overrides)
 * 2. Config files: typesugar.config.ts, .typesugarrc, etc. — the nearest one
 *    found walking up from `process.cwd()` (or from the directory passed to
 *    `config.load({ searchFrom })`), stopping at the repository root
 * 3. Programmatic: config.set() calls
 * 4. Defaults (lowest priority)
 *
 * (`config.set()` values are applied on top of the merged result, so in
 * practice they override env/file values until the next reload.)
 *
 * A config file that exists but fails to load is reported with a
 * `console.warn` and through `config.getLoadError()`; it is never silently
 * treated as "no config".
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

import { evaluateConfigCondition } from "./config-condition.js";
import { searchConfigFile, isNodeRuntime } from "./config-loader.js";

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
 * Resolution mode for typeclass and operator lookup. Accepted for
 * compatibility but not read in 1.0: resolution is always import-scoped
 * (PEP-052), with no "automatic" or "explicit" behaviour.
 */
export type ResolutionMode = "automatic" | "import-scoped" | "explicit";

/**
 * Resolution configuration. The 1.0 macros don't read it: resolution is
 * always import-scoped, with no prelude (PEP-052). `config.isInPrelude` and
 * `config.isTracingEnabled` still answer from it for callers of their own.
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
 * Security-related configuration (PEP-055).
 */
export interface SecurityConfig {
  /**
   * Package names (or "@scope/*" wildcard entries) allowed to register
   * macros outside the auto-trusted `@typesugar/*` scope. Written by
   * `typesugar approve-macros`; safe to hand-edit, but review each entry
   * as carefully as a new production dependency.
   */
  allowedMacroPackages?: string[];
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
  /** Security configuration (macro-package trust, etc.) */
  security?: SecurityConfig;
  /** Custom user configuration */
  [key: string]: unknown;
}

// ============================================================================
// Global State
// ============================================================================

/**
 * Why file-based config is not in effect, when it isn't (deep review
 * 2026-10, core #20/#53): `"failed"` = a config file was found but loading
 * it threw; `"unavailable"` = this runtime can't load config files at all.
 */
export interface ConfigLoadError {
  kind: "failed" | "unavailable";
  /** The config file that failed to load (`"failed"` only, when known). */
  filepath?: string;
  message: string;
  error?: Error;
}

// LIMITATION (deep review 2026-10, core #35): this is still ONE config per
// process, not one per project. A host serving several projects (tsserver
// with a multi-root workspace, one vite process for several packages) sees
// whichever project `load({ searchFrom })` last pointed at — or, if nothing
// calls `load()`, the nearest config above `process.cwd()`. Making every
// `config.get()` consumer project-aware is a larger refactor than this fix.
let configStore: TypesugarConfig = {};
let configLoaded = false;
let configFilePath: string | undefined;
let configLoadError: ConfigLoadError | undefined;
/** Directory the config-file search starts from; `undefined` = `process.cwd()`. */
let searchFromDir: string | undefined;

// ============================================================================
// Environment Variable Loading
// ============================================================================

/**
 * Map an env-var name (without the `TYPESUGAR_` prefix) to a config path.
 *
 * - The FIRST single `_` separates the top-level key from the rest:
 *   `CONTRACTS_MODE` → `contracts.mode`.
 * - `__` separates any further nesting levels:
 *   `CONTRACTS__STRIP__PRECONDITIONS` → `contracts.strip.preconditions`.
 * - Every other `_` joins words in camelCase:
 *   `CONTRACTS_PROVE_AT_COMPILE_TIME` → `contracts.proveAtCompileTime`.
 *
 * (Deep review 2026-10, core #52: previously every `_` became a `.` and
 * case was lost, so camelCase keys like `proveAtCompileTime` were
 * unreachable from the environment.)
 */
function envKeyToConfigPath(name: string): string {
  const camel = (words: string): string =>
    words
      .toLowerCase()
      .split("_")
      .filter((w) => w.length > 0)
      .map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1)))
      .join("");

  const levels = name.split("__");
  const first = levels[0];
  const sep = first.indexOf("_");
  const head =
    sep === -1 ? [camel(first)] : [camel(first.slice(0, sep)), camel(first.slice(sep + 1))];
  return [...head, ...levels.slice(1).map(camel)].filter((s) => s.length > 0).join(".");
}

/**
 * Load configuration from environment variables.
 * Variables prefixed with TYPESUGAR_ are parsed into the config object
 * (see `envKeyToConfigPath` for the name mapping).
 *
 * Examples:
 *   TYPESUGAR_DEBUG=1                              → { debug: true }
 *   TYPESUGAR_CONTRACTS_MODE=none                  → { contracts: { mode: "none" } }
 *   TYPESUGAR_CONTRACTS_PROVE_AT_COMPILE_TIME=1    → { contracts: { proveAtCompileTime: true } }
 *   TYPESUGAR_CONTRACTS__STRIP__PRECONDITIONS=1    → { contracts: { strip: { preconditions: true } } }
 */
function loadConfigFromEnv(): TypesugarConfig {
  const envConfig: TypesugarConfig = {};
  const PREFIX = "TYPESUGAR_";
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (!proc?.env) return envConfig;

  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(proc.env)) {
    if (!key.startsWith(PREFIX) || value === undefined) continue;
    const configPath = envKeyToConfigPath(key.slice(PREFIX.length));
    if (configPath.length > 0) entries.push([configPath, value]);
  }
  // Shallower paths first, so `TYPESUGAR_CONTRACTS=0` can't wipe
  // `TYPESUGAR_CONTRACTS_MODE=none` depending on environment order.
  entries.sort(([a], [b]) => a.split(".").length - b.split(".").length || a.localeCompare(b));

  for (const [configPath, value] of entries) {
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
// Config File Loading (see config-loader.ts)
// ============================================================================

/** Messages already printed, so a repeated reload doesn't spam the same warning. */
const warnedLoadErrors = new Set<string>();

function warnOnce(message: string): void {
  if (warnedLoadErrors.has(message)) return;
  warnedLoadErrors.add(message);
  console.warn(message);
}

function loadConfigFromFiles(): TypesugarConfig {
  const proc = (globalThis as { process?: { cwd?: () => string } }).process;
  const from = searchFromDir ?? proc?.cwd?.();
  if (from === undefined) {
    // Browser bundle (playground): there is no file system to search.
    return {};
  }

  const result = searchConfigFile(from);
  switch (result.kind) {
    case "found":
      configFilePath = result.filepath;
      return result.config as TypesugarConfig;
    case "none":
      return {};
    case "failed": {
      configLoadError = {
        kind: "failed",
        filepath: result.filepath,
        message: result.error.message,
        error: result.error,
      };
      warnOnce(
        `[typesugar] Failed to load config file ${result.filepath ?? "(unknown path)"}: ` +
          `${result.error.message}\n` +
          `[typesugar] All file-based settings (including security.allowedMacroPackages) ` +
          `are being ignored; using defaults and TYPESUGAR_* environment variables only.`
      );
      return {};
    }
    case "unavailable":
      configLoadError = { kind: "unavailable", message: result.reason };
      // Only a real Node process can have a config file worth warning about.
      if (isNodeRuntime()) {
        warnOnce(
          `[typesugar] Config files (typesugar.config.ts, .typesugarrc, ...) cannot be ` +
            `loaded: ${result.reason}. Only defaults and TYPESUGAR_* environment ` +
            `variables are in effect.`
        );
      }
      return {};
  }
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
  configLoadError = undefined;
  searchFromDir = undefined;
}

/**
 * (Re)load configuration, searching for a config file upward from
 * `options.searchFrom` (default: `process.cwd()`). Discards previous
 * `config.set()` values, and re-reads the file even if it was loaded before
 * — call it again after the config file changes (watch mode / LSP hosts).
 *
 * Hosts that know the project (the tsconfig directory) should call this
 * with it, so the config doesn't depend on the process's cwd.
 */
function load(options: { searchFrom?: string } = {}): void {
  reset();
  searchFromDir = options.searchFrom;
  initializeConfig();
}

/**
 * Why file-based config is not in effect, if it isn't: a config file that
 * was found but failed to load, or a runtime that can't load config files
 * at all. `undefined` when the file loaded fine or there simply is none.
 */
function getLoadError(): ConfigLoadError | undefined {
  initializeConfig();
  return configLoadError;
}

/**
 * Evaluate a condition string against the configuration.
 *
 * Supports dotted paths, quoted strings, numbers, true/false/null/undefined,
 * `==`/`===`/`!=`/`!==`, `&&`, `||`, `!` and parentheses. Throws a
 * `ConfigConditionError` for anything else, rather than silently returning
 * false (deep review 2026-10, core #51).
 */
function evaluate(condition: string): boolean {
  initializeConfig();
  return evaluateConfigCondition(condition, (p) => getNestedValue(configStore, p));
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
  if (!resolution) return "import-scoped";

  // Check file overrides
  if (resolution.fileOverrides) {
    for (const [pattern, mode] of Object.entries(resolution.fileOverrides)) {
      if (matchGlob(fileName, pattern)) {
        return mode;
      }
    }
  }

  return resolution.mode ?? "import-scoped";
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
  // PEP-052: no ambient prelude — nothing is in scope by default in import-scoped
  // mode; a file activates a typeclass only by importing it (or its @syntax marker).
  // A project may still opt into a prelude via `resolution.prelude` config.
  const prelude = resolution?.prelude ?? [];
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
  getLoadError,
  load,
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
