/**
 * Unified diagnostic suppression rule registration.
 *
 * All consumers (LSP server, language service plugin, CLI) must call
 * `registerAllDiagnosticSuppressionRules()` instead of registering rules individually.
 * This single entry point prevents drift between IDE paths.
 *
 * @see PEP-034 Wave 1
 */

import {
  registerDiagnosticSuppressionRuleOnce,
  registerOrReplaceDiagnosticSuppressionRule,
  createMacroGeneratedRule,
  type PositionMapFn,
} from "@typesugar/core";
import {
  createDerivedCompanionAccessRule,
  createExtensionMethodCallRule,
  createMacroCallChainRule,
  createMacroDecoratorRule,
  createMatchSwitchRule,
  createOperatorOverloadRule,
  createTypeRewriteAssignmentRule,
} from "./diagnostic-suppression-rules.js";

export interface DiagnosticSuppressionRegistrationOptions {
  /** Required for MacroGeneratedRule — maps transformed positions back to original */
  positionMapFn?: PositionMapFn;
}

/**
 * Register all built-in diagnostic suppression rules.
 *
 * Uses `registerDiagnosticSuppressionRuleOnce` so it's safe to call multiple times —
 * duplicate registrations are silently ignored. The exception is MacroGenerated,
 * whose behaviour depends on the `positionMapFn` it closes over: a later
 * registration REPLACES it, so a multi-project host (tsserver) is never left
 * with the first project's mapper (deep-review core #33). Hosts should still
 * pass their per-project `positionMapFn` and `program` to `filterDiagnostics`
 * as its `context` argument, which takes precedence over the registered one.
 *
 * @returns The names of all rules that were newly registered (not already present).
 */
export function registerAllDiagnosticSuppressionRules(
  options?: DiagnosticSuppressionRegistrationOptions
): string[] {
  const registered: string[] = [];

  if (options?.positionMapFn) {
    if (
      registerOrReplaceDiagnosticSuppressionRule(createMacroGeneratedRule(options.positionMapFn))
    ) {
      registered.push("MacroGenerated");
    }
  }
  if (registerDiagnosticSuppressionRuleOnce(createExtensionMethodCallRule())) {
    registered.push("ExtensionMethodCall");
  }
  if (registerDiagnosticSuppressionRuleOnce(createMacroCallChainRule())) {
    registered.push("MacroCallChain");
  }
  if (registerDiagnosticSuppressionRuleOnce(createMatchSwitchRule())) {
    registered.push("MatchSwitch");
  }
  if (registerDiagnosticSuppressionRuleOnce(createMacroDecoratorRule())) {
    registered.push("MacroDecorator");
  }
  if (registerDiagnosticSuppressionRuleOnce(createOperatorOverloadRule())) {
    registered.push("OperatorOverload");
  }
  if (registerDiagnosticSuppressionRuleOnce(createTypeRewriteAssignmentRule())) {
    registered.push("TypeRewriteAssignment");
  }
  if (registerDiagnosticSuppressionRuleOnce(createDerivedCompanionAccessRule())) {
    registered.push("DerivedCompanionAccess");
  }

  return registered;
}

/**
 * The complete set of diagnostic suppression rule names registered by `registerAllDiagnosticSuppressionRules`.
 * Useful for tests that verify completeness.
 */
export const ALL_DIAGNOSTIC_SUPPRESSION_RULE_NAMES = [
  "MacroGenerated",
  "ExtensionMethodCall",
  "MacroCallChain",
  "MatchSwitch",
  "MacroDecorator",
  "OperatorOverload",
  "TypeRewriteAssignment",
  "DerivedCompanionAccess",
] as const;
