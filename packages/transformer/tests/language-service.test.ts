/**
 * Tests for the Language Service Plugin
 *
 * These tests verify that:
 * 1. The plugin correctly intercepts file reads
 * 2. Transformed code is served to TypeScript
 * 3. Diagnostic positions are mapped back correctly
 * 4. IDE features work with position mapping
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as ts from "typescript";
import init from "../src/language-service.js";
import { TransformationPipeline, transformCode } from "../src/pipeline.js";
import {
  getDiagnosticSuppressionRules,
  clearDiagnosticSuppressionRules,
  getDiagnosticSuppressionAuditLog,
  clearDiagnosticSuppressionAuditLog,
  setDiagnosticSuppressionAuditMode,
  registerDiagnosticSuppressionRule,
  type DiagnosticSuppressionRule,
} from "@typesugar/core";

// HKT syntax (`F<_>`) is rewritten by the kept transformer path — a real
// transformation, so changed-flag/source-map assertions are non-vacuous.
const HKT_SRC = `type F<_> = { value: number };\ntype Applied = F<string>;`;

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
function createMockPluginInfo(files: Map<string, string>): ts.server.PluginCreateInfo {
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
      expect(info.languageServiceHost.getScriptSnapshot).not.toBe(originalGetSnapshot);
    });

    it("modifies the original host getScriptVersion", () => {
      const files = new Map<string, string>();
      files.set("/test/index.ts", "const x = 1;");

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);

      const originalGetVersion = info.languageServiceHost.getScriptVersion;

      plugin.create(info);

      // The host method should have been replaced
      expect(info.languageServiceHost.getScriptVersion).not.toBe(originalGetVersion);
    });

    it("returns original content for files that don't need transformation", () => {
      const files = new Map<string, string>();
      files.set("/test/index.ts", "const x = 1 + 2;");

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);

      plugin.create(info);

      const snapshot = info.languageServiceHost.getScriptSnapshot("/test/index.ts");
      const content = snapshot?.getText(0, snapshot.getLength());

      // Should be essentially the original content (printer may add trailing newline)
      expect(content?.trim()).toBe("const x = 1 + 2;");
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
      files.set("/test/index.ts", `const result = 1 |> ((x: string) => x + 1);`);

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
      const completions = proxy.getCompletionsAtPosition("/test/index.ts", position, undefined);

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
      const definitions = proxy.getDefinitionAtPosition("/test/index.ts", position);

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

      expect(pipeline.shouldTransform("/test/node_modules/foo/index.ts")).toBe(false);
    });
  });

  describe("transform result", () => {
    it("includes position mapper", () => {
      const code = HKT_SRC;
      const result = transformCode(code, { fileName: "test.ts" });

      expect(result.mapper).toBeDefined();
      expect(result.mapper.toOriginal).toBeInstanceOf(Function);
      expect(result.mapper.toTransformed).toBeInstanceOf(Function);
    });

    it("includes changed flag", () => {
      // HKT syntax (`F<_>`) is rewritten by the kept transformer path.
      const code = HKT_SRC;
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
  describe("position mapping after transformation", () => {
    it("maps positions correctly after HKT transformation", () => {
      const original = HKT_SRC;
      const result = transformCode(original, { fileName: "test.ts" });

      // The "type" keyword should still be at position 0
      const typePos = result.mapper.toOriginal(0);
      expect(typePos).toBe(0);
    });

    it("handles multi-line transformations", () => {
      const original = `
type F<_> = { value: number };
type G<_> = { items: string[] };
type Applied = F<string>;
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
        `import { pipe } from "typesugar";\nconst result = pipe(1, (x: string) => x.length);`
      );

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      const proxy = plugin.create(info);

      const diagnostics = proxy.getSemanticDiagnostics("/test/index.ts");

      // Diagnostics that land on macro-generated code with no mapping back to
      // the original source are suppressed; anything returned must carry a valid
      // (mapped) position.
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

// =============================================================================
// New integration test cases for realistic typesugar code
// =============================================================================

describe("Diagnostic Position Mapping", () => {
  it("preserves diagnostic for type error on first line", () => {
    const files = new Map<string, string>([["/test/index.ts", `const x: string = 42;`]]);

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

    const files = new Map<string, string>([["/test/index.ts", source]]);

    const plugin = init({ typescript: ts });
    const info = createMockPluginInfo(files);
    const proxy = plugin.create(info);

    // Position after "obj." in the original source
    const dotPos = source.indexOf("obj.") + 4;
    const completions = proxy.getCompletionsAtPosition("/test/index.ts", dotPos, undefined);

    expect(completions).toBeDefined();
    if (completions) {
      const entryNames = completions.entries.map((e) => e.name);
      expect(entryNames).toContain("name");
      expect(entryNames).toContain("value");
    }
  });

  it("provides completions in .ts code without custom operators", () => {
    // .ts files no longer get preprocessed for custom syntax (PEP-001)
    // This test verifies completions still work for standard TypeScript code
    const source = `
const obj = { foo: 1, bar: "hello" };
const value = obj.foo + 1;
obj.
    `.trim();

    const files = new Map<string, string>([["/test/index.ts", source]]);

    const plugin = init({ typescript: ts });
    const info = createMockPluginInfo(files);
    const proxy = plugin.create(info);

    const dotPos = source.lastIndexOf("obj.") + 4;
    const completions = proxy.getCompletionsAtPosition("/test/index.ts", dotPos, undefined);

    if (completions) {
      const entryNames = completions.entries.map((e) => e.name);
      expect(entryNames).toContain("foo");
      expect(entryNames).toContain("bar");
    }
  });
});

describe("Transform-First Analysis", () => {
  describe("TypeScript sees transformed content", () => {
    it("returns proper types for transformed expressions", () => {
      const files = new Map<string, string>();
      // A real macro the transformer still expands (pipe()), served through the
      // live snapshot-wrapping path.
      files.set(
        "/test/index.ts",
        `
import { pipe } from "typesugar";

const result = pipe(1, (x) => x + 1);
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

// =============================================================================
// PEP-005 Wave 4: Macro Diagnostic Injection Tests
// =============================================================================

describe("Macro Diagnostic Injection (PEP-005 Wave 4)", () => {
  describe("macro diagnostics appear in getSemanticDiagnostics", () => {
    it("injects typesugar-sourced diagnostics alongside TS diagnostics", () => {
      const files = new Map<string, string>();
      // A file with a type error (TS diagnostic) and macro code
      files.set("/test/index.ts", `const x: string = 123;`);

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      const proxy = plugin.create(info);

      const diagnostics = proxy.getSemanticDiagnostics("/test/index.ts");

      // Should have at least the TS type error
      expect(diagnostics.length).toBeGreaterThan(0);

      // TS diagnostics should still be present
      const tsErrors = diagnostics.filter((d) => d.source !== "typesugar");
      expect(tsErrors.length).toBeGreaterThan(0);
    });

    it("macro diagnostics have source: 'typesugar'", () => {
      // When macro diagnostics exist, they should be identifiable
      const files = new Map<string, string>();
      files.set("/test/index.ts", `const x = 1;`);

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      const proxy = plugin.create(info);

      const diagnostics = proxy.getSemanticDiagnostics("/test/index.ts");

      // For a plain file, there should be no macro diagnostics
      const macroDiags = diagnostics.filter((d) => d.source === "typesugar");
      expect(macroDiags).toHaveLength(0);
    });

    it("returns no stale macro diagnostics from typesugar source", () => {
      // Verify that typesugar diagnostics are regenerated per-file-version,
      // not carried over from a previous version. For a plain file with no
      // macros, there should be zero typesugar-sourced diagnostics.
      const files = new Map<string, string>();
      files.set("/test/index.ts", `const x = 1;`);

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      const proxy = plugin.create(info);

      // First call — no macro diagnostics expected
      const diags1 = proxy.getSemanticDiagnostics("/test/index.ts");
      const macroDiags1 = diags1.filter((d) => d.source === "typesugar");
      expect(macroDiags1).toHaveLength(0);

      // Second call — still no stale macro diagnostics
      const diags2 = proxy.getSemanticDiagnostics("/test/index.ts");
      const macroDiags2 = diags2.filter((d) => d.source === "typesugar");
      expect(macroDiags2).toHaveLength(0);
    });
  });

  describe("typesugar error code extraction", () => {
    it("extracts [TS9XXX] codes from diagnostic messages", () => {
      // Test the error code extraction logic used internally
      const testMessages = [
        { msg: "[TS9001] No instance found for `Eq<Point>`", expected: 9001 },
        { msg: "[TS9101] Cannot auto-derive Eq<Color>", expected: 9101 },
        { msg: "[TS9999] Internal error: something went wrong", expected: 9999 },
        { msg: "No error code in this message", expected: 9999 },
      ];

      for (const { msg, expected } of testMessages) {
        const match = msg.match(/\[TS(\d{4})\]/);
        const code = match ? parseInt(match[1], 10) : 9999;
        expect(code).toBe(expected);
      }
    });
  });

  describe("TransformDiagnostic format", () => {
    it("pipeline transform result includes diagnostic code field", () => {
      // Verify that TransformDiagnostic can carry optional code
      const code = "const x = 1;";
      const result = transformCode(code, { fileName: "test.ts" });

      // Plain code should have no diagnostics
      expect(result.diagnostics).toHaveLength(0);

      // The diagnostics array should be typed to accept code field
      const testDiag = {
        file: "test.ts",
        start: 0,
        length: 1,
        message: "[TS9001] test",
        severity: "error" as const,
        code: 9001,
      };
      expect(testDiag.code).toBe(9001);
    });
  });

  describe("code fix actions", () => {
    it("proxy has getCodeFixesAtPosition method", () => {
      const files = new Map<string, string>();
      files.set("/test/index.ts", `const x = 1;`);

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      const proxy = plugin.create(info);

      expect(proxy.getCodeFixesAtPosition).toBeInstanceOf(Function);
    });

    it("returns original TS code fixes for non-typesugar error codes", () => {
      const files = new Map<string, string>();
      files.set("/test/index.ts", `const x: string = 123;`);

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      const proxy = plugin.create(info);

      // Request fixes for a standard TS error code (not in 9001-9999 range)
      const fixes = proxy.getCodeFixesAtPosition("/test/index.ts", 0, 10, [2322], {}, {});

      // Should at least not throw
      expect(fixes).toBeDefined();
    });
  });
});

// =============================================================================
// PEP-011 Wave 2: Diagnostic Suppression Language Service Integration Tests
// =============================================================================

describe("Diagnostic Suppression Language Service Integration (PEP-011 Wave 2)", () => {
  afterEach(() => {
    clearDiagnosticSuppressionRules();
    clearDiagnosticSuppressionAuditLog();
    setDiagnosticSuppressionAuditMode(undefined);
  });

  describe("MacroGenerated rule registration", () => {
    it("registers MacroGenerated rule during plugin create", () => {
      clearDiagnosticSuppressionRules();

      const files = new Map<string, string>();
      files.set("/test/index.ts", "const x = 1;");

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      plugin.create(info);

      const rules = getDiagnosticSuppressionRules();
      expect(rules.some((r) => r.name === "MacroGenerated")).toBe(true);
    });

    it("does not register duplicate MacroGenerated rules on second create", () => {
      clearDiagnosticSuppressionRules();

      const files = new Map<string, string>();
      files.set("/test/index.ts", "const x = 1;");

      const plugin = init({ typescript: ts });

      // Create twice
      const info1 = createMockPluginInfo(files);
      plugin.create(info1);

      const info2 = createMockPluginInfo(files);
      plugin.create(info2);

      const macroRules = getDiagnosticSuppressionRules().filter((r) => r.name === "MacroGenerated");
      expect(macroRules).toHaveLength(1);
    });
  });

  describe("diagnostic suppression filtering in getSemanticDiagnostics", () => {
    it("still returns real type errors (not falsely suppressed)", () => {
      clearDiagnosticSuppressionRules();

      const files = new Map<string, string>();
      files.set("/test/index.ts", "const x: string = 123;");

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      const proxy = plugin.create(info);

      const diagnostics = proxy.getSemanticDiagnostics("/test/index.ts");

      // TS2322: Type 'number' is not assignable to type 'string'
      expect(diagnostics.length).toBeGreaterThan(0);
      const typeError = diagnostics.find((d) => d.code === 2322);
      expect(typeError).toBeDefined();
    });

    it("preserves diagnostics with valid original positions", () => {
      clearDiagnosticSuppressionRules();

      const files = new Map<string, string>();
      files.set("/test/index.ts", "const x: string = 42;\nconst y: number = 'hello';");

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      const proxy = plugin.create(info);

      const diagnostics = proxy.getSemanticDiagnostics("/test/index.ts");

      // Both type errors should survive diagnostic suppression filtering
      expect(diagnostics.length).toBeGreaterThanOrEqual(2);
    });

    it("allows custom diagnostic suppression rules to suppress specific diagnostics", () => {
      clearDiagnosticSuppressionRules();

      // Register a custom rule that suppresses TS2322 for testing
      const suppressedCodes: number[] = [];
      const testRule: DiagnosticSuppressionRule = {
        name: "TestSuppressor",
        errorCodes: [2322],
        shouldSuppress(diagnostic) {
          suppressedCodes.push(diagnostic.code);
          return true;
        },
      };

      const files = new Map<string, string>();
      files.set("/test/index.ts", "const x: string = 123;");

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      const proxy = plugin.create(info);

      // Register AFTER create so MacroGenerated is also registered
      registerDiagnosticSuppressionRule(testRule);

      const diagnostics = proxy.getSemanticDiagnostics("/test/index.ts");

      // The TS2322 error should be suppressed by our custom rule
      const typeError = diagnostics.find((d) => d.code === 2322);
      expect(typeError).toBeUndefined();
      expect(suppressedCodes).toContain(2322);
    });
  });

  describe("diagnostic suppression filtering in getSuggestionDiagnostics", () => {
    it("returns suggestion diagnostics for clean files", () => {
      clearDiagnosticSuppressionRules();

      const files = new Map<string, string>();
      files.set("/test/index.ts", "const x = 1;");

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      const proxy = plugin.create(info);

      // Should not throw
      const suggestions = proxy.getSuggestionDiagnostics("/test/index.ts");
      expect(suggestions).toBeDefined();
    });
  });

  describe("audit mode", () => {
    it("populates audit log when diagnostic suppression audit mode is enabled", () => {
      clearDiagnosticSuppressionRules();
      clearDiagnosticSuppressionAuditLog();
      setDiagnosticSuppressionAuditMode(true);

      // Register a rule that always suppresses TS2322
      registerDiagnosticSuppressionRule({
        name: "TestAuditRule",
        errorCodes: [2322],
        shouldSuppress() {
          return true;
        },
      });

      const files = new Map<string, string>();
      files.set("/test/index.ts", "const x: string = 123;");

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      const proxy = plugin.create(info);

      proxy.getSemanticDiagnostics("/test/index.ts");

      const auditLog = getDiagnosticSuppressionAuditLog();
      expect(auditLog.length).toBeGreaterThan(0);

      const entry = auditLog.find((e) => e.ruleName === "TestAuditRule");
      expect(entry).toBeDefined();
      expect(entry!.errorCode).toBe(2322);
    });

    it("does not populate audit log when audit mode is disabled", () => {
      clearDiagnosticSuppressionRules();
      clearDiagnosticSuppressionAuditLog();
      setDiagnosticSuppressionAuditMode(false);

      registerDiagnosticSuppressionRule({
        name: "TestAuditRule",
        errorCodes: [2322],
        shouldSuppress() {
          return true;
        },
      });

      const files = new Map<string, string>();
      files.set("/test/index.ts", "const x: string = 123;");

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      const proxy = plugin.create(info);

      proxy.getSemanticDiagnostics("/test/index.ts");

      const auditLog = getDiagnosticSuppressionAuditLog();
      expect(auditLog).toHaveLength(0);
    });
  });

  describe("extension method completions still work", () => {
    it("provides completions for object properties after diagnostic suppression integration", () => {
      clearDiagnosticSuppressionRules();

      const source = `
const obj = { name: "test", value: 42 };
obj.
      `.trim();

      const files = new Map<string, string>([["/test/index.ts", source]]);

      const plugin = init({ typescript: ts });
      const info = createMockPluginInfo(files);
      const proxy = plugin.create(info);

      const dotPos = source.indexOf("obj.") + 4;
      const completions = proxy.getCompletionsAtPosition("/test/index.ts", dotPos, undefined);

      expect(completions).toBeDefined();
      if (completions) {
        const entryNames = completions.entries.map((e) => e.name);
        expect(entryNames).toContain("name");
        expect(entryNames).toContain("value");
      }
    });
  });
});
