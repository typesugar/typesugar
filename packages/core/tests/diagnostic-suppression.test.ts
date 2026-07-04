/**
 * Tests for the diagnostic suppression system (PEP-011 Wave 1)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as ts from "typescript";
import {
  registerDiagnosticSuppressionRule,
  registerDiagnosticSuppressionRuleOnce,
  clearDiagnosticSuppressionRules,
  getDiagnosticSuppressionRules,
  evaluateDiagnosticSuppression,
  filterDiagnostics,
  getDiagnosticSuppressionAuditLog,
  clearDiagnosticSuppressionAuditLog,
  setDiagnosticSuppressionAuditMode,
  isDiagnosticSuppressionAuditEnabled,
  createMacroGeneratedRule,
  type DiagnosticSuppressionRule,
} from "@typesugar/core";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createSourceFile(content: string, fileName = "test.ts"): ts.SourceFile {
  return ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
}

function makeDiagnostic(
  code: number,
  message: string,
  sourceFile: ts.SourceFile,
  start = 0,
  length = 1
): ts.Diagnostic {
  return {
    file: sourceFile,
    start,
    length,
    messageText: message,
    category: ts.DiagnosticCategory.Error,
    code,
    source: undefined,
  };
}

const dummyChecker = {} as ts.TypeChecker;

// ---------------------------------------------------------------------------
// Registry tests
// ---------------------------------------------------------------------------

describe("Diagnostic Suppression Registry", () => {
  beforeEach(() => {
    clearDiagnosticSuppressionRules();
  });

  it("starts with no rules", () => {
    expect(getDiagnosticSuppressionRules()).toHaveLength(0);
  });

  it("registers a rule", () => {
    const rule: DiagnosticSuppressionRule = {
      name: "TestRule",
      errorCodes: [2339],
      shouldSuppress: () => true,
    };
    registerDiagnosticSuppressionRule(rule);
    expect(getDiagnosticSuppressionRules()).toHaveLength(1);
    expect(getDiagnosticSuppressionRules()[0].name).toBe("TestRule");
  });

  it("registers multiple rules in order", () => {
    registerDiagnosticSuppressionRule({ name: "A", errorCodes: [1], shouldSuppress: () => false });
    registerDiagnosticSuppressionRule({ name: "B", errorCodes: [2], shouldSuppress: () => false });
    registerDiagnosticSuppressionRule({ name: "C", errorCodes: [3], shouldSuppress: () => false });

    const rules = getDiagnosticSuppressionRules();
    expect(rules).toHaveLength(3);
    expect(rules.map((r) => r.name)).toEqual(["A", "B", "C"]);
  });

  it("clearDiagnosticSuppressionRules removes all rules", () => {
    registerDiagnosticSuppressionRule({ name: "X", errorCodes: [], shouldSuppress: () => true });
    expect(getDiagnosticSuppressionRules()).toHaveLength(1);

    clearDiagnosticSuppressionRules();
    expect(getDiagnosticSuppressionRules()).toHaveLength(0);
  });

  it("registerDiagnosticSuppressionRuleOnce deduplicates by name", () => {
    const ruleA: DiagnosticSuppressionRule = {
      name: "Dedup",
      errorCodes: [1],
      shouldSuppress: () => true,
    };
    const ruleB: DiagnosticSuppressionRule = {
      name: "Dedup",
      errorCodes: [2],
      shouldSuppress: () => false,
    };

    expect(registerDiagnosticSuppressionRuleOnce(ruleA)).toBe(true);
    expect(registerDiagnosticSuppressionRuleOnce(ruleB)).toBe(false);
    expect(getDiagnosticSuppressionRules()).toHaveLength(1);
    expect(getDiagnosticSuppressionRules()[0].errorCodes).toEqual([1]);
  });

  it("registerDiagnosticSuppressionRuleOnce allows different names", () => {
    expect(
      registerDiagnosticSuppressionRuleOnce({
        name: "R1",
        errorCodes: [],
        shouldSuppress: () => true,
      })
    ).toBe(true);
    expect(
      registerDiagnosticSuppressionRuleOnce({
        name: "R2",
        errorCodes: [],
        shouldSuppress: () => true,
      })
    ).toBe(true);
    expect(getDiagnosticSuppressionRules()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// evaluateDiagnosticSuppression tests
// ---------------------------------------------------------------------------

describe("evaluateDiagnosticSuppression", () => {
  const sf = createSourceFile("const x = 1;");

  beforeEach(() => {
    clearDiagnosticSuppressionRules();
    setDiagnosticSuppressionAuditMode(false);
  });

  it("returns false when no rules are registered", () => {
    const diag = makeDiagnostic(2339, "Property 'foo' does not exist", sf);
    expect(evaluateDiagnosticSuppression(diag, dummyChecker, sf)).toBe(false);
  });

  it("returns true when a matching rule suppresses", () => {
    registerDiagnosticSuppressionRule({
      name: "AlwaysSuppress",
      errorCodes: [2339],
      shouldSuppress: () => true,
    });

    const diag = makeDiagnostic(2339, "Property 'foo' does not exist", sf);
    expect(evaluateDiagnosticSuppression(diag, dummyChecker, sf)).toBe(true);
  });

  it("skips rules that don't match the error code", () => {
    const spy = vi.fn(() => true);
    registerDiagnosticSuppressionRule({
      name: "WrongCode",
      errorCodes: [9999],
      shouldSuppress: spy,
    });

    const diag = makeDiagnostic(2339, "Property 'foo' does not exist", sf);
    expect(evaluateDiagnosticSuppression(diag, dummyChecker, sf)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("wildcard errorCodes (empty array) matches any code", () => {
    registerDiagnosticSuppressionRule({
      name: "Wildcard",
      errorCodes: [],
      shouldSuppress: () => true,
    });

    const diag = makeDiagnostic(2339, "anything", sf);
    expect(evaluateDiagnosticSuppression(diag, dummyChecker, sf)).toBe(true);
  });

  it("first matching rule wins", () => {
    const spyA = vi.fn(() => true);
    const spyB = vi.fn(() => true);

    registerDiagnosticSuppressionRule({ name: "A", errorCodes: [2339], shouldSuppress: spyA });
    registerDiagnosticSuppressionRule({ name: "B", errorCodes: [2339], shouldSuppress: spyB });

    const diag = makeDiagnostic(2339, "test", sf);
    evaluateDiagnosticSuppression(diag, dummyChecker, sf);

    expect(spyA).toHaveBeenCalledOnce();
    expect(spyB).not.toHaveBeenCalled();
  });

  it("continues to next rule when current rule returns false", () => {
    const spyA = vi.fn(() => false);
    const spyB = vi.fn(() => true);

    registerDiagnosticSuppressionRule({ name: "A", errorCodes: [2339], shouldSuppress: spyA });
    registerDiagnosticSuppressionRule({ name: "B", errorCodes: [2339], shouldSuppress: spyB });

    const diag = makeDiagnostic(2339, "test", sf);
    expect(evaluateDiagnosticSuppression(diag, dummyChecker, sf)).toBe(true);

    expect(spyA).toHaveBeenCalledOnce();
    expect(spyB).toHaveBeenCalledOnce();
  });

  it("survives a rule that throws", () => {
    registerDiagnosticSuppressionRule({
      name: "Broken",
      errorCodes: [],
      shouldSuppress: () => {
        throw new Error("boom");
      },
    });
    registerDiagnosticSuppressionRule({
      name: "Fallback",
      errorCodes: [],
      shouldSuppress: () => true,
    });

    const diag = makeDiagnostic(2339, "test", sf);
    expect(evaluateDiagnosticSuppression(diag, dummyChecker, sf)).toBe(true);
  });

  it("logs thrown rule errors when audit mode is enabled", () => {
    setDiagnosticSuppressionAuditMode(true);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    registerDiagnosticSuppressionRule({
      name: "Exploding",
      errorCodes: [],
      shouldSuppress: () => {
        throw new Error("kaboom");
      },
    });

    const diag = makeDiagnostic(2339, "test", sf);
    evaluateDiagnosticSuppression(diag, dummyChecker, sf);

    expect(errSpy).toHaveBeenCalledOnce();
    const output = errSpy.mock.calls[0][0] as string;
    expect(output).toContain("[DiagnosticSuppression]");
    expect(output).toContain("Exploding");
    expect(output).toContain("kaboom");

    errSpy.mockRestore();
    setDiagnosticSuppressionAuditMode(undefined);
  });
});

// ---------------------------------------------------------------------------
// filterDiagnostics tests
// ---------------------------------------------------------------------------

describe("filterDiagnostics", () => {
  const sf = createSourceFile("const x = 1;\nconst y = 2;", "app.ts");

  beforeEach(() => {
    clearDiagnosticSuppressionRules();
    setDiagnosticSuppressionAuditMode(false);
  });

  it("returns all diagnostics when no rules registered", () => {
    const diags = [makeDiagnostic(2339, "err1", sf, 0), makeDiagnostic(2322, "err2", sf, 14)];
    const result = filterDiagnostics(diags, dummyChecker, () => sf);
    expect(result).toHaveLength(2);
  });

  it("filters out diagnostics matched by rules", () => {
    registerDiagnosticSuppressionRule({
      name: "Suppress2339",
      errorCodes: [2339],
      shouldSuppress: () => true,
    });

    const diags = [
      makeDiagnostic(2339, "property error", sf, 0),
      makeDiagnostic(2322, "assignment error", sf, 14),
    ];
    const result = filterDiagnostics(diags, dummyChecker, () => sf);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe(2322);
  });

  it("keeps diagnostics with no source file", () => {
    registerDiagnosticSuppressionRule({
      name: "SuppressAll",
      errorCodes: [],
      shouldSuppress: () => true,
    });

    const diagNoFile: ts.Diagnostic = {
      file: undefined,
      start: undefined,
      length: undefined,
      messageText: "global error",
      category: ts.DiagnosticCategory.Error,
      code: 1000,
    };

    const result = filterDiagnostics([diagNoFile], dummyChecker, () => undefined);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Audit mode tests
// ---------------------------------------------------------------------------

describe("Diagnostic Suppression Audit Mode", () => {
  const sf = createSourceFile("const x = 1;", "audit.ts");

  beforeEach(() => {
    clearDiagnosticSuppressionRules();
    clearDiagnosticSuppressionAuditLog();
    setDiagnosticSuppressionAuditMode(false);
  });

  afterEach(() => {
    setDiagnosticSuppressionAuditMode(undefined);
  });

  it("does not log when audit mode is off", () => {
    registerDiagnosticSuppressionRule({
      name: "TestRule",
      errorCodes: [2339],
      shouldSuppress: () => true,
    });

    evaluateDiagnosticSuppression(makeDiagnostic(2339, "test", sf), dummyChecker, sf);
    expect(getDiagnosticSuppressionAuditLog()).toHaveLength(0);
  });

  it("logs when audit mode is on", () => {
    setDiagnosticSuppressionAuditMode(true);
    registerDiagnosticSuppressionRule({
      name: "TestRule",
      errorCodes: [2339],
      shouldSuppress: () => true,
    });

    evaluateDiagnosticSuppression(
      makeDiagnostic(2339, "Property 'clamp' does not exist", sf),
      dummyChecker,
      sf
    );

    const log = getDiagnosticSuppressionAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0].errorCode).toBe(2339);
    expect(log[0].ruleName).toBe("TestRule");
    expect(log[0].messageText).toBe("Property 'clamp' does not exist");
    expect(log[0].fileName).toBe("audit.ts");
  });

  it("clearDiagnosticSuppressionAuditLog clears the log", () => {
    setDiagnosticSuppressionAuditMode(true);
    registerDiagnosticSuppressionRule({
      name: "R",
      errorCodes: [],
      shouldSuppress: () => true,
    });

    evaluateDiagnosticSuppression(makeDiagnostic(1, "a", sf), dummyChecker, sf);
    expect(getDiagnosticSuppressionAuditLog()).toHaveLength(1);

    clearDiagnosticSuppressionAuditLog();
    expect(getDiagnosticSuppressionAuditLog()).toHaveLength(0);
  });

  it("isDiagnosticSuppressionAuditEnabled respects programmatic override", () => {
    expect(isDiagnosticSuppressionAuditEnabled()).toBe(false);
    setDiagnosticSuppressionAuditMode(true);
    expect(isDiagnosticSuppressionAuditEnabled()).toBe(true);
    setDiagnosticSuppressionAuditMode(undefined);
    // Falls back to env var (which is unset in test env)
    expect(isDiagnosticSuppressionAuditEnabled()).toBe(false);
  });

  it("prints audit entries to stderr", () => {
    setDiagnosticSuppressionAuditMode(true);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    registerDiagnosticSuppressionRule({
      name: "TestRule",
      errorCodes: [2339],
      shouldSuppress: () => true,
    });

    evaluateDiagnosticSuppression(
      makeDiagnostic(2339, "Property 'clamp' does not exist", sf),
      dummyChecker,
      sf
    );

    expect(errSpy).toHaveBeenCalledOnce();
    const output = errSpy.mock.calls[0][0] as string;
    expect(output).toContain("[DiagnosticSuppression]");
    expect(output).toContain("TS2339");
    expect(output).toContain("TestRule");

    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// MacroGenerated rule tests
// ---------------------------------------------------------------------------

describe("MacroGenerated Rule (Rule 4)", () => {
  const sf = createSourceFile("const x = 1;\nconst y = 2;", "generated.ts");

  beforeEach(() => {
    clearDiagnosticSuppressionRules();
    setDiagnosticSuppressionAuditMode(false);
  });

  it("suppresses when position maps to null", () => {
    const rule = createMacroGeneratedRule((_file, _pos) => null);
    registerDiagnosticSuppressionRule(rule);

    const diag = makeDiagnostic(2339, "error in generated code", sf, 5);
    expect(evaluateDiagnosticSuppression(diag, dummyChecker, sf)).toBe(true);
  });

  it("does not suppress when position maps to a valid original position", () => {
    const rule = createMacroGeneratedRule((_file, pos) => pos);
    registerDiagnosticSuppressionRule(rule);

    const diag = makeDiagnostic(2339, "real error", sf, 5);
    expect(evaluateDiagnosticSuppression(diag, dummyChecker, sf)).toBe(false);
  });

  it("does not suppress diagnostics with no start position", () => {
    const rule = createMacroGeneratedRule(() => null);
    registerDiagnosticSuppressionRule(rule);

    const diag: ts.Diagnostic = {
      file: sf,
      start: undefined,
      length: undefined,
      messageText: "no position",
      category: ts.DiagnosticCategory.Error,
      code: 2339,
    };
    expect(evaluateDiagnosticSuppression(diag, dummyChecker, sf)).toBe(false);
  });

  it("does not suppress diagnostics with no file", () => {
    const rule = createMacroGeneratedRule(() => null);
    registerDiagnosticSuppressionRule(rule);

    const diag: ts.Diagnostic = {
      file: undefined,
      start: 0,
      length: 1,
      messageText: "no file",
      category: ts.DiagnosticCategory.Error,
      code: 2339,
    };
    expect(evaluateDiagnosticSuppression(diag, dummyChecker, sf)).toBe(false);
  });

  it("uses the file name from the diagnostic", () => {
    const fileNames: string[] = [];
    const rule = createMacroGeneratedRule((fileName, _pos) => {
      fileNames.push(fileName);
      return null;
    });
    registerDiagnosticSuppressionRule(rule);

    const diag = makeDiagnostic(2339, "test", sf, 0);
    evaluateDiagnosticSuppression(diag, dummyChecker, sf);

    expect(fileNames).toEqual(["generated.ts"]);
  });

  it("suppresses macro-generated diagnostics for all registered codes", () => {
    const rule = createMacroGeneratedRule(() => null);
    expect(rule.errorCodes.length).toBeGreaterThan(0);

    registerDiagnosticSuppressionRule(rule);

    // All registered error codes should be suppressed when position maps to null (generated)
    for (const code of rule.errorCodes) {
      const diag = makeDiagnostic(code, "test", sf, 0);
      expect(evaluateDiagnosticSuppression(diag, dummyChecker, sf)).toBe(true);
    }

    // Codes NOT in the list should not be suppressed
    const unregistered = makeDiagnostic(9999, "test", sf, 0);
    expect(evaluateDiagnosticSuppression(unregistered, dummyChecker, sf)).toBe(false);
  });

  it("selectively suppresses based on position mapping", () => {
    const rule = createMacroGeneratedRule((_file, pos) => {
      // Positions 0-12 are original, 13+ are generated
      return pos < 13 ? pos : null;
    });
    registerDiagnosticSuppressionRule(rule);

    expect(
      evaluateDiagnosticSuppression(makeDiagnostic(2339, "in original", sf, 5), dummyChecker, sf)
    ).toBe(false);
    expect(
      evaluateDiagnosticSuppression(makeDiagnostic(2339, "in generated", sf, 15), dummyChecker, sf)
    ).toBe(true);
  });
});
