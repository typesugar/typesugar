/**
 * Tests for InstanceScanner (PEP-038 Wave 2A).
 *
 * Verifies that the scanner discovers typeclass instances from module exports
 * via @impl JSDoc tags and type annotations.
 */

import { describe, it, expect, afterEach } from "vitest";
import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  InstanceScanner,
  parseDoMethodsTag,
  DEFAULT_DO_METHODS,
  type ScannedInstance,
} from "./instance-scanner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestModule {
  program: ts.Program;
  typeChecker: ts.TypeChecker;
  moduleSymbol: ts.Symbol;
  resolvedPath: string;
  cleanup: () => void;
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const fn of cleanups) fn();
  cleanups.length = 0;
});

/**
 * Create a real ts.Program from source so we get a working TypeChecker.
 * Overrides getSourceFile to re-parse with setParentNodes=true so JSDoc
 * tags are visible (TypeScript 5.3+ optimization workaround).
 */
function createTestModule(source: string, fileName = "test-module.ts"): TestModule {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-test-"));
  const filePath = path.join(tmpDir, fileName);
  fs.writeFileSync(filePath, source);

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
  };

  const host = ts.createCompilerHost(options);
  const origGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fn, languageVersion, onError, shouldCreate) => {
    const sf = origGetSourceFile(fn, languageVersion, onError, shouldCreate);
    if (sf && fn === filePath) {
      // Re-parse with setParentNodes=true for JSDoc tag visibility
      return ts.createSourceFile(fn, sf.text, languageVersion, true);
    }
    return sf;
  };

  const program = ts.createProgram([filePath], options, host);
  const typeChecker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(filePath)!;
  const moduleSymbol = typeChecker.getSymbolAtLocation(sourceFile)!;

  const cleanup = () => fs.rmSync(tmpDir, { recursive: true, force: true });
  cleanups.push(cleanup);

  return { program, typeChecker, moduleSymbol, resolvedPath: filePath, cleanup };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InstanceScanner", () => {
  it("detects @impl JSDoc tag", () => {
    const mod = createTestModule(`
/** @impl("Ord<number>") */
export const ordNumber = {
  compare: (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0),
};
    `);

    const scanner = new InstanceScanner();
    const results = scanner.scanModule(mod.typeChecker, mod.moduleSymbol, mod.resolvedPath);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      typeclassName: "Ord",
      forTypeString: "number",
      exportName: "ordNumber",
      detectedVia: "impl-tag",
    });
  });

  it("detects type annotation fallback", () => {
    const mod = createTestModule(`
interface Ord<A> { compare(a: A, b: A): number; }
export const ordNumber: Ord<number> = {
  compare: (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0),
};
    `);

    const scanner = new InstanceScanner();
    const results = scanner.scanModule(mod.typeChecker, mod.moduleSymbol, mod.resolvedPath);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      typeclassName: "Ord",
      forTypeString: "number",
      exportName: "ordNumber",
      detectedVia: "type-annotation",
    });
  });

  it("@impl tag takes precedence over type annotation", () => {
    const mod = createTestModule(`
interface Show<A> { show(a: A): string; }
/** @impl("Show<number>") */
export const showNumber: Show<number> = {
  show: (a: number): string => String(a),
};
    `);

    const scanner = new InstanceScanner();
    const results = scanner.scanModule(mod.typeChecker, mod.moduleSymbol, mod.resolvedPath);

    expect(results).toHaveLength(1);
    expect(results[0].detectedVia).toBe("impl-tag");
  });

  it("ignores plain exports without annotations", () => {
    const mod = createTestModule(`
export const PI = 3.14159;
export const greeting = "hello";
export function add(a: number, b: number) { return a + b; }
    `);

    const scanner = new InstanceScanner();
    const results = scanner.scanModule(mod.typeChecker, mod.moduleSymbol, mod.resolvedPath);

    expect(results).toHaveLength(0);
  });

  it("ignores function exports (generic factories)", () => {
    const mod = createTestModule(`
export function showArray<A>(elementShow: { show: (a: A) => string }) {
  return {
    show: (arr: A[]): string => arr.map(x => elementShow.show(x)).join(", "),
  };
}
    `);

    const scanner = new InstanceScanner();
    const results = scanner.scanModule(mod.typeChecker, mod.moduleSymbol, mod.resolvedPath);

    expect(results).toHaveLength(0);
  });

  it("caches results and clearCache forces re-scan", () => {
    const mod = createTestModule(`
/** @impl("Eq<number>") */
export const eqNumber = { eq: (a: number, b: number): boolean => a === b };
    `);

    const scanner = new InstanceScanner();
    const first = scanner.scanModule(mod.typeChecker, mod.moduleSymbol, mod.resolvedPath);
    const second = scanner.scanModule(mod.typeChecker, mod.moduleSymbol, mod.resolvedPath);

    // Same reference — cache hit
    expect(second).toBe(first);

    scanner.clearCache();
    const third = scanner.scanModule(mod.typeChecker, mod.moduleSymbol, mod.resolvedPath);

    // Different reference — re-scanned
    expect(third).not.toBe(first);
    // But same content
    expect(third).toEqual(first);
  });

  it("finds multiple annotated exports", () => {
    const mod = createTestModule(`
/** @impl("Show<number>") */
export const showNumber = { show: (a: number): string => String(a) };

/** @impl("Eq<number>") */
export const eqNumber = { eq: (a: number, b: number): boolean => a === b };

/** @impl("Ord<string>") */
export const ordString = { compare: (a: string, b: string): number => a.localeCompare(b) };
    `);

    const scanner = new InstanceScanner();
    const results = scanner.scanModule(mod.typeChecker, mod.moduleSymbol, mod.resolvedPath);

    expect(results).toHaveLength(3);
    const names = results.map((r) => r.exportName).sort();
    expect(names).toEqual(["eqNumber", "ordString", "showNumber"]);
  });

  it("handles nested generics in @impl tag", () => {
    const mod = createTestModule(`
/** @impl("Numeric<Expression<number>>") */
export const numericExprNumber = { add: (a: any, b: any) => a };
    `);

    const scanner = new InstanceScanner();
    const results = scanner.scanModule(mod.typeChecker, mod.moduleSymbol, mod.resolvedPath);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      typeclassName: "Numeric",
      forTypeString: "Expression<number>",
    });
  });

  it("handles @instance tag synonym", () => {
    const mod = createTestModule(`
/** @instance("Hash<string>") */
export const hashString = { hash: (a: string): number => a.length };
    `);

    const scanner = new InstanceScanner();
    const results = scanner.scanModule(mod.typeChecker, mod.moduleSymbol, mod.resolvedPath);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      typeclassName: "Hash",
      forTypeString: "string",
      detectedVia: "impl-tag",
    });
  });

  it("returns empty array for module with no exports", () => {
    const mod = createTestModule(`
const internal = 42;
    `);

    const scanner = new InstanceScanner();
    const results = scanner.scanModule(mod.typeChecker, mod.moduleSymbol, mod.resolvedPath);

    expect(results).toHaveLength(0);
  });

  it("follows re-exports to their original declarations", () => {
    // Create two files: provider.ts exports instances, consumer.ts re-exports them
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-reexport-"));
    cleanups.push(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    const providerPath = path.join(tmpDir, "provider.ts");
    fs.writeFileSync(
      providerPath,
      `
/** @impl("Ord<number>") */
export const ordNumber = { compare: (a: number, b: number): number => a < b ? -1 : a > b ? 1 : 0 };
    `
    );

    const consumerPath = path.join(tmpDir, "consumer.ts");
    fs.writeFileSync(
      consumerPath,
      `
export { ordNumber } from "./provider.js";
    `
    );

    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    };

    const host = ts.createCompilerHost(options);
    const origGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (fn, languageVersion, onError, shouldCreate) => {
      const sf = origGetSourceFile(fn, languageVersion, onError, shouldCreate);
      if (sf && (fn === providerPath || fn === consumerPath)) {
        return ts.createSourceFile(fn, sf.text, languageVersion, true);
      }
      return sf;
    };

    const program = ts.createProgram([consumerPath, providerPath], options, host);
    const typeChecker = program.getTypeChecker();
    const consumerSF = program.getSourceFile(consumerPath)!;
    const consumerSymbol = typeChecker.getSymbolAtLocation(consumerSF)!;

    const scanner = new InstanceScanner();
    const results = scanner.scanModule(typeChecker, consumerSymbol, consumerPath);

    // Re-exported symbols should be discovered by following to the original declaration
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      typeclassName: "Ord",
      forTypeString: "number",
      exportName: "ordNumber",
    });
  });

  it("discovers all 28 @impl-tagged instances in primitives.ts", () => {
    // Integration test: scan the actual primitives.ts source file
    const primitivesPath = path.resolve(__dirname, "primitives.ts");
    const source = fs.readFileSync(primitivesPath, "utf-8");

    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    };

    const host = ts.createCompilerHost(options);
    const origGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (fn, languageVersion, onError, shouldCreate) => {
      if (fn === primitivesPath) {
        return ts.createSourceFile(fn, source, languageVersion, true);
      }
      return origGetSourceFile(fn, languageVersion, onError, shouldCreate);
    };

    // primitives.ts imports from ./typeclass.js — stub it to avoid resolution errors
    const stubPath = path.resolve(__dirname, "typeclass.ts");
    host.fileExists = (fn) => fn === primitivesPath || fn === stubPath || ts.sys.fileExists(fn);

    const program = ts.createProgram([primitivesPath], options, host);
    const typeChecker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(primitivesPath)!;
    const moduleSymbol = typeChecker.getSymbolAtLocation(sourceFile)!;

    const scanner = new InstanceScanner();
    const results = scanner.scanModule(typeChecker, moduleSymbol, primitivesPath);

    // Verify all 28 tagged instances are found
    expect(results.length).toBe(28);

    // Verify all detectedVia are "impl-tag"
    expect(results.every((r) => r.detectedVia === "impl-tag")).toBe(true);

    // Spot check a few
    const byName = new Map(results.map((r) => [r.exportName, r]));
    expect(byName.get("ordNumber")).toMatchObject({
      typeclassName: "Ord",
      forTypeString: "number",
    });
    expect(byName.get("showString")).toMatchObject({
      typeclassName: "Show",
      forTypeString: "string",
    });
    expect(byName.get("eqBigint")).toMatchObject({ typeclassName: "Eq", forTypeString: "bigint" });
    expect(byName.get("hashNull")).toMatchObject({ typeclassName: "Hash", forTypeString: "null" });
    expect(byName.get("monoidBoolean")).toMatchObject({
      typeclassName: "Monoid",
      forTypeString: "boolean",
    });

    // Verify variants are NOT included
    expect(byName.has("semigroupNumberProduct")).toBe(false);
    expect(byName.has("monoidBooleanAny")).toBe(false);

    // Verify namespace objects are NOT included
    expect(byName.has("Show")).toBe(false);
    expect(byName.has("Eq")).toBe(false);
  });
});

describe("@do-methods metadata (PEP-052 Wave 3)", () => {
  it("parses key=value pairs and attaches doMeta to the scanned instance", () => {
    const mod = createTestModule(`
/**
 * @impl FlatMap<Promise>
 * @do-methods bind=then map=then orElse=catch
 */
export const flatMapPromise = { flatMap: (fa: any, f: any) => fa.then(f) };
    `);

    const scanner = new InstanceScanner();
    const results = scanner.scanModule(mod.typeChecker, mod.moduleSymbol, mod.resolvedPath);

    expect(results).toHaveLength(1);
    expect(results[0].doMeta).toEqual({
      bind: "then",
      map: "then",
      orElse: "catch",
      style: "method",
    });
  });

  it("parses style=static receiver=... for static-call emission", () => {
    const mod = createTestModule(`
/**
 * @impl FlatMap<Effect>
 * @do-methods bind=flatMap map=map orElse=catchAll style=static receiver=Effect
 */
export const flatMapEffect = {};
    `);

    const scanner = new InstanceScanner();
    const results = scanner.scanModule(mod.typeChecker, mod.moduleSymbol, mod.resolvedPath);

    expect(results[0].doMeta).toEqual({
      bind: "flatMap",
      map: "map",
      orElse: "catchAll",
      style: "static",
      receiver: "Effect",
    });
  });

  it("leaves doMeta undefined when the tag is absent (defaults applied by consumers)", () => {
    const mod = createTestModule(`
/** @impl FlatMap<Array> */
export const flatMapArray = {};
    `);

    const scanner = new InstanceScanner();
    const results = scanner.scanModule(mod.typeChecker, mod.moduleSymbol, mod.resolvedPath);

    expect(results[0].doMeta).toBeUndefined();
    expect(DEFAULT_DO_METHODS).toEqual({ bind: "flatMap", map: "map", style: "method" });
  });

  it("ignores unknown keys and malformed pairs (forward compatible)", () => {
    const sf = ts.createSourceFile(
      "x.ts",
      `/**
 * @do-methods bind=chain frobnicate=yes =bad noequals map=select
 */
const inst = {};`,
      ts.ScriptTarget.Latest,
      true
    );
    const meta = parseDoMethodsTag(sf.statements[0]);
    expect(meta).toEqual({ bind: "chain", map: "select", style: "method" });
  });
});
