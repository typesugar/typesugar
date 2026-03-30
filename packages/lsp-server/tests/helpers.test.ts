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
