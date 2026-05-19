/**
 * PEP-039 Wave 5 — position-helpers edge cases.
 *
 * Locks in PEP-039 Wave 1 fixes for the shared lsp-common position helpers
 * (used by both the LSP server and the TS plugin). These helpers are the
 * source of truth for byte-offset ↔ line/character conversion and must
 * handle CRLF, surrogate pairs, and boundary clamping correctly.
 */

import { describe, it, expect } from "vitest";
import { offsetToPosition, positionToOffset } from "../src/position-helpers.js";

// ---------------------------------------------------------------------------
// CRLF / \r\n regression (PEP-039 Wave 1)
// ---------------------------------------------------------------------------

describe("position-helpers — CRLF regression (Wave 1)", () => {
  it("positionToOffset('a\\r\\nb', {1,0}) returns offset after \\r\\n", () => {
    // Wave 1 fix: do not double-count the \r before the \n.
    expect(positionToOffset("a\r\nb", { line: 1, character: 0 })).toBe(3);
  });

  it("offsetToPosition('a\\r\\nb', offset_of_b) returns {1,0}", () => {
    expect(offsetToPosition("a\r\nb", 3)).toEqual({ line: 1, character: 0 });
  });

  it("CRLF: position on line 1 with non-zero character", () => {
    expect(positionToOffset("x\r\nyz", { line: 1, character: 1 })).toBe(4);
    expect(offsetToPosition("x\r\nyz", 4)).toEqual({ line: 1, character: 1 });
  });

  it("CRLF round-trip across all valid character offsets", () => {
    const text = "ab\r\ncd\r\nef";
    // valid char offsets (skip mid-\r\n indices): 0,1,2,4,5,6,8,9,10
    for (const off of [0, 1, 2, 4, 5, 6, 8, 9, 10]) {
      const pos = offsetToPosition(text, off);
      expect(positionToOffset(text, pos)).toBe(off);
    }
  });

  it("mixed LF + CRLF: line counts stay correct", () => {
    // "a\nb\r\nc\nd" — line offsets: 0, 2, 5, 7
    const text = "a\nb\r\nc\nd";
    expect(positionToOffset(text, { line: 0, character: 0 })).toBe(0);
    expect(positionToOffset(text, { line: 1, character: 0 })).toBe(2);
    expect(positionToOffset(text, { line: 2, character: 0 })).toBe(5);
    expect(positionToOffset(text, { line: 3, character: 0 })).toBe(7);
  });

  it("lone \\r is treated as line content (Mac classic, not split)", () => {
    // Documented behavior: lone \r is NOT a line terminator in these helpers.
    expect(offsetToPosition("a\rb", 2)).toEqual({ line: 0, character: 2 });
    expect(positionToOffset("a\rb", { line: 0, character: 2 })).toBe(2);
  });

  it("empty file: round-trip at (0,0)", () => {
    expect(offsetToPosition("", 0)).toEqual({ line: 0, character: 0 });
    expect(positionToOffset("", { line: 0, character: 0 })).toBe(0);
  });

  it("single '\\n': line 1 starts at offset 1", () => {
    expect(positionToOffset("\n", { line: 1, character: 0 })).toBe(1);
    expect(offsetToPosition("\n", 1)).toEqual({ line: 1, character: 0 });
  });

  it("single '\\r\\n': line 1 starts at offset 2", () => {
    // Wave 1 regression: \r\n is one line break, not two.
    expect(positionToOffset("\r\n", { line: 1, character: 0 })).toBe(2);
    expect(offsetToPosition("\r\n", 2)).toEqual({ line: 1, character: 0 });
  });
});

// ---------------------------------------------------------------------------
// UTF-16 surrogate pair handling (LSP spec uses UTF-16 code units)
// ---------------------------------------------------------------------------

describe("position-helpers — UTF-16 surrogate pairs", () => {
  // 𝟘 = U+1D7D8 = 2 UTF-16 code units.
  const surrogate = "𝟘";

  it("surrogate pair string has length 2 in UTF-16", () => {
    expect(surrogate.length).toBe(2);
  });

  it("offsetToPosition counts UTF-16 units across surrogate pair", () => {
    const text = `${surrogate}b`;
    expect(offsetToPosition(text, 2)).toEqual({ line: 0, character: 2 });
    expect(offsetToPosition(text, 3)).toEqual({ line: 0, character: 3 });
  });

  it("positionToOffset counts UTF-16 units across surrogate pair", () => {
    const text = `${surrogate}b`;
    expect(positionToOffset(text, { line: 0, character: 2 })).toBe(2);
    expect(positionToOffset(text, { line: 0, character: 3 })).toBe(3);
  });

  it("surrogate pair on later line", () => {
    const text = `a\n${surrogate}b`;
    expect(positionToOffset(text, { line: 1, character: 0 })).toBe(2);
    expect(positionToOffset(text, { line: 1, character: 2 })).toBe(4);
    expect(offsetToPosition(text, 4)).toEqual({ line: 1, character: 2 });
  });
});

// ---------------------------------------------------------------------------
// Boundary clamping (extends existing coverage to the shared package)
// ---------------------------------------------------------------------------

describe("position-helpers — boundary clamping", () => {
  it("negative offset clamps to 0", () => {
    expect(offsetToPosition("abc", -10)).toEqual({ line: 0, character: 0 });
  });

  it("offset beyond EOF clamps to text length", () => {
    const text = "abc\ndef";
    expect(offsetToPosition(text, 1000)).toEqual({ line: 1, character: 3 });
  });

  it("position past EOF returns text length", () => {
    expect(positionToOffset("abc\ndef", { line: 99, character: 99 })).toBe(7);
  });

  it("character beyond line length clamps to end of line", () => {
    const text = "hello\nworld";
    expect(positionToOffset(text, { line: 0, character: 999 })).toBe(5);
    expect(positionToOffset(text, { line: 1, character: 999 })).toBe(11);
  });

  it("long line stress: 10K characters", () => {
    const text = "z".repeat(10_000);
    expect(positionToOffset(text, { line: 0, character: 5_000 })).toBe(5_000);
    expect(offsetToPosition(text, 9_999)).toEqual({ line: 0, character: 9_999 });
  });
});
