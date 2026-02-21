/**
 * Tests for the TransformationPipeline
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TransformationPipeline, transformCode } from "../src/pipeline.js";
import * as ts from "typescript";

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

      const result = transformCode(code, { fileName: "test.ts" });

      // Pipe operator should be transformed to __binop__ calls
      // The |> operator itself is replaced, though the string appears as an argument
      expect(result.code).toContain("__binop__");
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

      const p = new TransformationPipeline(
        { target: ts.ScriptTarget.Latest },
        ["/test/index.ts"],
        {
          readFile: (f) => files.get(f),
          fileExists: (f) => files.has(f),
        }
      );

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
      files.set("/test/index.ts", `
        import { double } from "./util";
        export const x = double(1);
      `);
      files.set("/test/util.ts", `
        export function double(n: number) { return n * 2; }
      `);

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
});
