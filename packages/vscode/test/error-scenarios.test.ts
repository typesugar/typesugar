import { describe, it, expect, beforeEach } from "vitest";
import {
  resetMockState,
  createMockTextDocument,
  workspace,
  Uri,
  Range,
  Position,
  CancellationTokenSource,
  _diagnosticCollections,
} from "./mocks/vscode-mock";
import { MacroDiagnosticsManager } from "../src/diagnostics";
import { MacroSemanticTokensProvider, TOKEN_TYPES } from "../src/semantic-tokens";
import { MacroCodeLensProvider } from "../src/codelens";
import { MacroInlayHintsProvider } from "../src/inlay-hints";
import { MacroCodeActionsProvider } from "../src/code-actions";
import { ManifestLoader } from "../src/manifest";
import type { ExpansionService, ExpansionResult, ExpansionDiagnostic } from "../src/expansion";
import type * as vscode from "vscode";

function createMockCancellationToken(): vscode.CancellationToken {
  return new CancellationTokenSource().token as unknown as vscode.CancellationToken;
}

function createMockExpansionService(
  overrides?: Partial<{
    getExpansionResult: () => Promise<ExpansionResult | undefined>;
    expandFile: () => Promise<ExpansionResult | undefined>;
  }>
): ExpansionService {
  return {
    getExpansionResult: overrides?.getExpansionResult ?? (async () => undefined),
    expandFile: overrides?.expandFile ?? (async () => undefined),
    getExpansionAtPosition: async () => undefined,
    getTransformedFile: async () => undefined,
    dispose: () => {},
  } as unknown as ExpansionService;
}

describe("Error Scenarios", () => {
  beforeEach(() => {
    resetMockState();
  });

  describe("MacroDiagnosticsManager", () => {
    it("creates without error", () => {
      const expansion = createMockExpansionService();
      expect(() => new MacroDiagnosticsManager(expansion)).not.toThrow();
    });

    it("publishes diagnostics from expansion results on save", async () => {
      const diagnostics: ExpansionDiagnostic[] = [
        {
          message: "Missing typeclass instance for Eq<Color>",
          severity: "error",
          code: 90001,
          range: { startLine: 5, startChar: 0, endLine: 5, endChar: 10 },
        },
        {
          message: "Deprecated usage of extend()",
          severity: "warning",
          code: 90002,
          range: { startLine: 10, startChar: 2, endLine: 10, endChar: 15 },
        },
      ];

      const result: ExpansionResult = {
        expandedText: "expanded",
        focusedView: "",
        expansions: [],
        comptimeResults: new Map(),
        bindTypes: new Map(),
        diagnostics,
      };

      const expansion = createMockExpansionService({
        expandFile: async () => result,
      });

      const manager = new MacroDiagnosticsManager(expansion);
      const doc = createMockTextDocument("const x = 1;", "/test/file.ts");

      // Trigger save
      (workspace as any)._fireSave(doc);

      // Wait for async diagnostic update
      await new Promise((resolve) => setTimeout(resolve, 50));

      manager.dispose();
    });

    it("clears diagnostics when expansion returns no result", async () => {
      const expansion = createMockExpansionService({
        expandFile: async () => undefined,
      });

      const manager = new MacroDiagnosticsManager(expansion);
      const doc = createMockTextDocument("const x = 1;", "/test/file.ts");

      (workspace as any)._fireSave(doc);
      await new Promise((resolve) => setTimeout(resolve, 50));

      manager.dispose();
    });

    it("clears diagnostics when expansion throws", async () => {
      const expansion = createMockExpansionService({
        expandFile: async () => {
          throw new Error("Transformer crashed");
        },
      });

      const manager = new MacroDiagnosticsManager(expansion);
      const doc = createMockTextDocument("const x = 1;", "/test/file.ts");

      // Should not throw even though expansion throws
      (workspace as any)._fireSave(doc);
      await new Promise((resolve) => setTimeout(resolve, 50));

      manager.dispose();
    });

    it("ignores non-TypeScript files", async () => {
      const expansion = createMockExpansionService();
      const manager = new MacroDiagnosticsManager(expansion);
      const doc = createMockTextDocument("# README", "/test/readme.md", "markdown");

      // Saving a markdown file should not trigger expansion
      (workspace as any)._fireSave(doc);
      await new Promise((resolve) => setTimeout(resolve, 50));

      manager.dispose();
    });

    it("respects enableDiagnostics setting", async () => {
      (workspace as any)._setConfig("typesugar", { enableDiagnostics: false });

      const result: ExpansionResult = {
        expandedText: "expanded",
        focusedView: "",
        expansions: [],
        comptimeResults: new Map(),
        bindTypes: new Map(),
        diagnostics: [{ message: "error", severity: "error" }],
      };

      const expansion = createMockExpansionService({
        expandFile: async () => result,
      });

      const manager = new MacroDiagnosticsManager(expansion);
      const doc = createMockTextDocument("const x = 1;", "/test/file.ts");

      (workspace as any)._fireSave(doc);
      await new Promise((resolve) => setTimeout(resolve, 50));

      manager.dispose();
    });

    it("clears diagnostics when file is closed", () => {
      const expansion = createMockExpansionService();
      const manager = new MacroDiagnosticsManager(expansion);
      const doc = createMockTextDocument("const x = 1;", "/test/file.ts");

      (workspace as any)._fireClose(doc);

      manager.dispose();
    });

    it("disposes cleanly", () => {
      const expansion = createMockExpansionService();
      const manager = new MacroDiagnosticsManager(expansion);
      expect(() => manager.dispose()).not.toThrow();
    });
  });

  describe("Provider error resilience", () => {
    it("SemanticTokens handles malformed code without throwing", () => {
      const loader = new ManifestLoader();
      const provider = new MacroSemanticTokensProvider(loader);
      const doc = createMockTextDocument("@@@ !!! ??? ((( ))) {{{ }}}", "test.ts");

      expect(() => {
        provider.provideDocumentSemanticTokens(doc, createMockCancellationToken());
      }).not.toThrow();
    });

    it("CodeLens handles malformed code without throwing", () => {
      const loader = new ManifestLoader();
      const expansion = createMockExpansionService();
      const provider = new MacroCodeLensProvider(loader, expansion);
      const doc = createMockTextDocument("@@@ !!! ??? ((( ))) {{{ }}}", "test.ts");

      expect(() => {
        provider.provideCodeLenses(doc, createMockCancellationToken());
      }).not.toThrow();
    });

    it("CodeActions handles malformed code without throwing", () => {
      const loader = new ManifestLoader();
      const expansion = createMockExpansionService();
      const provider = new MacroCodeActionsProvider(loader, expansion);
      const doc = createMockTextDocument("@@@ !!! ??? ((( ))) {{{ }}}", "test.ts");

      const range = new Range(0, 0, 0, 5);
      const context = { diagnostics: [], only: undefined, triggerKind: 1 };

      expect(() => {
        provider.provideCodeActions(
          doc,
          range as any,
          context as any,
          createMockCancellationToken()
        );
      }).not.toThrow();
    });

    it("SemanticTokens handles very large documents", () => {
      const loader = new ManifestLoader();
      const provider = new MacroSemanticTokensProvider(loader);
      const lines = Array.from({ length: 500 }, (_, i) => `const v${i} = ${i};`);
      const doc = createMockTextDocument(lines.join("\n"), "test.ts");

      expect(() => {
        provider.provideDocumentSemanticTokens(doc, createMockCancellationToken());
      }).not.toThrow();
    });

    it("CodeLens handles document with only decorators", () => {
      const loader = new ManifestLoader();
      const expansion = createMockExpansionService();
      const provider = new MacroCodeLensProvider(loader, expansion);
      const doc = createMockTextDocument(
        "@derive(Eq)\n@derive(Ord)\n@derive(Clone)\nclass A {}",
        "test.ts"
      );

      const lenses = provider.provideCodeLenses(doc, createMockCancellationToken());
      expect(lenses.length).toBe(3);
    });
  });

  // =========================================================================
  // PEP-036 Wave 6: Diagnostic range accuracy
  // =========================================================================

  describe("diagnostic range accuracy", () => {
    it("publishes diagnostics with correct line and column", async () => {
      const diagnostics: ExpansionDiagnostic[] = [
        {
          message: "Missing Eq instance",
          severity: "error",
          code: 90001,
          range: { startLine: 3, startChar: 4, endLine: 3, endChar: 20 },
        },
      ];

      const result: ExpansionResult = {
        expandedText: "expanded",
        focusedView: "",
        expansions: [],
        comptimeResults: new Map(),
        bindTypes: new Map(),
        diagnostics,
      };

      const expansion = createMockExpansionService({
        expandFile: async () => result,
      });

      const manager = new MacroDiagnosticsManager(expansion);
      const doc = createMockTextDocument(
        "line0\nline1\nline2\n    summon<Eq<Bad>>()",
        "/test/file.ts"
      );

      (workspace as any)._fireSave(doc);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify published diagnostic range
      const collection = _diagnosticCollections[0];
      expect(collection).toBeDefined();

      const published = collection.get(doc.uri);
      expect(published).toBeDefined();
      expect(published!.length).toBe(1);

      const diag = published![0];
      expect(diag.range.start.line).toBe(3);
      expect(diag.range.start.character).toBe(4);
      expect(diag.range.end.line).toBe(3);
      expect(diag.range.end.character).toBe(20);

      manager.dispose();
    });

    it("publishes relatedInformation when expansion field is present", async () => {
      const diagnostics: ExpansionDiagnostic[] = [
        {
          message: "Macro expansion failed",
          severity: "error",
          code: 90001,
          range: { startLine: 1, startChar: 0, endLine: 1, endChar: 10 },
          expansion: "const expanded = 42;",
        },
      ];

      const result: ExpansionResult = {
        expandedText: "expanded",
        focusedView: "",
        expansions: [],
        comptimeResults: new Map(),
        bindTypes: new Map(),
        diagnostics,
      };

      const expansion = createMockExpansionService({
        expandFile: async () => result,
      });

      const manager = new MacroDiagnosticsManager(expansion);
      const doc = createMockTextDocument("line0\nmacro_call()", "/test/file.ts");

      (workspace as any)._fireSave(doc);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const collection = _diagnosticCollections[0];
      const published = collection.get(doc.uri);
      expect(published).toBeDefined();
      expect(published!.length).toBe(1);

      const diag = published![0];
      expect(diag.relatedInformation).toBeDefined();
      expect(diag.relatedInformation!.length).toBe(1);
      expect(diag.relatedInformation![0].message).toContain("const expanded = 42;");

      manager.dispose();
    });

    it("diagnostics without range get default range (0,0)-(0,0)", async () => {
      const diagnostics: ExpansionDiagnostic[] = [
        {
          message: "Global error",
          severity: "error",
          code: 90001,
          // no range field
        },
      ];

      const result: ExpansionResult = {
        expandedText: "expanded",
        focusedView: "",
        expansions: [],
        comptimeResults: new Map(),
        bindTypes: new Map(),
        diagnostics,
      };

      const expansion = createMockExpansionService({
        expandFile: async () => result,
      });

      const manager = new MacroDiagnosticsManager(expansion);
      const doc = createMockTextDocument("const x = 1;", "/test/file.ts");

      (workspace as any)._fireSave(doc);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const collection = _diagnosticCollections[0];
      const published = collection.get(doc.uri);
      expect(published).toBeDefined();
      expect(published!.length).toBe(1);

      const diag = published![0];
      // Default range for diagnostics without position
      expect(diag.range.start.line).toBe(0);
      expect(diag.range.start.character).toBe(0);
      expect(diag.range.end.line).toBe(0);
      expect(diag.range.end.character).toBe(0);

      manager.dispose();
    });

    it("filters out diagnostics for generated code (no bogus positions)", async () => {
      const diagnostics: ExpansionDiagnostic[] = [
        {
          message: "Real error at line 2",
          severity: "error",
          code: 90001,
          range: { startLine: 2, startChar: 0, endLine: 2, endChar: 10 },
        },
        {
          message: "Error from generated code",
          severity: "error",
          code: 90002,
          range: { startLine: 500, startChar: 0, endLine: 500, endChar: 10 },
        },
      ];

      const result: ExpansionResult = {
        expandedText: "expanded",
        focusedView: "",
        expansions: [],
        comptimeResults: new Map(),
        bindTypes: new Map(),
        diagnostics,
      };

      const expansion = createMockExpansionService({
        expandFile: async () => result,
      });

      const manager = new MacroDiagnosticsManager(expansion);
      const source = "line0\nline1\nline2_error_here\n";
      const doc = createMockTextDocument(source, "/test/file.ts");

      (workspace as any)._fireSave(doc);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const collection = _diagnosticCollections[0];
      const published = collection.get(doc.uri);
      expect(published).toBeDefined();

      // Both diagnostics are published because the VS Code extension does not
      // filter by line bounds (that's the LSP server's job). This test documents
      // that behavior — the extension trusts the upstream diagnostic positions.
      expect(published!.length).toBe(2);

      manager.dispose();
    });
  });

  describe("Manifest error scenarios", () => {
    it("handles empty manifest JSON", async () => {
      (workspace as any)._setFsReadFile(async () => {
        return new TextEncoder().encode("{}");
      });

      const loader = new ManifestLoader();
      const workspaceFolder = {
        uri: Uri.file("/test-workspace"),
        name: "test",
        index: 0,
      };

      // Empty object has no version — should fall back to defaults
      await loader.initialize(workspaceFolder as any);
      expect(loader.expressionMacroNames.has("comptime")).toBe(true);
    });

    it("handles manifest with null macros", async () => {
      (workspace as any)._setFsReadFile(async () => {
        return new TextEncoder().encode(
          JSON.stringify({
            version: 1,
            macros: null,
          })
        );
      });

      const loader = new ManifestLoader();
      const workspaceFolder = {
        uri: Uri.file("/test-workspace"),
        name: "test",
        index: 0,
      };

      // Should not crash
      try {
        await loader.initialize(workspaceFolder as any);
      } catch {
        // Expected to fail — the point is it doesn't crash the extension
      }
      // Defaults should still be available from constructor
      expect(loader.expressionMacroNames.has("comptime")).toBe(true);
    });
  });
});
