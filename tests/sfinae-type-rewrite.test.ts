/**
 * Tests for TypeRewriteAssignment SFINAE rule (PEP-011 Wave 5)
 *
 * Verifies that TS2322/TS2345/TS2355 are suppressed when a type registered
 * in the `typeRewriteRegistry` is involved in an assignment and the other
 * side matches the registered underlying representation.
 *
 * Uses mock registry entries since actual `@opaque` types come in PEP-012.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as ts from "typescript";
import {
  registerSfinaeRule,
  clearSfinaeRules,
  evaluateSfinae,
  filterDiagnostics,
  registerTypeRewrite,
  clearTypeRewrites,
  type TypeRewriteEntry,
} from "@typesugar/core";
import { createTypeRewriteAssignmentRule } from "@typesugar/macros";

// ---------------------------------------------------------------------------
// Helpers: create a real TypeScript program to get actual diagnostics
// ---------------------------------------------------------------------------

/**
 * Preamble declaring mock opaque types as interfaces so TypeScript
 * generates real assignment errors for our tests. These simulate what
 * `@opaque` would produce: an interface that is NOT structurally
 * assignable from the underlying type.
 */
const OPAQUE_PREAMBLE = `
// Simulate @opaque Option<T> = T | null
// The interface has a brand member that makes it incompatible with T | null
interface Option<T> {
  readonly __optionBrand: unique symbol;
  readonly _T: T;
}

// Simulate @opaque Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
interface Result<T, E> {
  readonly __resultBrand: unique symbol;
  readonly _T: T;
  readonly _E: E;
}

// Simulate @opaque Email = string
interface Email {
  readonly __emailBrand: unique symbol;
}
`;

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

function getDiagnosticsForFile(
  diagnostics: readonly ts.Diagnostic[],
  fileName: string
): ts.Diagnostic[] {
  return diagnostics.filter((d) => d.file?.fileName === fileName);
}

function getAssignmentDiagnostics(
  diagnostics: readonly ts.Diagnostic[],
  fileName: string
): ts.Diagnostic[] {
  return getDiagnosticsForFile(diagnostics, fileName).filter(
    (d) => d.code === 2322 || d.code === 2345 || d.code === 2355
  );
}

// ---------------------------------------------------------------------------
// Mock registry setup
// ---------------------------------------------------------------------------

function registerMockOpaqueTypes(): void {
  registerTypeRewrite({
    typeName: "Option",
    underlyingTypeText: "T | null",
    matchesUnderlying: (typeText) => {
      // Accept "X | null", "null | X", or just "null"
      const parts = typeText.split("|").map((p) => p.trim());
      return parts.includes("null");
    },
  });

  registerTypeRewrite({
    typeName: "Result",
    underlyingTypeText: "{ ok: true; value: T } | { ok: false; error: E }",
  });

  registerTypeRewrite({
    typeName: "Email",
    underlyingTypeText: "string",
    matchesUnderlying: (typeText) => typeText === "string" || typeText === `"${typeText}"`,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TypeRewriteAssignment SFINAE Rule", () => {
  beforeEach(() => {
    clearSfinaeRules();
    clearTypeRewrites();
  });

  afterEach(() => {
    clearTypeRewrites();
  });

  describe("rule creation", () => {
    it("creates a rule with correct metadata", () => {
      const rule = createTypeRewriteAssignmentRule();
      expect(rule.name).toBe("TypeRewriteAssignment");
      expect(rule.errorCodes).toEqual([2322, 2345, 2355]);
    });
  });

  describe("underlying → opaque suppression (TS2322)", () => {
    it("suppresses TS2322 for const o: Option<number> = nullableValue", () => {
      const rule = createTypeRewriteAssignmentRule();
      registerSfinaeRule(rule);
      registerMockOpaqueTypes();

      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
declare const nullableValue: number | null;
const o: Option<number> = nullableValue;
`,
      });

      const assignDiags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(assignDiags.length).toBeGreaterThan(0);

      const sourceFile = assignDiags[0].file!;
      expect(evaluateSfinae(assignDiags[0], checker, sourceFile)).toBe(true);
    });

    it("suppresses TS2322 for string → Email assignment", () => {
      const rule = createTypeRewriteAssignmentRule();
      registerSfinaeRule(rule);
      registerMockOpaqueTypes();

      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
const email: Email = "user@test.com";
`,
      });

      const assignDiags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(assignDiags.length).toBeGreaterThan(0);

      const sourceFile = assignDiags[0].file!;
      expect(evaluateSfinae(assignDiags[0], checker, sourceFile)).toBe(true);
    });

    it("suppresses TS2322 for null → Option<string> assignment", () => {
      const rule = createTypeRewriteAssignmentRule();
      registerSfinaeRule(rule);
      registerMockOpaqueTypes();

      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
const o: Option<string> = null;
`,
      });

      const assignDiags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(assignDiags.length).toBeGreaterThan(0);

      const sourceFile = assignDiags[0].file!;
      expect(evaluateSfinae(assignDiags[0], checker, sourceFile)).toBe(true);
    });
  });

  describe("opaque → underlying suppression (TS2322)", () => {
    it("suppresses TS2322 for Option<number> → number | null assignment", () => {
      const rule = createTypeRewriteAssignmentRule();
      registerSfinaeRule(rule);
      registerMockOpaqueTypes();

      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
declare const opt: Option<number>;
const n: number | null = opt;
`,
      });

      const assignDiags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(assignDiags.length).toBeGreaterThan(0);

      const sourceFile = assignDiags[0].file!;
      expect(evaluateSfinae(assignDiags[0], checker, sourceFile)).toBe(true);
    });

    it("suppresses TS2322 for Email → string assignment", () => {
      const rule = createTypeRewriteAssignmentRule();
      registerSfinaeRule(rule);
      registerMockOpaqueTypes();

      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
declare const email: Email;
const s: string = email;
`,
      });

      const assignDiags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(assignDiags.length).toBeGreaterThan(0);

      const sourceFile = assignDiags[0].file!;
      expect(evaluateSfinae(assignDiags[0], checker, sourceFile)).toBe(true);
    });
  });

  describe("function argument suppression (TS2345)", () => {
    it("suppresses TS2345 when passing number | null to an Option<number> parameter", () => {
      const rule = createTypeRewriteAssignmentRule();
      registerSfinaeRule(rule);
      registerMockOpaqueTypes();

      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
function processOption(o: Option<number>): void {}
declare const nullableNum: number | null;
processOption(nullableNum);
`,
      });

      const assignDiags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(assignDiags.length).toBeGreaterThan(0);

      const sourceFile = assignDiags[0].file!;
      expect(evaluateSfinae(assignDiags[0], checker, sourceFile)).toBe(true);
    });

    it("suppresses TS2345 when passing an Option to a number | null parameter", () => {
      const rule = createTypeRewriteAssignmentRule();
      registerSfinaeRule(rule);
      registerMockOpaqueTypes();

      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
function processNullable(n: number | null): void {}
declare const opt: Option<number>;
processNullable(opt);
`,
      });

      const assignDiags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(assignDiags.length).toBeGreaterThan(0);

      const sourceFile = assignDiags[0].file!;
      expect(evaluateSfinae(assignDiags[0], checker, sourceFile)).toBe(true);
    });

    it("suppresses TS2345 when passing a string literal to an Email parameter", () => {
      const rule = createTypeRewriteAssignmentRule();
      registerSfinaeRule(rule);
      registerMockOpaqueTypes();

      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
function sendEmail(to: Email): void {}
sendEmail("user@test.com");
`,
      });

      const assignDiags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(assignDiags.length).toBeGreaterThan(0);

      const sourceFile = assignDiags[0].file!;
      expect(evaluateSfinae(assignDiags[0], checker, sourceFile)).toBe(true);
    });
  });

  describe("no false positives", () => {
    it("does NOT suppress TS2322 for unrelated types (string to number)", () => {
      const rule = createTypeRewriteAssignmentRule();
      registerSfinaeRule(rule);
      registerMockOpaqueTypes();

      const { checker, diagnostics } = createProgram({
        "/test.ts": `const x: number = "hello";`,
      });

      const assignDiags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(assignDiags.length).toBeGreaterThan(0);

      const sourceFile = assignDiags[0].file!;
      expect(evaluateSfinae(assignDiags[0], checker, sourceFile)).toBe(false);
    });

    it("does NOT suppress TS2322 when no registry entries exist", () => {
      const rule = createTypeRewriteAssignmentRule();
      registerSfinaeRule(rule);
      // Intentionally NOT registering any type rewrites

      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
declare const nullableValue: number | null;
const o: Option<number> = nullableValue;
`,
      });

      const assignDiags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(assignDiags.length).toBeGreaterThan(0);

      const sourceFile = assignDiags[0].file!;
      expect(evaluateSfinae(assignDiags[0], checker, sourceFile)).toBe(false);
    });

    it("does NOT suppress TS2322 for wrong underlying type (number to Email)", () => {
      const rule = createTypeRewriteAssignmentRule();
      registerSfinaeRule(rule);
      registerMockOpaqueTypes();

      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
const email: Email = 42;
`,
      });

      const assignDiags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(assignDiags.length).toBeGreaterThan(0);

      const sourceFile = assignDiags[0].file!;
      expect(evaluateSfinae(assignDiags[0], checker, sourceFile)).toBe(false);
    });

    it("does NOT suppress TS2345 for wrong underlying type in function args", () => {
      const rule = createTypeRewriteAssignmentRule();
      registerSfinaeRule(rule);
      registerMockOpaqueTypes();

      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
function processOption(o: Option<number>): void {}
processOption("not a number or null");
`,
      });

      const assignDiags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(assignDiags.length).toBeGreaterThan(0);

      const sourceFile = assignDiags[0].file!;
      expect(evaluateSfinae(assignDiags[0], checker, sourceFile)).toBe(false);
    });
  });

  describe("filterDiagnostics integration", () => {
    it("filters TS2322 from diagnostics array for valid opaque assignment", () => {
      const rule = createTypeRewriteAssignmentRule();
      registerSfinaeRule(rule);
      registerMockOpaqueTypes();

      const { program, checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
declare const nullableValue: number | null;
const o: Option<number> = nullableValue;
`,
      });

      const fileDiags = getDiagnosticsForFile(diagnostics, "/test.ts");
      const assignBefore = fileDiags.filter(
        (d) => d.code === 2322 || d.code === 2345 || d.code === 2355
      );
      expect(assignBefore.length).toBeGreaterThan(0);

      const filtered = filterDiagnostics(fileDiags, checker, (fn) => program.getSourceFile(fn));
      const assignAfter = filtered.filter(
        (d) => d.code === 2322 || d.code === 2345 || d.code === 2355
      );

      expect(assignAfter.length).toBeLessThan(assignBefore.length);
    });

    it("preserves non-assignment diagnostics", () => {
      const rule = createTypeRewriteAssignmentRule();
      registerSfinaeRule(rule);
      registerMockOpaqueTypes();

      const { program, checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
declare const nullableValue: number | null;
const o: Option<number> = nullableValue;
const bad = undeclaredVariable;
`,
      });

      const fileDiags = getDiagnosticsForFile(diagnostics, "/test.ts");
      const nonAssignBefore = fileDiags.filter(
        (d) => d.code !== 2322 && d.code !== 2345 && d.code !== 2355
      );

      const filtered = filterDiagnostics(fileDiags, checker, (fn) => program.getSourceFile(fn));
      const nonAssignAfter = filtered.filter(
        (d) => d.code !== 2322 && d.code !== 2345 && d.code !== 2355
      );

      expect(nonAssignAfter.length).toBe(nonAssignBefore.length);
    });
  });

  describe("custom matchesUnderlying callback", () => {
    it("uses the matchesUnderlying callback when provided", () => {
      const rule = createTypeRewriteAssignmentRule();
      registerSfinaeRule(rule);

      registerTypeRewrite({
        typeName: "Percentage",
        underlyingTypeText: "number",
        matchesUnderlying: (typeText) => typeText === "number",
      });

      const { checker, diagnostics } = createProgram({
        "/test.ts": `
interface Percentage {
  readonly __percentageBrand: unique symbol;
}
const pct: Percentage = 0.5;
`,
      });

      const assignDiags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(assignDiags.length).toBeGreaterThan(0);

      const sourceFile = assignDiags[0].file!;
      expect(evaluateSfinae(assignDiags[0], checker, sourceFile)).toBe(true);
    });
  });

  describe("coexistence with NewtypeAssignment rule", () => {
    it("both rules can be active without interference", async () => {
      const { createNewtypeAssignmentRule } = await import("@typesugar/macros");

      registerSfinaeRule(createNewtypeAssignmentRule());
      registerSfinaeRule(createTypeRewriteAssignmentRule());
      registerMockOpaqueTypes();

      // Newtype case (handled by NewtypeAssignment)
      const newtypeResult = createProgram({
        "/test.ts": `
declare const __brand: unique symbol;
type Newtype<Base, Brand extends string> = Base & {
  readonly [__brand]: Brand;
};
type UserId = Newtype<number, "UserId">;
const id: UserId = 42;
`,
      });

      const newtypeDiags = getAssignmentDiagnostics(newtypeResult.diagnostics, "/test.ts");
      expect(newtypeDiags.length).toBeGreaterThan(0);
      expect(evaluateSfinae(newtypeDiags[0], newtypeResult.checker, newtypeDiags[0].file!)).toBe(
        true
      );

      // Opaque type case (handled by TypeRewriteAssignment)
      const opaqueResult = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
const email: Email = "user@test.com";
`,
      });

      const opaqueDiags = getAssignmentDiagnostics(opaqueResult.diagnostics, "/test.ts");
      expect(opaqueDiags.length).toBeGreaterThan(0);
      expect(evaluateSfinae(opaqueDiags[0], opaqueResult.checker, opaqueDiags[0].file!)).toBe(true);
    });
  });
});
