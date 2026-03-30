/**
 * Tests for Wave 2 features: semantic tokens, codelens, inlay hints,
 * code actions, and workspace commands.
 */

import { describe, it, expect } from "vitest";
import { computeSemanticTokens, TOKEN_TYPES, TOKEN_MODIFIERS } from "../src/semantic-tokens.js";
import { computeCodeLenses } from "../src/codelens.js";
import { computeInlayHints } from "../src/inlay-hints.js";
import { computeExtraCodeActions } from "../src/code-actions-extra.js";
import { ManifestState } from "../src/manifest.js";

function makeManifest(): ManifestState {
  const m = new ManifestState();
  // Default manifest has comptime, derive, sql, let, etc.
  return m;
}

// ---------------------------------------------------------------------------
// Semantic Tokens
// ---------------------------------------------------------------------------

describe("computeSemanticTokens", () => {
  const manifest = makeManifest();

  it("tokenizes expression macro calls", () => {
    const text = "const x = comptime(() => 1 + 2);\n";
    const result = computeSemanticTokens(text, "test.ts", manifest);
    // Should have tokens for "comptime"
    expect(result.data.length).toBeGreaterThan(0);
    // Data is in groups of 5: deltaLine, deltaChar, length, tokenType, modifiers
    expect(result.data.length % 5).toBe(0);
  });

  it("tokenizes decorator macros", () => {
    const text = '@derive("Eq", "Ord")\nclass Foo {}\n';
    const result = computeSemanticTokens(text, "test.ts", manifest);
    expect(result.data.length).toBeGreaterThan(0);
    // Should have tokens for "derive" decorator and "Eq", "Ord" derive args
    const tokenCount = result.data.length / 5;
    expect(tokenCount).toBeGreaterThanOrEqual(3); // derive + Eq + Ord
  });

  it("tokenizes tagged template macros", () => {
    const text = "const q = sql`SELECT * FROM users`;\n";
    const result = computeSemanticTokens(text, "test.ts", manifest);
    expect(result.data.length).toBeGreaterThan(0);
  });

  it("returns empty data for plain TypeScript", () => {
    const text = "const x: number = 42;\n";
    const result = computeSemanticTokens(text, "test.ts", manifest);
    expect(result.data.length).toBe(0);
  });

  it("encodes tokens in delta format", () => {
    const text = "comptime(() => 1);\ncomptime(() => 2);\n";
    const result = computeSemanticTokens(text, "test.ts", manifest);
    // At least 2 tokens (one per comptime)
    const tokenCount = result.data.length / 5;
    expect(tokenCount).toBeGreaterThanOrEqual(2);

    // First token's deltaLine should be 0 (first line)
    expect(result.data[0]).toBe(0);
    // Second token group's deltaLine should be 1 (next line)
    if (tokenCount >= 3) {
      // Skip tokens on the same line that are for comptimeBlock
      // Find the first token with deltaLine > 0
      let foundNextLine = false;
      for (let i = 5; i < result.data.length; i += 5) {
        if (result.data[i] > 0) {
          foundNextLine = true;
          break;
        }
      }
      expect(foundNextLine).toBe(true);
    }
  });

  it("has correct legend types and modifiers", () => {
    expect(TOKEN_TYPES).toContain("macro");
    expect(TOKEN_TYPES).toContain("macroDecorator");
    expect(TOKEN_TYPES).toContain("extensionMethod");
    expect(TOKEN_MODIFIERS).toContain("macro");
    expect(TOKEN_MODIFIERS).toContain("comptime");
  });
});

// ---------------------------------------------------------------------------
// CodeLens
// ---------------------------------------------------------------------------

describe("computeCodeLenses", () => {
  const manifest = makeManifest();

  it("creates lenses for expression macros", () => {
    const text = "const x = comptime(() => 42);\n";
    const lenses = computeCodeLenses(text, "test.ts", manifest, "file:///test.ts");
    expect(lenses.length).toBeGreaterThan(0);
    expect(lenses[0].command?.title).toContain("comptime");
    expect(lenses[0].command?.command).toBe("typesugar.expandMacro");
  });

  it("creates lenses for decorator macros", () => {
    const text = '@derive("Eq")\nclass Foo {}\n';
    const lenses = computeCodeLenses(text, "test.ts", manifest, "file:///test.ts");
    const deriveLens = lenses.find((l) => l.command?.title?.includes("@derive"));
    expect(deriveLens).toBeDefined();
    expect(deriveLens!.command?.title).toContain("1 derives");
  });

  it("creates lenses for tagged templates", () => {
    const text = "const q = sql`SELECT 1`;\n";
    const lenses = computeCodeLenses(text, "test.ts", manifest, "file:///test.ts");
    expect(lenses.length).toBeGreaterThan(0);
    expect(lenses[0].command?.title).toContain("sql");
  });

  it("returns empty for plain TypeScript", () => {
    const text = "const x = 42;\n";
    const lenses = computeCodeLenses(text, "test.ts", manifest, "file:///test.ts");
    expect(lenses.length).toBe(0);
  });

  it("includes URI and offset in command arguments", () => {
    const text = "const x = comptime(() => 42);\n";
    const lenses = computeCodeLenses(text, "test.ts", manifest, "file:///test.ts");
    expect(lenses[0].command?.arguments).toBeDefined();
    expect(lenses[0].command?.arguments![0]).toBe("file:///test.ts");
    expect(typeof lenses[0].command?.arguments![1]).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Inlay Hints
// ---------------------------------------------------------------------------

describe("computeInlayHints", () => {
  const manifest = makeManifest();
  const fullRange = {
    start: { line: 0, character: 0 },
    end: { line: 100, character: 0 },
  };

  it("shows expansion hint for comptime with expansion data", () => {
    const text = "const x = comptime(() => 42);\n";
    const hints = computeInlayHints(text, "test.ts", manifest, fullRange, [
      {
        macroName: "comptime",
        originalFile: "test.ts",
        originalLine: 0,
        originalColumn: 10,
        originalStart: 10,
        originalEnd: 28,
        originalText: "comptime(() => 42)",
        expandedText: "42",
      },
    ]);
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0].label).toContain("42");
  });

  it("returns empty for plain TypeScript", () => {
    const text = "const x = 42;\n";
    const hints = computeInlayHints(text, "test.ts", manifest, fullRange);
    expect(hints.length).toBe(0);
  });

  it("respects visible range", () => {
    const text = "const x = comptime(() => 1);\nconst y = comptime(() => 2);\n";
    // Only line 0 visible
    const hints = computeInlayHints(
      text,
      "test.ts",
      manifest,
      {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 100 },
      },
      [
        {
          macroName: "comptime",
          originalFile: "test.ts",
          originalLine: 0,
          originalColumn: 10,
          originalStart: 10,
          originalEnd: 28,
          originalText: "comptime(() => 1)",
          expandedText: "1",
        },
        {
          macroName: "comptime",
          originalFile: "test.ts",
          originalLine: 1,
          originalColumn: 10,
          originalStart: 39,
          originalEnd: 57,
          originalText: "comptime(() => 2)",
          expandedText: "2",
        },
      ]
    );
    // Should only include hint for line 0
    expect(hints.length).toBe(1);
    expect(hints[0].label).toContain("1");
  });
});

// ---------------------------------------------------------------------------
// Extra Code Actions
// ---------------------------------------------------------------------------

describe("computeExtraCodeActions", () => {
  const manifest = makeManifest();

  it("offers expand-macro for comptime calls", () => {
    const text = "const x = comptime(() => 42);\n";
    const actions = computeExtraCodeActions(
      text,
      "test.ts",
      manifest,
      {
        start: { line: 0, character: 12 },
        end: { line: 0, character: 12 },
      },
      "file:///test.ts"
    );

    const expandAction = actions.find((a) => a.title.includes("Expand"));
    expect(expandAction).toBeDefined();
    expect(expandAction!.command?.command).toBe("typesugar.expandMacro");
  });

  it("offers wrap-in-comptime for selections", () => {
    const text = "const x = 1 + 2;\n";
    const actions = computeExtraCodeActions(
      text,
      "test.ts",
      manifest,
      {
        start: { line: 0, character: 10 },
        end: { line: 0, character: 15 },
      },
      "file:///test.ts"
    );

    const wrapAction = actions.find((a) => a.title.includes("comptime"));
    expect(wrapAction).toBeDefined();
    expect(wrapAction!.edit).toBeDefined();
  });

  it("offers add-derive for classes without derive", () => {
    const text = "class Foo {\n  x: number = 1;\n}\n";
    const actions = computeExtraCodeActions(
      text,
      "test.ts",
      manifest,
      {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 6 },
      },
      "file:///test.ts"
    );

    const deriveAction = actions.find((a) => a.title.includes("@derive"));
    expect(deriveAction).toBeDefined();
  });

  it("does not offer add-derive for classes with derive", () => {
    const text = '@derive("Eq")\nclass Foo {\n  x: number = 1;\n}\n';
    const actions = computeExtraCodeActions(
      text,
      "test.ts",
      manifest,
      {
        start: { line: 1, character: 6 },
        end: { line: 1, character: 6 },
      },
      "file:///test.ts"
    );

    const deriveAction = actions.find((a) => a.title.includes("@derive"));
    expect(deriveAction).toBeUndefined();
  });

  it("returns empty for plain code with no selection", () => {
    const text = "const x = 42;\n";
    const actions = computeExtraCodeActions(
      text,
      "test.ts",
      manifest,
      {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 6 },
      },
      "file:///test.ts"
    );

    expect(actions.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

describe("ManifestState", () => {
  it("has default macros loaded", () => {
    const m = new ManifestState();
    expect(m.expressionMacroNames.has("comptime")).toBe(true);
    expect(m.decoratorMacroNames.has("derive")).toBe(true);
    expect(m.taggedTemplateMacroNames.has("sql")).toBe(true);
    expect(m.deriveArgNames.has("Eq")).toBe(true);
    expect(m.deriveArgNames.has("Ord")).toBe(true);
  });

  it("loads from workspace root", () => {
    const m = new ManifestState();
    // Loading from the typesugar repo root should find the manifest
    const loaded = m.load("/Users/deapovey/src/typesugar");
    expect(loaded).toBe(true);
    // Should have the extra macros from the repo's manifest
    expect(m.expressionMacroNames.has("comptime")).toBe(true);
    expect(m.expressionMacroNames.has("match")).toBe(true);
  });

  it("returns false when no manifest found", () => {
    const m = new ManifestState();
    const loaded = m.load("/nonexistent/path");
    expect(loaded).toBe(false);
    // Should still have defaults
    expect(m.expressionMacroNames.has("comptime")).toBe(true);
  });
});
