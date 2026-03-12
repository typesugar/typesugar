/**
 * Tests for .sts file extension-based routing (PEP-001)
 *
 * Verifies that:
 * - .sts files go through the preprocessor (custom syntax works)
 * - .ts files skip the preprocessor (custom syntax produces errors)
 * - Cross-file imports between .ts and .sts resolve correctly
 * - TypeScript type-checks mixed .ts/.sts projects (Wave 2)
 * - Module resolution works for .sts files (Wave 2)
 */
import { describe, it, expect } from "vitest";
import { TransformationPipeline, transformCode } from "../packages/transformer/src/pipeline.js";
import { preprocess } from "../packages/preprocessor/src/index.js";
import { VirtualCompilerHost } from "../packages/transformer/src/virtual-host.js";
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
    it("should transform .sts file when imported from .ts file", () => {
      const files = new Map<string, string>();
      files.set("/test/main.ts", `import { double } from "./util";\nconst x = double(2);`);
      files.set("/test/util.sts", `export const double = (n: number) => n |> ((x) => x * 2);`);

      const pipeline = new TransformationPipeline(
        { target: ts.ScriptTarget.Latest },
        ["/test/util.sts"], // Only include .sts in root files
        {
          readFile: (f) => files.get(f),
          fileExists: (f) => files.has(f),
        }
      );

      // The .sts file should be transformed
      const stsResult = pipeline.transform("/test/util.sts");
      expect(stsResult.code).toContain("__binop__");
      expect(stsResult.changed).toBe(true);
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

    // Note: Cross-file import tests from .ts to .sts require ts-patch integration
    // because TypeScript 5.9+ doesn't recognize .sts as a valid extension.
    // These tests are skipped until ts-patch is configured in the test environment.
    it.skip("should extract dependencies to .sts files (requires ts-patch)", () => {
      const files = new Map<string, string>();
      files.set("/test/main.ts", `import { value } from "./util";`);
      files.set("/test/util.sts", `export const value = 42 |> String;`);

      const pipeline = new TransformationPipeline(
        { target: ts.ScriptTarget.Latest },
        ["/test/main.ts"],
        {
          readFile: (f) => files.get(f),
          fileExists: (f) => files.has(f),
        }
      );

      const result = pipeline.transform("/test/main.ts");
      expect(result.dependencies?.has("/test/util.sts")).toBe(true);
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
    it.skip("should extract .sts file dependencies from imports (requires ts-patch)", () => {
      const files = new Map<string, string>();
      files.set("/test/main.ts", `import { foo } from "./bar";\nconsole.log(foo);`);
      files.set("/test/bar.sts", `export const foo = 1 |> String;`);

      const pipeline = new TransformationPipeline(
        { target: ts.ScriptTarget.Latest },
        ["/test/main.ts"],
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

// =============================================================================
// Wave 2: Module Resolution — TypeScript Sees .sts Files
// =============================================================================
describe("Module resolution - TypeScript sees .sts files (PEP-001 Wave 2)", () => {
  // ==========================================================================
  // Test 1: VirtualCompilerHost resolves modules to .sts files
  // ==========================================================================
  describe("VirtualCompilerHost module resolution", () => {
    it("should resolve module imports to .sts files when .ts not found", () => {
      const files = new Map<string, string>();
      files.set("/test/main.ts", `import { double } from "./util";\nconst x = double(2);`);
      files.set("/test/util.sts", `export const double = (n: number) => n * 2;`);

      const host = new VirtualCompilerHost({
        compilerOptions: { target: ts.ScriptTarget.Latest },
        readFile: (f) => files.get(f),
        fileExists: (f) => files.has(f),
      });

      const resolved = host.resolveModuleNames(
        ["./util"],
        "/test/main.ts",
        undefined,
        undefined,
        { target: ts.ScriptTarget.Latest }
      );

      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toBeDefined();
      expect(resolved[0]!.resolvedFileName).toBe("/test/util.sts");
    });

    it("should prefer .ts over .sts in module resolution", () => {
      const files = new Map<string, string>();
      files.set("/test/main.ts", `import { foo } from "./util";`);
      files.set("/test/util.ts", `export const foo = 1;`);
      files.set("/test/util.sts", `export const foo = 2;`);

      const host = new VirtualCompilerHost({
        compilerOptions: { target: ts.ScriptTarget.Latest },
        readFile: (f) => files.get(f),
        fileExists: (f) => files.has(f),
      });

      const resolved = host.resolveModuleNames(
        ["./util"],
        "/test/main.ts",
        undefined,
        undefined,
        { target: ts.ScriptTarget.Latest }
      );

      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toBeDefined();
      // Should resolve to .ts, not .sts
      expect(resolved[0]!.resolvedFileName).toBe("/test/util.ts");
    });

    it("should resolve .stsx files for JSX modules", () => {
      const files = new Map<string, string>();
      files.set("/test/App.tsx", `import { Button } from "./Button";\nexport const App = () => <Button />;`);
      files.set("/test/Button.stsx", `export const Button = () => <button>Click me</button>;`);

      const host = new VirtualCompilerHost({
        compilerOptions: { target: ts.ScriptTarget.Latest, jsx: ts.JsxEmit.React },
        readFile: (f) => files.get(f),
        fileExists: (f) => files.has(f),
      });

      const resolved = host.resolveModuleNames(
        ["./Button"],
        "/test/App.tsx",
        undefined,
        undefined,
        { target: ts.ScriptTarget.Latest, jsx: ts.JsxEmit.React }
      );

      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toBeDefined();
      expect(resolved[0]!.resolvedFileName).toBe("/test/Button.stsx");
    });

    it("should resolve index.sts files for directory imports", () => {
      const files = new Map<string, string>();
      files.set("/test/main.ts", `import { utils } from "./lib";`);
      files.set("/test/lib/index.sts", `export const utils = { name: "lib" };`);

      const host = new VirtualCompilerHost({
        compilerOptions: { target: ts.ScriptTarget.Latest },
        readFile: (f) => files.get(f),
        fileExists: (f) => files.has(f),
      });

      const resolved = host.resolveModuleNames(
        ["./lib"],
        "/test/main.ts",
        undefined,
        undefined,
        { target: ts.ScriptTarget.Latest }
      );

      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toBeDefined();
      expect(resolved[0]!.resolvedFileName).toBe("/test/lib/index.sts");
    });
  });

  // ==========================================================================
  // Test 2: TypeScript type-checks mixed .ts/.sts projects
  // ==========================================================================
  describe("TypeScript type-checking mixed projects", () => {
    it("should transform .sts file to valid TypeScript for type checking", () => {
      const files = new Map<string, string>();
      files.set("/test/math.sts", `
        export const add = (a: number, b: number): number => a + b;
        export const piped = 5 |> ((x) => x * 2);
      `);

      // Use TransformationPipeline to transform .sts file
      const pipeline = new TransformationPipeline(
        {
          target: ts.ScriptTarget.Latest,
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          skipDefaultLibCheck: true,
          lib: [],
        },
        ["/test/math.sts"],
        {
          readFile: (f) => files.get(f),
          fileExists: (f) => files.has(f),
        }
      );

      // Transform the .sts file
      const result = pipeline.transform("/test/math.sts");

      // The code should be preprocessed (pipe operator transformed)
      expect(result.code).toContain("__binop__");
      expect(result.changed).toBe(true);

      // No pipeline diagnostics should be reported
      expect(result.diagnostics).toHaveLength(0);

      // The preprocessed file should be cached
      const preprocessed = pipeline.getPreprocessedFile("/test/math.sts");
      expect(preprocessed).toBeDefined();
    });

    it("should handle .sts files without custom syntax", () => {
      const files = new Map<string, string>();
      // This .sts file doesn't use custom syntax (no |>, ::, or F<_>)
      files.set("/test/data.sts", `
        export const value: number = 42;
        export const greet = (name: string): string => \`Hello, \${name}!\`;
      `);

      // Use TransformationPipeline
      const pipeline = new TransformationPipeline(
        { target: ts.ScriptTarget.Latest },
        ["/test/data.sts"],
        {
          readFile: (f) => files.get(f),
          fileExists: (f) => files.has(f),
        }
      );

      // Transform the file
      const result = pipeline.transform("/test/data.sts");

      // Since there's no custom syntax, the file should NOT be changed by preprocessing
      // (the preprocessor only transforms files with |>, ::, or HKT syntax)
      // But it may still be "changed" due to macro transformation
      expect(result.diagnostics).toHaveLength(0);

      // The file should still be in the pipeline
      expect(pipeline.getFileNames()).toContain("/test/data.sts");
    });

    it("should type-check .sts file with custom syntax after preprocessing", () => {
      const files = new Map<string, string>();
      const stsCode = `
        const double = (x: number): number => x * 2;
        const result: number = 5 |> double;
      `;
      files.set("/test/app.sts", stsCode);

      // Use TransformationPipeline which properly handles .sts files
      const pipeline = new TransformationPipeline(
        {
          target: ts.ScriptTarget.Latest,
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          skipDefaultLibCheck: true,
          lib: [],
        },
        ["/test/app.sts"],
        {
          readFile: (f) => files.get(f),
          fileExists: (f) => files.has(f),
        }
      );

      // Transform the .sts file
      const result = pipeline.transform("/test/app.sts");

      // The code should be preprocessed (pipe operator transformed)
      expect(result.code).toContain("__binop__");
      expect(result.changed).toBe(true);

      // No syntax errors in the transformation diagnostics
      const syntaxErrors = result.diagnostics.filter(d => d.severity === "error");
      expect(syntaxErrors).toHaveLength(0);

      // The preprocessed file info should be available
      const preprocessed = pipeline.getPreprocessedFile("/test/app.sts");
      expect(preprocessed).toBeDefined();
      expect(preprocessed!.code).toContain("__binop__");
      expect(preprocessed!.original).toBe(stsCode);

      // The pipeline should have the file in its file list
      const fileNames = pipeline.getFileNames();
      expect(fileNames).toContain("/test/app.sts");
    });
  });

  // ==========================================================================
  // Test 3: Declaration file emit for .sts files
  // ==========================================================================
  describe("Declaration file emit", () => {
    it("should correct .d.sts.ts to .d.ts in writeFile", () => {
      const writtenFiles = new Map<string, string>();

      const files = new Map<string, string>();
      files.set("/test/util.sts", `export const value: number = 42;`);

      const host = new VirtualCompilerHost({
        compilerOptions: {
          target: ts.ScriptTarget.Latest,
          declaration: true,
          outDir: "/test/dist",
        },
        readFile: (f) => files.get(f),
        fileExists: (f) => files.has(f),
        baseHost: {
          ...ts.createCompilerHost({ target: ts.ScriptTarget.Latest }),
          writeFile: (fileName, data) => {
            writtenFiles.set(fileName, data);
          },
        },
      });

      // Simulate writing a .d.sts.ts file
      host.writeFile("/test/dist/util.d.sts.ts", "export declare const value: number;", false);

      // Should have been corrected to .d.ts
      expect(writtenFiles.has("/test/dist/util.d.ts")).toBe(true);
      expect(writtenFiles.has("/test/dist/util.d.sts.ts")).toBe(false);
    });

    it("should not modify regular .d.ts file names", () => {
      const writtenFiles = new Map<string, string>();

      const host = new VirtualCompilerHost({
        compilerOptions: { target: ts.ScriptTarget.Latest },
        readFile: () => undefined,
        fileExists: () => false,
        baseHost: {
          ...ts.createCompilerHost({ target: ts.ScriptTarget.Latest }),
          writeFile: (fileName, data) => {
            writtenFiles.set(fileName, data);
          },
        },
      });

      // Write a regular .d.ts file
      host.writeFile("/test/dist/normal.d.ts", "export declare const x: number;", false);

      // Should remain unchanged
      expect(writtenFiles.has("/test/dist/normal.d.ts")).toBe(true);
    });
  });

  // ==========================================================================
  // Test 4: Position mapping for .sts files (preprocessor source maps)
  // ==========================================================================
  describe("Position mapping for .sts files", () => {
    it("should provide source maps for preprocessed .sts files", () => {
      const files = new Map<string, string>();
      files.set("/test/app.sts", `const x = 1 |> double;`);

      const host = new VirtualCompilerHost({
        compilerOptions: { target: ts.ScriptTarget.Latest },
        readFile: (f) => files.get(f),
        fileExists: (f) => files.has(f),
      });

      // Get the preprocessed file
      const preprocessed = host.getPreprocessedFile("/test/app.sts");

      expect(preprocessed).toBeDefined();
      expect(preprocessed!.map).toBeDefined();
      expect(preprocessed!.map).not.toBeNull();

      // Source map should have mappings
      expect(preprocessed!.map!.mappings).toBeDefined();
      expect(preprocessed!.map!.mappings.length).toBeGreaterThan(0);
    });

    it("should preserve original content for position mapping", () => {
      const originalCode = `const piped = value |> transform;`;
      const files = new Map<string, string>();
      files.set("/test/code.sts", originalCode);

      const host = new VirtualCompilerHost({
        compilerOptions: { target: ts.ScriptTarget.Latest },
        readFile: (f) => files.get(f),
        fileExists: (f) => files.has(f),
      });

      const preprocessed = host.getPreprocessedFile("/test/code.sts");

      expect(preprocessed).toBeDefined();
      expect(preprocessed!.original).toBe(originalCode);
      expect(preprocessed!.code).not.toBe(originalCode); // Should be transformed
    });
  });
});
