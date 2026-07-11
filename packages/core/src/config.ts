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
 * Get a working `require()` for loading `cosmiconfig`, or `undefined` if
 * none is available (browser, or a Node too old to have
 * `process.getBuiltinModule`).
 *
 * `@typesugar/core` builds to (and is consumed as) BOTH a browser bundle
 * (via `packages/playground`, which bundles this package's ESM output
 * directly with `platform: 'browser'`) and Node CJS/ESM — so this can NOT
 * be a static `import { createRequire } from "module"` at the top of the
 * file: esbuild resolves static import specifiers at BUNDLE time
 * regardless of whether the code path ever runs, and "module" doesn't
 * exist for a browser target, hard-failing the playground build. A plain
 * `require("module")` doesn't work either — tsup rewrites bare `require()`
 * calls in ESM output through a runtime shim that itself depends on an
 * ambient `require` existing, which real Node ESM (`dist/index.js`, what
 * any `"type": "module"` consumer — including this repo's own CLI —
 * actually loads) doesn't have.
 *
 * `process.getBuiltinModule(id)` (Node 22.3+) sidesteps both problems: it's
 * a plain runtime property access on `process`, invisible to bundler
 * static analysis (nothing to resolve at build time), and works
 * correctly in real Node ESM without needing an ambient `require` at all.
 * Guarded the same way `profiling.ts`'s `typeof process !== "undefined"`
 * check already is for this package's other Node/browser isomorphic code;
 * gracefully returns `undefined` for a browser or an older Node, exactly
 * matching this function's pre-existing "cosmiconfig not available, use
 * empty config" fallback.
 *
 * Found because file-based config loading (of ANY config file, `.ts`
 * included) had never actually round-tripped in real Node ESM — only
 * appeared to work under `vitest`, since vite-node's own module loader
 * gives `require` a truthy value regardless, unlike a real Node ESM
 * process — surfaced by PEP-055's `approve-macros` re-reading a config
 * file it had just written.
 */
function getNodeRequire(): NodeRequire | undefined {
  const proc = globalThis as unknown as {
    process?: { getBuiltinModule?: (id: string) => unknown };
  };
  const moduleBuiltin = proc.process?.getBuiltinModule?.("module") as
    | typeof import("module")
    | undefined;
  if (!moduleBuiltin) return undefined;
  return moduleBuiltin.createRequire(import.meta.url);
}

function loadConfigFromFiles(): TypesugarConfig {
  try {
    const nodeRequire = getNodeRequire();
    if (!nodeRequire) return {};

    const { cosmiconfigSync } = nodeRequire("cosmiconfig") as {
      cosmiconfigSync: (
        name: string,
        options: { searchPlaces: string[] }
      ) => {
        search: () => { filepath?: string; config?: TypesugarConfig; isEmpty?: boolean } | null;
      };
    };
    const explorer = cosmiconfigSync(MODULE_NAME, {
      // NOTE: no `.mjs` entries. `cosmiconfigSync`'s ExplorerSync validates
      // every searchPlaces entry has a sync-compatible loader AT
      // CONSTRUCTION TIME — `.mjs` (ESM) has none (loading it requires an
      // async `import()`), so including it here throws immediately and
      // silently discards ALL file-based config for EVERY project, not
      // just ones that happen to use `.mjs` (the one `catch` below this
      // swallows the error). Found while wiring PEP-055's `approve-macros`
      // config read-back: `security.allowedMacroPackages` never round-
      // tripped through any config file, even `.ts` ones, because the
      // explorer itself never got past its constructor.
      searchPlaces: [
        "package.json",
        `.${MODULE_NAME}rc`,
        `.${MODULE_NAME}rc.json`,
        `.${MODULE_NAME}rc.yaml`,
        `.${MODULE_NAME}rc.yml`,
        `.${MODULE_NAME}rc.js`,
        `.${MODULE_NAME}rc.cjs`,
        `.${MODULE_NAME}rc.ts`,
        `${MODULE_NAME}.config.js`,
        `${MODULE_NAME}.config.cjs`,
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
