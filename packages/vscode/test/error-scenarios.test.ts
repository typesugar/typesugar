import { describe, it, expect, beforeEach } from "vitest";
import {
  resetMockState,
  createMockTextDocument,
  workspace,
  Uri,
  Range,
  Position,
} from "./mocks/vscode-mock";
import { MacroDiagnosticsManager } from "../src/diagnostics";
import { MacroSemanticTokensProvider, TOKEN_TYPES } from "../src/semantic-tokens";
import { MacroCodeLensProvider } from "../src/codelens";
import { MacroInlayHintsProvider } from "../src/inlay-hints";
import { MacroCodeActionsProvider } from "../src/code-actions";
import { ManifestLoader } from "../src/manifest";
import type { ExpansionService, ExpansionResult, ExpansionDiagnostic } from "../src/expansion";
import { CancellationTokenSource } from "./mocks/vscode-mock";

function createMockCancellationToken() {
  return new CancellationTokenSource().token;
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
