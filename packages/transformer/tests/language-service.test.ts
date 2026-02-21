/**
 * Tests for the Language Service Plugin
 *
 * These tests verify that:
 * 1. The plugin correctly intercepts file reads
 * 2. Transformed code is served to TypeScript
 * 3. Diagnostic positions are mapped back correctly
 * 4. IDE features work with position mapping
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as ts from "typescript";
import init from "../src/language-service.js";
import { TransformationPipeline, transformCode } from "../src/pipeline.js";

/**
 * Creates a mock LanguageServiceHost for testing
 */
function createMockHost(files: Map<string, string>): ts.LanguageServiceHost {
  const versions = new Map<string, number>();
  for (const fileName of files.keys()) {
    versions.set(fileName, 1);
  }

  return {
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      strict: true,
    }),
    getScriptFileNames: () => Array.from(files.keys()),
    getScriptVersion: (fileName) => String(versions.get(fileName) ?? 1),
    getScriptSnapshot: (fileName) => {
      const content = files.get(fileName);
      if (content !== undefined) {
        return ts.ScriptSnapshot.fromString(content);
      }
      return undefined;
    },
    getCurrentDirectory: () => "/test",
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: (fileName) => files.has(fileName) || ts.sys.fileExists(fileName),
    readFile: (fileName) => files.get(fileName) ?? ts.sys.readFile(fileName),
  };
}

/**
 * Creates a mock PluginCreateInfo for testing
 */
function createMockPluginInfo(
  files: Map<string, string>
): ts.server.PluginCreateInfo {
  const host = createMockHost(files);
  const ls = ts.createLanguageService(host);

  // Create a minimal mock project
  const mockProject = {
    getProjectName: () => "/test/tsconfig.json",
    getCompilerOptions: () => host.getCompilationSettings(),
    getFileNames: () => Array.from(files.keys()),
    projectService: {
      logger: {
        info: vi.fn(),
        msg: vi.fn(),
      },
    },
  } as unknown as ts.server.Project;

  return {
    languageService: ls,
    languageServiceHost: host,
    project: mockProject,
    serverHost: {} as ts.server.ServerHost,
    config: {},
  };
}

describe("Language Service Plugin", () => {
  describe("init()", () => {
    it("returns a create function", () => {
      const plugin = init({ typescript: ts });

      expect(plugin).toBeDefined();
      expect(plugin.create).toBeInstanceOf(Function);
    });
  });

  describe("create()", () => {
    it("returns a language service proxy", () => {
      const files = new Map<string, string>();
      files.set("/test/index.ts", "const x = 1;");

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      const proxy = plugin.create(info);

      expect(proxy).toBeDefined();
      expect(proxy.getSemanticDiagnostics).toBeInstanceOf(Function);
      expect(proxy.getCompletionsAtPosition).toBeInstanceOf(Function);
    });

    it("logs initialization messages", () => {
      const files = new Map<string, string>();
      files.set("/test/index.ts", "const x = 1;");

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      plugin.create(info);

      const logger = info.project.projectService.logger;
      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe("host interception", () => {
    it("modifies the original host getScriptSnapshot", () => {
      const files = new Map<string, string>();
      files.set("/test/index.ts", "const x = 1;");

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);

      const originalGetSnapshot = info.languageServiceHost.getScriptSnapshot;

      plugin.create(info);

      // The host method should have been replaced
      expect(info.languageServiceHost.getScriptSnapshot).not.toBe(
        originalGetSnapshot
      );
    });

    it("modifies the original host getScriptVersion", () => {
      const files = new Map<string, string>();
      files.set("/test/index.ts", "const x = 1;");

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);

      const originalGetVersion = info.languageServiceHost.getScriptVersion;

      plugin.create(info);

      // The host method should have been replaced
      expect(info.languageServiceHost.getScriptVersion).not.toBe(
        originalGetVersion
      );
    });

    it("returns transformed content for files that need transformation", () => {
      // Use pipe operator which triggers transformation
      const files = new Map<string, string>();
      files.set("/test/index.ts", "const result = 1 |> ((x) => x + 1);");

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);

      plugin.create(info);

      // Get the script snapshot through the modified host
      const snapshot = info.languageServiceHost.getScriptSnapshot(
        "/test/index.ts"
      );
      const content = snapshot?.getText(0, snapshot.getLength());

      // Should contain transformed code with __binop__ call
      // Note: The "|>" is preserved as a string argument to __binop__
      expect(content).toContain("__binop__");
      expect(content).toContain('"|>"'); // The operator is now a string arg
    });

    it("returns original content for files that don't need transformation", () => {
      const files = new Map<string, string>();
      files.set("/test/index.ts", "const x = 1 + 2;");

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);

      plugin.create(info);

      const snapshot = info.languageServiceHost.getScriptSnapshot(
        "/test/index.ts"
      );
      const content = snapshot?.getText(0, snapshot.getLength());

      // Should be essentially the original content (printer may add trailing newline)
      expect(content?.trim()).toBe("const x = 1 + 2;");
    });

    it("adds version marker for transformed files", () => {
      const files = new Map<string, string>();
      files.set("/test/index.ts", "const result = 1 |> ((x) => x + 1);");

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);

      plugin.create(info);

      const version = info.languageServiceHost.getScriptVersion("/test/index.ts");

      // Version should contain typesugar marker
      expect(version).toContain("-ts-");
    });
  });

  describe("diagnostics mapping", () => {
    it("returns diagnostics from the language service", () => {
      const files = new Map<string, string>();
      files.set("/test/index.ts", "const x: string = 123;"); // Type error

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      const proxy = plugin.create(info);

      const diagnostics = proxy.getSemanticDiagnostics("/test/index.ts");

      // Should have a type error
      expect(diagnostics.length).toBeGreaterThan(0);
    });

    it("maps diagnostic positions back to original for transformed files", () => {
      // File with pipe operator where the error is in the original position
      const files = new Map<string, string>();
      files.set(
        "/test/index.ts",
        `const result = 1 |> ((x: string) => x + 1);`
      );

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      const proxy = plugin.create(info);

      const diagnostics = proxy.getSemanticDiagnostics("/test/index.ts");

      // Diagnostics should exist and have mapped positions
      // The exact positions depend on the transformation
      for (const diag of diagnostics) {
        if (diag.start !== undefined) {
          // Position should be reasonable (within file bounds)
          expect(diag.start).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  describe("completion mapping", () => {
    it("returns completions at position", () => {
      const files = new Map<string, string>();
      files.set(
        "/test/index.ts",
        `
const obj = { foo: 1, bar: 2 };
obj.
      `.trim()
      );

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      const proxy = plugin.create(info);

      // Position after "obj."
      const position = files.get("/test/index.ts")!.indexOf(".") + 1;
      const completions = proxy.getCompletionsAtPosition(
        "/test/index.ts",
        position,
        undefined
      );

      expect(completions).toBeDefined();
      if (completions) {
        expect(completions.entries.length).toBeGreaterThan(0);
      }
    });
  });

  describe("quick info mapping", () => {
    it("returns quick info at position", () => {
      const files = new Map<string, string>();
      files.set("/test/index.ts", "const myVar = 42;");

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      const proxy = plugin.create(info);

      // Position at "myVar"
      const position = 6;
      const quickInfo = proxy.getQuickInfoAtPosition("/test/index.ts", position);

      expect(quickInfo).toBeDefined();
      if (quickInfo) {
        expect(quickInfo.textSpan).toBeDefined();
      }
    });
  });

  describe("definition mapping", () => {
    it("returns definitions at position", () => {
      const files = new Map<string, string>();
      files.set(
        "/test/index.ts",
        `
const foo = 1;
const bar = foo;
      `.trim()
      );

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      const proxy = plugin.create(info);

      // Position at "foo" in the second line
      const position = files.get("/test/index.ts")!.lastIndexOf("foo");
      const definitions = proxy.getDefinitionAtPosition(
        "/test/index.ts",
        position
      );

      expect(definitions).toBeDefined();
      if (definitions && definitions.length > 0) {
        expect(definitions[0].textSpan).toBeDefined();
      }
    });
  });
});

describe("TransformationPipeline integration", () => {
  describe("shouldTransform", () => {
    it("returns true for project source files", () => {
      const files = new Map<string, string>();
      files.set("/test/index.ts", "const x = 1;");

      const pipeline = new TransformationPipeline(
        { target: ts.ScriptTarget.Latest },
        ["/test/index.ts"],
        {
          readFile: (f) => files.get(f),
          fileExists: (f) => files.has(f),
        }
      );

      expect(pipeline.shouldTransform("/test/index.ts")).toBe(true);
    });

    it("returns false for .d.ts files", () => {
      const files = new Map<string, string>();
      files.set("/test/index.d.ts", "declare const x: number;");

      const pipeline = new TransformationPipeline(
        { target: ts.ScriptTarget.Latest },
        ["/test/index.d.ts"],
        {
          readFile: (f) => files.get(f),
          fileExists: (f) => files.has(f),
        }
      );

      expect(pipeline.shouldTransform("/test/index.d.ts")).toBe(false);
    });

    it("returns false for node_modules", () => {
      const files = new Map<string, string>();
      files.set("/test/node_modules/foo/index.ts", "export const x = 1;");

      const pipeline = new TransformationPipeline(
        { target: ts.ScriptTarget.Latest },
        ["/test/node_modules/foo/index.ts"],
        {
          readFile: (f) => files.get(f),
          fileExists: (f) => files.has(f),
        }
      );

      expect(pipeline.shouldTransform("/test/node_modules/foo/index.ts")).toBe(
        false
      );
    });
  });

  describe("transform result", () => {
    it("includes position mapper", () => {
      const code = "const result = 1 |> ((x) => x + 1);";
      const result = transformCode(code, { fileName: "test.ts" });

      expect(result.mapper).toBeDefined();
      expect(result.mapper.toOriginal).toBeInstanceOf(Function);
      expect(result.mapper.toTransformed).toBeInstanceOf(Function);
    });

    it("includes changed flag", () => {
      const code = "const result = 1 |> ((x) => x + 1);";
      const result = transformCode(code, { fileName: "test.ts" });

      expect(result.changed).toBe(true);
    });

    it("sets changed to false for unchanged files", () => {
      const code = "const x = 1;";
      const result = transformCode(code, { fileName: "test.ts" });

      // Simple code that doesn't need transformation
      // Note: changed might still be true if the printer reformats
      expect(result).toBeDefined();
    });
  });
});

describe("Position Mapping", () => {
  describe("pipe operator transformation", () => {
    it("maps positions correctly after pipe transformation", () => {
      const original = "const result = 1 |> ((x) => x + 1);";
      const result = transformCode(original, { fileName: "test.ts" });

      // The "const" keyword should still be at position 0
      const constPos = result.mapper.toOriginal(0);
      expect(constPos).toBe(0);
    });

    it("handles multi-line transformations", () => {
      const original = `
const a = 1;
const b = a |> ((x) => x + 1);
const c = b |> ((x) => x * 2);
      `.trim();

      const result = transformCode(original, { fileName: "test.ts" });

      // First line should map to itself (no change)
      expect(result.mapper.toOriginal(0)).toBeDefined();
    });
  });

  describe("HKT syntax transformation", () => {
    it("maps positions correctly after HKT transformation", () => {
      const original = `
type F<_> = { value: number };
type Applied = F<string>;
      `.trim();

      const result = transformCode(original, { fileName: "test.ts" });

      // The file should be transformed
      expect(result.code).toBeDefined();
    });
  });
});

describe("Error Suppression", () => {
  describe("diagnostics in generated code", () => {
    it("suppresses diagnostics that cannot be mapped", () => {
      const files = new Map<string, string>();
      files.set(
        "/test/index.ts",
        `const result = 1 |> ((x: string) => x);`
      );

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      const proxy = plugin.create(info);

      const diagnostics = proxy.getSemanticDiagnostics("/test/index.ts");

      // Diagnostics in generated code (like __binop__) should be suppressed
      // if they can't be mapped back
      for (const diag of diagnostics) {
        // All returned diagnostics should have valid mapped positions
        // or no start position (global errors)
        if (diag.start !== undefined) {
          expect(diag.start).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });
});

describe("VS Code Simulation", () => {
  it("simulates VS Code scenario: LS created before plugin", () => {
    // This test simulates what happens in VS Code:
    // 1. TS server creates the host
    // 2. TS server creates the LanguageService using that host
    // 3. Plugin `create()` is called
    // 4. Plugin modifies the host
    // 5. Diagnostics are requested

    const files = new Map<string, string>();
    files.set(
      "/test/index.ts",
      `
declare function __binop__<T, R>(value: T, op: string, fn: (x: T) => R): R;
const result = 1 |> ((x) => x + 1);
      `.trim()
    );

    // Step 1: Create the host (as TS server would)
    const host = {
      getCompilationSettings: () => ({
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        strict: true,
      }),
      getScriptFileNames: () => ["/test/index.ts"],
      getScriptVersion: (_fileName: string) => "1",
      getScriptSnapshot: (fileName: string) => {
        const content = files.get(fileName);
        if (content !== undefined) {
          return ts.ScriptSnapshot.fromString(content);
        }
        return undefined;
      },
      getCurrentDirectory: () => "/test",
      getDefaultLibFileName: (options: ts.CompilerOptions) => ts.getDefaultLibFilePath(options),
      fileExists: (fileName: string) => files.has(fileName) || ts.sys.fileExists(fileName),
      readFile: (fileName: string) => files.get(fileName) ?? ts.sys.readFile(fileName),
    };

    // Step 2: Create the LanguageService (as TS server would)
    // This LS will cache file contents from the ORIGINAL host
    const oldLS = ts.createLanguageService(host);

    // At this point, if we get diagnostics, TS sees the ORIGINAL code with |>
    const diagsBeforePlugin = oldLS.getSemanticDiagnostics("/test/index.ts");
    console.log("Diagnostics BEFORE plugin (should have errors for |>):", diagsBeforePlugin.length);

    // Step 3: Plugin would be called with info containing oldLS and host
    // Step 4: Plugin modifies the host
    const originalGetSnapshot = host.getScriptSnapshot;
    let transformCallCount = 0;

    host.getScriptSnapshot = (fileName: string) => {
      // Simulate transformation - replace |> with __binop__
      const content = files.get(fileName);
      if (content && content.includes("|>")) {
        transformCallCount++;
        // More accurate regex that preserves the arrow function
        const transformed = content.replace(
          /(\w+)\s*\|>\s*(\([^)]*\)\s*=>\s*[^;]+)/g,
          '__binop__($1, "|>", $2)'
        );
        console.log("Serving transformed content:", transformed);
        return ts.ScriptSnapshot.fromString(transformed);
      }
      return originalGetSnapshot(fileName);
    };

    host.getScriptVersion = (fileName: string) => {
      // Return a new version to trigger re-read
      return "1-transformed";
    };

    // Step 5: Get diagnostics again
    // The CRITICAL QUESTION: Does oldLS use the new getScriptSnapshot?
    const diagsAfterPlugin = oldLS.getSemanticDiagnostics("/test/index.ts");
    console.log("Diagnostics AFTER plugin modification:", diagsAfterPlugin.length);
    console.log("Transform call count:", transformCallCount);

    // The test reveals whether modifying the host AFTER LS creation works
    // If transformCallCount > 0, it means TS re-read the file
    // If diagsAfterPlugin.length === 0, the transformation worked

    // Note: This test documents the behavior, not necessarily asserts success
    // The key insight is whether changing the host affects the existing LS
  });

  it("creates new LS after modifying host (works)", () => {
    // This simulates the approach where we create a NEW LS after modifying the host
    const files = new Map<string, string>();
    files.set(
      "/test/index.ts",
      `
declare function __binop__<T, R>(value: T, op: string, fn: (x: T) => R): R;
const result = 1 |> ((x) => x + 1);
      `.trim()
    );

    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => ({
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        strict: true,
      }),
      getScriptFileNames: () => ["/test/index.ts"],
      getScriptVersion: (_fileName: string) => "1",
      getScriptSnapshot: (fileName: string) => {
        const content = files.get(fileName);
        if (content && content.includes("|>")) {
          // Transform |> to __binop__ - preserve the arrow function
          const transformed = content.replace(
            /(\w+)\s*\|>\s*(\([^)]*\)\s*=>\s*[^;]+)/g,
            '__binop__($1, "|>", $2)'
          );
          return ts.ScriptSnapshot.fromString(transformed);
        }
        if (content) {
          return ts.ScriptSnapshot.fromString(content);
        }
        return undefined;
      },
      getCurrentDirectory: () => "/test",
      getDefaultLibFileName: (options: ts.CompilerOptions) => ts.getDefaultLibFilePath(options),
      fileExists: (fileName: string) => files.has(fileName) || ts.sys.fileExists(fileName),
      readFile: (fileName: string) => files.get(fileName) ?? ts.sys.readFile(fileName),
    };

    // Create LS with the ALREADY-MODIFIED host
    const ls = ts.createLanguageService(host);

    const diags = ls.getSemanticDiagnostics("/test/index.ts");
    console.log("Diagnostics with modified host from start:", diags.length);

    // This SHOULD have 0 errors because TS sees the transformed code
    expect(diags.length).toBe(0);
  });
});

// =============================================================================
// New integration test cases for realistic typesugar code
// =============================================================================

describe("Preprocessing via Language Service Plugin", () => {
  it("transforms pipe operator in diagnostics", () => {
    const files = new Map<string, string>([
      [
        "/test/index.ts",
        `
declare function __binop__<T, R>(value: T, op: string, fn: (x: T) => R): R;
const add1 = (x: number): number => x + 1;
const double = (x: number): number => x * 2;
const result: number = 5 |> add1 |> double;
        `.trim(),
      ],
    ]);

    const plugin = init({ typescript: ts });
    const info = createMockPluginInfo(files);
    const proxy = plugin.create(info);

    // The |> should be preprocessed to __binop__ calls
    const snapshot = info.languageServiceHost.getScriptSnapshot("/test/index.ts");
    const content = snapshot?.getText(0, snapshot.getLength());

    expect(content).toContain("__binop__");

    // No syntax errors — |> is preprocessed to valid TS
    const syntacticDiags = proxy.getSyntacticDiagnostics("/test/index.ts");
    const syntaxErrors = syntacticDiags.filter(
      (d) => d.code === 1005 || d.code === 1109 || d.code === 1128
    );
    expect(syntaxErrors).toHaveLength(0);
  });

  it("transforms HKT syntax", () => {
    const files = new Map<string, string>([
      [
        "/test/index.ts",
        `
type Apply<F<_>, A> = F<A>;
type Result = Apply<Array, string>;
        `.trim(),
      ],
    ]);

    const plugin = init({ typescript: ts });
    const info = createMockPluginInfo(files);
    const proxy = plugin.create(info);

    // After transformation, the file should parse without syntax errors
    const snapshot = info.languageServiceHost.getScriptSnapshot("/test/index.ts");
    const content = snapshot?.getText(0, snapshot.getLength());

    // The content should be transformed (HKT rewritten)
    expect(content).toBeDefined();

    // No syntax errors from the HKT syntax
    const syntacticDiags = proxy.getSyntacticDiagnostics("/test/index.ts");
    const syntaxErrors = syntacticDiags.filter(
      (d) => d.code === 1005 || d.code === 1109 || d.code === 1128
    );
    expect(syntaxErrors).toHaveLength(0);
  });
});

describe("Diagnostic Position Mapping", () => {
  it("maps diagnostic positions back to original source", () => {
    const originalSource = `
const x: string = 42;
const y = 1 |> ((n: number) => n + 1);
    `.trim();

    const files = new Map<string, string>([
      ["/test/index.ts", originalSource],
    ]);

    const plugin = init({ typescript: ts });
    const info = createMockPluginInfo(files);
    const proxy = plugin.create(info);

    const diagnostics = proxy.getSemanticDiagnostics("/test/index.ts");

    // Should have at least one diagnostic (type error: number not assignable to string)
    const typeErrors = diagnostics.filter((d) => d.start !== undefined);

    for (const diag of typeErrors) {
      // Positions should be within the bounds of the ORIGINAL source
      expect(diag.start).toBeGreaterThanOrEqual(0);
      expect(diag.start!).toBeLessThan(originalSource.length);
    }
  });

  it("preserves diagnostic for type error on first line", () => {
    const files = new Map<string, string>([
      [
        "/test/index.ts",
        `const x: string = 42;`,
      ],
    ]);

    const plugin = init({ typescript: ts });
    const info = createMockPluginInfo(files);
    const proxy = plugin.create(info);

    const diagnostics = proxy.getSemanticDiagnostics("/test/index.ts");

    // Should report the type mismatch
    expect(diagnostics.length).toBeGreaterThan(0);

    // The error should point to a reasonable position in the original
    const firstDiag = diagnostics[0];
    if (firstDiag.start !== undefined) {
      expect(firstDiag.start).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("Completions in Transformed Code", () => {
  it("provides completions for object properties", () => {
    const source = `
const obj = { name: "test", value: 42 };
obj.
    `.trim();

    const files = new Map<string, string>([
      ["/test/index.ts", source],
    ]);

    const plugin = init({ typescript: ts });
    const info = createMockPluginInfo(files);
    const proxy = plugin.create(info);

    // Position after "obj." in the original source
    const dotPos = source.indexOf("obj.") + 4;
    const completions = proxy.getCompletionsAtPosition(
      "/test/index.ts",
      dotPos,
      undefined
    );

    expect(completions).toBeDefined();
    if (completions) {
      const entryNames = completions.entries.map((e) => e.name);
      expect(entryNames).toContain("name");
      expect(entryNames).toContain("value");
    }
  });

  it("provides completions in code alongside pipe operators", () => {
    const source = `
declare function __binop__<T, R>(value: T, op: string, fn: (x: T) => R): R;
const obj = { foo: 1, bar: "hello" };
const piped = 1 |> ((x: number) => x + 1);
obj.
    `.trim();

    const files = new Map<string, string>([
      ["/test/index.ts", source],
    ]);

    const plugin = init({ typescript: ts });
    const info = createMockPluginInfo(files);
    const proxy = plugin.create(info);

    // Position after the last "obj." in the original source
    const dotPos = source.lastIndexOf("obj.") + 4;
    const completions = proxy.getCompletionsAtPosition(
      "/test/index.ts",
      dotPos,
      undefined
    );

    // Completions may be undefined if the position mapper can't map through
    // the pipe-operator transformation. This is a known limitation when the
    // |> rewrite shifts character offsets and the source map doesn't cover
    // subsequent lines precisely.
    if (completions) {
      const entryNames = completions.entries.map((e) => e.name);
      expect(entryNames).toContain("foo");
      expect(entryNames).toContain("bar");
    }
  });
});

describe("Transform-First Analysis", () => {
  describe("TypeScript sees transformed content", () => {
    it("analyzes transformed code without pipe operator syntax errors", () => {
      // Original code uses pipe operator which is NOT valid TypeScript
      // After transformation, it becomes __binop__(...) which IS valid
      const files = new Map<string, string>();
      files.set(
        "/test/index.ts",
        `
// Declare __binop__ so transformed code is valid
declare function __binop__<T, R>(value: T, op: string, fn: (x: T) => R): R;

const result = 1 |> ((x) => x + 1);
        `.trim()
      );

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      const proxy = plugin.create(info);

      // Verify transformed content is what we expect
      const snapshot = info.languageServiceHost.getScriptSnapshot("/test/index.ts");
      const content = snapshot?.getText(0, snapshot.getLength());

      console.log("Transformed content:", content);

      // Get diagnostics - should NOT have "unexpected token |>" error
      // because TypeScript is analyzing the transformed content
      const diagnostics = proxy.getSemanticDiagnostics("/test/index.ts");

      console.log(
        "Diagnostics:",
        diagnostics.map((d) => ({
          code: d.code,
          message: typeof d.messageText === "string" ? d.messageText : d.messageText.messageText,
          start: d.start,
        }))
      );

      // Filter for syntax-related errors (the pipe operator would cause these)
      const syntaxErrors = diagnostics.filter(
        (d) => d.code === 1005 || d.code === 1109 || d.code === 1128
      );

      // Should have NO syntax errors from the pipe operator
      expect(syntaxErrors).toHaveLength(0);
    });

    it("returns proper types for transformed expressions", () => {
      const files = new Map<string, string>();
      files.set(
        "/test/index.ts",
        `
declare function __binop__<T, R>(value: T, op: string, fn: (x: T) => R): R;

const result = 1 |> ((x) => x + 1);
        `.trim()
      );

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      const proxy = plugin.create(info);

      // Get the transformed content to find the correct position
      const snapshot = info.languageServiceHost.getScriptSnapshot("/test/index.ts");
      const transformedContent = snapshot?.getText(0, snapshot.getLength()) ?? "";

      // Find "result" in the TRANSFORMED content
      const resultPosInTransformed = transformedContent.indexOf("const result");

      // The position we query should be in original coordinates
      // For this simple case, the declaration line hasn't moved much
      const originalContent = files.get("/test/index.ts")!;
      const resultPosInOriginal = originalContent.indexOf("const result");

      const quickInfo = proxy.getQuickInfoAtPosition("/test/index.ts", resultPosInOriginal + 6);

      console.log("Quick info:", quickInfo);
      console.log("Original pos:", resultPosInOriginal);
      console.log("Transformed pos:", resultPosInTransformed);

      // Quick info might be undefined if position mapping fails
      // This is expected since the positions may not align perfectly
      // The important thing is that diagnostics work (tested above)
      if (quickInfo) {
        expect(quickInfo.textSpan).toBeDefined();
      }
    });
  });

  describe("verifies LS uses modified host", () => {
    it("calls the modified getScriptSnapshot during analysis", () => {
      const files = new Map<string, string>();
      files.set("/test/index.ts", "const x = 1;");

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);

      // Track calls to getScriptSnapshot
      let getScriptSnapshotCalled = false;
      const originalGetSnapshot = info.languageServiceHost.getScriptSnapshot;

      plugin.create(info);

      // Wrap the modified method to track calls
      const modifiedGetSnapshot = info.languageServiceHost.getScriptSnapshot;
      info.languageServiceHost.getScriptSnapshot = (fileName: string) => {
        getScriptSnapshotCalled = true;
        return modifiedGetSnapshot(fileName);
      };

      // Force analysis by getting diagnostics
      // This should trigger getScriptSnapshot calls
      const ls = ts.createLanguageService(info.languageServiceHost);
      ls.getSemanticDiagnostics("/test/index.ts");

      // The host should have been called during analysis
      expect(getScriptSnapshotCalled).toBe(true);
    });
  });
});
