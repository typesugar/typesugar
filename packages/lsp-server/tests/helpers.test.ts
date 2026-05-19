/**
 * Unit tests for exported helper functions in the LSP server.
 * Covers fixes #1, #2, #12 from the code review.
 */

import { describe, it, expect } from "vitest";
import {
  offsetToPosition,
  positionToOffset,
  uriToFileName,
  fileNameToUri,
} from "../src/helpers.js";

// ---------------------------------------------------------------------------
// fix #1 / #2: URI ↔ fileName conversion (using vscode-uri)
// ---------------------------------------------------------------------------

describe("uriToFileName", () => {
  it("converts a basic file:// URI to a file path", () => {
    const result = uriToFileName("file:///Users/test/file.ts");
    expect(result).toBe("/Users/test/file.ts");
  });

  it("decodes percent-encoded characters in URI", () => {
    const result = uriToFileName("file:///Users/test/my%20file.ts");
    expect(result).toBe("/Users/test/my file.ts");
  });

  it("handles URI with hash characters in path", () => {
    const result = uriToFileName("file:///Users/test/%23temp/file.ts");
    expect(result).toBe("/Users/test/#temp/file.ts");
  });

  it("handles URI with question mark in path", () => {
    const result = uriToFileName("file:///Users/test/%3Fwhat/file.ts");
    expect(result).toBe("/Users/test/?what/file.ts");
  });
});

describe("fileNameToUri", () => {
  it("converts a basic file path to a file:// URI", () => {
    const result = fileNameToUri("/Users/test/file.ts");
    expect(result).toBe("file:///Users/test/file.ts");
  });

  it("encodes spaces in file path", () => {
    const result = fileNameToUri("/Users/test/my file.ts");
    expect(result).toContain("my%20file.ts");
  });

  it("encodes hash characters in file path", () => {
    const result = fileNameToUri("/Users/test/#temp/file.ts");
    expect(result).toContain("%23temp");
  });

  it("round-trips: uriToFileName(fileNameToUri(path)) === path", () => {
    const paths = [
      "/Users/test/file.ts",
      "/Users/test/my file.ts",
      "/Users/test/#temp/file.ts",
      "/Users/test/path with spaces/and (parens)/file.ts",
    ];
    for (const p of paths) {
      expect(uriToFileName(fileNameToUri(p))).toBe(p);
    }
  });
});

// ---------------------------------------------------------------------------
// fix #12: offsetToPosition and positionToOffset clamping
// ---------------------------------------------------------------------------

describe("offsetToPosition", () => {
  const text = "hello\nworld\nfoo";

  it("converts offset 0 to line 0, character 0", () => {
    expect(offsetToPosition(text, 0)).toEqual({ line: 0, character: 0 });
  });

  it("converts offset within first line", () => {
    expect(offsetToPosition(text, 3)).toEqual({ line: 0, character: 3 });
  });

  it("converts offset at start of second line", () => {
    // "hello\n" is 6 chars, so offset 6 is start of "world"
    expect(offsetToPosition(text, 6)).toEqual({ line: 1, character: 0 });
  });

  it("converts offset within second line", () => {
    expect(offsetToPosition(text, 8)).toEqual({ line: 1, character: 2 });
  });

  it("converts offset at start of third line", () => {
    // "hello\nworld\n" is 12 chars
    expect(offsetToPosition(text, 12)).toEqual({ line: 2, character: 0 });
  });

  it("converts offset at end of text", () => {
    // text length is 15 ("hello\nworld\nfoo")
    expect(offsetToPosition(text, 15)).toEqual({ line: 2, character: 3 });
  });

  it("clamps negative offset to 0", () => {
    expect(offsetToPosition(text, -5)).toEqual({ line: 0, character: 0 });
  });

  it("clamps offset beyond text length", () => {
    // Should clamp to text.length, which is end of "foo"
    expect(offsetToPosition(text, 100)).toEqual({ line: 2, character: 3 });
  });

  it("handles empty text", () => {
    expect(offsetToPosition("", 0)).toEqual({ line: 0, character: 0 });
    expect(offsetToPosition("", 5)).toEqual({ line: 0, character: 0 });
  });
});

describe("positionToOffset", () => {
  const text = "hello\nworld\nfoo";

  it("converts line 0, character 0 to offset 0", () => {
    expect(positionToOffset(text, { line: 0, character: 0 })).toBe(0);
  });

  it("converts position within first line", () => {
    expect(positionToOffset(text, { line: 0, character: 3 })).toBe(3);
  });

  it("converts position at start of second line", () => {
    expect(positionToOffset(text, { line: 1, character: 0 })).toBe(6);
  });

  it("converts position within second line", () => {
    expect(positionToOffset(text, { line: 1, character: 2 })).toBe(8);
  });

  it("converts position at start of third line", () => {
    expect(positionToOffset(text, { line: 2, character: 0 })).toBe(12);
  });

  it("clamps character beyond line length to end of line", () => {
    // First line is "hello" (5 chars), requesting char 100 should clamp to offset 5 (the \n position)
    expect(positionToOffset(text, { line: 0, character: 100 })).toBe(5);
  });

  it("clamps character beyond last line length to end of text", () => {
    // Last line is "foo" (3 chars), requesting char 100 should clamp to offset 15
    expect(positionToOffset(text, { line: 2, character: 100 })).toBe(15);
  });

  it("returns text.length for line beyond text", () => {
    expect(positionToOffset(text, { line: 10, character: 0 })).toBe(text.length);
  });

  it("handles empty text", () => {
    expect(positionToOffset("", { line: 0, character: 0 })).toBe(0);
    expect(positionToOffset("", { line: 5, character: 5 })).toBe(0);
  });

  it("round-trips with offsetToPosition", () => {
    const offsets = [0, 3, 5, 6, 8, 11, 12, 14, 15];
    for (const offset of offsets) {
      const pos = offsetToPosition(text, offset);
      expect(positionToOffset(text, pos)).toBe(offset);
    }
  });
});

// ---------------------------------------------------------------------------
// PEP-039 Wave 5 — CRLF / line-ending edge cases
// Locks in PEP-039 Wave 1 fix: positionToOffset / offsetToPosition must not
// double-count the \r in a \r\n sequence.
// ---------------------------------------------------------------------------

describe("CRLF line endings (PEP-039 Wave 1 regression)", () => {
  it("positionToOffset: line 1 char 0 in 'a\\r\\nb' returns offset after \\r\\n", () => {
    // Wave 1 fix: the previous implementation could double-count \r causing
    // off-by-one. "a\r\nb" has b at offset 3.
    expect(positionToOffset("a\r\nb", { line: 1, character: 0 })).toBe(3);
  });

  it("offsetToPosition: offset of 'b' in 'a\\r\\nb' returns line 1 char 0", () => {
    // Wave 1 fix regression: 'b' is at offset 3, must map to { 1, 0 } not { 1, 1 }.
    expect(offsetToPosition("a\r\nb", 3)).toEqual({ line: 1, character: 0 });
  });

  it("CRLF round-trip stays stable across offsets", () => {
    const text = "a\r\nb\r\nc";
    // valid offsets: 0=a, 3=b, 6=c, 7=eof
    for (const off of [0, 1, 3, 4, 6, 7]) {
      const pos = offsetToPosition(text, off);
      expect(positionToOffset(text, pos)).toBe(off);
    }
  });

  it("CRLF: character on line 1 maps correctly (no shift from \\r)", () => {
    // "x\r\nyz" — 'z' is at offset 4, line 1 char 1.
    expect(positionToOffset("x\r\nyz", { line: 1, character: 1 })).toBe(4);
    expect(offsetToPosition("x\r\nyz", 4)).toEqual({ line: 1, character: 1 });
  });

  it("mixed LF + CRLF in one file: line counts stay correct", () => {
    // a\nb\r\nc\nd — lines are: "a","b","c","d"
    // offsets: 0=a, 2=b, 5=c, 7=d
    const text = "a\nb\r\nc\nd";
    expect(positionToOffset(text, { line: 0, character: 0 })).toBe(0);
    expect(positionToOffset(text, { line: 1, character: 0 })).toBe(2);
    expect(positionToOffset(text, { line: 2, character: 0 })).toBe(5);
    expect(positionToOffset(text, { line: 3, character: 0 })).toBe(7);
    expect(offsetToPosition(text, 7)).toEqual({ line: 3, character: 0 });
  });

  it("mixed line endings: offset -> pos -> offset round-trips at line-content offsets", () => {
    // Round-trip holds for offsets that point at line content or the start of
    // a line. Offsets that land on a '\n' that is part of a \r\n pair
    // intentionally clamp back to the position just before the \r — that
    // asymmetry is documented (positionToOffset excludes the \r from the line
    // while offsetToPosition counts it as a character on the line).
    const text = "abc\ndef\r\nghi\njkl";
    // Valid line-content offsets: skip offset 8 (the \n in \r\n).
    const offsets = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16];
    for (const i of offsets) {
      const pos = offsetToPosition(text, i);
      expect(positionToOffset(text, pos)).toBe(i);
    }
  });

  it("lone \\r without \\n is treated as line content, not terminator", () => {
    // Mac classic \r-only is rare in modern text; we document that the helpers
    // treat lone \r as part of line content (no line break). This is the
    // observed behavior we lock in until LSP spec or callers require otherwise.
    expect(offsetToPosition("a\rb", 2)).toEqual({ line: 0, character: 2 });
    expect(positionToOffset("a\rb", { line: 0, character: 2 })).toBe(2);
  });

  it("empty file: position (0,0) and offset 0 round-trip", () => {
    expect(offsetToPosition("", 0)).toEqual({ line: 0, character: 0 });
    expect(positionToOffset("", { line: 0, character: 0 })).toBe(0);
  });

  it("single \\n: position (1,0) maps to offset 1", () => {
    expect(positionToOffset("\n", { line: 1, character: 0 })).toBe(1);
    expect(offsetToPosition("\n", 1)).toEqual({ line: 1, character: 0 });
  });

  it("single \\r\\n: position (1,0) maps to offset 2 (after CRLF)", () => {
    // Wave 1 regression: \r\n is ONE line break, not two — line 1 starts at offset 2.
    expect(positionToOffset("\r\n", { line: 1, character: 0 })).toBe(2);
    expect(offsetToPosition("\r\n", 2)).toEqual({ line: 1, character: 0 });
  });
});

// ---------------------------------------------------------------------------
// PEP-039 Wave 5 — UTF-16 surrogate pair handling
// LSP spec uses UTF-16 code units for `character`. New coverage.
// ---------------------------------------------------------------------------

describe("UTF-16 surrogate pair handling (LSP spec)", () => {
  // 𝟘 = U+1D7D8 (MATHEMATICAL DOUBLE-STRUCK ZERO), a surrogate pair (2 UTF-16 units).
  const surrogate = "𝟘";

  it("single surrogate pair: string length is 2 UTF-16 code units", () => {
    // sanity check: confirms test assumption
    expect(surrogate.length).toBe(2);
  });

  it("offsetToPosition counts UTF-16 code units across surrogate pairs", () => {
    const text = `${surrogate}b`; // 3 UTF-16 units
    expect(offsetToPosition(text, 2)).toEqual({ line: 0, character: 2 });
    expect(offsetToPosition(text, 3)).toEqual({ line: 0, character: 3 });
  });

  it("positionToOffset counts UTF-16 code units across surrogate pairs", () => {
    const text = `${surrogate}b`;
    expect(positionToOffset(text, { line: 0, character: 2 })).toBe(2);
    expect(positionToOffset(text, { line: 0, character: 3 })).toBe(3);
  });

  it("surrogate pair on second line", () => {
    const text = `a\n${surrogate}b`;
    // line 1: "𝟘b", offsets 2,3,4 = surr-high, surr-low, b
    expect(positionToOffset(text, { line: 1, character: 0 })).toBe(2);
    expect(positionToOffset(text, { line: 1, character: 2 })).toBe(4);
    expect(offsetToPosition(text, 4)).toEqual({ line: 1, character: 2 });
  });

  it("surrogate pair round-trip on every code-unit boundary", () => {
    const text = `${surrogate}\n${surrogate}`;
    for (let i = 0; i <= text.length; i++) {
      const pos = offsetToPosition(text, i);
      expect(positionToOffset(text, pos)).toBe(i);
    }
  });
});

// ---------------------------------------------------------------------------
// PEP-039 Wave 5 — Additional boundary / clamping / stress coverage.
// New coverage for cases not in original suite.
// ---------------------------------------------------------------------------

describe("Boundary clamping and edge cases (extended)", () => {
  it("position past EOF returns text length", () => {
    const text = "abc";
    expect(positionToOffset(text, { line: 100, character: 100 })).toBe(text.length);
  });

  it("character clamped on empty line (between two \\n)", () => {
    // text: "a\n\nb" — line 1 is empty
    const text = "a\n\nb";
    expect(positionToOffset(text, { line: 1, character: 0 })).toBe(2);
    expect(positionToOffset(text, { line: 1, character: 50 })).toBe(2);
    expect(offsetToPosition(text, 2)).toEqual({ line: 1, character: 0 });
  });

  it("negative offset clamps to 0", () => {
    expect(offsetToPosition("hello", -1)).toEqual({ line: 0, character: 0 });
    expect(offsetToPosition("hello", -100)).toEqual({ line: 0, character: 0 });
  });

  it("offset at exact text length returns position at end", () => {
    const text = "abc\ndef";
    expect(offsetToPosition(text, text.length)).toEqual({ line: 1, character: 3 });
  });

  it("long-line stress: 10K-character single line stays accurate", () => {
    const longLine = "x".repeat(10_000);
    expect(positionToOffset(longLine, { line: 0, character: 5_000 })).toBe(5_000);
    expect(offsetToPosition(longLine, 5_000)).toEqual({ line: 0, character: 5_000 });
    expect(offsetToPosition(longLine, 9_999)).toEqual({ line: 0, character: 9_999 });
    expect(positionToOffset(longLine, { line: 0, character: 10_000 })).toBe(10_000);
  });

  it("long-line stress: \\n followed by 10K chars", () => {
    const text = `a\n${"x".repeat(10_000)}`;
    expect(positionToOffset(text, { line: 1, character: 9_999 })).toBe(2 + 9_999);
    expect(offsetToPosition(text, 2 + 9_999)).toEqual({ line: 1, character: 9_999 });
  });

  it("trailing newline: position on the empty trailing line", () => {
    const text = "abc\n";
    // line 1 starts at offset 4 and is empty
    expect(positionToOffset(text, { line: 1, character: 0 })).toBe(4);
    expect(offsetToPosition(text, 4)).toEqual({ line: 1, character: 0 });
  });
});
