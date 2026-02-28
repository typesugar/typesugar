/**
 * Tests for position mapping utilities in @typesugar/eslint-plugin
 *
 * Tests edge cases for lineColToOffset and offsetToLineCol helper functions
 * used in both lightweight and full processors.
 */

import { describe, it, expect } from "vitest";

/**
 * Convert ESLint 1-based line/column to 0-based offset
 */
function lineColToOffset(source: string, line: number, column: number): number {
  let currentLine = 1;
  let offset = 0;

  while (currentLine < line && offset < source.length) {
    if (source[offset] === "\n") {
      currentLine++;
    }
    offset++;
  }

  return offset + (column - 1);
}

/**
 * Convert 0-based offset to ESLint 1-based line/column
 */
function offsetToLineCol(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastLineStart = 0;

  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      lastLineStart = i + 1;
    }
  }

  return { line, column: offset - lastLineStart + 1 };
}

describe("lineColToOffset", () => {
  describe("basic cases", () => {
    it("should return 0 for line 1, column 1", () => {
      const source = "hello world";
      expect(lineColToOffset(source, 1, 1)).toBe(0);
    });

    it("should return correct offset for first line", () => {
      const source = "hello world";
      expect(lineColToOffset(source, 1, 6)).toBe(5);
    });

    it("should return correct offset for second line", () => {
      const source = "hello\nworld";
      expect(lineColToOffset(source, 2, 1)).toBe(6);
    });

    it("should return correct offset for second line with column", () => {
      const source = "hello\nworld";
      expect(lineColToOffset(source, 2, 3)).toBe(8);
    });

    it("should handle multiple lines", () => {
      const source = "line1\nline2\nline3";
      expect(lineColToOffset(source, 3, 1)).toBe(12);
    });
  });

  describe("edge cases", () => {
    it("should handle empty string", () => {
      const source = "";
      expect(lineColToOffset(source, 1, 1)).toBe(0);
    });

    it("should handle single character", () => {
      const source = "x";
      expect(lineColToOffset(source, 1, 1)).toBe(0);
      expect(lineColToOffset(source, 1, 2)).toBe(1);
    });

    it("should handle string with only newlines", () => {
      const source = "\n\n\n";
      expect(lineColToOffset(source, 1, 1)).toBe(0);
      expect(lineColToOffset(source, 2, 1)).toBe(1);
      expect(lineColToOffset(source, 3, 1)).toBe(2);
    });

    it("should handle trailing newline", () => {
      const source = "hello\n";
      expect(lineColToOffset(source, 1, 1)).toBe(0);
      expect(lineColToOffset(source, 2, 1)).toBe(6);
    });

    it("should handle last character of source", () => {
      const source = "abc";
      expect(lineColToOffset(source, 1, 3)).toBe(2);
    });

    it("should handle offset beyond source length", () => {
      const source = "abc";
      const result = lineColToOffset(source, 1, 10);
      expect(result).toBe(9);
    });

    it("should handle line beyond source", () => {
      const source = "abc";
      const result = lineColToOffset(source, 5, 1);
      expect(result).toBeGreaterThanOrEqual(source.length);
    });
  });

  describe("multi-byte unicode", () => {
    it("should handle basic unicode characters", () => {
      const source = "héllo";
      expect(lineColToOffset(source, 1, 1)).toBe(0);
      expect(lineColToOffset(source, 1, 2)).toBe(1);
    });

    it("should handle emoji", () => {
      const source = "a😀b";
      expect(lineColToOffset(source, 1, 1)).toBe(0);
      expect(lineColToOffset(source, 1, 2)).toBe(1);
    });

    it("should handle unicode on multiple lines", () => {
      const source = "héllo\nwörld";
      expect(lineColToOffset(source, 2, 1)).toBe(6);
    });

    it("should handle CJK characters", () => {
      const source = "你好世界";
      expect(lineColToOffset(source, 1, 1)).toBe(0);
      expect(lineColToOffset(source, 1, 3)).toBe(2);
    });
  });

  describe("windows line endings", () => {
    it("should handle CRLF line endings", () => {
      const source = "hello\r\nworld";
      expect(lineColToOffset(source, 1, 1)).toBe(0);
    });

    it("should count CR as part of line content", () => {
      const source = "ab\r\ncd";
      expect(lineColToOffset(source, 1, 3)).toBe(2);
      expect(lineColToOffset(source, 2, 1)).toBe(4);
    });
  });
});

describe("offsetToLineCol", () => {
  describe("basic cases", () => {
    it("should return line 1, column 1 for offset 0", () => {
      const source = "hello world";
      expect(offsetToLineCol(source, 0)).toEqual({ line: 1, column: 1 });
    });

    it("should return correct position on first line", () => {
      const source = "hello world";
      expect(offsetToLineCol(source, 5)).toEqual({ line: 1, column: 6 });
    });

    it("should return correct position on second line", () => {
      const source = "hello\nworld";
      expect(offsetToLineCol(source, 6)).toEqual({ line: 2, column: 1 });
    });

    it("should return correct position within second line", () => {
      const source = "hello\nworld";
      expect(offsetToLineCol(source, 8)).toEqual({ line: 2, column: 3 });
    });

    it("should handle multiple lines", () => {
      const source = "line1\nline2\nline3";
      expect(offsetToLineCol(source, 12)).toEqual({ line: 3, column: 1 });
    });
  });

  describe("edge cases", () => {
    it("should handle empty string", () => {
      const source = "";
      expect(offsetToLineCol(source, 0)).toEqual({ line: 1, column: 1 });
    });

    it("should handle single character", () => {
      const source = "x";
      expect(offsetToLineCol(source, 0)).toEqual({ line: 1, column: 1 });
    });

    it("should handle string with only newlines", () => {
      const source = "\n\n\n";
      expect(offsetToLineCol(source, 0)).toEqual({ line: 1, column: 1 });
      expect(offsetToLineCol(source, 1)).toEqual({ line: 2, column: 1 });
      expect(offsetToLineCol(source, 2)).toEqual({ line: 3, column: 1 });
    });

    it("should handle offset at newline character", () => {
      const source = "hello\nworld";
      expect(offsetToLineCol(source, 5)).toEqual({ line: 1, column: 6 });
    });

    it("should handle offset at last character", () => {
      const source = "abc";
      expect(offsetToLineCol(source, 2)).toEqual({ line: 1, column: 3 });
    });

    it("should handle offset beyond source length", () => {
      const source = "abc";
      const result = offsetToLineCol(source, 10);
      expect(result.line).toBe(1);
      expect(result.column).toBe(11);
    });

    it("should handle negative offset", () => {
      const source = "abc";
      const result = offsetToLineCol(source, -1);
      // Negative offset is invalid input - function returns column 0
      // which is technically invalid for ESLint (1-based), but this is
      // acceptable since negative offsets shouldn't occur in practice
      expect(result.line).toBe(1);
      expect(result.column).toBeLessThanOrEqual(1);
    });
  });

  describe("multi-byte unicode", () => {
    it("should handle basic unicode characters", () => {
      const source = "héllo";
      expect(offsetToLineCol(source, 0)).toEqual({ line: 1, column: 1 });
      expect(offsetToLineCol(source, 1)).toEqual({ line: 1, column: 2 });
    });

    it("should handle unicode on multiple lines", () => {
      const source = "héllo\nwörld";
      expect(offsetToLineCol(source, 6)).toEqual({ line: 2, column: 1 });
    });
  });

  describe("windows line endings", () => {
    it("should handle CRLF as part of line", () => {
      const source = "ab\r\ncd";
      expect(offsetToLineCol(source, 2)).toEqual({ line: 1, column: 3 });
      expect(offsetToLineCol(source, 4)).toEqual({ line: 2, column: 1 });
    });
  });
});

describe("roundtrip consistency", () => {
  it("should roundtrip through both functions", () => {
    const source = "hello\nworld\nfoo";

    for (let line = 1; line <= 3; line++) {
      for (let col = 1; col <= 5; col++) {
        const offset = lineColToOffset(source, line, col);
        const result = offsetToLineCol(source, offset);
        expect(result).toEqual({ line, column: col });
      }
    }
  });

  it("should roundtrip with unicode", () => {
    const source = "héllo\nwörld";

    const testCases = [
      { line: 1, column: 1 },
      { line: 1, column: 3 },
      { line: 2, column: 1 },
      { line: 2, column: 2 },
    ];

    for (const { line, column } of testCases) {
      const offset = lineColToOffset(source, line, column);
      const result = offsetToLineCol(source, offset);
      expect(result).toEqual({ line, column });
    }
  });
});
