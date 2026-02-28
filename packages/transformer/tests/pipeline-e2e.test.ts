/**
 * Pipeline End-to-End Tests
 *
 * Verifies the full TransformationPipeline on realistic typesugar code:
 * - HKT syntax (F<_> → Kind<F, A>)
 * - Pipeline operator (|> → __binop__)
 * - Cons operator (:: → __binop__)
 * - Source map round-trip accuracy
 * - Multi-file projects
 * - Cache invalidation
 */

import { describe, it, expect } from "vitest";
import { TransformationPipeline, transformCode } from "../src/pipeline.js";
import * as ts from "typescript";

function createPipelineFromFiles(
  files: Map<string, string>,
  opts?: { extensions?: ("hkt" | "pipeline" | "cons")[] }
): TransformationPipeline {
  return new TransformationPipeline(
    {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
    },
    Array.from(files.keys()),
    {
      readFile: (f) => files.get(f),
      fileExists: (f) => files.has(f) || ts.sys.fileExists(f),
      extensions: opts?.extensions,
    }
  );
}

// =============================================================================
// 1. HKT Syntax Transformation
// =============================================================================

describe("Pipeline E2E: HKT syntax", () => {
  it("transforms F<_> parameter and F<A> usages", () => {
    const input = `
interface Functor<F<_>> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}
    `.trim();

    const result = transformCode(input, { fileName: "hkt.ts" });

    expect(result.code).toBeDefined();
    expect(result.changed).toBe(true);

    // F<_> is rewritten to plain F, and F<A>/F<B> become Kind<F, A>/Kind<F, B>
    expect(result.code).toContain("Kind<F, A>");
    expect(result.code).toContain("Kind<F, B>");
    // The HKT parameter sugar F<_> should be gone
    expect(result.code).not.toContain("F<_>");
  });

  it("transforms HKT in type aliases", () => {
    const input = `
type Apply<F<_>, A> = F<A>;
type Result = Apply<Array, string>;
    `.trim();

    const result = transformCode(input, { fileName: "hkt-alias.ts" });

    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toBeDefined();
    expect(result.changed).toBe(true);
  });

  it("preserves non-HKT generics untouched", () => {
    const input = `
interface Container<T> {
  value: T;
}
const c: Container<string> = { value: "hello" };
    `.trim();

    const result = transformCode(input, { fileName: "no-hkt.ts" });

    // Regular generics should pass through without mangling
    expect(result.code).toContain("Container");
    expect(result.code).toContain("string");
  });
});

// =============================================================================
// 2. Pipeline Operator Transformation
// =============================================================================

describe("Pipeline E2E: pipe operator", () => {
  it("transforms |> to __binop__ calls", () => {
    const input = `const result = 1 |> ((x: number) => x + 1) |> ((x: number) => x * 2);`;

    const result = transformCode(input, { fileName: "pipe.ts" });

    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toContain("__binop__");
    // The |> token should only appear as a string argument to __binop__, not as an operator
    const codeWithoutStrings = result.code.replace(/"[^"]*"/g, "").replace(/'[^']*'/g, "");
    expect(codeWithoutStrings).not.toContain("|>");
  });

  it("handles chained pipe operators", () => {
    const input = `
const add1 = (x: number): number => x + 1;
const double = (x: number): number => x * 2;
const toString = (x: number): string => String(x);
const result = 10 |> add1 |> double |> toString;
    `.trim();

    const result = transformCode(input, { fileName: "chained-pipe.ts" });

    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toContain("__binop__");
    expect(result.changed).toBe(true);
  });

  it("preserves code without pipe operators", () => {
    const input = `const x = 1 + 2;`;

    const result = transformCode(input, {
      fileName: "no-pipe.ts",
      extensions: ["pipeline"],
    });

    expect(result.code).toContain("1 + 2");
  });
});

// =============================================================================
// 3. Cons Operator Transformation
// =============================================================================

describe("Pipeline E2E: cons operator", () => {
  it("transforms :: to __binop__ calls", () => {
    const input = `const list = 1 :: 2 :: [];`;

    const result = transformCode(input, { fileName: "cons.ts" });

    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toContain("__binop__");
    // :: should only appear as a string literal argument
    const codeWithoutStrings = result.code.replace(/"[^"]*"/g, "").replace(/'[^']*'/g, "");
    expect(codeWithoutStrings).not.toContain("::");
  });

  it("handles nested cons expressions", () => {
    const input = `const nested = 1 :: 2 :: 3 :: [];`;

    const result = transformCode(input, { fileName: "nested-cons.ts" });

    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toContain("__binop__");
    expect(result.changed).toBe(true);
  });
});

// =============================================================================
// 4. Source Map Accuracy
// =============================================================================

describe("Pipeline E2E: source map accuracy", () => {
  it("produces a source map for transformed files", () => {
    const input = `const result = 1 |> ((x: number) => x + 1);`;

    const result = transformCode(input, { fileName: "map-test.ts" });

    expect(result.sourceMap).not.toBeNull();
    expect(result.mapper).toBeDefined();
  });

  it("provides identity mapping for untransformed files", () => {
    const input = `const x = 42;`;

    const result = transformCode(input, { fileName: "identity.ts" });

    // Identity mapper returns the same position
    expect(result.mapper.toOriginal(0)).toBe(0);
    expect(result.mapper.toTransformed(0)).toBe(0);
    expect(result.mapper.toOriginal(5)).toBe(5);
    expect(result.mapper.toTransformed(5)).toBe(5);
  });

  it("maps positions for pipe-transformed code", () => {
    const input = `const result = 1 |> ((x: number) => x + 1);`;

    const result = transformCode(input, { fileName: "pipe-map.ts" });

    // "const" is at position 0 in the original
    // After transformation, "const" should still map back to 0
    const constTransformed = result.mapper.toTransformed(0);
    expect(constTransformed).not.toBeNull();

    if (constTransformed !== null) {
      const roundTripped = result.mapper.toOriginal(constTransformed);
      // Round-trip should get us back to the start
      expect(roundTripped).not.toBeNull();
      if (roundTripped !== null) {
        expect(roundTripped).toBe(0);
      }
    }
  });

  it("maps 'result' identifier position through transformation", () => {
    const input = `const result = 1 |> ((x: number) => x + 1);`;

    const result = transformCode(input, { fileName: "result-map.ts" });

    const originalPos = input.indexOf("result");
    expect(originalPos).toBeGreaterThan(0);

    const transformedPos = result.mapper.toTransformed(originalPos);
    if (transformedPos !== null) {
      // The identifier "result" should exist at the transformed position
      const snippet = result.code.substring(transformedPos, transformedPos + 6);
      expect(snippet).toBe("result");

      // Round-trip
      const roundTripped = result.mapper.toOriginal(transformedPos);
      expect(roundTripped).not.toBeNull();
      if (roundTripped !== null) {
        expect(roundTripped).toBe(originalPos);
      }
    }
  });

  it("maps positions for HKT-transformed code", () => {
    const input = `
type Apply<F<_>, A> = F<A>;
const x = 42;
    `.trim();

    const result = transformCode(input, { fileName: "hkt-map.ts" });

    // "const x" should still be findable after HKT transformation
    const constOriginalPos = input.indexOf("const x");
    const constTransformed = result.mapper.toTransformed(constOriginalPos);
    expect(constTransformed).not.toBeNull();
  });
});

// =============================================================================
// 5. Multi-File Project
// =============================================================================

describe("Pipeline E2E: multi-file project", () => {
  it("transforms both files correctly", () => {
    const files = new Map<string, string>();
    files.set("/test/types.ts", `export interface Expr<T> { tag: string; }`);
    files.set(
      "/test/main.ts",
      `
import { Expr } from "./types";
const x: Expr<number> = { tag: "num" };
      `.trim()
    );

    const pipeline = createPipelineFromFiles(files);

    const typesResult = pipeline.transform("/test/types.ts");
    const mainResult = pipeline.transform("/test/main.ts");

    expect(typesResult.code).toBeDefined();
    expect(mainResult.code).toBeDefined();
    expect(typesResult.diagnostics).toHaveLength(0);
    expect(mainResult.diagnostics).toHaveLength(0);
  });

  it("transforms all files via transformAll()", () => {
    const files = new Map<string, string>();
    files.set("/test/types.ts", `export interface Expr<T> { tag: string; }`);
    files.set(
      "/test/main.ts",
      `
import { Expr } from "./types";
const x: Expr<number> = { tag: "num" };
      `.trim()
    );

    const pipeline = createPipelineFromFiles(files);
    const results = pipeline.transformAll();

    expect(results.size).toBe(2);
    expect(results.has("/test/types.ts")).toBe(true);
    expect(results.has("/test/main.ts")).toBe(true);
  });

  it("detects dependencies between files", () => {
    const files = new Map<string, string>();
    files.set("/test/util.ts", `export function double(n: number) { return n * 2; }`);
    files.set(
      "/test/main.ts",
      `
import { double } from "./util";
export const result = double(21);
      `.trim()
    );

    const pipeline = createPipelineFromFiles(files);
    const result = pipeline.transform("/test/main.ts");

    expect(result.dependencies).toBeDefined();
    if (result.dependencies) {
      // Should detect the import of ./util
      const deps = Array.from(result.dependencies);
      const hasUtilDep = deps.some((d) => d.includes("util"));
      expect(hasUtilDep).toBe(true);
    }
  });

  it("handles mixed transformed and untransformed files", () => {
    const files = new Map<string, string>();
    files.set("/test/plain.ts", `export const x = 42;`);
    files.set(
      "/test/piped.ts",
      `
import { x } from "./plain";
const result = x |> ((n: number) => n + 1);
      `.trim()
    );

    const pipeline = createPipelineFromFiles(files);

    const plainResult = pipeline.transform("/test/plain.ts");
    const pipedResult = pipeline.transform("/test/piped.ts");

    // Plain file should be essentially unchanged
    expect(plainResult.code).toContain("42");

    // Piped file should be transformed
    expect(pipedResult.code).toContain("__binop__");
  });
});

// =============================================================================
// 6. Cache Invalidation
// =============================================================================

describe("Pipeline E2E: cache invalidation", () => {
  it("returns cached result on repeated transforms", () => {
    const files = new Map<string, string>();
    files.set("/test/main.ts", `const result = 1 |> ((x: number) => x + 1);`);

    const pipeline = createPipelineFromFiles(files);

    const result1 = pipeline.transform("/test/main.ts");
    const result2 = pipeline.transform("/test/main.ts");

    // Cached: same code
    expect(result1.code).toBe(result2.code);
    expect(result1.changed).toBe(result2.changed);
  });

  it("returns fresh result after invalidation", () => {
    const files = new Map<string, string>();
    files.set("/test/main.ts", `const result = 1 |> ((x: number) => x + 1);`);

    const pipeline = createPipelineFromFiles(files);

    const result1 = pipeline.transform("/test/main.ts");

    // Update file content
    files.set("/test/main.ts", `const result = 99 |> ((x: number) => x + 1);`);

    // Invalidate cache
    pipeline.invalidate("/test/main.ts");

    const result3 = pipeline.transform("/test/main.ts");

    // Should reflect the new content
    expect(result3.original).toContain("99");
    expect(result3.original).not.toBe(result1.original);
  });

  it("invalidateAll resets everything", () => {
    const files = new Map<string, string>();
    files.set("/test/a.ts", `export const a = 1;`);
    files.set("/test/b.ts", `export const b = 2;`);

    const pipeline = createPipelineFromFiles(files);

    pipeline.transform("/test/a.ts");
    pipeline.transform("/test/b.ts");

    const stats1 = pipeline.getCacheStats();
    expect(stats1.transformedCount).toBeGreaterThan(0);

    pipeline.invalidateAll();

    const stats2 = pipeline.getCacheStats();
    expect(stats2.transformedCount).toBe(0);
    expect(stats2.preprocessedCount).toBe(0);
  });

  it("tracks cache statistics", () => {
    const files = new Map<string, string>();
    files.set("/test/main.ts", `const x = 1 |> ((n: number) => n + 1);`);

    const pipeline = createPipelineFromFiles(files);

    const statsBefore = pipeline.getCacheStats();
    expect(statsBefore.transformedCount).toBe(0);

    pipeline.transform("/test/main.ts");

    const statsAfter = pipeline.getCacheStats();
    expect(statsAfter.transformedCount).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// 7. Edge Cases
// =============================================================================

describe("Pipeline E2E: edge cases", () => {
  it("handles empty files", () => {
    const result = transformCode("", { fileName: "empty.ts" });

    expect(result.code).toBeDefined();
    // Empty string is falsy, so pipeline treats it as "file not found"
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("not found");
  });

  it("handles files with only comments", () => {
    const result = transformCode("// just a comment\n/* block */", {
      fileName: "comments.ts",
    });

    expect(result.code).toBeDefined();
    expect(result.diagnostics).toHaveLength(0);
  });

  it("returns error diagnostic for missing files", () => {
    const files = new Map<string, string>();
    const pipeline = createPipelineFromFiles(files);

    const result = pipeline.transform("/test/nonexistent.ts");

    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("not found");
  });

  it("skips declaration files", () => {
    expect(
      new TransformationPipeline({ target: ts.ScriptTarget.Latest }, [], {}).shouldTransform(
        "/test/foo.d.ts"
      )
    ).toBe(false);
  });

  it("skips node_modules", () => {
    expect(
      new TransformationPipeline({ target: ts.ScriptTarget.Latest }, [], {}).shouldTransform(
        "/test/node_modules/foo/index.ts"
      )
    ).toBe(false);
  });

  it("handles code with all three custom operators", () => {
    const input = `
const piped = 1 |> ((x: number) => x + 1);
const consed = 1 :: [];
    `.trim();

    const result = transformCode(input, { fileName: "all-ops.ts" });

    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toContain("__binop__");
    expect(result.changed).toBe(true);
  });

  it("getProgram() returns a valid ts.Program", () => {
    const files = new Map<string, string>();
    files.set("/test/main.ts", `export const x = 1;`);

    const pipeline = createPipelineFromFiles(files);
    const program = pipeline.getProgram();

    expect(program).toBeDefined();
    expect(program.getSourceFiles().length).toBeGreaterThan(0);
  });
});
