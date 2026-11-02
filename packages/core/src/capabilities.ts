/**
 * Macro Capability Tracking — EXPERIMENTAL, NOT ENFORCED.
 *
 * @experimental Nothing in typesugar applies these yet (deep review core #39,
 * SECURITY-REVIEW.md F4): macro definitions have no `capabilities` field, the
 * transformer never calls {@link createRestrictedContext} or
 * {@link resolveCapabilities}, and `needsFileSystem` is not read anywhere
 * (not even by the proxy). Every macro runs with the full `MacroContext` and
 * ordinary Node access. Do not rely on this module for security.
 *
 * Intended design: macros declare their required capabilities, and the
 * system provides a restricted MacroContext that only exposes the requested
 * operations (inspired by Scala 3 `Quotes`, Rust proc-macro capability flags).
 * Today the proxy can be applied by hand:
 *
 * @example
 * ```typescript
 * const restricted = createRestrictedContext(
 *   ctx,
 *   resolveCapabilities({ needsTypeChecker: false }),
 *   "myMacro"
 * );
 * restricted.getTypeOf(node); // throws: needsTypeChecker not declared
 * ```
 */

import type { MacroContext } from "./types.js";

// =============================================================================
// Capability Flags
// =============================================================================

/**
 * Capabilities that a macro can request.
 * By default, all capabilities are granted (backward compatible).
 */
export interface MacroCapabilities {
  /** Whether the macro needs access to the TypeScript type checker */
  needsTypeChecker?: boolean;

  /**
   * Whether the macro needs file system access (for include macros).
   * NOT ENFORCED: nothing reads this flag, including `createRestrictedContext`.
   */
  needsFileSystem?: boolean;

  /** Whether the macro needs project-wide analysis (for collectTypes) */
  needsProjectIndex?: boolean;

  /** Whether the macro can emit diagnostics (errors/warnings) */
  canEmitDiagnostics?: boolean;

  /** Override the default comptime timeout (ms) */
  maxTimeout?: number;
}

/** Default capabilities (only consulted by {@link resolveCapabilities}; see the module note). */
export const DEFAULT_CAPABILITIES: Required<MacroCapabilities> = {
  needsTypeChecker: true,
  needsFileSystem: false,
  needsProjectIndex: false,
  canEmitDiagnostics: true,
  maxTimeout: 5000,
};

/**
 * Merge user-specified capabilities with defaults.
 */
export function resolveCapabilities(caps?: MacroCapabilities): Required<MacroCapabilities> {
  if (!caps) return { ...DEFAULT_CAPABILITIES };
  return {
    needsTypeChecker: caps.needsTypeChecker ?? DEFAULT_CAPABILITIES.needsTypeChecker,
    needsFileSystem: caps.needsFileSystem ?? DEFAULT_CAPABILITIES.needsFileSystem,
    needsProjectIndex: caps.needsProjectIndex ?? DEFAULT_CAPABILITIES.needsProjectIndex,
    canEmitDiagnostics: caps.canEmitDiagnostics ?? DEFAULT_CAPABILITIES.canEmitDiagnostics,
    maxTimeout: caps.maxTimeout ?? DEFAULT_CAPABILITIES.maxTimeout,
  };
}

// =============================================================================
// Restricted MacroContext
// =============================================================================

/**
 * Create a restricted MacroContext that only exposes capabilities
 * declared by the macro. Accessing restricted operations throws
 * a clear error message.
 */
export function createRestrictedContext(
  inner: MacroContext,
  capabilities: Required<MacroCapabilities>,
  macroName: string
): MacroContext {
  const restrictedMessage = (operation: string, capability: string) =>
    `Macro '${macroName}' attempted to use '${operation}' but does not declare ` +
    `the '${capability}' capability. Add '${capability}: true' to the macro's ` +
    `capabilities to enable this operation.`;

  const handler: ProxyHandler<MacroContext> = {
    get(target, prop, receiver) {
      // Type checker operations
      if (!capabilities.needsTypeChecker) {
        switch (prop) {
          case "typeChecker":
            throw new Error(restrictedMessage("typeChecker", "needsTypeChecker"));
          case "getTypeOf":
          case "getTypeString":
          case "isAssignableTo":
          case "getPropertiesOfType":
          case "getSymbol":
            return () => {
              throw new Error(restrictedMessage(String(prop), "needsTypeChecker"));
            };
        }
      }

      // Diagnostic operations
      if (!capabilities.canEmitDiagnostics) {
        switch (prop) {
          case "reportError":
          case "reportWarning":
            return () => {
              throw new Error(restrictedMessage(String(prop), "canEmitDiagnostics"));
            };
        }
      }

      return Reflect.get(target, prop, receiver);
    },
  };

  return new Proxy(inner, handler);
}
