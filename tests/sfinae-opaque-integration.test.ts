/**
 * Integration tests for SFINAE × @opaque type rewrite (PEP-012 Wave 6)
 *
 * Verifies that PEP-011's TypeRewriteAssignment SFINAE rule works correctly
 * with full PEP-012 `@opaque` registry entries — entries that include
 * `sourceModule`, `methods`, `constructors`, `accessors`, and `transparent`,
 * not just the minimal `typeName`/`underlyingTypeText`/`matchesUnderlying`
 * used by the mock-based tests in sfinae-type-rewrite.test.ts.
 *
 * The rule should care only about `typeName`, `underlyingTypeText`, and
 * `matchesUnderlying`; the additional fields must not interfere.
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
  type ConstructorRewrite,
  type AccessorRewrite,
} from "@typesugar/core";
import { createTypeRewriteAssignmentRule } from "@typesugar/macros";

// ---------------------------------------------------------------------------
// Helpers: real TypeScript program with actual diagnostics
// ---------------------------------------------------------------------------

const OPAQUE_PREAMBLE = `
// Simulate @opaque Option<T> = T | null
interface Option<T> {
  readonly __optionBrand: unique symbol;
  readonly _T: T;
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

function getAssignmentDiagnostics(
  diagnostics: readonly ts.Diagnostic[],
  fileName: string
): ts.Diagnostic[] {
  return diagnostics
    .filter((d) => d.file?.fileName === fileName)
    .filter((d) => d.code === 2322 || d.code === 2345 || d.code === 2355);
}

// ---------------------------------------------------------------------------
// Full @opaque registry entries (PEP-012 style, not mock)
// ---------------------------------------------------------------------------

function fullOptionEntry(): TypeRewriteEntry {
  return {
    typeName: "Option",
    underlyingTypeText: "T | null",
    sourceModule: "@typesugar/fp/data/option",
    methods: new Map([
      ["map", "map"],
      ["flatMap", "flatMap"],
      ["getOrElse", "getOrElse"],
      ["filter", "filter"],
      ["fold", "fold"],
      ["contains", "contains"],
      ["exists", "exists"],
      ["orElse", "orElse"],
      ["toArray", "toArray"],
    ]),
    constructors: new Map<string, ConstructorRewrite>([
      ["Some", { kind: "identity" }],
      ["None", { kind: "constant", value: "null" }],
    ]),
    accessors: new Map<string, AccessorRewrite>([["value", { kind: "identity" }]]),
    transparent: true,
    matchesUnderlying: (typeText) => {
      const parts = typeText.split("|").map((p) => p.trim());
      return parts.includes("null");
    },
  };
}

function fullEmailEntry(): TypeRewriteEntry {
  return {
    typeName: "Email",
    underlyingTypeText: "string",
    sourceModule: "@typesugar/fp/data/email",
    methods: new Map<string, string>(),
    constructors: new Map<string, ConstructorRewrite>([["Email", { kind: "identity" }]]),
    accessors: new Map<string, AccessorRewrite>(),
    transparent: false,
    matchesUnderlying: (typeText) => typeText === "string",
  };
}

function registerFullOpaqueTypes(): void {
  registerTypeRewrite(fullOptionEntry());
  registerTypeRewrite(fullEmailEntry());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SFINAE × @opaque integration (PEP-012 Wave 6)", () => {
  beforeEach(() => {
    clearSfinaeRules();
    clearTypeRewrites();
    registerSfinaeRule(createTypeRewriteAssignmentRule());
    registerFullOpaqueTypes();
  });

  afterEach(() => {
    clearSfinaeRules();
    clearTypeRewrites();
  });

  // -----------------------------------------------------------------------
  // Assignment: underlying → opaque (TS2322)
  // -----------------------------------------------------------------------

  describe("underlying → opaque assignment (TS2322)", () => {
    it("suppresses for Option<number> = number | null", () => {
      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
declare const nullableValue: number | null;
const o: Option<number> = nullableValue;
`,
      });

      const diags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(diags.length).toBeGreaterThan(0);
      expect(evaluateSfinae(diags[0], checker, diags[0].file!)).toBe(true);
    });

    it("suppresses for Option<string> = null", () => {
      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
const o: Option<string> = null;
`,
      });

      const diags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(diags.length).toBeGreaterThan(0);
      expect(evaluateSfinae(diags[0], checker, diags[0].file!)).toBe(true);
    });

    it("suppresses for Email = string literal", () => {
      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
const email: Email = "user@example.com";
`,
      });

      const diags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(diags.length).toBeGreaterThan(0);
      expect(evaluateSfinae(diags[0], checker, diags[0].file!)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Assignment: opaque → underlying (TS2322)
  // -----------------------------------------------------------------------

  describe("opaque → underlying assignment (TS2322)", () => {
    it("suppresses for number | null = Option<number>", () => {
      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
declare const opt: Option<number>;
const raw: number | null = opt;
`,
      });

      const diags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(diags.length).toBeGreaterThan(0);
      expect(evaluateSfinae(diags[0], checker, diags[0].file!)).toBe(true);
    });

    it("suppresses for string = Email", () => {
      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
declare const email: Email;
const s: string = email;
`,
      });

      const diags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(diags.length).toBeGreaterThan(0);
      expect(evaluateSfinae(diags[0], checker, diags[0].file!)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Function arguments (TS2345)
  // -----------------------------------------------------------------------

  describe("function argument implicit conversion (TS2345)", () => {
    it("suppresses when passing number | null to Option<number> parameter", () => {
      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
function takesOption(o: Option<number>): void {}
declare const nullable: number | null;
takesOption(nullable);
`,
      });

      const diags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(diags.length).toBeGreaterThan(0);
      expect(evaluateSfinae(diags[0], checker, diags[0].file!)).toBe(true);
    });

    it("suppresses when passing Option<number> to number | null parameter", () => {
      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
function takesNullable(n: number | null): void {}
declare const opt: Option<number>;
takesNullable(opt);
`,
      });

      const diags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(diags.length).toBeGreaterThan(0);
      expect(evaluateSfinae(diags[0], checker, diags[0].file!)).toBe(true);
    });

    it("suppresses when passing string to Email parameter", () => {
      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
function sendEmail(to: Email): void {}
sendEmail("user@example.com");
`,
      });

      const diags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(diags.length).toBeGreaterThan(0);
      expect(evaluateSfinae(diags[0], checker, diags[0].file!)).toBe(true);
    });

    it("suppresses when passing Email to string parameter", () => {
      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
function logMessage(msg: string): void {}
declare const email: Email;
logMessage(email);
`,
      });

      const diags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(diags.length).toBeGreaterThan(0);
      expect(evaluateSfinae(diags[0], checker, diags[0].file!)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Bidirectional round-trip (the PEP-012 showcase scenario)
  // -----------------------------------------------------------------------

  describe("bidirectional round-trip", () => {
    it("suppresses all diagnostics in a realistic Option<T> ↔ T | null scenario", () => {
      const { program, checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
// Source: nullable from database
declare function getFromDatabase(): number | null;

// Assign nullable → Option (SFINAE suppresses TS2322)
const opt: Option<number> = getFromDatabase();

// Pass Option to nullable consumer (SFINAE suppresses TS2345)
function takesNullable(n: number | null): void {}
takesNullable(opt);

// Assign Option → nullable (SFINAE suppresses TS2322)
const raw: number | null = opt;

// Pass nullable to Option consumer (SFINAE suppresses TS2345)
function takesOption(o: Option<number>): void {}
declare const nullable: number | null;
takesOption(nullable);
`,
      });

      const diags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(diags.length).toBeGreaterThan(0);

      for (const d of diags) {
        expect(evaluateSfinae(d, checker, d.file!)).toBe(true);
      }

      // filterDiagnostics should remove ALL assignment errors
      const allFileDiags = diagnostics.filter((d) => d.file?.fileName === "/test.ts");
      const filtered = filterDiagnostics(allFileDiags, checker, (fn) => program.getSourceFile(fn));
      const assignAfter = filtered.filter((d) => d.code === 2322 || d.code === 2345);
      expect(assignAfter).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // No false positives with full entries
  // -----------------------------------------------------------------------

  describe("no false positives with full entries", () => {
    it("does NOT suppress for unrelated types (boolean → Option<number>)", () => {
      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
const o: Option<number> = true;
`,
      });

      const diags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(diags.length).toBeGreaterThan(0);
      expect(evaluateSfinae(diags[0], checker, diags[0].file!)).toBe(false);
    });

    it("does NOT suppress for number → Email", () => {
      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
const email: Email = 42;
`,
      });

      const diags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(diags.length).toBeGreaterThan(0);
      expect(evaluateSfinae(diags[0], checker, diags[0].file!)).toBe(false);
    });

    it("does NOT suppress for wrong type in function arg (string → Option<number>)", () => {
      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
function takesOption(o: Option<number>): void {}
takesOption("hello");
`,
      });

      const diags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(diags.length).toBeGreaterThan(0);
      expect(evaluateSfinae(diags[0], checker, diags[0].file!)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Full entries with methods/constructors/accessors don't break rule
  // -----------------------------------------------------------------------

  describe("full entry fields don't interfere with SFINAE", () => {
    it("works when entry has populated methods map", () => {
      const entry = fullOptionEntry();
      expect(entry.methods!.size).toBeGreaterThan(0);

      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
declare const nullable: number | null;
const o: Option<number> = nullable;
`,
      });

      const diags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(diags.length).toBeGreaterThan(0);
      expect(evaluateSfinae(diags[0], checker, diags[0].file!)).toBe(true);
    });

    it("works when entry has populated constructors map", () => {
      const entry = fullOptionEntry();
      expect(entry.constructors!.size).toBeGreaterThan(0);

      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
declare const opt: Option<number>;
const raw: number | null = opt;
`,
      });

      const diags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(diags.length).toBeGreaterThan(0);
      expect(evaluateSfinae(diags[0], checker, diags[0].file!)).toBe(true);
    });

    it("works when entry has populated accessors map", () => {
      const entry = fullOptionEntry();
      expect(entry.accessors!.size).toBeGreaterThan(0);

      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
function takesNullable(n: number | null): void {}
declare const opt: Option<number>;
takesNullable(opt);
`,
      });

      const diags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(diags.length).toBeGreaterThan(0);
      expect(evaluateSfinae(diags[0], checker, diags[0].file!)).toBe(true);
    });

    it("works when entry has transparent flag set", () => {
      expect(fullOptionEntry().transparent).toBe(true);
      expect(fullEmailEntry().transparent).toBe(false);

      const { checker, diagnostics } = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
declare const nullable: number | null;
const o: Option<number> = nullable;
const email: Email = "test@example.com";
`,
      });

      const diags = getAssignmentDiagnostics(diagnostics, "/test.ts");
      expect(diags.length).toBeGreaterThanOrEqual(2);
      for (const d of diags) {
        expect(evaluateSfinae(d, checker, d.file!)).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Coexistence: TypeRewriteAssignment + NewtypeAssignment
  // -----------------------------------------------------------------------

  describe("coexistence with NewtypeAssignment", () => {
    it("both rules work simultaneously with full entries", async () => {
      const { createNewtypeAssignmentRule } = await import("@typesugar/macros");
      registerSfinaeRule(createNewtypeAssignmentRule());

      // Newtype case
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

      // @opaque case with full entries
      const opaqueResult = createProgram({
        "/test.ts": `${OPAQUE_PREAMBLE}
declare const nullable: number | null;
const o: Option<number> = nullable;
`,
      });

      const opaqueDiags = getAssignmentDiagnostics(opaqueResult.diagnostics, "/test.ts");
      expect(opaqueDiags.length).toBeGreaterThan(0);
      expect(evaluateSfinae(opaqueDiags[0], opaqueResult.checker, opaqueDiags[0].file!)).toBe(true);
    });
  });
});
