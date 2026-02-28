/**
 * Red Team Tests for @typesugar/strings
 *
 * Attack surfaces:
 * - HTML XSS escaping bypass attempts
 * - Unicode handling (surrogate pairs, combining chars, emoji)
 * - Regex edge cases (ReDoS, empty patterns, special chars)
 * - JSON parsing edge cases (special numbers, deep nesting)
 * - Template literal edge cases (empty, backticks in strings)
 * - Raw string escape sequence handling
 */
import { describe, it, expect } from "vitest";
import { __typesugar_escapeHtml } from "@typesugar/strings";

describe("Strings Edge Cases", () => {
  // ==========================================================================
  // Attack 1: HTML XSS Escaping
  // ==========================================================================
  describe("HTML XSS Escaping", () => {
    it("escapes basic HTML special characters", () => {
      expect(__typesugar_escapeHtml("<script>alert('xss')</script>")).toBe(
        "&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;"
      );
    });

    it("escapes all five critical characters", () => {
      expect(__typesugar_escapeHtml("&")).toBe("&amp;");
      expect(__typesugar_escapeHtml("<")).toBe("&lt;");
      expect(__typesugar_escapeHtml(">")).toBe("&gt;");
      expect(__typesugar_escapeHtml('"')).toBe("&quot;");
      expect(__typesugar_escapeHtml("'")).toBe("&#039;");
    });

    it("handles double encoding attempts", () => {
      // Attacker tries: &lt; hoping it becomes < after double decode
      expect(__typesugar_escapeHtml("&lt;")).toBe("&amp;lt;");
      expect(__typesugar_escapeHtml("&amp;")).toBe("&amp;amp;");
    });

    it("handles unicode escapes that look like HTML", () => {
      // \u003C is < in unicode - should still be escaped
      const unicodeLt = "\u003C";
      expect(__typesugar_escapeHtml(unicodeLt)).toBe("&lt;");
    });

    it("handles null byte injection attempts", () => {
      // Null bytes can sometimes bypass filters
      expect(__typesugar_escapeHtml("foo\0<script>")).toBe("foo\0&lt;script&gt;");
    });

    it("converts non-string values to strings", () => {
      expect(__typesugar_escapeHtml(null)).toBe("null");
      expect(__typesugar_escapeHtml(undefined)).toBe("undefined");
      expect(__typesugar_escapeHtml(123)).toBe("123");
      expect(__typesugar_escapeHtml({ toString: () => "<bad>" })).toBe("&lt;bad&gt;");
    });

    it("handles mixed content with newlines", () => {
      const input = `<div>
        "Hello" & 'World'
      </div>`;
      const result = __typesugar_escapeHtml(input);
      expect(result).not.toContain("<");
      expect(result).not.toContain(">");
      expect(result).toContain("&lt;");
      expect(result).toContain("&gt;");
    });
  });

  // ==========================================================================
  // Attack 2: Unicode Edge Cases
  // ==========================================================================
  describe("Unicode Edge Cases", () => {
    it("preserves emoji in escaped output", () => {
      const emoji = "Hello 👋 World <script>";
      const result = __typesugar_escapeHtml(emoji);
      expect(result).toContain("👋");
      expect(result).toContain("&lt;script&gt;");
    });

    it("handles surrogate pairs correctly", () => {
      // 𝌆 is U+1D306 (requires surrogate pair in UTF-16)
      const tetragram = "𝌆";
      expect(tetragram.length).toBe(2); // surrogate pair
      expect(__typesugar_escapeHtml(tetragram)).toBe("𝌆");
    });

    it("handles combining characters", () => {
      // é can be e + combining acute accent
      const combining = "e\u0301"; // e + combining acute
      expect(__typesugar_escapeHtml(combining)).toBe("e\u0301");
    });

    it("handles zero-width characters", () => {
      const zeroWidth = "foo\u200Bbar"; // zero-width space
      expect(__typesugar_escapeHtml(zeroWidth)).toBe("foo\u200Bbar");

      // Zero-width joiner in emoji sequences
      const familyEmoji = "👨‍👩‍👧"; // family emoji with ZWJ
      expect(__typesugar_escapeHtml(familyEmoji)).toBe(familyEmoji);
    });

    it("handles right-to-left override characters", () => {
      // RLO can be used to visually disguise URLs
      const rlo = "\u202E<script>";
      const result = __typesugar_escapeHtml(rlo);
      expect(result).toContain("&lt;");
    });

    it("handles homoglyph attacks (lookalike chars)", () => {
      // Cyrillic 'а' looks like Latin 'a'
      const homoglyph = "<script>"; // Uses Cyrillic characters
      const result = __typesugar_escapeHtml(homoglyph);
      // Even with homoglyphs, < and > should be escaped
      expect(result).toContain("&lt;");
    });
  });

  // ==========================================================================
  // Attack 3: JSON Parsing Edge Cases
  // ==========================================================================
  describe("JSON Parsing Edge Cases", () => {
    it("handles special number values in JSON string context", () => {
      // These are valid JSON when properly formatted
      expect(() => JSON.parse('{"num": 1e308}')).not.toThrow();
      expect(() => JSON.parse('{"num": -1e308}')).not.toThrow();
    });

    it("rejects non-JSON number literals", () => {
      // NaN, Infinity are not valid JSON
      expect(() => JSON.parse('{"num": NaN}')).toThrow();
      expect(() => JSON.parse('{"num": Infinity}')).toThrow();
      expect(() => JSON.parse('{"num": -Infinity}')).toThrow();
    });

    it("handles deeply nested structures", () => {
      // Deeply nested JSON can cause stack overflow
      const depth = 100;
      let nested = '{"a":';
      for (let i = 0; i < depth; i++) {
        nested += '{"a":';
      }
      nested += "1";
      for (let i = 0; i <= depth; i++) {
        nested += "}";
      }
      // Should parse without throwing (100 levels is reasonable)
      expect(() => JSON.parse(nested)).not.toThrow();
    });

    it("handles unicode escapes in JSON strings", () => {
      const json = '{"text": "\\u003Cscript\\u003E"}';
      const parsed = JSON.parse(json);
      expect(parsed.text).toBe("<script>");
    });

    it("handles empty objects and arrays", () => {
      expect(JSON.parse("{}")).toEqual({});
      expect(JSON.parse("[]")).toEqual([]);
      expect(JSON.parse('{"a":[],"b":{}}')).toEqual({ a: [], b: {} });
    });

    it("rejects trailing commas (strict JSON)", () => {
      expect(() => JSON.parse('{"a": 1,}')).toThrow();
      expect(() => JSON.parse("[1,2,3,]")).toThrow();
    });

    it("handles JSON keys that need escaping", () => {
      const json = '{"<script>": "value", "key&key": "val"}';
      const parsed = JSON.parse(json);
      expect(parsed["<script>"]).toBe("value");
      expect(parsed["key&key"]).toBe("val");
    });

    it("handles very long strings", () => {
      const longString = "a".repeat(100000);
      const json = JSON.stringify({ text: longString });
      const parsed = JSON.parse(json);
      expect(parsed.text.length).toBe(100000);
    });
  });

  // ==========================================================================
  // Attack 4: Regex Edge Cases
  // ==========================================================================
  describe("Regex Edge Cases", () => {
    it("validates basic regex patterns", () => {
      expect(() => new RegExp("^test$")).not.toThrow();
      expect(() => new RegExp("[a-z]+")).not.toThrow();
      expect(() => new RegExp("\\d{3}")).not.toThrow();
    });

    it("rejects invalid regex patterns", () => {
      expect(() => new RegExp("[")).toThrow();
      expect(() => new RegExp("(")).toThrow();
      expect(() => new RegExp("\\")).toThrow();
      expect(() => new RegExp("*")).toThrow();
    });

    it("handles empty regex pattern", () => {
      const empty = new RegExp("");
      expect(empty.test("anything")).toBe(true);
      expect(empty.test("")).toBe(true);
    });

    it("identifies potential ReDoS patterns", () => {
      // These patterns have catastrophic backtracking potential
      // The macro should ideally warn about them, but at minimum shouldn't crash
      const redosPatterns = [
        "(a+)+$", // nested quantifiers
        "(a|a)+$", // alternation with overlap
        "([a-zA-Z]+)*$", // quantified group
      ];

      for (const pattern of redosPatterns) {
        expect(() => new RegExp(pattern)).not.toThrow();
      }
    });

    it("handles regex special characters", () => {
      // All regex metacharacters
      const meta = ".^$*+?{}[]\\|()";
      // Escaping each should work
      for (const char of meta) {
        expect(() => new RegExp("\\" + char)).not.toThrow();
      }
    });

    it("handles unicode in regex", () => {
      expect(new RegExp("😀").test("😀")).toBe(true);
      expect(new RegExp("\\u{1F600}", "u").test("😀")).toBe(true);
    });

    it("handles lookahead/lookbehind", () => {
      expect(() => new RegExp("(?=foo)")).not.toThrow();
      expect(() => new RegExp("(?!foo)")).not.toThrow();
      expect(() => new RegExp("(?<=foo)")).not.toThrow();
      expect(() => new RegExp("(?<!foo)")).not.toThrow();
    });
  });

  // ==========================================================================
  // Attack 5: Empty and Boundary Cases
  // ==========================================================================
  describe("Empty and Boundary Cases", () => {
    it("handles empty string input to escapeHtml", () => {
      expect(__typesugar_escapeHtml("")).toBe("");
    });

    it("handles whitespace-only strings", () => {
      expect(__typesugar_escapeHtml("   ")).toBe("   ");
      expect(__typesugar_escapeHtml("\t\n\r")).toBe("\t\n\r");
    });

    it("handles strings with only special characters", () => {
      expect(__typesugar_escapeHtml("<><>")).toBe("&lt;&gt;&lt;&gt;");
      expect(__typesugar_escapeHtml('"""')).toBe("&quot;&quot;&quot;");
    });

    it("handles very long strings efficiently", () => {
      const long = "<".repeat(10000);
      const start = performance.now();
      const result = __typesugar_escapeHtml(long);
      const elapsed = performance.now() - start;

      expect(result).toBe("&lt;".repeat(10000));
      // Should complete quickly (< 100ms even for 10k chars)
      expect(elapsed).toBeLessThan(100);
    });

    it("handles strings at character boundaries", () => {
      // Single character
      expect(__typesugar_escapeHtml("<")).toBe("&lt;");

      // Maximum safe integer as string
      expect(__typesugar_escapeHtml(Number.MAX_SAFE_INTEGER)).toBe("9007199254740991");
    });
  });

  // ==========================================================================
  // Attack 6: Template Literal Edge Cases
  // ==========================================================================
  describe("Template Literal Edge Cases", () => {
    it("handles template strings with backticks in content", () => {
      // Backticks inside template need escaping in source, but result is literal
      const withBacktick = "code: `const x = 1`";
      expect(__typesugar_escapeHtml(withBacktick)).toBe("code: `const x = 1`");
    });

    it("handles template strings with ${} that look like interpolation", () => {
      // Escaped interpolation syntax in a string literal
      const fakeInterp = "template: ${notActuallyInterpolated}";
      expect(__typesugar_escapeHtml(fakeInterp)).toBe("template: ${notActuallyInterpolated}");
    });

    it("handles nested quotes", () => {
      const nested = `"outer 'inner "nested" inner' outer"`;
      const result = __typesugar_escapeHtml(nested);
      expect(result).toContain("&quot;");
      expect(result).toContain("&#039;");
    });

    it("handles control characters", () => {
      // Bell, backspace, form feed
      const controls = "\x07\x08\x0C";
      expect(__typesugar_escapeHtml(controls)).toBe(controls);
    });

    it("handles strings with only escape sequences", () => {
      const escapes = "\n\t\r\\";
      expect(__typesugar_escapeHtml(escapes)).toBe("\n\t\r\\");
    });
  });
});
