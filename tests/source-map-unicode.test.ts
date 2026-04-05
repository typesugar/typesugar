/**
 * PEP-036 Wave 3: Unicode & Multi-byte Edge Cases
 *
 * Tests that the source map pipeline handles multi-byte characters correctly:
 * - Byte offsets vs character offsets
 * - Emoji, CJK, combining characters
 * - Position mapping accuracy through transformations with Unicode content
 * - LSP offsetToPosition() UTF-16 code unit compliance
 */

import { describe, it, expect } from "vitest";
import { transformCode, type TransformResult } from "@typesugar/transformer";
import { AMBIENT_DECLARATIONS } from "../api/playground-declarations.js";
import { offsetToPosition, positionToOffset } from "../packages/lsp-common/src/position-helpers.js";
import * as path from "path";
import * as ts from "typescript";

// ============================================================================
// Helpers
// ============================================================================

const AMBIENT_FILE = path.resolve(__dirname, "../__playground_ambient__.d.ts");

function transform(code: string, opts?: { strictOutput?: boolean }): TransformResult {
  return transformCode(code, {
    fileName: path.resolve("test-unicode.ts"),
    extraRootFiles: [AMBIENT_FILE],
    strictOutput: opts?.strictOutput ?? false,
    readFile: (f: string) => {
      if (f === AMBIENT_FILE) return AMBIENT_DECLARATIONS;
      return ts.sys.readFile(f);
    },
    fileExists: (f: string) => f === AMBIENT_FILE || ts.sys.fileExists(f),
  });
}

function transformSts(code: string): TransformResult {
  return transformCode(code, {
    fileName: path.resolve("test-unicode.sts"),
    extraRootFiles: [AMBIENT_FILE],
    readFile: (f: string) => {
      if (f === AMBIENT_FILE) return AMBIENT_DECLARATIONS;
      return ts.sys.readFile(f);
    },
    fileExists: (f: string) => f === AMBIENT_FILE || ts.sys.fileExists(f),
  });
}

/** Find 0-based byte offset of text in source. */
function offsetOf(source: string, needle: string): number {
  const idx = source.indexOf(needle);
  if (idx === -1) throw new Error(`"${needle}" not found in source`);
  return idx;
}

/** Get 1-based line number for a byte offset. */
function lineAt(source: string, offset: number): number {
  return source.substring(0, offset).split("\n").length;
}

// ============================================================================
// offsetToPosition — UTF-16 correctness
// ============================================================================

describe("offsetToPosition UTF-16 behavior", () => {
  it("returns correct line/character for ASCII-only content", () => {
    const text = "abc\ndef\nghi";
    // 'd' is at offset 4
    const pos = offsetToPosition(text, 4);
    expect(pos).toEqual({ line: 1, character: 0 });

    // 'e' is at offset 5
    const pos2 = offsetToPosition(text, 5);
    expect(pos2).toEqual({ line: 1, character: 1 });
  });

  it("handles emoji in content — character count diverges from byte offset", () => {
    // "🎉" is 2 UTF-16 code units (surrogate pair) but iterating JS string chars gives length 2
    // In a JS string, "🎉".length === 2
    const text = "🎉ab\ncd";
    // The emoji takes positions 0-1 in UTF-16, 'a' is at UTF-16 position 2, 'b' at 3
    // '\n' at UTF-16 position 4, 'c' at line 1 character 0

    const posC = offsetToPosition(text, text.indexOf("c"));
    expect(posC.line).toBe(1);
    expect(posC.character).toBe(0);

    // 'a' after emoji
    const posA = offsetToPosition(text, text.indexOf("a"));
    expect(posA.line).toBe(0);
    // In JS string indexing: "🎉" occupies indices 0,1; "a" is at index 2
    // offsetToPosition counts characters, so character should be 2
    expect(posA.character).toBe(2);
  });

  it("handles CJK characters", () => {
    // CJK characters are 1 UTF-16 code unit each (BMP)
    const text = "変数\nabc";
    // '変' at index 0, '数' at index 1, '\n' at index 2, 'a' at index 3
    const posA = offsetToPosition(text, text.indexOf("a"));
    expect(posA).toEqual({ line: 1, character: 0 });

    const pos数 = offsetToPosition(text, text.indexOf("数"));
    expect(pos数).toEqual({ line: 0, character: 1 });
  });

  it("handles text with emoji mid-line", () => {
    const text = "abc🎉def";
    // 'a' at 0, 'b' at 1, 'c' at 2, '🎉' at 3-4 (surrogate pair), 'd' at 5, 'e' at 6, 'f' at 7
    const posD = offsetToPosition(text, text.indexOf("d"));
    expect(posD.line).toBe(0);
    // 'd' is at string index 5, line starts at 0, so character = 5
    expect(posD.character).toBe(text.indexOf("d"));
  });

  it("roundtrips offsetToPosition → positionToOffset for ASCII", () => {
    const text = "const x = 1;\nconst y = 2;\nconst z = 3;";
    for (let offset = 0; offset < text.length; offset++) {
      const pos = offsetToPosition(text, offset);
      const back = positionToOffset(text, pos);
      expect(back, `roundtrip failed at offset ${offset}`).toBe(offset);
    }
  });

  it("roundtrips offsetToPosition → positionToOffset for text with emoji", () => {
    const text = "🎉abc\n変数def";
    for (let offset = 0; offset < text.length; offset++) {
      const pos = offsetToPosition(text, offset);
      const back = positionToOffset(text, pos);
      expect(back, `roundtrip failed at offset ${offset}`).toBe(offset);
    }
  });
});

// ============================================================================
// Position mapping through transformations with Unicode content
// ============================================================================

describe("source map with Unicode content", () => {
  it("position mapping works with emoji in comments between macros", () => {
    const code = `import { pipe } from "typesugar";

// 🎉 celebrate!
const a = pipe(1, (n: number) => n + 1);
// 🔥 fire
const after = "marker";
`;
    const result = transform(code);
    expect(result.changed).toBe(true);

    if (result.code.includes("const after")) {
      const origOffset = offsetOf(code, "const after");
      const transOffset = offsetOf(result.code, "const after");
      const mapped = result.mapper.toOriginal(transOffset);
      expect(mapped, "code after emoji comments should map back").toBe(origOffset);
    }
  });

  it("position mapping works with CJK identifiers around macros", () => {
    const code = `import { pipe } from "typesugar";

const 変数 = 42;
const result = pipe(変数, (n: number) => n + 1);
const 結果 = "end";
`;
    const result = transform(code);
    expect(result.changed).toBe(true);

    if (result.code.includes("const 結果")) {
      const origOffset = offsetOf(code, "const 結果");
      const transOffset = offsetOf(result.code, "const 結果");
      const mapped = result.mapper.toOriginal(transOffset);
      expect(mapped, "CJK identifier after pipe should map back").toBe(origOffset);
    }
  });

  it("position mapping works with emoji in string literals around macros", () => {
    const code = `import { pipe } from "typesugar";

const greeting = "Hello 🌍!";
const result = pipe(1, (n: number) => n + 1);
const farewell = "Goodbye 🌙!";
`;
    const result = transform(code);
    expect(result.changed).toBe(true);

    if (result.code.includes("const farewell")) {
      const origOffset = offsetOf(code, "const farewell");
      const transOffset = offsetOf(result.code, "const farewell");
      const mapped = result.mapper.toOriginal(transOffset);
      expect(mapped, "code after emoji strings + pipe should map back").toBe(origOffset);
    }
  });

  // BUG: mapper.toOriginal returns null for code after template literal with emoji + pipe expansion
  it.fails("position mapping works with template literals containing multi-byte chars", () => {
    const code = `import { pipe } from "typesugar";

const msg = \`Hello 🎉 \${42}\`;
const result = pipe(1, (n: number) => n + 1);
const after = "done";
`;
    const result = transform(code);
    expect(result.changed).toBe(true);

    if (result.code.includes("const after")) {
      const origOffset = offsetOf(code, "const after");
      const transOffset = offsetOf(result.code, "const after");
      const mapped = result.mapper.toOriginal(transOffset);
      expect(mapped, "code after template literal with emoji should map back").toBe(origOffset);
    }
  });
});

// ============================================================================
// Diagnostic positions with Unicode content
// ============================================================================

describe("diagnostic positions with Unicode content", () => {
  it("staticAssert error position is correct after emoji content", () => {
    const code = `import { staticAssert } from "typesugar";

const 🎉 = 1;
const 変数 = "hello 🌍";
staticAssert(false, "after unicode");
`;
    const result = transform(code);
    const errors = result.diagnostics.filter(
      (d) => d.severity === "error" && d.message.includes("after unicode")
    );
    expect(errors.length).toBeGreaterThan(0);

    const errorLine = lineAt(code, errors[0].start);
    const expectedLine = lineAt(code, offsetOf(code, "staticAssert(false"));
    expect(errorLine, "staticAssert error should be on correct line after emoji/CJK content").toBe(
      expectedLine
    );
  });

  it("macro error column is correct on line with CJK prefix", () => {
    const code = `import { staticAssert } from "typesugar";

const 変数 = 1;  staticAssert(false, "after CJK");
`;
    const result = transform(code);
    const errors = result.diagnostics.filter(
      (d) => d.severity === "error" && d.message.includes("after CJK")
    );
    expect(errors.length).toBeGreaterThan(0);

    // The error should point to "staticAssert", not to the CJK text before it
    const errorOffset = errors[0].start;
    const expectedOffset = offsetOf(code, "staticAssert(false");
    expect(errorOffset, "macro error offset should point to staticAssert call").toBe(
      expectedOffset
    );
  });
});

// ============================================================================
// .sts preprocessing with Unicode
// ============================================================================

describe("STS preprocessing with Unicode", () => {
  it("pipe operator with emoji in surrounding code maps correctly", () => {
    const code = `const 🎉 = 1;
const result = 42 |> ((n: number) => n + 1);
const 結果 = "done";
`;
    const result = transformSts(code);

    if (result.changed && result.code.includes("結果")) {
      const origOffset = offsetOf(code, "const 結果");
      const transOffset = offsetOf(result.code, "const 結果");
      const mapped = result.mapper.toOriginal(transOffset);
      expect(mapped, "CJK identifier after |> with emoji should map back").toBe(origOffset);
    }
  });
});
