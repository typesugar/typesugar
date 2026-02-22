import { describe, it, expect, beforeEach } from "vitest";
import { CancellationTokenSource, resetMockState } from "../test/mocks/vscode-mock";
import { createMockTextDocument } from "../test/mocks/vscode-mock";
import { MacroSemanticTokensProvider, TOKEN_TYPES } from "../src/semantic-tokens";
import { ManifestLoader } from "../src/manifest";

function createMockCancellationToken() {
  return new CancellationTokenSource().token;
}

/**
 * Decode semantic token data back into readable form.
 * Tokens are encoded as delta arrays: [deltaLine, deltaChar, length, typeIndex, modBits]
 */
function decodeTokens(data: Uint32Array): Array<{
  line: number;
  char: number;
  length: number;
  type: string;
  modifiers: string[];
}> {
  const tokens: Array<{
    line: number;
    char: number;
    length: number;
    type: string;
    modifiers: string[];
  }> = [];
  let line = 0;
  let char = 0;

  for (let i = 0; i < data.length; i += 5) {
    const deltaLine = data[i];
    const deltaChar = data[i + 1];
    const length = data[i + 2];
    const typeIndex = data[i + 3];
    const modBits = data[i + 4];

    line += deltaLine;
    char = deltaLine === 0 ? char + deltaChar : deltaChar;

    const modifiers: string[] = [];
    if (modBits & 1) modifiers.push("macro");
    if (modBits & 2) modifiers.push("comptime");

    tokens.push({
      line,
      char,
      length,
      type: TOKEN_TYPES[typeIndex] ?? `unknown(${typeIndex})`,
      modifiers,
    });
  }
  return tokens;
}

describe("MacroSemanticTokensProvider", () => {
  let loader: ManifestLoader;
  let provider: MacroSemanticTokensProvider;

  beforeEach(() => {
    resetMockState();
    loader = new ManifestLoader();
    provider = new MacroSemanticTokensProvider(loader);
  });

  describe("expression macros", () => {
    it("highlights comptime as comptimeBlock", () => {
      const doc = createMockTextDocument("const x = comptime(() => 42);", "test.ts");
      const result = provider.provideDocumentSemanticTokens(doc, createMockCancellationToken());
      const tokens = decodeTokens(result.data);

      const comptimeToken = tokens.find((t) => t.type === "comptimeBlock");
      expect(comptimeToken).toBeDefined();
      expect(comptimeToken!.length).toBe("comptime".length);
      expect(comptimeToken!.modifiers).toContain("comptime");
    });

    it("highlights specialize as macro", () => {
      const doc = createMockTextDocument("const f = specialize(fn, [dict]);", "test.ts");
      const result = provider.provideDocumentSemanticTokens(doc, createMockCancellationToken());
      const tokens = decodeTokens(result.data);

      const macroToken = tokens.find((t) => t.type === "macro");
      expect(macroToken).toBeDefined();
      expect(macroToken!.length).toBe("specialize".length);
      expect(macroToken!.modifiers).toContain("macro");
    });

    it("highlights summon as macro", () => {
      const doc = createMockTextDocument("const eq = summon<Eq<number>>();", "test.ts");
      const result = provider.provideDocumentSemanticTokens(doc, createMockCancellationToken());
      const tokens = decodeTokens(result.data);

      const macroToken = tokens.find((t) => t.type === "macro");
      expect(macroToken).toBeDefined();
      expect(macroToken!.length).toBe("summon".length);
    });
  });

  describe("decorator macros", () => {
    it("highlights @derive as macroDecorator", () => {
      const doc = createMockTextDocument("@derive(Eq, Ord)\nclass Point { }", "test.ts");
      const result = provider.provideDocumentSemanticTokens(doc, createMockCancellationToken());
      const tokens = decodeTokens(result.data);

      const decoratorToken = tokens.find((t) => t.type === "macroDecorator");
      expect(decoratorToken).toBeDefined();
      expect(decoratorToken!.length).toBe("derive".length);
    });

    it("highlights derive arguments as deriveArg", () => {
      const doc = createMockTextDocument("@derive(Eq, Ord, Clone)\nclass Point { }", "test.ts");
      const result = provider.provideDocumentSemanticTokens(doc, createMockCancellationToken());
      const tokens = decodeTokens(result.data);

      const deriveArgTokens = tokens.filter((t) => t.type === "deriveArg");
      expect(deriveArgTokens.length).toBe(3);
      expect(deriveArgTokens[0].length).toBe("Eq".length);
      expect(deriveArgTokens[1].length).toBe("Ord".length);
      expect(deriveArgTokens[2].length).toBe("Clone".length);
    });

    it("highlights @typeclass as macroDecorator", () => {
      const doc = createMockTextDocument(
        "@typeclass\ninterface Show<A> { show(a: A): string; }",
        "test.ts"
      );
      const result = provider.provideDocumentSemanticTokens(doc, createMockCancellationToken());
      const tokens = decodeTokens(result.data);

      const decoratorToken = tokens.find((t) => t.type === "macroDecorator");
      expect(decoratorToken).toBeDefined();
    });
  });

  describe("tagged template macros", () => {
    it("highlights sql tag as macroTemplate", () => {
      const doc = createMockTextDocument("const q = sql`SELECT * FROM users`;", "test.ts");
      const result = provider.provideDocumentSemanticTokens(doc, createMockCancellationToken());
      const tokens = decodeTokens(result.data);

      const templateToken = tokens.find((t) => t.type === "macroTemplate");
      expect(templateToken).toBeDefined();
      expect(templateToken!.length).toBe("sql".length);
    });
  });

  describe("extension methods", () => {
    it("highlights extension method calls", () => {
      const doc = createMockTextDocument("const s = point.show();", "test.ts");
      const result = provider.provideDocumentSemanticTokens(doc, createMockCancellationToken());
      const tokens = decodeTokens(result.data);

      const extToken = tokens.find((t) => t.type === "extensionMethod");
      expect(extToken).toBeDefined();
      expect(extToken!.length).toBe("show".length);
    });

    it("highlights chained extension methods", () => {
      const doc = createMockTextDocument("const h = point.hash();", "test.ts");
      const result = provider.provideDocumentSemanticTokens(doc, createMockCancellationToken());
      const tokens = decodeTokens(result.data);

      const extToken = tokens.find((t) => t.type === "extensionMethod");
      expect(extToken).toBeDefined();
    });
  });

  describe("labeled blocks", () => {
    it("highlights let: label as macro", () => {
      const doc = createMockTextDocument("let: {\n  x << Some(1);\n}", "test.ts");
      const result = provider.provideDocumentSemanticTokens(doc, createMockCancellationToken());
      const tokens = decodeTokens(result.data);

      // The "let" label should be highlighted as macro
      const labelToken = tokens.find((t) => t.type === "macro" && t.line === 0);
      expect(labelToken).toBeDefined();
    });

    it("highlights bind variables in comprehensions", () => {
      const doc = createMockTextDocument("let: {\n  x << Some(1);\n  y << Some(2);\n}", "test.ts");
      const result = provider.provideDocumentSemanticTokens(doc, createMockCancellationToken());
      const tokens = decodeTokens(result.data);

      const bindTokens = tokens.filter((t) => t.type === "bindVariable");
      expect(bindTokens.length).toBe(2);
    });
  });

  describe("edge cases", () => {
    it("returns empty tokens for empty document", () => {
      const doc = createMockTextDocument("", "test.ts");
      const result = provider.provideDocumentSemanticTokens(doc, createMockCancellationToken());
      expect(result.data.length).toBe(0);
    });

    it("returns empty tokens for document with no macros", () => {
      const doc = createMockTextDocument(
        "const x = 42;\nfunction add(a: number, b: number) { return a + b; }",
        "test.ts"
      );
      const result = provider.provideDocumentSemanticTokens(doc, createMockCancellationToken());
      expect(result.data.length).toBe(0);
    });

    it("handles TSX files", () => {
      const doc = createMockTextDocument(
        "const q = sql`SELECT 1`;\nconst el = <div>hello</div>;",
        "test.tsx",
        "typescriptreact"
      );
      const result = provider.provideDocumentSemanticTokens(doc, createMockCancellationToken());
      const tokens = decodeTokens(result.data);

      const templateToken = tokens.find((t) => t.type === "macroTemplate");
      expect(templateToken).toBeDefined();
    });

    it("ignores non-macro function calls", () => {
      const doc = createMockTextDocument(
        'console.log("hello");\nfetch("/api");\nmyFunction(42);',
        "test.ts"
      );
      const result = provider.provideDocumentSemanticTokens(doc, createMockCancellationToken());
      expect(result.data.length).toBe(0);
    });
  });
});
