/**
 * Tests for the SFINAE diagnostic resolution system (PEP-011 Wave 1)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as ts from "typescript";
import {
  registerSfinaeRule,
  clearSfinaeRules,
  getSfinaeRules,
  evaluateSfinae,
  filterDiagnostics,
  getSfinaeAuditLog,
  clearSfinaeAuditLog,
  setSfinaeAuditMode,
  isSfinaeAuditEnabled,
  createMacroGeneratedRule,
  type SfinaeRule,
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

describe("SFINAE Registry", () => {
  beforeEach(() => {
    clearSfinaeRules();
  });

  it("starts with no rules", () => {
    expect(getSfinaeRules()).toHaveLength(0);
  });

  it("registers a rule", () => {
    const rule: SfinaeRule = {
      name: "TestRule",
      errorCodes: [2339],
      shouldSuppress: () => true,
    };
    registerSfinaeRule(rule);
    expect(getSfinaeRules()).toHaveLength(1);
    expect(getSfinaeRules()[0].name).toBe("TestRule");
  });

  it("registers multiple rules in order", () => {
    registerSfinaeRule({ name: "A", errorCodes: [1], shouldSuppress: () => false });
    registerSfinaeRule({ name: "B", errorCodes: [2], shouldSuppress: () => false });
    registerSfinaeRule({ name: "C", errorCodes: [3], shouldSuppress: () => false });

    const rules = getSfinaeRules();
    expect(rules).toHaveLength(3);
    expect(rules.map((r) => r.name)).toEqual(["A", "B", "C"]);
  });

  it("clearSfinaeRules removes all rules", () => {
    registerSfinaeRule({ name: "X", errorCodes: [], shouldSuppress: () => true });
    expect(getSfinaeRules()).toHaveLength(1);

    clearSfinaeRules();
    expect(getSfinaeRules()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// evaluateSfinae tests
// ---------------------------------------------------------------------------

describe("evaluateSfinae", () => {
  const sf = createSourceFile("const x = 1;");

  beforeEach(() => {
    clearSfinaeRules();
    setSfinaeAuditMode(false);
  });

  it("returns false when no rules are registered", () => {
    const diag = makeDiagnostic(2339, "Property 'foo' does not exist", sf);
    expect(evaluateSfinae(diag, dummyChecker, sf)).toBe(false);
  });

  it("returns true when a matching rule suppresses", () => {
    registerSfinaeRule({
      name: "AlwaysSuppress",
      errorCodes: [2339],
      shouldSuppress: () => true,
    });

    const diag = makeDiagnostic(2339, "Property 'foo' does not exist", sf);
    expect(evaluateSfinae(diag, dummyChecker, sf)).toBe(true);
  });

  it("skips rules that don't match the error code", () => {
    const spy = vi.fn(() => true);
    registerSfinaeRule({
      name: "WrongCode",
      errorCodes: [9999],
      shouldSuppress: spy,
    });

    const diag = makeDiagnostic(2339, "Property 'foo' does not exist", sf);
    expect(evaluateSfinae(diag, dummyChecker, sf)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("wildcard errorCodes (empty array) matches any code", () => {
    registerSfinaeRule({
      name: "Wildcard",
      errorCodes: [],
      shouldSuppress: () => true,
    });

    const diag = makeDiagnostic(2339, "anything", sf);
    expect(evaluateSfinae(diag, dummyChecker, sf)).toBe(true);
  });

  it("first matching rule wins", () => {
    const spyA = vi.fn(() => true);
    const spyB = vi.fn(() => true);

    registerSfinaeRule({ name: "A", errorCodes: [2339], shouldSuppress: spyA });
    registerSfinaeRule({ name: "B", errorCodes: [2339], shouldSuppress: spyB });

    const diag = makeDiagnostic(2339, "test", sf);
    evaluateSfinae(diag, dummyChecker, sf);

    expect(spyA).toHaveBeenCalledOnce();
    expect(spyB).not.toHaveBeenCalled();
  });

  it("continues to next rule when current rule returns false", () => {
    const spyA = vi.fn(() => false);
    const spyB = vi.fn(() => true);

    registerSfinaeRule({ name: "A", errorCodes: [2339], shouldSuppress: spyA });
    registerSfinaeRule({ name: "B", errorCodes: [2339], shouldSuppress: spyB });

    const diag = makeDiagnostic(2339, "test", sf);
    expect(evaluateSfinae(diag, dummyChecker, sf)).toBe(true);

    expect(spyA).toHaveBeenCalledOnce();
    expect(spyB).toHaveBeenCalledOnce();
  });

  it("survives a rule that throws", () => {
    registerSfinaeRule({
      name: "Broken",
      errorCodes: [],
      shouldSuppress: () => {
        throw new Error("boom");
      },
    });
    registerSfinaeRule({
      name: "Fallback",
      errorCodes: [],
      shouldSuppress: () => true,
    });

    const diag = makeDiagnostic(2339, "test", sf);
    expect(evaluateSfinae(diag, dummyChecker, sf)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// filterDiagnostics tests
// ---------------------------------------------------------------------------

describe("filterDiagnostics", () => {
  const sf = createSourceFile("const x = 1;\nconst y = 2;", "app.ts");

  beforeEach(() => {
    clearSfinaeRules();
    setSfinaeAuditMode(false);
  });

  it("returns all diagnostics when no rules registered", () => {
    const diags = [makeDiagnostic(2339, "err1", sf, 0), makeDiagnostic(2322, "err2", sf, 14)];
    const result = filterDiagnostics(diags, dummyChecker, () => sf);
    expect(result).toHaveLength(2);
  });

  it("filters out diagnostics matched by rules", () => {
    registerSfinaeRule({
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
    registerSfinaeRule({
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

describe("SFINAE Audit Mode", () => {
  const sf = createSourceFile("const x = 1;", "audit.ts");

  beforeEach(() => {
    clearSfinaeRules();
    clearSfinaeAuditLog();
    setSfinaeAuditMode(false);
  });

  afterEach(() => {
    setSfinaeAuditMode(undefined);
  });

  it("does not log when audit mode is off", () => {
    registerSfinaeRule({
      name: "TestRule",
      errorCodes: [2339],
      shouldSuppress: () => true,
    });

    evaluateSfinae(makeDiagnostic(2339, "test", sf), dummyChecker, sf);
    expect(getSfinaeAuditLog()).toHaveLength(0);
  });

  it("logs when audit mode is on", () => {
    setSfinaeAuditMode(true);
    registerSfinaeRule({
      name: "TestRule",
      errorCodes: [2339],
      shouldSuppress: () => true,
    });

    evaluateSfinae(makeDiagnostic(2339, "Property 'clamp' does not exist", sf), dummyChecker, sf);

    const log = getSfinaeAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0].errorCode).toBe(2339);
    expect(log[0].ruleName).toBe("TestRule");
    expect(log[0].messageText).toBe("Property 'clamp' does not exist");
    expect(log[0].fileName).toBe("audit.ts");
  });

  it("clearSfinaeAuditLog clears the log", () => {
    setSfinaeAuditMode(true);
    registerSfinaeRule({
      name: "R",
      errorCodes: [],
      shouldSuppress: () => true,
    });

    evaluateSfinae(makeDiagnostic(1, "a", sf), dummyChecker, sf);
    expect(getSfinaeAuditLog()).toHaveLength(1);

    clearSfinaeAuditLog();
    expect(getSfinaeAuditLog()).toHaveLength(0);
  });

  it("isSfinaeAuditEnabled respects programmatic override", () => {
    expect(isSfinaeAuditEnabled()).toBe(false);
    setSfinaeAuditMode(true);
    expect(isSfinaeAuditEnabled()).toBe(true);
    setSfinaeAuditMode(undefined);
    // Falls back to env var (which is unset in test env)
    expect(isSfinaeAuditEnabled()).toBe(false);
  });

  it("prints audit entries to stderr", () => {
    setSfinaeAuditMode(true);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    registerSfinaeRule({
      name: "TestRule",
      errorCodes: [2339],
      shouldSuppress: () => true,
    });

    evaluateSfinae(makeDiagnostic(2339, "Property 'clamp' does not exist", sf), dummyChecker, sf);

    expect(errSpy).toHaveBeenCalledOnce();
    const output = errSpy.mock.calls[0][0] as string;
    expect(output).toContain("[SFINAE]");
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
    clearSfinaeRules();
    setSfinaeAuditMode(false);
  });

  it("suppresses when position maps to null", () => {
    const rule = createMacroGeneratedRule((_file, _pos) => null);
    registerSfinaeRule(rule);

    const diag = makeDiagnostic(2339, "error in generated code", sf, 5);
    expect(evaluateSfinae(diag, dummyChecker, sf)).toBe(true);
  });

  it("does not suppress when position maps to a valid original position", () => {
    const rule = createMacroGeneratedRule((_file, pos) => pos);
    registerSfinaeRule(rule);

    const diag = makeDiagnostic(2339, "real error", sf, 5);
    expect(evaluateSfinae(diag, dummyChecker, sf)).toBe(false);
  });

  it("does not suppress diagnostics with no start position", () => {
    const rule = createMacroGeneratedRule(() => null);
    registerSfinaeRule(rule);

    const diag: ts.Diagnostic = {
      file: sf,
      start: undefined,
      length: undefined,
      messageText: "no position",
      category: ts.DiagnosticCategory.Error,
      code: 2339,
    };
    expect(evaluateSfinae(diag, dummyChecker, sf)).toBe(false);
  });

  it("does not suppress diagnostics with no file", () => {
    const rule = createMacroGeneratedRule(() => null);
    registerSfinaeRule(rule);

    const diag: ts.Diagnostic = {
      file: undefined,
      start: 0,
      length: 1,
      messageText: "no file",
      category: ts.DiagnosticCategory.Error,
      code: 2339,
    };
    expect(evaluateSfinae(diag, dummyChecker, sf)).toBe(false);
  });

  it("uses the file name from the diagnostic", () => {
    const fileNames: string[] = [];
    const rule = createMacroGeneratedRule((fileName, _pos) => {
      fileNames.push(fileName);
      return null;
    });
    registerSfinaeRule(rule);

    const diag = makeDiagnostic(2339, "test", sf, 0);
    evaluateSfinae(diag, dummyChecker, sf);

    expect(fileNames).toEqual(["generated.ts"]);
  });

  it("works with any error code (wildcard)", () => {
    const rule = createMacroGeneratedRule(() => null);
    expect(rule.errorCodes).toEqual([]);

    registerSfinaeRule(rule);

    for (const code of [2322, 2339, 2345, 9001]) {
      const diag = makeDiagnostic(code, "test", sf, 0);
      expect(evaluateSfinae(diag, dummyChecker, sf)).toBe(true);
    }
  });

  it("selectively suppresses based on position mapping", () => {
    const rule = createMacroGeneratedRule((_file, pos) => {
      // Positions 0-12 are original, 13+ are generated
      return pos < 13 ? pos : null;
    });
    registerSfinaeRule(rule);

    expect(evaluateSfinae(makeDiagnostic(2339, "in original", sf, 5), dummyChecker, sf)).toBe(
      false
    );
    expect(evaluateSfinae(makeDiagnostic(2339, "in generated", sf, 15), dummyChecker, sf)).toBe(
      true
    );
  });
});
