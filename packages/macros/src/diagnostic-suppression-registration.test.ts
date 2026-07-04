/**
 * Tests for unified diagnostic suppression registration (PEP-034 Wave 1B)
 *
 * Verifies:
 * 1. registerAllDiagnosticSuppressionRules() registers the expected set of rules
 * 2. Calling it twice doesn't duplicate rules
 * 3. Without positionMapFn, MacroGenerated is omitted
 * 4. With positionMapFn, MacroGenerated is included
 */

import { describe, it, expect, beforeEach } from "vitest";
import { clearDiagnosticSuppressionRules, getDiagnosticSuppressionRules } from "@typesugar/core";
import {
  registerAllDiagnosticSuppressionRules,
  ALL_DIAGNOSTIC_SUPPRESSION_RULE_NAMES,
} from "./diagnostic-suppression-registration.js";

describe("registerAllDiagnosticSuppressionRules", () => {
  beforeEach(() => {
    clearDiagnosticSuppressionRules();
  });

  it("registers all non-positional rules when called without options", () => {
    const registered = registerAllDiagnosticSuppressionRules();
    const rules = getDiagnosticSuppressionRules();
    const ruleNames = rules.map((r) => r.name);

    expect(registered).toEqual([
      "ExtensionMethodCall",
      "MacroCallChain",
      "MacroDecorator",
      "NewtypeAssignment",
      "OperatorOverload",
      "TypeRewriteAssignment",
    ]);
    expect(ruleNames).toEqual(registered);
  });

  it("registers MacroGenerated when positionMapFn is provided", () => {
    const dummyMapFn = (_fileName: string, _pos: number): number | null => null;
    const registered = registerAllDiagnosticSuppressionRules({ positionMapFn: dummyMapFn });
    const rules = getDiagnosticSuppressionRules();
    const ruleNames = rules.map((r) => r.name);

    expect(registered).toContain("MacroGenerated");
    expect(ruleNames).toContain("MacroGenerated");
    expect(rules).toHaveLength(7);
  });

  it("returns empty array on duplicate registration", () => {
    registerAllDiagnosticSuppressionRules();
    const second = registerAllDiagnosticSuppressionRules();
    expect(second).toEqual([]);
    // Rules should still be there, just not re-registered
    expect(getDiagnosticSuppressionRules()).toHaveLength(6);
  });

  it("ALL_DIAGNOSTIC_SUPPRESSION_RULE_NAMES contains every rule", () => {
    const dummyMapFn = (_fileName: string, _pos: number): number | null => null;
    registerAllDiagnosticSuppressionRules({ positionMapFn: dummyMapFn });
    const ruleNames = getDiagnosticSuppressionRules().map((r) => r.name);
    expect(ruleNames).toEqual([...ALL_DIAGNOSTIC_SUPPRESSION_RULE_NAMES]);
  });
});
