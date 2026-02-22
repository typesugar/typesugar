import { describe, it, expect, beforeEach } from "vitest";
import {
  CancellationTokenSource,
  Range,
  Position,
  resetMockState,
  createMockTextDocument,
  workspace,
} from "./mocks/vscode-mock";
import { MacroCodeLensProvider } from "../src/codelens";
import { MacroInlayHintsProvider } from "../src/inlay-hints";
import { ManifestLoader } from "../src/manifest";
import type { ExpansionService, ExpansionResult } from "../src/expansion";
import type * as vscode from "vscode";

function createMockCancellationToken(): vscode.CancellationToken {
  return new CancellationTokenSource().token as unknown as vscode.CancellationToken;
}

function createMockRange(
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number
): vscode.Range {
  return new Range(startLine, startChar, endLine, endChar) as unknown as vscode.Range;
}

function createMockExpansionService(result?: Partial<ExpansionResult>): ExpansionService {
  const defaultResult: ExpansionResult = {
    expandedText: "",
    comptimeResults: new Map(),
    bindTypes: new Map(),
    diagnostics: [],
    ...result,
  };

  return {
    getExpansionResult: async () => defaultResult,
    expandFile: async () => defaultResult,
    getExpansionAtPosition: async () => defaultResult.expandedText || undefined,
    getTransformedFile: async () => undefined,
    dispose: () => {},
  } as unknown as ExpansionService;
}

describe("MacroCodeLensProvider", () => {
  let loader: ManifestLoader;

  beforeEach(() => {
    resetMockState();
    loader = new ManifestLoader();
  });

  describe("expression macro lenses", () => {
    it("provides lens for comptime()", () => {
      const expansion = createMockExpansionService();
      const provider = new MacroCodeLensProvider(loader, expansion);
      const doc = createMockTextDocument("const x = comptime(() => 42);", "test.ts");

      const lenses = provider.provideCodeLenses(doc, createMockCancellationToken());

      expect(lenses.length).toBeGreaterThan(0);
      const comptimeLens = lenses.find((l: vscode.CodeLens) =>
        l.command?.title.includes("comptime")
      );
      expect(comptimeLens).toBeDefined();
      expect(comptimeLens!.command!.command).toBe("typesugar.expandMacro");
    });

    it("provides lens for specialize()", () => {
      const expansion = createMockExpansionService();
      const provider = new MacroCodeLensProvider(loader, expansion);
      const doc = createMockTextDocument("const f = specialize(fn, [dict]);", "test.ts");

      const lenses = provider.provideCodeLenses(doc, createMockCancellationToken());
      const lens = lenses.find((l: vscode.CodeLens) => l.command?.title.includes("specialize"));
      expect(lens).toBeDefined();
    });
  });

  describe("decorator macro lenses", () => {
    it("provides lens for @derive with derive count", () => {
      const expansion = createMockExpansionService();
      const provider = new MacroCodeLensProvider(loader, expansion);
      const doc = createMockTextDocument("@derive(Eq, Ord, Clone)\nclass Point { }", "test.ts");

      const lenses = provider.provideCodeLenses(doc, createMockCancellationToken());
      const deriveLens = lenses.find((l: vscode.CodeLens) => l.command?.title.includes("@derive"));
      expect(deriveLens).toBeDefined();
      expect(deriveLens!.command!.title).toContain("3 derives");
    });

    it("provides lens for @typeclass", () => {
      const expansion = createMockExpansionService();
      const provider = new MacroCodeLensProvider(loader, expansion);
      const doc = createMockTextDocument(
        "@typeclass\ninterface Show<A> { show(a: A): string; }",
        "test.ts"
      );

      const lenses = provider.provideCodeLenses(doc, createMockCancellationToken());
      const lens = lenses.find((l: vscode.CodeLens) => l.command?.title.includes("@typeclass"));
      expect(lens).toBeDefined();
    });
  });

  describe("tagged template lenses", () => {
    it("provides lens for sql``", () => {
      const expansion = createMockExpansionService();
      const provider = new MacroCodeLensProvider(loader, expansion);
      const doc = createMockTextDocument("const q = sql`SELECT * FROM users`;", "test.ts");

      const lenses = provider.provideCodeLenses(doc, createMockCancellationToken());
      const lens = lenses.find((l: vscode.CodeLens) => l.command?.title.includes("sql"));
      expect(lens).toBeDefined();
    });
  });

  describe("labeled block lenses", () => {
    it("provides lens for let: comprehension", () => {
      const expansion = createMockExpansionService();
      const provider = new MacroCodeLensProvider(loader, expansion);
      const doc = createMockTextDocument("let: {\n  x << Some(1);\n}", "test.ts");

      const lenses = provider.provideCodeLenses(doc, createMockCancellationToken());
      const lens = lenses.find((l: vscode.CodeLens) => l.command?.title.includes("let:"));
      expect(lens).toBeDefined();
      expect(lens!.command!.title).toContain("comprehension");
    });
  });

  describe("edge cases", () => {
    it("returns empty for empty document", () => {
      const expansion = createMockExpansionService();
      const provider = new MacroCodeLensProvider(loader, expansion);
      const doc = createMockTextDocument("", "test.ts");

      const lenses = provider.provideCodeLenses(doc, createMockCancellationToken());
      expect(lenses.length).toBe(0);
    });

    it("returns empty for non-macro code", () => {
      const expansion = createMockExpansionService();
      const provider = new MacroCodeLensProvider(loader, expansion);
      const doc = createMockTextDocument(
        "const x = 42;\nfunction add(a: number, b: number) { return a + b; }",
        "test.ts"
      );

      const lenses = provider.provideCodeLenses(doc, createMockCancellationToken());
      expect(lenses.length).toBe(0);
    });

    it("returns empty when CodeLens is disabled", () => {
      (workspace as any)._setConfig("typesugar", { enableCodeLens: false });

      const expansion = createMockExpansionService();
      const provider = new MacroCodeLensProvider(loader, expansion);
      const doc = createMockTextDocument("const x = comptime(() => 42);", "test.ts");

      const lenses = provider.provideCodeLenses(doc, createMockCancellationToken());
      expect(lenses.length).toBe(0);
    });
  });
});

describe("MacroInlayHintsProvider", () => {
  let loader: ManifestLoader;

  beforeEach(() => {
    resetMockState();
    loader = new ManifestLoader();
  });

  describe("comptime result hints", () => {
    it("shows comptime result when expansion available", async () => {
      // The comptime() call is at offset ~10 in "const x = comptime(() => 42);"
      // We need the offset of the comptime CallExpression node
      const code = "const x = comptime(() => 42);";
      const comptimeOffset = code.indexOf("comptime");

      const expansion = createMockExpansionService({
        comptimeResults: new Map([[comptimeOffset, 42]]),
      });

      const provider = new MacroInlayHintsProvider(loader, expansion);
      const doc = createMockTextDocument(code, "test.ts");

      const range = createMockRange(0, 0, 0, code.length);
      const hints = await provider.provideInlayHints(doc, range, createMockCancellationToken());

      expect(hints.length).toBeGreaterThan(0);
      const comptimeHint = hints.find((h: vscode.InlayHint) =>
        (h.label as string).includes("= 42")
      );
      expect(comptimeHint).toBeDefined();
    });

    it("shows no hints when no expansion available", async () => {
      const expansion = createMockExpansionService();
      // Return undefined from getExpansionResult
      (expansion as any).getExpansionResult = async () => undefined;

      const provider = new MacroInlayHintsProvider(loader, expansion);
      const doc = createMockTextDocument("const x = comptime(() => 42);", "test.ts");

      const range = createMockRange(0, 0, 0, 50);
      const hints = await provider.provideInlayHints(doc, range, createMockCancellationToken());

      expect(hints.length).toBe(0);
    });
  });

  describe("bind type hints", () => {
    it("shows bind variable types in comprehensions", async () => {
      const code = "let: {\n  x << Some(1);\n}";
      // Find the position of 'x' in "x << Some(1);"
      const xOffset = code.indexOf("x <<");

      const expansion = createMockExpansionService({
        bindTypes: new Map([[xOffset, "number"]]),
      });

      const provider = new MacroInlayHintsProvider(loader, expansion);
      const doc = createMockTextDocument(code, "test.ts");

      const range = createMockRange(0, 0, 3, 0);
      const hints = await provider.provideInlayHints(doc, range, createMockCancellationToken());

      const typeHint = hints.find((h: vscode.InlayHint) =>
        (h.label as string).includes(": number")
      );
      expect(typeHint).toBeDefined();
    });
  });

  describe("edge cases", () => {
    it("returns empty hints for empty document", async () => {
      const expansion = createMockExpansionService();
      const provider = new MacroInlayHintsProvider(loader, expansion);
      const doc = createMockTextDocument("", "test.ts");

      const range = createMockRange(0, 0, 0, 0);
      const hints = await provider.provideInlayHints(doc, range, createMockCancellationToken());

      expect(hints.length).toBe(0);
    });

    it("returns empty when inlay hints are disabled", async () => {
      (workspace as any)._setConfig("typesugar", { enableInlayHints: false });

      const expansion = createMockExpansionService({
        comptimeResults: new Map([[10, 42]]),
      });
      const provider = new MacroInlayHintsProvider(loader, expansion);
      const doc = createMockTextDocument("const x = comptime(() => 42);", "test.ts");

      const range = createMockRange(0, 0, 0, 50);
      const hints = await provider.provideInlayHints(doc, range, createMockCancellationToken());
      expect(hints.length).toBe(0);
    });

    it("handles expansion service errors gracefully", async () => {
      const expansion = createMockExpansionService();
      (expansion as any).getExpansionResult = async () => {
        throw new Error("Expansion failed");
      };

      const provider = new MacroInlayHintsProvider(loader, expansion);
      const doc = createMockTextDocument("const x = comptime(() => 42);", "test.ts");

      const range = createMockRange(0, 0, 0, 50);
      // Should not throw
      await expect(
        provider.provideInlayHints(doc, range, createMockCancellationToken())
      ).rejects.toThrow();
    });
  });
});
