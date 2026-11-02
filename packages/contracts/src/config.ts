/**
 * Contract Configuration
 *
 * Contracts configuration is managed through the unified typesugar config system.
 * This module provides contract-specific accessors and helpers.
 *
 * Configuration sources (all via the unified `@typesugar/core` config):
 * 1. Environment variables: TYPESUGAR_CONTRACTS_MODE, TYPESUGAR_CONTRACTS_PROVE_AT_COMPILE_TIME
 *    (mapped onto `contracts.*` by core)
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

import type { ContractsConfig } from "@typesugar/core";
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
   * Registered prover plugins.
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
// Unified config (@typesugar/core)
// ============================================================================

/**
 * Where the `contracts.*` settings come from.
 *
 * The values live in the unified `@typesugar/core` config (config files,
 * `config.set(...)`, and the `TYPESUGAR_CONTRACTS_*` environment variables,
 * which core maps onto `contracts.*`). This module is part of the
 * `@typesugar/contracts` RUNTIME entry, which must not pull in
 * `@typesugar/core` (that would drag `typescript` into application bundles —
 * PEP-050), so the build-time `./macros` entry installs a synchronous
 * accessor for `config.get<ContractsConfig>("contracts")` when it loads.
 *
 * Previously this module tried to `require("../../../src/core/config.js")` —
 * a path that does not exist (and `require` is a throwing shim in ESM) — so
 * every `contracts.*` setting (mode "none", proveAtCompileTime, strip, ...)
 * was silently ignored (deep review 2026-10, effect-contracts #8).
 */
export interface ContractsConfigSource {
  get(): (ContractsConfig & Record<string, unknown>) | undefined;
  set(values: Record<string, unknown>): void;
}

// Shared across the CJS/ESM copies of this module (see type-facts.ts).
const SOURCE_KEY = Symbol.for("@typesugar/contracts/config-source");
const sourceHolder = globalThis as unknown as Record<symbol, ContractsConfigSource | undefined>;

/** @internal Installed by `@typesugar/contracts/macros`. */
export function setContractsConfigSource(source: ContractsConfigSource | undefined): void {
  sourceHolder[SOURCE_KEY] = source;
}

function getSource(): ContractsConfigSource | undefined {
  return sourceHolder[SOURCE_KEY];
}

// ============================================================================
// Internal State (for prover plugins which aren't in the core config)
// ============================================================================

const proverPlugins: ProverPlugin[] = [];

// ============================================================================
// Public API
// ============================================================================

/**
 * Local config cache for when core config is not available (runtime-only
 * use without the macros entry loaded).
 */
let localConfigCache: Partial<ContractConfig> | null = null;

const DEFAULT_DECIDABILITY: ContractConfig["decidabilityWarnings"] = {
  warnOnFallback: "warn",
  warnOnSMT: "info",
  ignoreBrands: [],
};

/**
 * Get the current contract configuration.
 * Reads from the unified typesugar config system.
 */
export function getContractConfig(): ContractConfig {
  const source = getSource();

  if (source) {
    const c = source.get() ?? {};
    const dw = (c.decidabilityWarnings ?? {}) as Partial<ContractConfig["decidabilityWarnings"]>;
    return {
      mode: c.mode ?? "full",
      proveAtCompileTime: c.proveAtCompileTime ?? false,
      strip: {
        preconditions: c.strip?.preconditions ?? false,
        postconditions: c.strip?.postconditions ?? false,
        invariants: c.strip?.invariants ?? false,
      },
      proverPlugins,
      decidabilityWarnings: { ...DEFAULT_DECIDABILITY, ...dw },
    };
  }

  const defaultConfig: ContractConfig = {
    mode: "full",
    proveAtCompileTime: false,
    strip: {},
    proverPlugins,
    decidabilityWarnings: { ...DEFAULT_DECIDABILITY },
  };

  if (localConfigCache) {
    return {
      ...defaultConfig,
      ...localConfigCache,
      proverPlugins,
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
  const source = getSource();

  if (source) {
    // Core's config.set deep-merges, so spell out every `strip` key: passing
    // `strip: {}` must clear an earlier `strip: { preconditions: true }`
    // (the replace-the-given-keys semantics this function always had).
    const contracts: Record<string, unknown> = {};
    if (contractConfig.mode !== undefined) contracts.mode = contractConfig.mode;
    if (contractConfig.proveAtCompileTime !== undefined) {
      contracts.proveAtCompileTime = contractConfig.proveAtCompileTime;
    }
    if (contractConfig.strip !== undefined) {
      contracts.strip = {
        preconditions: contractConfig.strip.preconditions ?? false,
        postconditions: contractConfig.strip.postconditions ?? false,
        invariants: contractConfig.strip.invariants ?? false,
      };
    }
    if (contractConfig.decidabilityWarnings !== undefined) {
      contracts.decidabilityWarnings = {
        ...DEFAULT_DECIDABILITY,
        ...contractConfig.decidabilityWarnings,
      };
    }
    source.set({ contracts });
  }

  // Always update local cache as fallback (runtime-only use)
  localConfigCache = { ...localConfigCache, ...contractConfig };

  // Always update prover plugins locally
  if (contractConfig.proverPlugins) {
    proverPlugins.length = 0;
    proverPlugins.push(...contractConfig.proverPlugins);
  }
}

/**
 * Register a prover plugin.
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
  } else if (info.actualStrategy === "plugin") {
    // Had to use external prover plugin
    level = decidabilityWarnings.warnOnSMT;
    message = `Predicate "${info.brand}" required external prover for verification`;
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
      if (typeof process !== "undefined" && process.env?.NODE_ENV === "development") {
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
