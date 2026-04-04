/**
 * Unified SFINAE rule registration.
 *
 * All consumers (LSP server, language service plugin, CLI) must call
 * `registerAllSfinaeRules()` instead of registering rules individually.
 * This single entry point prevents drift between IDE paths.
 *
 * @see PEP-034 Wave 1
 */

import {
  registerSfinaeRuleOnce,
  createMacroGeneratedRule,
  type PositionMapFn,
} from "@typesugar/core";
import { createExtensionMethodCallRule } from "./sfinae-rules.js";
import { createMacroDecoratorRule } from "./sfinae-rules.js";
import { createNewtypeAssignmentRule } from "./sfinae-rules.js";
import { createOperatorOverloadRule } from "./sfinae-rules.js";
import { createTypeRewriteAssignmentRule } from "./sfinae-rules.js";

export interface SfinaeRegistrationOptions {
  /** Required for MacroGeneratedRule — maps transformed positions back to original */
  positionMapFn?: PositionMapFn;
}

/**
 * Register all built-in SFINAE rules.
 *
 * Uses `registerSfinaeRuleOnce` so it's safe to call multiple times —
 * duplicate registrations are silently ignored.
 *
 * @returns The names of all rules that were newly registered (not already present).
 */
export function registerAllSfinaeRules(options?: SfinaeRegistrationOptions): string[] {
  const registered: string[] = [];

  if (options?.positionMapFn) {
    if (registerSfinaeRuleOnce(createMacroGeneratedRule(options.positionMapFn))) {
      registered.push("MacroGenerated");
    }
  }
  if (registerSfinaeRuleOnce(createExtensionMethodCallRule())) {
    registered.push("ExtensionMethodCall");
  }
  if (registerSfinaeRuleOnce(createMacroDecoratorRule())) {
    registered.push("MacroDecorator");
  }
  if (registerSfinaeRuleOnce(createNewtypeAssignmentRule())) {
    registered.push("NewtypeAssignment");
  }
  if (registerSfinaeRuleOnce(createOperatorOverloadRule())) {
    registered.push("OperatorOverload");
  }
  if (registerSfinaeRuleOnce(createTypeRewriteAssignmentRule())) {
    registered.push("TypeRewriteAssignment");
  }

  return registered;
}

/**
 * The complete set of SFINAE rule names registered by `registerAllSfinaeRules`.
 * Useful for tests that verify completeness.
 */
export const ALL_SFINAE_RULE_NAMES = [
  "MacroGenerated",
  "ExtensionMethodCall",
  "MacroDecorator",
  "NewtypeAssignment",
  "OperatorOverload",
  "TypeRewriteAssignment",
] as const;
