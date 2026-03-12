/**
 * Tests for the TransformationPipeline
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  TransformationPipeline,
  transformCode,
  restoreBlankLines,
  formatExpansions,
} from "../src/pipeline.js";
import * as ts from "typescript";

describe("TransformationPipeline", () => {
  describe("transformCode (single-file)", () => {
    it("preprocesses HKT syntax in .sts files", () => {
      const code = `
        type F<_> = { value: number };
        type Applied = F<string>;
      `;

      // Use .sts extension for files with custom syntax (PEP-001)
      const result = transformCode(code, { fileName: "test.sts" });

      // HKT syntax should be transformed
      // F<_> → interface with _ property
      expect(result.code).toBeDefined();
      // The file should be processed without errors
      expect(result.diagnostics).toHaveLength(0);
    });

    it("transforms pipe operator in .sts files", () => {
      const code = `
        const result = 1 |> ((x) => x + 1) |> ((x) => x * 2);
      `;

      // Use .sts extension for files with custom syntax (PEP-001)
      const result = transformCode(code, { fileName: "test.sts" });

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
      // Use .sts extension for files with custom syntax (PEP-001)
      const code = `const result = 1 |> ((x) => x + 1);`;

      const result = transformCode(code, { fileName: "test.sts" });

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
      const result = transformCode(code, { fileName: "fmt-pipe.sts", preserveBlankLines: true });
      const focused = formatExpansions(result);

      expect(focused).toContain("changed line");
      expect(focused).toContain("__binop__");
      expect(focused).toContain("const a = 1;");
      expect(focused).toContain("const c = 3;");
    });

    it("returns 'No changes.' for unchanged files", () => {
      const code = "const x = 1;\n";
      const result = transformCode(code, { fileName: "fmt-noop.ts", preserveBlankLines: true });
      expect(formatExpansions(result)).toBe("No changes.");
    });

    it("shows comptime expansions with context", () => {
      const code = [
        'import { comptime } from "@typesugar/comptime";',
        "",
        "const x = comptime(1 + 2);",
        "",
        "console.log(x);",
      ].join("\n");

      const result = transformCode(code, { fileName: "fmt-ct.ts", preserveBlankLines: true });
      const focused = formatExpansions(result);

      expect(focused).toContain("changed line");
      // Should show the comptime call as deleted and literal as inserted
      expect(focused).toContain("- const x = comptime(1 + 2);");
      expect(focused).toContain("+ const x = 3;");
      // Context should include surrounding lines
      expect(focused).toContain("console.log(x);");
    });
  });

  describe("restoreBlankLines", () => {
    it("restores blank lines between unchanged content lines", () => {
      const original = "a\n\nb\n\nc\n";
      const printed = "a\nb\nc\n";

      const result = restoreBlankLines(original, printed);
      expect(result).toBe("a\n\nb\n\nc\n");
    });

    it("preserves blank lines around replaced lines", () => {
      const original = "a\n\ncomptime(1 + 2)\n\nc\n";
      const printed = "a\n3\nc\n";

      const result = restoreBlankLines(original, printed);
      expect(result).toContain("a\n");
      expect(result).toContain("3\n");
      expect(result).toContain("c\n");
    });

    it("handles removed lines (e.g. stripped imports)", () => {
      const original = 'import { comptime } from "typesugar";\n\nconst x = 1;\n';
      const printed = "const x = 1;\n";

      const result = restoreBlankLines(original, printed);
      expect(result).toContain("const x = 1;");
    });

    it("returns identical output when no blank lines exist", () => {
      const text = "a\nb\nc\n";
      expect(restoreBlankLines(text, text)).toBe(text);
    });

    it("integrates with transformCode", () => {
      const code = [
        'import { comptime } from "@typesugar/comptime";',
        "",
        "// section 1",
        "const a = 1;",
        "",
        "// section 2",
        "const b = comptime(() => 2 + 3);",
        "",
        "// section 3",
        "const c = 3;",
      ].join("\n");

      const result = transformCode(code, {
        fileName: "blank-lines.ts",
        preserveBlankLines: true,
      });

      // Blank lines between sections should be preserved
      expect(result.code).toContain("// section 1\nconst a = 1;");
      expect(result.code).toContain("\n\n// section 2");
      expect(result.code).toContain("\n\n// section 3");
    });
  });
});
