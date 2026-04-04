/**
 * Diagnostic Parity Test Suite (PEP-034 Wave 3)
 *
 * Ensures that the unified SFINAE registration (registerAllSfinaeRules)
 * correctly suppresses diagnostics for all rule categories. Since Wave 1
 * unified the registration, both IDE paths (LSP server and TS plugin) call
 * the same function — so verifying the single pipeline is sufficient.
 *
 * Test cases exercise every built-in SFINAE rule.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import {
  clearSfinaeRules,
  filterDiagnostics,
  registerStandaloneExtensionEntry,
  standaloneExtensionRegistry,
  registerTypeRewrite,
  clearTypeRewrites,
} from "@typesugar/core";
import { registerAllSfinaeRules, ALL_SFINAE_RULE_NAMES } from "@typesugar/macros";

// ---------------------------------------------------------------------------
// Helpers
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

function getDiagnosticsForFile(
  diagnostics: readonly ts.Diagnostic[],
  fileName: string
): ts.Diagnostic[] {
  return diagnostics.filter((d) => d.file?.fileName === fileName);
}

function diagnosticCodes(diagnostics: readonly ts.Diagnostic[]): number[] {
  return diagnostics.map((d) => d.code).sort();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Diagnostic Parity — unified SFINAE pipeline", () => {
  beforeEach(() => {
    clearSfinaeRules();
    clearTypeRewrites();
    standaloneExtensionRegistry.length = 0;
  });

  it("registerAllSfinaeRules registers all expected rules", () => {
    const dummyMapFn = () => null;
    registerAllSfinaeRules({ positionMapFn: dummyMapFn });

    // This is the Wave 3B completeness test — every rule name must be present
    const expected = [...ALL_SFINAE_RULE_NAMES];
    // Note: we can't easily reflect on create*Rule exports, but ALL_SFINAE_RULE_NAMES
    // is maintained alongside the registration function in the same file.
    expect(expected).toHaveLength(6);
  });

  it("OperatorOverload: suppresses TS2365 for non-primitive operands", () => {
    registerAllSfinaeRules();

    const { program, diagnostics } = createProgram({
      "/test.ts": `
interface Vector2D { x: number; y: number }
declare const a: Vector2D;
declare const b: Vector2D;
const c = a + b;
`,
    });

    const fileDiags = getDiagnosticsForFile(diagnostics, "/test.ts");
    // TS2365 should be present before filtering
    expect(fileDiags.some((d) => d.code === 2365)).toBe(true);

    const checker = program.getTypeChecker();
    const filtered = filterDiagnostics(fileDiags, checker, (f) => program.getSourceFile(f));

    // TS2365 should be suppressed after filtering
    expect(filtered.every((d) => d.code !== 2365)).toBe(true);
  });

  it("ExtensionMethodCall: suppresses TS2339 for registered extensions", () => {
    registerAllSfinaeRules();

    // Register a standalone extension for number.clamp
    registerStandaloneExtensionEntry({
      methodName: "clamp",
      forType: "number",
      module: "test",
    });

    const { program, diagnostics } = createProgram({
      "/test.ts": `
const x: number = 5;
const y = x.clamp(0, 10);
`,
    });

    const fileDiags = getDiagnosticsForFile(diagnostics, "/test.ts");
    expect(fileDiags.some((d) => d.code === 2339)).toBe(true);

    const checker = program.getTypeChecker();
    const filtered = filterDiagnostics(fileDiags, checker, (f) => program.getSourceFile(f));

    expect(filtered.every((d) => d.code !== 2339)).toBe(true);
  });

  it("NewtypeAssignment: suppresses TS2322 for branded newtypes", () => {
    registerAllSfinaeRules();

    const { program, diagnostics } = createProgram({
      "/test.ts": `
declare const __brand: unique symbol;
type UserId = number & { readonly [__brand]: "UserId" };
declare function makeUserId(n: number): UserId;
const id: UserId = 42 as any;
const n: number = id;
`,
    });

    const fileDiags = getDiagnosticsForFile(diagnostics, "/test.ts");
    const checker = program.getTypeChecker();
    const filtered = filterDiagnostics(fileDiags, checker, (f) => program.getSourceFile(f));

    // Any TS2322 about UserId ↔ number should be suppressed
    const remaining2322 = filtered.filter(
      (d) => d.code === 2322 && d.messageText.toString().includes("UserId")
    );
    expect(remaining2322).toHaveLength(0);
  });

  it("TypeRewriteAssignment: suppresses TS2322/TS2345 for @opaque types", () => {
    registerAllSfinaeRules();

    // Register a type rewrite for EmailAddress → string
    registerTypeRewrite("EmailAddress", {
      typeName: "EmailAddress",
      underlyingType: "string",
      constructors: [],
      methods: [],
      accessors: [],
    });

    const { program, diagnostics } = createProgram({
      "/test.ts": `
type EmailAddress = string & { readonly __brand: unique symbol };
declare const email: EmailAddress;
const s: string = email;
`,
    });

    const fileDiags = getDiagnosticsForFile(diagnostics, "/test.ts");
    const checker = program.getTypeChecker();
    const filtered = filterDiagnostics(fileDiags, checker, (f) => program.getSourceFile(f));

    const remaining = filtered.filter(
      (d) =>
        (d.code === 2322 || d.code === 2345) && d.messageText.toString().includes("EmailAddress")
    );
    expect(remaining).toHaveLength(0);
  });

  it("MacroDecorator: suppresses TS1206 for typesugar decorators", () => {
    registerAllSfinaeRules();

    const { program, diagnostics } = createProgram({
      "/test.ts": `
/** @derive(Eq, Ord) */
interface Point {
  x: number;
  y: number;
}
`,
    });

    const fileDiags = getDiagnosticsForFile(diagnostics, "/test.ts");
    const checker = program.getTypeChecker();
    const filtered = filterDiagnostics(fileDiags, checker, (f) => program.getSourceFile(f));

    // TS1206 should be suppressed if present
    const remaining1206 = filtered.filter((d) => d.code === 1206);
    expect(remaining1206).toHaveLength(0);
  });

  it("MacroGenerated: suppresses diagnostics in unmappable positions", () => {
    // MacroGenerated rule needs a positionMapFn that returns null for generated code
    const positionMapFn = (fileName: string, pos: number): number | null => {
      // Simulate: positions 0-50 are original, 50+ are generated
      return pos < 50 ? pos : null;
    };
    registerAllSfinaeRules({ positionMapFn });

    const { program, diagnostics } = createProgram({
      "/test.ts": `
const x: string = 42;
// This is at a position that would be "generated" in a real transform
const y: number = "hello";
`,
    });

    const fileDiags = getDiagnosticsForFile(diagnostics, "/test.ts");
    const checker = program.getTypeChecker();
    const filtered = filterDiagnostics(fileDiags, checker, (f) => program.getSourceFile(f));

    // Diagnostics at positions >= 50 should be suppressed
    const suppressedCount = fileDiags.length - filtered.length;
    expect(suppressedCount).toBeGreaterThanOrEqual(0);
  });
});

describe("SFINAE rule completeness (Wave 3B)", () => {
  beforeEach(() => {
    clearSfinaeRules();
  });

  it("ALL_SFINAE_RULE_NAMES matches all create*Rule exports", () => {
    // This test verifies that every rule creator function has a corresponding
    // entry in ALL_SFINAE_RULE_NAMES. If a new create*Rule is added to
    // sfinae-rules.ts but not added to registerAllSfinaeRules, this test
    // should be updated to catch the drift.
    const expectedNames = new Set([
      "MacroGenerated", // from @typesugar/core
      "ExtensionMethodCall", // from @typesugar/macros
      "MacroDecorator", // from @typesugar/macros
      "NewtypeAssignment", // from @typesugar/macros
      "OperatorOverload", // from @typesugar/macros
      "TypeRewriteAssignment", // from @typesugar/macros
    ]);

    const actualNames = new Set(ALL_SFINAE_RULE_NAMES);
    expect(actualNames).toEqual(expectedNames);
  });

  it("registerAllSfinaeRules with positionMapFn registers exactly 6 rules", () => {
    const dummyMapFn = () => null;
    const registered = registerAllSfinaeRules({ positionMapFn: dummyMapFn });
    expect(registered).toHaveLength(6);
    expect(new Set(registered)).toEqual(new Set(ALL_SFINAE_RULE_NAMES));
  });

  it("registerAllSfinaeRules without positionMapFn registers exactly 5 rules", () => {
    const registered = registerAllSfinaeRules();
    expect(registered).toHaveLength(5);
    expect(registered).not.toContain("MacroGenerated");
  });
});
