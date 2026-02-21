/**
 * Contract Configuration
 *
 * Contracts configuration is managed through the unified typesugar config system.
 * This module provides contract-specific accessors and helpers.
 *
 * Configuration sources (priority order):
 * 1. Environment variables: TYPESUGAR_CONTRACTS_MODE, TYPESUGAR_CONTRACTS_PROVE_AT_COMPILE_TIME
 * 2. Config files: typesugar.config.ts, .typesugarrc, etc.
 * 3. Programmatic: config.set({ contracts: { ... } })
 * 4. Defaults: mode="full", proveAtCompileTime=false
 *
 * @example Environment variables
 * ```bash
 * TYPESUGAR_CONTRACTS_MODE=none pnpm build           # Strip all checks
 * TYPESUGAR_CONTRACTS_MODE=assertions pnpm build     # Only invariants
 * TYPESUGAR_CONTRACTS_PROVE_AT_COMPILE_TIME=1        # Enable proof elision
 * ```
 *
 * @example Config file (typesugar.config.ts)
 * ```typescript
 * import { defineConfig } from "typesugar";
 *
 * export default defineConfig({
 *   contracts: {
 *     mode: "full",
 *     proveAtCompileTime: true,
 *     strip: {
 *       preconditions: false,
 *       postconditions: false,
 *       invariants: false,
 *     },
 *   },
 * });
 * ```
 */

import type { ProverPlugin } from "./prover/index.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Warning levels for decidability fallback.
 */
export type DecidabilityWarningLevel = "error" | "warn" | "info" | "off";

export interface ContractConfig {
  /**
   * Contract checking mode:
   * - "full": All checks enabled (default)
   * - "assertions": Only class invariants
   * - "none": All checks stripped
   */
  mode: "full" | "assertions" | "none";

  /**
   * Enable compile-time proof attempts.
   * When true, the prover tries to statically verify conditions
   * and omits runtime checks for proven ones.
   */
  proveAtCompileTime: boolean;

  /**
   * Fine-grained control per contract type.
   * When a key is true, that contract type is stripped.
   */
  strip: {
    preconditions?: boolean;
    postconditions?: boolean;
    invariants?: boolean;
  };

  /**
   * Registered prover plugins (e.g., Z3).
   * Plugins are tried after the built-in proof layers.
   */
  proverPlugins: ProverPlugin[];

  /**
   * Warning configuration for decidability fallback (Coq-inspired).
   *
   * Controls what happens when a predicate marked as "compile-time"
   * decidable falls back to runtime checking.
   */
  decidabilityWarnings: {
    /** Emit warning when compile-time predicates fall back to runtime */
    warnOnFallback: DecidabilityWarningLevel;
    /** Emit info when decidable predicates need SMT solver */
    warnOnSMT: DecidabilityWarningLevel;
    /** List of brands to ignore warnings for */
    ignoreBrands: string[];
  };
}

// ============================================================================
// Lazy Import of Core Config
// ============================================================================

/**
 * Core config interface for type safety (matches the shape from @typesugar/core).
 */
interface CoreConfigApi {
  get(key: string): unknown;
  set(values: Record<string, unknown>): void;
}

// We use dynamic import to avoid circular dependency issues
// since @typesugar/contracts may be imported before the core is fully initialized
let coreConfig: CoreConfigApi | null = null;

// Build a path that TypeScript's static analysis won't follow
// This prevents DTS generation from trying to include files outside rootDir
const CORE_CONFIG_PATH = ["../../../src/core", "config.js"].join("/");

async function getCoreConfig(): Promise<CoreConfigApi | null> {
  if (!coreConfig) {
    try {
      const module = await import(/* @vite-ignore */ CORE_CONFIG_PATH);
      coreConfig = module.config as CoreConfigApi;
    } catch {
      return null;
    }
  }
  return coreConfig;
}

// Synchronous version for use in macros (assumes config is already loaded)
function getCoreConfigSync(): CoreConfigApi | null {
  if (!coreConfig) {
    // Fallback to require for synchronous access
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const module = require(CORE_CONFIG_PATH);
      coreConfig = module.config as CoreConfigApi;
    } catch {
      // If core config isn't available, return null and use defaults
      return null;
    }
  }
  return coreConfig;
}

// ============================================================================
// Internal State (for prover plugins which aren't in the core config)
// ============================================================================

const proverPlugins: ProverPlugin[] = [];

// ============================================================================
// Public API
// ============================================================================

/**
 * Local config cache for when core config is not available (e.g., in tests).
 */
let localConfigCache: Partial<ContractConfig> | null = null;

/**
 * Get the current contract configuration.
 * Reads from the unified typesugar config system.
 */
export function getContractConfig(): ContractConfig {
  const cfg = getCoreConfigSync();

  if (cfg) {
    const mode = cfg.get("contracts.mode") as "full" | "assertions" | "none" | undefined;
    const proveAtCompileTime = cfg.get("contracts.proveAtCompileTime") as boolean | undefined;
    const stripPre = cfg.get("contracts.strip.preconditions") as boolean | undefined;
    const stripPost = cfg.get("contracts.strip.postconditions") as boolean | undefined;
    const stripInv = cfg.get("contracts.strip.invariants") as boolean | undefined;
    const warnOnFallback = cfg.get("contracts.decidabilityWarnings.warnOnFallback") as
      | DecidabilityWarningLevel
      | undefined;
    const warnOnSMT = cfg.get("contracts.decidabilityWarnings.warnOnSMT") as
      | DecidabilityWarningLevel
      | undefined;
    const ignoreBrands = cfg.get("contracts.decidabilityWarnings.ignoreBrands") as
      | string[]
      | undefined;

    return {
      mode: mode ?? "full",
      proveAtCompileTime: proveAtCompileTime ?? false,
      strip: {
        preconditions: stripPre ?? false,
        postconditions: stripPost ?? false,
        invariants: stripInv ?? false,
      },
      proverPlugins,
      decidabilityWarnings: {
        warnOnFallback: warnOnFallback ?? "warn",
        warnOnSMT: warnOnSMT ?? "info",
        ignoreBrands: ignoreBrands ?? [],
      },
    };
  }

  // Fallback to local cache (set by setContractConfig) or environment variables
  const envMode = process.env.TYPESUGAR_CONTRACTS_MODE;
  const defaultConfig: ContractConfig = {
    mode: envMode === "none" || envMode === "assertions" || envMode === "full" ? envMode : "full",
    proveAtCompileTime: process.env.TYPESUGAR_CONTRACTS_PROVE_AT_COMPILE_TIME === "1",
    strip: {},
    proverPlugins,
    decidabilityWarnings: {
      warnOnFallback: "warn",
      warnOnSMT: "info",
      ignoreBrands: [],
    },
  };

  // Merge with local cache if available
  if (localConfigCache) {
    return {
      ...defaultConfig,
      ...localConfigCache,
      strip: { ...defaultConfig.strip, ...localConfigCache.strip },
      decidabilityWarnings: {
        ...defaultConfig.decidabilityWarnings,
        ...localConfigCache.decidabilityWarnings,
      },
    };
  }

  return defaultConfig;
}

/**
 * Set contract configuration programmatically.
 * This updates the unified config system.
 *
 * @deprecated Use `config.set({ contracts: { ... } })` from typesugar instead
 */
export function setContractConfig(contractConfig: Partial<ContractConfig>): void {
  const cfg = getCoreConfigSync();

  if (cfg) {
    cfg.set({
      contracts: {
        mode: contractConfig.mode,
        proveAtCompileTime: contractConfig.proveAtCompileTime,
        strip: contractConfig.strip,
        decidabilityWarnings: contractConfig.decidabilityWarnings,
      },
    });
  }

  // Always update local cache as fallback (for tests)
  localConfigCache = { ...localConfigCache, ...contractConfig };

  // Always update prover plugins locally
  if (contractConfig.proverPlugins) {
    proverPlugins.length = 0;
    proverPlugins.push(...contractConfig.proverPlugins);
  }
}

/**
 * Register a prover plugin (e.g., Z3).
 */
export function registerProverPlugin(plugin: ProverPlugin): void {
  proverPlugins.push(plugin);
}

/**
 * Should a runtime check be emitted for the given contract type?
 */
export function shouldEmitCheck(type: "precondition" | "postcondition" | "invariant"): boolean {
  const config = getContractConfig();

  if (config.mode === "none") return false;
  if (config.mode === "assertions" && type !== "invariant") return false;

  const stripKey = {
    precondition: "preconditions" as const,
    postcondition: "postconditions" as const,
    invariant: "invariants" as const,
  }[type];

  return !config.strip[stripKey];
}

// ============================================================================
// Decidability Warning Helpers (Coq-inspired)
// ============================================================================

/**
 * Information about a decidability fallback event.
 */
export interface DecidabilityFallbackInfo {
  brand: string;
  expectedStrategy: "compile-time" | "decidable" | "runtime" | "undecidable";
  actualStrategy: string;
  reason?: string;
}

/**
 * Emit a decidability warning based on configuration.
 * Used when a predicate expected to be compile-time decidable falls back to runtime.
 */
export function emitDecidabilityWarning(info: DecidabilityFallbackInfo): void {
  const config = getContractConfig();
  const { decidabilityWarnings } = config;

  // Check if this brand should be ignored
  if (decidabilityWarnings.ignoreBrands.includes(info.brand)) {
    return;
  }

  // Determine which warning level to use
  let level: DecidabilityWarningLevel = "off";
  let message = "";

  if (
    info.expectedStrategy === "compile-time" &&
    info.actualStrategy !== "constant" &&
    info.actualStrategy !== "type"
  ) {
    // Compile-time predicate fell back to runtime strategy
    level = decidabilityWarnings.warnOnFallback;
    message = `Predicate "${info.brand}" marked as compile-time decidable fell back to ${info.actualStrategy}`;
    if (info.reason) message += `: ${info.reason}`;
  } else if (info.actualStrategy === "z3" || info.actualStrategy === "plugin") {
    // Had to use SMT solver
    level = decidabilityWarnings.warnOnSMT;
    message = `Predicate "${info.brand}" required SMT solver for verification`;
    if (info.reason) message += `: ${info.reason}`;
  }

  // Emit the warning at the appropriate level
  if (level === "off") return;

  const prefix = "[typesugar/contracts decidability]";
  switch (level) {
    case "error":
      console.error(`${prefix} ERROR: ${message}`);
      break;
    case "warn":
      console.warn(`${prefix} WARN: ${message}`);
      break;
    case "info":
      if (process.env.NODE_ENV === "development") {
        console.info(`${prefix} INFO: ${message}`);
      }
      break;
  }
}

/**
 * Check if a predicate's decidability allows compile-time proving.
 */
export function canProveAtCompileTime(
  decidability: "compile-time" | "decidable" | "runtime" | "undecidable"
): boolean {
  return decidability === "compile-time" || decidability === "decidable";
}

/**
 * Check if a predicate must always be checked at runtime.
 */
export function mustCheckAtRuntime(
  decidability: "compile-time" | "decidable" | "runtime" | "undecidable"
): boolean {
  return decidability === "runtime" || decidability === "undecidable";
}
