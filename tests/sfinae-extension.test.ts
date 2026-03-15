/**
 * Tests for ExtensionMethodCall SFINAE rule (PEP-011 Wave 3)
 *
 * Verifies that TS2339 ("Property 'X' does not exist on type 'Y'") is
 * suppressed when an extension method is resolvable, and NOT suppressed
 * when no extension exists.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import {
  registerSfinaeRule,
  clearSfinaeRules,
  evaluateSfinae,
  filterDiagnostics,
  registerStandaloneExtensionEntry,
  standaloneExtensionRegistry,
} from "@typesugar/core";
import { createExtensionMethodCallRule } from "@typesugar/macros";

// ---------------------------------------------------------------------------
// Helpers: create a real TypeScript program to get actual diagnostics
// ---------------------------------------------------------------------------

function createProgram(
  files: Record<string, string>,
  mainFile = "/test.ts"
): { program: ts.Program; checker: ts.TypeChecker; diagnostics: readonly ts.Diagnostic[] } {
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  };

  const fileMap = new Map<string, string>();
  for (const [name, content] of Object.entries(files)) {
    fileMap.set(name, content);
  }

  const host = ts.createCompilerHost(compilerOptions);
  const origGetSourceFile = host.getSourceFile;
  const origFileExists = host.fileExists;
  const origReadFile = host.readFile;

  host.getSourceFile = (fileName, languageVersion, onError) => {
    const content = fileMap.get(fileName);
    if (content !== undefined) {
      return ts.createSourceFile(fileName, content, languageVersion, true);
    }
    return origGetSourceFile.call(host, fileName, languageVersion, onError);
  };

  host.fileExists = (fileName) => {
    return fileMap.has(fileName) || origFileExists.call(host, fileName);
  };

  host.readFile = (fileName) => {
    return fileMap.get(fileName) ?? origReadFile.call(host, fileName);
  };

  const program = ts.createProgram(Array.from(fileMap.keys()), compilerOptions, host);
  const checker = program.getTypeChecker();
  const diagnostics = ts.getPreEmitDiagnostics(program);

  return { program, checker, diagnostics };
}

/**
 * Filter diagnostics from a specific file.
 */
function getDiagnosticsForFile(
  diagnostics: readonly ts.Diagnostic[],
  fileName: string
): ts.Diagnostic[] {
  return diagnostics.filter((d) => d.file?.fileName === fileName);
}

/**
 * Get TS2339 diagnostics from a file.
 */
function getTS2339Diagnostics(
  diagnostics: readonly ts.Diagnostic[],
  fileName: string
): ts.Diagnostic[] {
  return getDiagnosticsForFile(diagnostics, fileName).filter((d) => d.code === 2339);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExtensionMethodCall SFINAE Rule", () => {
  beforeEach(() => {
    clearSfinaeRules();
    standaloneExtensionRegistry.length = 0;
  });

  describe("rule creation", () => {
    it("creates a rule with correct metadata", () => {
      const rule = createExtensionMethodCallRule();
      expect(rule.name).toBe("ExtensionMethodCall");
      expect(rule.errorCodes).toEqual([2339]);
    });
  });

  describe("standalone registry suppression", () => {
    it("suppresses TS2339 when extension is in the standalone registry", () => {
      // Register an extension: clamp(n: number, min: number, max: number)
      registerStandaloneExtensionEntry({
        methodName: "clamp",
        forType: "number",
        qualifier: "NumberExt",
      });

      const rule = createExtensionMethodCallRule();
      registerSfinaeRule(rule);

      const { checker, diagnostics } = createProgram({
        "/test.ts": `const result = (42).clamp(0, 100);`,
      });

      const ts2339 = getTS2339Diagnostics(diagnostics, "/test.ts");
      // TypeScript SHOULD produce TS2339 for .clamp on number
      expect(ts2339.length).toBeGreaterThan(0);

      const sourceFile = ts2339[0].file!;
      // The rule should suppress this diagnostic
      expect(evaluateSfinae(ts2339[0], checker, sourceFile)).toBe(true);
    });

    it("suppresses TS2339 for extensions registered without qualifier", () => {
      registerStandaloneExtensionEntry({
        methodName: "clamp",
        forType: "number",
        qualifier: undefined,
      });

      const rule = createExtensionMethodCallRule();
      registerSfinaeRule(rule);

      const { checker, diagnostics } = createProgram({
        "/test.ts": `const result = (42).clamp(0, 100);`,
      });

      const ts2339 = getTS2339Diagnostics(diagnostics, "/test.ts");
      expect(ts2339.length).toBeGreaterThan(0);

      const sourceFile = ts2339[0].file!;
      expect(evaluateSfinae(ts2339[0], checker, sourceFile)).toBe(true);
    });

    it("does NOT suppress TS2339 for unregistered methods (no false positives)", () => {
      // Register "clamp" but NOT "nonExistent"
      registerStandaloneExtensionEntry({
        methodName: "clamp",
        forType: "number",
        qualifier: "NumberExt",
      });

      const rule = createExtensionMethodCallRule();
      registerSfinaeRule(rule);

      const { checker, diagnostics } = createProgram({
        "/test.ts": `const result = (42).nonExistent();`,
      });

      const ts2339 = getTS2339Diagnostics(diagnostics, "/test.ts");
      expect(ts2339.length).toBeGreaterThan(0);

      const sourceFile = ts2339[0].file!;
      expect(evaluateSfinae(ts2339[0], checker, sourceFile)).toBe(false);
    });

    it("does NOT suppress TS2339 for wrong type", () => {
      // Register "clamp" for "string", not "number"
      registerStandaloneExtensionEntry({
        methodName: "clamp",
        forType: "string",
        qualifier: undefined,
      });

      const rule = createExtensionMethodCallRule();
      registerSfinaeRule(rule);

      const { checker, diagnostics } = createProgram({
        "/test.ts": `const result = (42).clamp(0, 100);`,
      });

      const ts2339 = getTS2339Diagnostics(diagnostics, "/test.ts");
      expect(ts2339.length).toBeGreaterThan(0);

      const sourceFile = ts2339[0].file!;
      expect(evaluateSfinae(ts2339[0], checker, sourceFile)).toBe(false);
    });
  });

  describe("import-scoped resolution", () => {
    it("suppresses TS2339 when a matching function is imported", () => {
      const rule = createExtensionMethodCallRule();
      registerSfinaeRule(rule);

      const { checker, diagnostics } = createProgram({
        "/ext.ts": `export function clamp(n: number, min: number, max: number): number {
          return Math.max(min, Math.min(max, n));
        }`,
        "/test.ts": `import { clamp } from "./ext";
const result = (42).clamp(0, 100);`,
      });

      const ts2339 = getTS2339Diagnostics(diagnostics, "/test.ts");
      expect(ts2339.length).toBeGreaterThan(0);

      const sourceFile = ts2339[0].file!;
      expect(evaluateSfinae(ts2339[0], checker, sourceFile)).toBe(true);
    });

    it("suppresses TS2339 when a namespace with matching method is imported", () => {
      const rule = createExtensionMethodCallRule();
      registerSfinaeRule(rule);

      const { checker, diagnostics } = createProgram({
        "/ext.ts": `export namespace NumberExt {
          export function clamp(n: number, min: number, max: number): number {
            return Math.max(min, Math.min(max, n));
          }
        }`,
        "/test.ts": `import { NumberExt } from "./ext";
const result = (42).clamp(0, 100);`,
      });

      const ts2339 = getTS2339Diagnostics(diagnostics, "/test.ts");
      expect(ts2339.length).toBeGreaterThan(0);

      const sourceFile = ts2339[0].file!;
      expect(evaluateSfinae(ts2339[0], checker, sourceFile)).toBe(true);
    });

    it("does NOT suppress when imported function's first param doesn't match", () => {
      const rule = createExtensionMethodCallRule();
      registerSfinaeRule(rule);

      const { checker, diagnostics } = createProgram({
        "/ext.ts": `export function clamp(s: string, min: number, max: number): string {
          return s;
        }`,
        "/test.ts": `import { clamp } from "./ext";
const result = (42).clamp(0, 100);`,
      });

      const ts2339 = getTS2339Diagnostics(diagnostics, "/test.ts");
      expect(ts2339.length).toBeGreaterThan(0);

      const sourceFile = ts2339[0].file!;
      // number is not assignable to string, so should NOT suppress
      expect(evaluateSfinae(ts2339[0], checker, sourceFile)).toBe(false);
    });

    it("does NOT suppress when no matching import exists", () => {
      const rule = createExtensionMethodCallRule();
      registerSfinaeRule(rule);

      const { checker, diagnostics } = createProgram({
        "/ext.ts": `export function otherFunc(n: number): number { return n; }`,
        "/test.ts": `import { otherFunc } from "./ext";
const result = (42).clamp(0, 100);`,
      });

      const ts2339 = getTS2339Diagnostics(diagnostics, "/test.ts");
      expect(ts2339.length).toBeGreaterThan(0);

      const sourceFile = ts2339[0].file!;
      expect(evaluateSfinae(ts2339[0], checker, sourceFile)).toBe(false);
    });
  });

  describe("filterDiagnostics integration", () => {
    it("filters TS2339 from diagnostics array when extension resolves", () => {
      registerStandaloneExtensionEntry({
        methodName: "clamp",
        forType: "number",
        qualifier: undefined,
      });

      const rule = createExtensionMethodCallRule();
      registerSfinaeRule(rule);

      const { program, checker, diagnostics } = createProgram({
        "/test.ts": `const result = (42).clamp(0, 100);`,
      });

      const fileDiags = getDiagnosticsForFile(diagnostics, "/test.ts");
      const ts2339Before = fileDiags.filter((d) => d.code === 2339);
      expect(ts2339Before.length).toBeGreaterThan(0);

      const filtered = filterDiagnostics(fileDiags, checker, (fn) => program.getSourceFile(fn));
      const ts2339After = filtered.filter((d) => d.code === 2339);

      // The clamp TS2339 should be filtered out
      expect(ts2339After.length).toBeLessThan(ts2339Before.length);
    });

    it("preserves non-TS2339 diagnostics", () => {
      registerStandaloneExtensionEntry({
        methodName: "clamp",
        forType: "number",
        qualifier: undefined,
      });

      const rule = createExtensionMethodCallRule();
      registerSfinaeRule(rule);

      const { program, checker, diagnostics } = createProgram({
        // Two errors: TS2339 for .clamp and TS2304/other for undeclaredVar
        "/test.ts": `const result = (42).clamp(0, 100);
const bad: string = undeclaredVar;`,
      });

      const fileDiags = getDiagnosticsForFile(diagnostics, "/test.ts");
      const nonTs2339Before = fileDiags.filter((d) => d.code !== 2339);

      const filtered = filterDiagnostics(fileDiags, checker, (fn) => program.getSourceFile(fn));
      const nonTs2339After = filtered.filter((d) => d.code !== 2339);

      // Non-TS2339 diagnostics should be preserved
      expect(nonTs2339After.length).toBe(nonTs2339Before.length);
    });
  });

  describe("edge cases", () => {
    it("handles non-TS2339 diagnostic codes gracefully", () => {
      const rule = createExtensionMethodCallRule();
      registerSfinaeRule(rule);

      const { checker, diagnostics } = createProgram({
        "/test.ts": `const x: string = 42;`, // TS2322, not TS2339
      });

      const fileDiags = getDiagnosticsForFile(diagnostics, "/test.ts");
      const ts2322 = fileDiags.filter((d) => d.code === 2322);

      if (ts2322.length > 0) {
        const sourceFile = ts2322[0].file!;
        // TS2322 is not in the rule's errorCodes, so evaluateSfinae should
        // never even call shouldSuppress — and definitely not suppress
        expect(evaluateSfinae(ts2322[0], checker, sourceFile)).toBe(false);
      }
    });

    it("handles string extensions", () => {
      registerStandaloneExtensionEntry({
        methodName: "capitalize",
        forType: "string",
        qualifier: undefined,
      });

      const rule = createExtensionMethodCallRule();
      registerSfinaeRule(rule);

      const { checker, diagnostics } = createProgram({
        "/test.ts": `const result = "hello".capitalize();`,
      });

      const ts2339 = getTS2339Diagnostics(diagnostics, "/test.ts");
      // "capitalize" doesn't exist on string natively
      expect(ts2339.length).toBeGreaterThan(0);

      const sourceFile = ts2339[0].file!;
      expect(evaluateSfinae(ts2339[0], checker, sourceFile)).toBe(true);
    });

    it("handles method calls with no arguments", () => {
      registerStandaloneExtensionEntry({
        methodName: "isEven",
        forType: "number",
        qualifier: undefined,
      });

      const rule = createExtensionMethodCallRule();
      registerSfinaeRule(rule);

      const { checker, diagnostics } = createProgram({
        "/test.ts": `const result = (42).isEven();`,
      });

      const ts2339 = getTS2339Diagnostics(diagnostics, "/test.ts");
      expect(ts2339.length).toBeGreaterThan(0);

      const sourceFile = ts2339[0].file!;
      expect(evaluateSfinae(ts2339[0], checker, sourceFile)).toBe(true);
    });

    it("handles property access without call (still suppresses)", () => {
      registerStandaloneExtensionEntry({
        methodName: "doubled",
        forType: "number",
        qualifier: undefined,
      });

      const rule = createExtensionMethodCallRule();
      registerSfinaeRule(rule);

      const { checker, diagnostics } = createProgram({
        // Property access without call — still TS2339
        "/test.ts": `const fn = (42).doubled;`,
      });

      const ts2339 = getTS2339Diagnostics(diagnostics, "/test.ts");
      expect(ts2339.length).toBeGreaterThan(0);

      const sourceFile = ts2339[0].file!;
      expect(evaluateSfinae(ts2339[0], checker, sourceFile)).toBe(true);
    });
  });
});
