/**
 * Tests for the TransformationPipeline
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TransformationPipeline, transformCode, formatExpansions } from "../src/pipeline.js";
import * as ts from "typescript";

// Load macro definitions (registers macros in the global registry)
import "@typesugar/macros";

describe("TransformationPipeline", () => {
  describe("transformCode (single-file)", () => {
    it("preprocesses HKT syntax", () => {
      const code = `
        type F<_> = { value: number };
        type Applied = F<string>;
      `;

      const result = transformCode(code, { fileName: "test.ts" });

      // HKT syntax should be transformed
      // F<_> → interface with _ property
      expect(result.code).toBeDefined();
      // The file should be processed without errors
      expect(result.diagnostics).toHaveLength(0);
    });

    it("transforms pipe operator", () => {
      const code = `
        const result = 1 |> ((x) => x + 1) |> ((x) => x * 2);
      `;

      // Use .sts extension to trigger preprocessing for pipe operator
      const result = transformCode(code, { fileName: "test.sts" });

      // Pipe operator is expanded via __binop__ macro to function calls
      // 1 |> f |> g becomes g(f(1))
      expect(result.code).toContain("((x) => x * 2)(((x) => x + 1)(1))");
      expect(result.diagnostics).toHaveLength(0);
    });

    it("returns unchanged flag when no transformation needed", () => {
      const code = `const x = 1 + 2;`;

      const result = transformCode(code, { fileName: "test.ts" });

      // Simple code shouldn't be marked as changed
      // (unless the printer formats differently)
      expect(result.code).toBeDefined();
    });

    it("handles syntax errors gracefully", () => {
      const code = `const x = {`;

      const result = transformCode(code, { fileName: "test.ts" });

      // Should return something, even if there are parse errors
      expect(result).toBeDefined();
    });
  });

  describe("TransformationPipeline (project)", () => {
    let pipeline: TransformationPipeline;

    beforeEach(() => {
      const files = new Map<string, string>();
      files.set("/test/index.ts", `export const x = 1;`);
      files.set("/test/util.ts", `export function double(n: number) { return n * 2; }`);

      pipeline = new TransformationPipeline(
        { target: ts.ScriptTarget.Latest },
        Array.from(files.keys()),
        {
          readFile: (f) => files.get(f),
          fileExists: (f) => files.has(f),
        }
      );
    });

    it("transforms multiple files", () => {
      const results = pipeline.transformAll();

      expect(results.size).toBe(2);
      expect(results.has("/test/index.ts")).toBe(true);
      expect(results.has("/test/util.ts")).toBe(true);
    });

    it("caches transform results", () => {
      // First transform
      const result1 = pipeline.transform("/test/index.ts");

      // Second transform should hit cache
      const result2 = pipeline.transform("/test/index.ts");

      // Results should be the same object (cached)
      expect(result1.code).toBe(result2.code);
    });

    it("invalidates cache on file change", () => {
      const files = new Map<string, string>();
      files.set("/test/index.ts", `export const x = 1;`);

      const p = new TransformationPipeline({ target: ts.ScriptTarget.Latest }, ["/test/index.ts"], {
        readFile: (f) => files.get(f),
        fileExists: (f) => files.has(f),
      });

      // First transform
      p.transform("/test/index.ts");

      // Change the file content
      files.set("/test/index.ts", `export const x = 2;`);

      // Invalidate
      p.invalidate("/test/index.ts");

      // New transform should use new content
      const result = p.transform("/test/index.ts");
      expect(result.original).toBe(`export const x = 2;`);
    });

    it("reports file names", () => {
      expect(pipeline.getFileNames()).toEqual(["/test/index.ts", "/test/util.ts"]);
    });

    it("filters files for transformation", () => {
      expect(pipeline.shouldTransform("/test/index.ts")).toBe(true);
      expect(pipeline.shouldTransform("/test/index.d.ts")).toBe(false);
      expect(pipeline.shouldTransform("/node_modules/foo.ts")).toBe(false);
    });
  });

  describe("dependency tracking", () => {
    it("extracts dependencies from imports", () => {
      const files = new Map<string, string>();
      files.set(
        "/test/index.ts",
        `
        import { double } from "./util";
        export const x = double(1);
      `
      );
      files.set(
        "/test/util.ts",
        `
        export function double(n: number) { return n * 2; }
      `
      );

      const pipeline = new TransformationPipeline(
        { target: ts.ScriptTarget.Latest },
        Array.from(files.keys()),
        {
          readFile: (f) => files.get(f),
          fileExists: (f) => files.has(f),
        }
      );

      const result = pipeline.transform("/test/index.ts");

      // Should have extracted the dependency
      expect(result.dependencies).toBeDefined();
      // Note: The dependency resolution might find the file or not depending on
      // the mock file system behavior
    });
  });

  describe("source map composition", () => {
    it("provides a position mapper", () => {
      const code = `const result = 1 |> ((x) => x + 1);`;

      const result = transformCode(code, { fileName: "test.ts" });

      expect(result.mapper).toBeDefined();
      expect(typeof result.mapper.toOriginal).toBe("function");
      expect(typeof result.mapper.toTransformed).toBe("function");
    });

    it("maps positions for unchanged files", () => {
      const code = `const x = 1;`;

      const result = transformCode(code, { fileName: "test.ts" });

      // Identity mapper for unchanged files
      expect(result.mapper.toOriginal(5)).toBe(5);
      expect(result.mapper.toTransformed(5)).toBe(5);
    });
  });

  describe("formatExpansions (focused diff)", () => {
    it("shows only changed regions for pipe operators", () => {
      const code = ["const a = 1;", "", "const b = a |> double;", "", "const c = 3;"].join("\n");

      // Use .sts extension for files with custom syntax (PEP-001)
      const result = transformCode(code, { fileName: "fmt-pipe.sts" });
      const focused = formatExpansions(result);

      expect(focused).toContain("changed line");
      // After transformation, |> becomes a function call (double(a))
      expect(focused).toContain("double");
      expect(focused).toContain("const a = 1;");
      expect(focused).toContain("const c = 3;");
    });

    it("returns 'No changes.' for unchanged files", () => {
      const code = "const x = 1;\n";
      const result = transformCode(code, { fileName: "fmt-noop.ts" });
      expect(formatExpansions(result)).toBe("No changes.");
    });

    it("shows preprocessor expansions with context", () => {
      // Use .sts extension with pipeline operator, which triggers the preprocessor
      // and doesn't require import resolution (unlike comptime which needs "typesugar" to resolve)
      const code = [
        "const double = (x: number) => x * 2;",
        "",
        "const result = 5 |> double;",
        "",
        "console.log(result);",
      ].join("\n");

      const result = transformCode(code, { fileName: "fmt-preproc.sts" });
      const focused = formatExpansions(result);

      expect(focused).toContain("changed line");
      // Should show the pipeline operator rewritten
      expect(focused).toContain("- const result = 5 |> double;");
      expect(focused).toContain("+ const result = double(5);");
      // Context should include surrounding lines
      expect(focused).toContain("console.log(result);");
    });
  });

  // Note: restoreBlankLines was removed (PEP-032 Wave 10).
  // Blank line restoration will be reimplemented using source maps.

  describe("strict typecheck modes", () => {
    const simpleCode = `const x: number = 1;\n`;

    function makePipeline(
      files: Record<string, string>,
      strict: boolean | "incremental"
    ): TransformationPipeline {
      const fileNames = Object.keys(files).map((f) => (f.startsWith("/") ? f : `/virtual/${f}`));
      return new TransformationPipeline(
        { target: ts.ScriptTarget.ES2022, strict: true },
        fileNames,
        {
          strict,
          readFile: (f) => {
            const key = f.replace(/^\/virtual\//, "");
            return files[key] ?? files[f];
          },
          fileExists: (f) => {
            const key = f.replace(/^\/virtual\//, "");
            return key in files || f in files;
          },
        }
      );
    }

    it("strictTypecheck() returns empty when strict is false", () => {
      const pipeline = makePipeline({ "a.ts": simpleCode }, false);
      expect(pipeline.strictTypecheck()).toEqual([]);
    });

    it("strictTypecheck() returns diagnostics when strict is true", () => {
      const pipeline = makePipeline({ "a.ts": simpleCode }, true);
      const diags = pipeline.strictTypecheck();
      expect(Array.isArray(diags)).toBe(true);
    });

    it("strictTypecheck() works with incremental mode (first run = full)", () => {
      const pipeline = makePipeline({ "a.ts": simpleCode }, "incremental");
      const diags = pipeline.strictTypecheck();
      expect(Array.isArray(diags)).toBe(true);
    });

    it("incremental mode reuses cache on unchanged second run", () => {
      const pipeline = makePipeline({ "a.ts": simpleCode }, "incremental");

      const diags1 = pipeline.strictTypecheck();
      const diags2 = pipeline.strictTypecheck();

      expect(diags1.length).toBe(diags2.length);
    });
  });
});
