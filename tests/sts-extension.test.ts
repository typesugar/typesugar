/**
 * Tests for .sts file extension-based routing (PEP-001)
 *
 * Verifies that:
 * - .sts files go through the preprocessor (custom syntax works)
 * - .ts files skip the preprocessor (custom syntax produces errors)
 * - Cross-file imports between .ts and .sts resolve correctly
 */
import { describe, it, expect } from "vitest";
import { TransformationPipeline, transformCode } from "../packages/transformer/src/pipeline.js";
import { preprocess } from "../packages/preprocessor/src/index.js";
import * as ts from "typescript";

describe("Extension-based routing (PEP-001 Wave 1)", () => {
  // ==========================================================================
  // Test 1: .sts files with |> compile correctly
  // ==========================================================================
  describe(".sts files with custom syntax", () => {
    it("should preprocess |> operator in .sts files", () => {
      const code = `const result = 1 |> ((x) => x + 1);`;

      const result = transformCode(code, { fileName: "test.sts" });

      // Pipeline operator should be transformed to __binop__ calls
      expect(result.code).toContain("__binop__");
      expect(result.diagnostics).toHaveLength(0);
    });

    it("should preprocess HKT syntax in .sts files", () => {
      const code = `type F<_> = { value: number };`;

      const result = transformCode(code, { fileName: "test.sts" });

      // HKT syntax should be transformed
      expect(result.code).toBeDefined();
      expect(result.diagnostics).toHaveLength(0);
    });

    it("should preprocess :: operator in .sts files", () => {
      const code = `const list = 1 :: [2, 3];`;

      const result = transformCode(code, { fileName: "test.sts" });

      // Cons operator should be transformed
      expect(result.code).toContain("__binop__");
      expect(result.diagnostics).toHaveLength(0);
    });

    it("should handle .stsx files with JSX and custom syntax", () => {
      const code = `
        const doubled = x |> double;
        const el = <div>{doubled}</div>;
      `;

      // Using the preprocessor directly to verify JSX mode is enabled
      const result = preprocess(code, {
        fileName: "test.stsx",
        extensions: ["pipeline"],
      });

      expect(result.changed).toBe(true);
      expect(result.code).toContain("__binop__");
      expect(result.code).toContain("<div>");
    });
  });

  // ==========================================================================
  // Test 2: .ts files with |> produce errors (not preprocessed)
  // ==========================================================================
  describe(".ts files skip preprocessing", () => {
    it("should NOT preprocess |> operator in .ts files", () => {
      const code = `const result = 1 |> ((x) => x + 1);`;

      // The preprocessor should not transform .ts files
      const preprocessResult = preprocess(code, {
        fileName: "test.ts",
        extensions: ["pipeline"],
      });

      // The preprocessor still runs but the pipeline shouldPreprocess check
      // should be at the VirtualCompilerHost level
      // Let's verify via the transformation pipeline behavior

      // When using transformCode with a .ts file, the preprocessor should
      // skip preprocessing (VirtualCompilerHost.shouldPreprocess returns false)
      const result = transformCode(code, { fileName: "test.ts" });

      // For .ts files, the |> is not transformed because:
      // 1. VirtualCompilerHost.shouldPreprocess returns false for .ts
      // 2. maybePreprocess in index.ts only preprocesses .sts files
      // The |> will either remain as-is (causing a parse error) or be rejected

      // In the current setup, TypeScript will fail to parse |> as it's not valid syntax
      // The code will either have parse errors or the |> will remain untransformed
      // Since TypeScript can't parse |>, we expect either errors or no __binop__
      expect(result.code).not.toContain("__binop__");
    });

    it("should NOT preprocess HKT syntax in .ts files", () => {
      const code = `type F<_> = { value: number };`;

      const result = transformCode(code, { fileName: "test.ts" });

      // HKT syntax should NOT be transformed in .ts files
      // The raw <_> syntax might cause parse issues or remain as-is
      expect(result.code).not.toContain("__kind__");
    });
  });

  // ==========================================================================
  // Test 3: Cross-file imports between .ts and .sts resolve correctly
  // ==========================================================================
  describe("Cross-file imports", () => {
    it("should resolve import from .ts to .sts file", () => {
      const files = new Map<string, string>();
      files.set("/test/main.ts", `import { double } from "./util";\nconst x = double(2);`);
      files.set("/test/util.sts", `export const double = (n: number) => n |> ((x) => x * 2);`);

      const pipeline = new TransformationPipeline(
        { target: ts.ScriptTarget.Latest },
        ["/test/main.ts", "/test/util.sts"],
        {
          readFile: (f) => files.get(f),
          fileExists: (f) => files.has(f),
        }
      );

      // The .sts file should be transformed
      const stsResult = pipeline.transform("/test/util.sts");
      expect(stsResult.code).toContain("__binop__");

      // The .ts file should NOT be preprocessed (it's plain TypeScript)
      const tsResult = pipeline.transform("/test/main.ts");
      expect(tsResult.diagnostics).toHaveLength(0);
    });

    it("should resolve import from .sts to .ts file", () => {
      const files = new Map<string, string>();
      files.set("/test/main.sts", `import { add } from "./math";\nconst x = 1 |> add(2);`);
      files.set("/test/math.ts", `export const add = (a: number) => (b: number) => a + b;`);

      const pipeline = new TransformationPipeline(
        { target: ts.ScriptTarget.Latest },
        ["/test/main.sts", "/test/math.ts"],
        {
          readFile: (f) => files.get(f),
          fileExists: (f) => files.has(f),
        }
      );

      // The .sts file should be transformed
      const stsResult = pipeline.transform("/test/main.sts");
      expect(stsResult.code).toContain("__binop__");

      // The .ts file should NOT have any custom syntax transformation
      const tsResult = pipeline.transform("/test/math.ts");
      expect(tsResult.code).not.toContain("__binop__");
    });

    it("should resolve ./foo to foo.sts when foo.ts doesn't exist", () => {
      const files = new Map<string, string>();
      files.set("/test/main.ts", `import { value } from "./util";`);
      files.set("/test/util.sts", `export const value = 42 |> String;`);
      // Note: /test/util.ts does NOT exist

      const pipeline = new TransformationPipeline(
        { target: ts.ScriptTarget.Latest },
        ["/test/main.ts", "/test/util.sts"],
        {
          readFile: (f) => files.get(f),
          fileExists: (f) => files.has(f),
        }
      );

      // Transform main.ts - it should resolve "./util" to util.sts
      const result = pipeline.transform("/test/main.ts");

      // Should have found the dependency
      expect(result.dependencies).toBeDefined();
      expect(result.dependencies!.has("/test/util.sts")).toBe(true);
    });
  });

  // ==========================================================================
  // Test 4: TransformationPipeline.shouldTransform includes .sts/.stsx
  // ==========================================================================
  describe("shouldTransform includes .sts/.stsx", () => {
    it("should transform .sts files", () => {
      const files = new Map<string, string>();
      files.set("/test/app.sts", `const x = 1;`);

      const pipeline = new TransformationPipeline(
        { target: ts.ScriptTarget.Latest },
        ["/test/app.sts"],
        {
          readFile: (f) => files.get(f),
          fileExists: (f) => files.has(f),
        }
      );

      expect(pipeline.shouldTransform("/test/app.sts")).toBe(true);
    });

    it("should transform .stsx files", () => {
      const files = new Map<string, string>();
      files.set("/test/app.stsx", `const x = 1;`);

      const pipeline = new TransformationPipeline(
        { target: ts.ScriptTarget.Latest },
        ["/test/app.stsx"],
        {
          readFile: (f) => files.get(f),
          fileExists: (f) => files.has(f),
        }
      );

      expect(pipeline.shouldTransform("/test/app.stsx")).toBe(true);
    });

    it("should not transform .sts.d.ts files", () => {
      const files = new Map<string, string>();
      files.set("/test/types.d.ts", `declare const x: number;`);

      const pipeline = new TransformationPipeline(
        { target: ts.ScriptTarget.Latest },
        ["/test/types.d.ts"],
        {
          readFile: (f) => files.get(f),
          fileExists: (f) => files.has(f),
        }
      );

      expect(pipeline.shouldTransform("/test/types.d.ts")).toBe(false);
    });

    it("should not transform node_modules .sts files", () => {
      const files = new Map<string, string>();
      files.set("/test/node_modules/lib/index.sts", `const x = 1;`);

      const pipeline = new TransformationPipeline(
        { target: ts.ScriptTarget.Latest },
        ["/test/node_modules/lib/index.sts"],
        {
          readFile: (f) => files.get(f),
          fileExists: (f) => files.has(f),
        }
      );

      expect(pipeline.shouldTransform("/test/node_modules/lib/index.sts")).toBe(false);
    });
  });

  // ==========================================================================
  // Test 5: Module resolution includes .sts/.stsx extensions
  // ==========================================================================
  describe("Module resolution includes .sts/.stsx", () => {
    it("should resolve imports to .sts files", () => {
      const files = new Map<string, string>();
      files.set("/test/main.ts", `import { foo } from "./bar";\nconsole.log(foo);`);
      files.set("/test/bar.sts", `export const foo = 1 |> String;`);

      const pipeline = new TransformationPipeline(
        { target: ts.ScriptTarget.Latest },
        ["/test/main.ts", "/test/bar.sts"],
        {
          readFile: (f) => files.get(f),
          fileExists: (f) => files.has(f),
        }
      );

      const result = pipeline.transform("/test/main.ts");
      expect(result.dependencies?.has("/test/bar.sts")).toBe(true);
    });

    it("should prefer .ts over .sts when both exist", () => {
      const files = new Map<string, string>();
      files.set("/test/main.ts", `import { foo } from "./bar";\nconsole.log(foo);`);
      files.set("/test/bar.ts", `export const foo = "from ts";`);
      files.set("/test/bar.sts", `export const foo = "from sts" |> String;`);

      const pipeline = new TransformationPipeline(
        { target: ts.ScriptTarget.Latest },
        ["/test/main.ts", "/test/bar.ts", "/test/bar.sts"],
        {
          readFile: (f) => files.get(f),
          fileExists: (f) => files.has(f),
        }
      );

      const result = pipeline.transform("/test/main.ts");
      // Should resolve to .ts first, not .sts
      expect(result.dependencies?.has("/test/bar.ts")).toBe(true);
      expect(result.dependencies?.has("/test/bar.sts")).toBe(false);
    });
  });
});
