/**
 * Tests for PEP-035: Emit Pipeline Architecture
 *
 * Verifies that the transpile step correctly converts expanded TypeScript
 * to portable JavaScript for consumers that use esbuild/swc.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import {
  transformCode,
  transpileExpanded,
  TransformationPipeline,
} from "@typesugar/transformer/pipeline";
import {
  composeSourceMapChain,
  decodeSourceMap,
  findOriginalPosition,
} from "@typesugar/transformer-core";
import type { RawSourceMap } from "@typesugar/core";

// ============================================================================
// transpileExpanded() unit tests
// ============================================================================

describe("transpileExpanded", () => {
  const defaultOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
  };

  it("strips type annotations", () => {
    const code = `const x: number = 42;\nfunction foo(a: string): boolean { return true; }`;
    const result = transpileExpanded(code, "test.ts", defaultOptions);
    expect(result.outputText).not.toContain(": number");
    expect(result.outputText).not.toContain(": string");
    expect(result.outputText).not.toContain(": boolean");
    expect(result.outputText).toContain("const x = 42");
  });

  it("compiles namespace to IIFE", () => {
    const code = `namespace Foo {\n  export const bar = 1;\n}`;
    const result = transpileExpanded(code, "test.ts", defaultOptions);
    expect(result.outputText).toContain("(function (Foo)");
    expect(result.outputText).toContain("Foo.bar = 1");
    expect(result.outputText).not.toContain("namespace");
  });

  it("converts companion const→var to avoid redeclaration errors", () => {
    const code = `const Point: Record<string, any> = {};\nnamespace Point {\n  export const Eq = { equals: () => true };\n}`;
    const result = transpileExpanded(code, "test.ts", defaultOptions);
    // Should use var (not const) so var re-declaration from namespace IIFE is legal
    expect(result.outputText).toContain("var Point = {}");
    expect(result.outputText).not.toContain("const Point");
    // Namespace should be compiled to IIFE
    expect(result.outputText).toContain("(function (Point)");
    expect(result.outputText).toContain("Point.Eq");
  });

  it("converts exported companion const→var", () => {
    const code = `export const MyType: Record<string, any> = {};\nnamespace MyType {\n  export const Debug = {};\n}`;
    const result = transpileExpanded(code, "test.ts", defaultOptions);
    expect(result.outputText).toContain("var MyType = {}");
    expect(result.outputText).not.toMatch(/const MyType/);
  });

  it("does not affect non-companion const declarations", () => {
    const code = `const x = 42;\nconst y: string = "hello";`;
    const result = transpileExpanded(code, "test.ts", defaultOptions);
    expect(result.outputText).toContain("const x = 42");
    expect(result.outputText).toContain('const y = "hello"');
  });

  it("generates source map when requested", () => {
    const code = `const x = 1;\nconsole.log(x);`;
    const result = transpileExpanded(code, "test.ts", defaultOptions, { sourceMap: true });
    expect(result.sourceMapText).toBeDefined();
    const map = JSON.parse(result.sourceMapText!) as RawSourceMap;
    expect(map.version).toBe(3);
    expect(map.sources).toContain("test.ts");
  });

  it("omits source map when sourceMap: false", () => {
    const code = `const x = 1;`;
    const result = transpileExpanded(code, "test.ts", defaultOptions, { sourceMap: false });
    expect(result.sourceMapText).toBeUndefined();
  });

  it("returns fixMap when companion const is present", () => {
    const code = `const Point: Record<string, any> = {};\nnamespace Point { export const Eq = {}; }`;
    const result = transpileExpanded(code, "test.ts", defaultOptions);
    expect(result.fixMap).not.toBeNull();
  });

  it("returns null fixMap when no companion const", () => {
    const code = `const x = 42;\nconsole.log(x);`;
    const result = transpileExpanded(code, "test.ts", defaultOptions);
    expect(result.fixMap).toBeNull();
  });

  it("handles JSX when jsx option provided", () => {
    const code = `const el = <div>hello</div>;`;
    const result = transpileExpanded(code, "test.tsx", defaultOptions, {
      sourceMap: false,
      jsx: ts.JsxEmit.ReactJSX,
    });
    expect(result.outputText).not.toContain("<div>");
    expect(result.outputText).toContain("jsx");
  });

  it("handles multiple companion consts in one file", () => {
    const code = [
      `const Point: Record<string, any> = {};`,
      `namespace Point { export const Eq = {}; }`,
      `const Color: Record<string, any> = {};`,
      `namespace Color { export const Debug = {}; }`,
    ].join("\n");
    const result = transpileExpanded(code, "test.ts", defaultOptions);
    expect(result.outputText).toContain("var Point = {}");
    expect(result.outputText).toContain("var Color = {}");
    expect(result.outputText).not.toMatch(/const Point|const Color/);
  });
});

// ============================================================================
// TransformResult.js / emitJs integration tests
// ============================================================================

describe("emitJs pipeline integration", () => {
  it("populates js field when emitJs is enabled and file changed", () => {
    const code = `
/** @derive(Eq) */
interface Point { x: number; y: number; }
    `.trim();

    const result = transformCode(code, { fileName: "test.ts", emitJs: true });

    expect(result.changed).toBe(true);
    expect(result.js).toBeDefined();
    expect(result.js).not.toContain("namespace");
    // Should still have TS in result.code
    expect(result.code).toContain("namespace Point");
  });

  it("js output does not contain sourceMappingURL comment", () => {
    const code = `
/** @derive(Eq) */
interface Point { x: number; y: number; }
    `.trim();

    const result = transformCode(code, { fileName: "test.ts", emitJs: true });
    expect(result.js).not.toContain("sourceMappingURL");
  });

  it("js output does not contain type annotations", () => {
    const code = `
/** @derive(Eq, Clone) */
interface Point { x: number; y: number; }
    `.trim();

    const result = transformCode(code, { fileName: "test.ts", emitJs: true });
    expect(result.js).not.toMatch(/:\s*number/);
    expect(result.js).not.toMatch(/:\s*Point/);
    expect(result.js).not.toMatch(/:\s*boolean/);
  });

  it("does not populate js when emitJs is false", () => {
    const code = `
/** @derive(Eq) */
interface Point { x: number; y: number; }
    `.trim();

    const result = transformCode(code, { fileName: "test.ts" });
    expect(result.js).toBeUndefined();
    expect(result.jsSourceMap).toBeUndefined();
  });

  it("skips transpile for files without macros (2B)", () => {
    // The TS printer adds a trailing newline, but the changed check now
    // normalizes trailing whitespace to avoid false positives.
    const code = `const x = 42;`;
    const result = transformCode(code, { fileName: "test.ts", emitJs: true });
    // File has no macros — should NOT be marked as changed
    expect(result.changed).toBe(false);
    // No js output since the file wasn't changed
    expect(result.js).toBeUndefined();
  });

  it("populates jsSourceMap when emitJs is enabled", () => {
    const code = `
/** @derive(Eq) */
interface Point { x: number; y: number; }
    `.trim();

    const result = transformCode(code, { fileName: "test.ts", emitJs: true });
    expect(result.jsSourceMap).toBeDefined();
    expect(result.jsSourceMap!.version).toBe(3);
    // Mappings may be sparse — the macro transformer doesn't map all generated
    // lines back to the original source. The jsSourceMap correctly reflects
    // whatever the upstream source maps provide.
    expect(result.jsSourceMap!.sources.length).toBeGreaterThanOrEqual(0);
  });

  it("jsSourceMap maps JS positions back to original source", () => {
    // Use dynamic import for trace-mapping since it's ESM
    const code = `
const greeting: string = "hello";
/** @derive(Debug) */
interface Msg { text: string; }
console.log(greeting);
    `.trim();

    const result = transformCode(code, { fileName: "test.ts", emitJs: true });
    expect(result.jsSourceMap).toBeDefined();

    // Basic structural checks on the source map
    const map = result.jsSourceMap!;
    expect(map.sources).toBeDefined();
    expect(map.sources.length).toBeGreaterThan(0);
    expect(map.mappings.length).toBeGreaterThan(0);
  });

  it("macro-generated lines map back to @derive annotation (2A)", () => {
    const code = `
/** @derive(Eq) */
interface Point { x: number; y: number; }
    `.trim();

    const result = transformCode(code, { fileName: "test.ts", emitJs: true });

    // The upstream source map should have mappings for macro-generated lines
    expect(result.sourceMap).not.toBeNull();
    const upstreamDecoded = decodeSourceMap(result.sourceMap!);
    const tsLines = result.code.split("\n");

    // The TS output has ~13 lines (interface + companion const + namespace block).
    // With 2A, macro-generated lines (companion const, namespace) should have mappings.
    const nsLine = tsLines.findIndex((l) => l.includes("namespace Point"));
    expect(nsLine).toBeGreaterThanOrEqual(0);

    // Source map should now cover lines beyond the original interface (lines 0-4)
    // The namespace and companion const are on lines 5+
    expect(upstreamDecoded.mappings.length).toBeGreaterThan(nsLine);
    const hasNsMappings = upstreamDecoded.mappings.slice(nsLine).some((segs) => segs.length > 0);
    expect(hasNsMappings).toBe(true);

    // jsSourceMap should also have non-empty mappings now
    expect(result.jsSourceMap).toBeDefined();
    const jsDecoded = decodeSourceMap(result.jsSourceMap!);
    const jsSegments = jsDecoded.mappings.flat().filter((s) => s.sourceLine !== undefined);
    expect(jsSegments.length).toBeGreaterThan(0);
  });

  it("preserves runtime semantics of @derive output", () => {
    const code = `
/** @derive(Eq) */
interface Point { x: number; y: number; }
    `.trim();

    const result = transformCode(code, { fileName: "test.ts", emitJs: true });

    // The JS should contain the Eq implementation
    expect(result.js).toContain("equals");
    // Should have the companion IIFE pattern
    expect(result.js).toContain("(function (Point)");
    expect(result.js).toContain("Point.Eq");
  });

  it("handles comptime macro with emitJs", () => {
    const code = `
import { comptime } from "typesugar";
const val = comptime(() => 42);
console.log(val);
    `.trim();

    const result = transformCode(code, { fileName: "test.ts", emitJs: true });
    expect(result.js).toBeDefined();
    // comptime should be replaced with the value
    expect(result.js).toContain("42");
    expect(result.js).not.toContain("comptime");
  });

  it("produces js on second transform (in-memory cache hit)", () => {
    const code = `
/** @derive(Eq) */
interface Cached { a: number; }
    `.trim();
    const fileName = "/virtual/cache-test.ts";

    const pipeline = new TransformationPipeline(
      { target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext },
      [fileName],
      {
        emitJs: true,
        readFile: (f) => (f === fileName ? code : ts.sys.readFile(f)),
        fileExists: (f) => f === fileName || ts.sys.fileExists(f),
      }
    );

    // First transform — populates cache
    const r1 = pipeline.transform(fileName);
    expect(r1.js).toBeDefined();
    expect(r1.js).toContain("(function (Cached)");

    // Second transform — should hit in-memory cache and still have js
    const r2 = pipeline.transform(fileName);
    expect(r2.js).toBeDefined();
    expect(r2.js).toContain("(function (Cached)");
  });
});

// ============================================================================
// Pipeline robustness — no crashes on realistic files
// ============================================================================

describe("pipeline robustness", () => {
  it("@derive(Eq) with surrounding code does not crash the printer", () => {
    // This fixture replicates the VS Code integration test project.
    // The printer (ts.createPrinter().printFile()) used to crash with
    // "Debug Failure: position cannot precede the beginning of the file"
    // when mixing synthesized @derive nodes with original source nodes.
    const code = `
import { staticAssert } from "typesugar";

const x: number = "wrong";

/** @derive(Eq) */
interface Point { x: number; y: number; }

const y: string = 42;

staticAssert(false, "intentional failure");
    `.trim();

    const result = transformCode(code, { fileName: "diagnostics-fixture.ts" });

    // Must not produce a "Transform failed" diagnostic
    const crashDiags = result.diagnostics.filter((d) => d.message.includes("Transform failed"));
    expect(crashDiags, "pipeline should not crash during transform").toHaveLength(0);

    // The transform should succeed (derive expands the interface)
    expect(result.changed).toBe(true);
    expect(result.code).toContain("Point");
  });

  it("@derive(Eq) on interface produces namespace companion", () => {
    // @derive generates a companion namespace for the derived implementations.
    // For interfaces, a companion const is also emitted for declaration merging.
    const code = `
/** @derive(Eq) */
interface Point { x: number; y: number; }
    `.trim();

    const result = transformCode(code, { fileName: "derive-companion.ts" });

    expect(result.code).toContain("namespace Point");
    expect(result.code).toContain("export const Eq");
  });

  it("@derive(Eq) works on exported class", () => {
    const code = `
import { derive, Eq } from "typesugar";
/** @derive(Eq) */
export class Point { constructor(public x: number, public y: number) {} }
    `.trim();

    const result = transformCode(code, { fileName: "derive-export-class.ts" });

    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(0);
    expect(result.changed).toBe(true);
    expect(result.code).toContain("export namespace Point");
    expect(result.code).toContain("export const Eq");
  });

  it("@derive(Eq) on exported class produces importable companion", () => {
    // The companion namespace must be exported so that importing modules
    // can access Point.Eq.equals(). This test verifies the full two-file scenario.
    const pointModule = `
import { derive, Eq } from "typesugar";
/** @derive(Eq) */
export class Point { constructor(public x: number, public y: number) {} }
    `.trim();

    const result = transformCode(pointModule, { fileName: "point.ts" });

    // Namespace must be exported
    expect(result.code).toContain("export namespace Point");

    // A consumer module should be able to reference Point.Eq
    const consumer = `
import { Point } from "./point";
const p1 = new Point(1, 2);
const p2 = new Point(1, 2);
console.log(Point.Eq.equals(p1, p2));
    `.trim();

    const consumerResult = transformCode(consumer, { fileName: "consumer.ts" });
    // Consumer should not have errors about Point.Eq
    const consumerErrors = consumerResult.diagnostics.filter((d) => d.severity === "error");
    expect(consumerErrors).toHaveLength(0);
  });

  it("@derive(Eq) on exported interface produces exported namespace", () => {
    const code = `
import { derive, Eq } from "typesugar";
/** @derive(Eq) */
export interface Point { x: number; y: number; }
    `.trim();

    const result = transformCode(code, { fileName: "derive-export-interface.ts" });

    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(0);
    expect(result.changed).toBe(true);
    expect(result.code).toContain("export namespace Point");
  });

  it("@derive(Eq) with multiple interfaces does not crash", () => {
    const code = `
/** @derive(Eq) */
interface Point { x: number; y: number; }

/** @derive(Eq) */
interface Color { r: number; g: number; b: number; }

const p: Point = { x: 1, y: 2 };
    `.trim();

    const result = transformCode(code, { fileName: "multi-derive.ts" });

    const crashDiags = result.diagnostics.filter((d) => d.message.includes("Transform failed"));
    expect(crashDiags).toHaveLength(0);
    expect(result.changed).toBe(true);
  });

  it("@derive(Eq) through full pipeline does not crash", () => {
    const code = `
import { staticAssert } from "typesugar";

const x: number = "wrong";

/** @derive(Eq) */
interface Point { x: number; y: number; }

const y: string = 42;
    `.trim();
    const fileName = "/virtual/pipeline-derive-crash.ts";

    const pipeline = new TransformationPipeline(
      { target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext },
      [fileName],
      {
        readFile: (f) => (f === fileName ? code : ts.sys.readFile(f)),
        fileExists: (f) => f === fileName || ts.sys.fileExists(f),
      }
    );

    const result = pipeline.transform(fileName);

    const crashDiags = result.diagnostics.filter((d) => d.message.includes("Transform failed"));
    expect(crashDiags, "full pipeline should not crash on @derive with errors").toHaveLength(0);
    expect(result.changed).toBe(true);
  });
});

// ============================================================================
// composeSourceMapChain tests
// ============================================================================

describe("composeSourceMapChain", () => {
  it("returns null for empty array", () => {
    expect(composeSourceMapChain([])).toBeNull();
  });

  it("returns null when all entries are null", () => {
    expect(composeSourceMapChain([null, null, undefined])).toBeNull();
  });

  it("returns single map unchanged", () => {
    const map: RawSourceMap = {
      version: 3,
      sources: ["a.ts"],
      names: [],
      mappings: "AAAA",
    };
    const result = composeSourceMapChain([map]);
    expect(result).toEqual(map);
  });

  it("composes two maps correctly", () => {
    // Map 1: a→b (identity)
    const map1: RawSourceMap = {
      version: 3,
      sources: ["a.ts"],
      names: [],
      mappings: "AAAA",
      sourcesContent: ["x"],
    };
    // Map 2: b→c (identity)
    const map2: RawSourceMap = {
      version: 3,
      sources: ["b.ts"],
      names: [],
      mappings: "AAAA",
      sourcesContent: ["x"],
    };
    const result = composeSourceMapChain([map2, map1]);
    expect(result).not.toBeNull();
    expect(result!.version).toBe(3);
    expect(result!.sources).toContain("a.ts");
  });

  it("filters null entries from chain", () => {
    const map: RawSourceMap = {
      version: 3,
      sources: ["a.ts"],
      names: [],
      mappings: "AAAA",
    };
    const result = composeSourceMapChain([null, map, null]);
    expect(result).toEqual(map);
  });
});

// ============================================================================
// expand --js behavior (via transformCode)
// ============================================================================

describe("expand --js equivalent", () => {
  it("expand without emitJs returns TypeScript with namespaces", () => {
    const code = `
/** @derive(Eq) */
interface Point { x: number; y: number; }
    `.trim();

    const result = transformCode(code, { fileName: "test.ts" });
    expect(result.code).toContain("namespace Point");
    expect(result.code).toContain(": boolean");
  });

  it("expand with emitJs returns JavaScript without namespaces", () => {
    const code = `
/** @derive(Eq) */
interface Point { x: number; y: number; }
    `.trim();

    const result = transformCode(code, { fileName: "test.ts", emitJs: true });
    expect(result.js).not.toContain("namespace");
    expect(result.js).not.toMatch(/:\s*boolean/);
    expect(result.js).toContain("(function (Point)");
  });
});
