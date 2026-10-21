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
import * as ts from "typescript";
import {
  clearDiagnosticSuppressionRules,
  getDiagnosticSuppressionRules,
  evaluateDiagnosticSuppression,
} from "@typesugar/core";
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
      "MatchSwitch",
      "MacroDecorator",
      "OperatorOverload",
      "TypeRewriteAssignment",
      "DerivedCompanionAccess",
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
    expect(rules).toHaveLength(8);
  });

  it("returns empty array on duplicate registration", () => {
    registerAllDiagnosticSuppressionRules();
    const second = registerAllDiagnosticSuppressionRules();
    expect(second).toEqual([]);
    // Rules should still be there, just not re-registered
    expect(getDiagnosticSuppressionRules()).toHaveLength(7);
  });

  it("ALL_DIAGNOSTIC_SUPPRESSION_RULE_NAMES contains every rule", () => {
    const dummyMapFn = (_fileName: string, _pos: number): number | null => null;
    registerAllDiagnosticSuppressionRules({ positionMapFn: dummyMapFn });
    const ruleNames = getDiagnosticSuppressionRules().map((r) => r.name);
    expect(ruleNames).toEqual([...ALL_DIAGNOSTIC_SUPPRESSION_RULE_NAMES]);
  });

  it("a second project's registration replaces MacroGenerated's mapper (deep-review core #33)", () => {
    // Project 1: every position maps back to source (nothing generated).
    registerAllDiagnosticSuppressionRules({ positionMapFn: (_f, pos) => pos });
    // Project 2 (same tsserver process): everything in its file is generated.
    registerAllDiagnosticSuppressionRules({ positionMapFn: () => null });

    const rules = getDiagnosticSuppressionRules();
    expect(rules.filter((r) => r.name === "MacroGenerated")).toHaveLength(1);

    const sf = ts.createSourceFile("p2.ts", "const x = 1;", ts.ScriptTarget.Latest, true);
    const diag: ts.Diagnostic = {
      file: sf,
      start: 6,
      length: 1,
      messageText: "Cannot find name 'x'.",
      category: ts.DiagnosticCategory.Error,
      code: 2304,
    };
    expect(evaluateDiagnosticSuppression(diag, {} as ts.TypeChecker, sf)).toBe(true);
  });
});
