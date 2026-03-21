/**
 * Tests for @typesugar/strings
 *
 * Tests the runtime helper functions, macro definitions, and runtime stubs.
 * Comprehensive edge case testing is in root-level tests/red-team-strings.test.ts.
 */

import { describe, it, expect } from "vitest";
import {
  __typesugar_escapeHtml,
  regex,
  html,
  fmt,
  raw,
  regexMacro,
  htmlMacro,
  fmtMacro,
  rawMacro,
  register,
  parseFormatString,
} from "../src/index.js";

describe("@typesugar/strings", () => {
  // ==========================================================================
  // Runtime Stub Tests
  // ==========================================================================

  describe("runtime stubs", () => {
    it("should export all runtime stub functions", () => {
      expect(typeof regex).toBe("function");
      expect(typeof html).toBe("function");
      expect(typeof fmt).toBe("function");
      expect(typeof raw).toBe("function");
    });

    it("regex stub should throw with helpful error message", () => {
      expect(() => regex`test`).toThrow("regex`...` was not transformed at compile time");
      expect(() => regex`test`).toThrow("typesugar transformer is configured");
    });

    it("html stub should throw with helpful error message", () => {
      expect(() => html`test`).toThrow("html`...` was not transformed at compile time");
      expect(() => html`test`).toThrow("typesugar transformer is configured");
    });

    it("fmt stub should throw with helpful error message", () => {
      expect(() => fmt`test`).toThrow("fmt`...` was not transformed at compile time");
      expect(() => fmt`test`).toThrow("typesugar transformer is configured");
    });

    it("raw stub should throw with helpful error message", () => {
      expect(() => raw`test`).toThrow("raw`...` was not transformed at compile time");
      expect(() => raw`test`).toThrow("typesugar transformer is configured");
    });

    it("stubs should throw with interpolated values too", () => {
      const value = "test";
      expect(() => html`<div>${value}</div>`).toThrow("html`...` was not transformed");
      expect(() => fmt`Hello ${value}`).toThrow("fmt`...` was not transformed");
      expect(() => raw`path/${value}/file`).toThrow("raw`...` was not transformed");
    });
  });

  // ==========================================================================
  // Macro Definition Tests
  // ==========================================================================

  describe("macro definitions", () => {
    it("should export all macro definitions", () => {
      expect(regexMacro).toBeDefined();
      expect(htmlMacro).toBeDefined();
      expect(fmtMacro).toBeDefined();
      expect(rawMacro).toBeDefined();
    });

    it("macros should have correct names", () => {
      expect(regexMacro.name).toBe("regex");
      expect(htmlMacro.name).toBe("html");
      expect(fmtMacro.name).toBe("fmt");
      expect(rawMacro.name).toBe("raw");
    });

    it("macros should have correct module", () => {
      expect(regexMacro.module).toBe("@typesugar/strings");
      expect(htmlMacro.module).toBe("@typesugar/strings");
      expect(fmtMacro.module).toBe("@typesugar/strings");
      expect(rawMacro.module).toBe("@typesugar/strings");
    });

    it("macros should have correct kind", () => {
      expect(regexMacro.kind).toBe("tagged-template");
      expect(htmlMacro.kind).toBe("tagged-template");
      expect(fmtMacro.kind).toBe("tagged-template");
      expect(rawMacro.kind).toBe("tagged-template");
    });

    it("macros should have expand functions", () => {
      expect(typeof regexMacro.expand).toBe("function");
      expect(typeof htmlMacro.expand).toBe("function");
      expect(typeof fmtMacro.expand).toBe("function");
      expect(typeof rawMacro.expand).toBe("function");
    });

    it("macros should have descriptions", () => {
      expect(regexMacro.description).toContain("regular expression");
      expect(htmlMacro.description).toContain("XSS");
      expect(fmtMacro.description).toContain("formatting");
      expect(rawMacro.description).toContain("escape");
    });
  });

  // ==========================================================================
  // Register Function Tests
  // ==========================================================================

  describe("register function", () => {
    it("should export register function", () => {
      expect(typeof register).toBe("function");
    });

    it("register should be idempotent", () => {
      expect(() => {
        register();
        register();
        register();
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // HTML Escape Helper Tests
  // ==========================================================================

  describe("HTML escape helper (__typesugar_escapeHtml)", () => {
    it("should be exported", () => {
      expect(typeof __typesugar_escapeHtml).toBe("function");
    });

    it("escapes & to &amp;", () => {
      expect(__typesugar_escapeHtml("&")).toBe("&amp;");
    });

    it("escapes < to &lt;", () => {
      expect(__typesugar_escapeHtml("<")).toBe("&lt;");
    });

    it("escapes > to &gt;", () => {
      expect(__typesugar_escapeHtml(">")).toBe("&gt;");
    });

    it('escapes " to &quot;', () => {
      expect(__typesugar_escapeHtml('"')).toBe("&quot;");
    });

    it("escapes ' to &#039;", () => {
      expect(__typesugar_escapeHtml("'")).toBe("&#039;");
    });

    it("escapes all special characters in a string", () => {
      expect(__typesugar_escapeHtml('<script>alert("xss")</script>')).toBe(
        "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
      );
    });

    it("handles empty string", () => {
      expect(__typesugar_escapeHtml("")).toBe("");
    });

    it("handles non-string values by converting to string", () => {
      expect(__typesugar_escapeHtml(42)).toBe("42");
      expect(__typesugar_escapeHtml(null)).toBe("null");
      expect(__typesugar_escapeHtml(undefined)).toBe("undefined");
      expect(__typesugar_escapeHtml(true)).toBe("true");
      expect(__typesugar_escapeHtml(false)).toBe("false");
    });

    it("preserves safe characters", () => {
      expect(__typesugar_escapeHtml("hello world")).toBe("hello world");
      expect(__typesugar_escapeHtml("123")).toBe("123");
      expect(__typesugar_escapeHtml("foo@bar.com")).toBe("foo@bar.com");
    });

    it("handles repeated escapes correctly", () => {
      expect(__typesugar_escapeHtml("&lt;")).toBe("&amp;lt;");
      expect(__typesugar_escapeHtml("&amp;")).toBe("&amp;amp;");
    });

    it("handles mixed content", () => {
      expect(__typesugar_escapeHtml("Hello <b>World</b> & 'Friends'")).toBe(
        "Hello &lt;b&gt;World&lt;/b&gt; &amp; &#039;Friends&#039;"
      );
    });
  });

  // ==========================================================================
  // Package Structure Tests
  // ==========================================================================

  describe("package exports", () => {
    it("should export all expected symbols", async () => {
      const exports = await import("../src/index.js");

      // Runtime stubs
      expect(exports.regex).toBeDefined();
      expect(exports.html).toBeDefined();
      expect(exports.fmt).toBeDefined();
      expect(exports.raw).toBeDefined();

      // Macro definitions
      expect(exports.regexMacro).toBeDefined();
      expect(exports.htmlMacro).toBeDefined();
      expect(exports.fmtMacro).toBeDefined();
      expect(exports.rawMacro).toBeDefined();

      // Register function
      expect(exports.register).toBeDefined();

      // Runtime helper
      expect(exports.__typesugar_escapeHtml).toBeDefined();

      // Format string parser
      expect(exports.parseFormatString).toBeDefined();
      expect(exports.applyFormatSpecifier).toBeDefined();
    });
  });

  // ==========================================================================
  // parseFormatString Tests
  // ==========================================================================

  describe("parseFormatString", () => {
    it("should parse plain text as a single literal", () => {
      const result = parseFormatString("hello world");
      expect(result).toEqual([{ type: "literal", value: "hello world" }]);
    });

    it("should parse %d as a format specifier", () => {
      const result = parseFormatString("value: %d");
      expect(result).toEqual([
        { type: "literal", value: "value: " },
        { type: "format", value: "%d" },
      ]);
    });

    it("should parse %i as a format specifier", () => {
      const result = parseFormatString("%i");
      expect(result).toEqual([{ type: "format", value: "%i" }]);
    });

    it("should parse %f as a format specifier", () => {
      const result = parseFormatString("%f");
      expect(result).toEqual([{ type: "format", value: "%f" }]);
    });

    it("should parse %s as a format specifier", () => {
      const result = parseFormatString("name: %s");
      expect(result).toEqual([
        { type: "literal", value: "name: " },
        { type: "format", value: "%s" },
      ]);
    });

    it("should parse %x as hex format specifier", () => {
      const result = parseFormatString("hex: %x");
      expect(result).toEqual([
        { type: "literal", value: "hex: " },
        { type: "format", value: "%x" },
      ]);
    });

    it("should parse %o as octal format specifier", () => {
      const result = parseFormatString("%o");
      expect(result).toEqual([{ type: "format", value: "%o" }]);
    });

    it("should parse %b as binary format specifier", () => {
      const result = parseFormatString("%b");
      expect(result).toEqual([{ type: "format", value: "%b" }]);
    });

    it("should parse %% as a literal percent sign", () => {
      const result = parseFormatString("100%%");
      expect(result).toEqual([{ type: "literal", value: "100%" }]);
    });

    it("should parse %.2f as precision format specifier", () => {
      const result = parseFormatString("price: %.2f");
      expect(result).toEqual([
        { type: "literal", value: "price: " },
        { type: "format", value: "%.2f" },
      ]);
    });

    it("should parse %.0f as zero-precision format specifier", () => {
      const result = parseFormatString("%.0f");
      expect(result).toEqual([{ type: "format", value: "%.0f" }]);
    });

    it("should parse %.10f as high-precision format specifier", () => {
      const result = parseFormatString("%.10f");
      expect(result).toEqual([{ type: "format", value: "%.10f" }]);
    });

    it("should parse multiple specifiers in sequence", () => {
      const result = parseFormatString("x=%d, y=%d");
      expect(result).toEqual([
        { type: "literal", value: "x=" },
        { type: "format", value: "%d" },
        { type: "literal", value: ", y=" },
        { type: "format", value: "%d" },
      ]);
    });

    it("should handle %% mixed with other specifiers", () => {
      const result = parseFormatString("100%% of %d");
      expect(result).toEqual([
        { type: "literal", value: "100% of " },
        { type: "format", value: "%d" },
      ]);
    });

    it("should treat unrecognized % sequences as literals", () => {
      const result = parseFormatString("%z");
      expect(result).toEqual([{ type: "literal", value: "%z" }]);
    });

    it("should handle empty string", () => {
      const result = parseFormatString("");
      expect(result).toEqual([]);
    });

    it("should handle trailing percent with no following char", () => {
      const result = parseFormatString("test%");
      expect(result).toEqual([{ type: "literal", value: "test%" }]);
    });
  });

  // ==========================================================================
  // fmt Macro Format Specifier Integration Tests
  // ==========================================================================

  describe("fmt macro format specifier code generation", () => {
    // These tests verify the macro definition structure for format specifiers.
    // Full end-to-end transform tests live in the transformer tests.

    it("fmtMacro expand function should be defined", () => {
      expect(typeof fmtMacro.expand).toBe("function");
    });

    it("parseFormatString should correctly split mixed format strings", () => {
      // Simulating: fmt`Item %s${name} costs $%.2f${price} (%d${count} in stock)`
      // The literal before each interpolation is parsed for trailing specifiers.

      const head = parseFormatString("Item %s");
      expect(head).toEqual([
        { type: "literal", value: "Item " },
        { type: "format", value: "%s" },
      ]);

      const mid1 = parseFormatString(" costs $%.2f");
      expect(mid1).toEqual([
        { type: "literal", value: " costs $" },
        { type: "format", value: "%.2f" },
      ]);

      const mid2 = parseFormatString(" (%d");
      expect(mid2).toEqual([
        { type: "literal", value: " (" },
        { type: "format", value: "%d" },
      ]);

      const tail = parseFormatString(" in stock)");
      expect(tail).toEqual([{ type: "literal", value: " in stock)" }]);
    });

    it("should handle hex, octal, and binary specifiers in parse", () => {
      expect(parseFormatString("0x%x")).toEqual([
        { type: "literal", value: "0x" },
        { type: "format", value: "%x" },
      ]);
      expect(parseFormatString("0o%o")).toEqual([
        { type: "literal", value: "0o" },
        { type: "format", value: "%o" },
      ]);
      expect(parseFormatString("0b%b")).toEqual([
        { type: "literal", value: "0b" },
        { type: "format", value: "%b" },
      ]);
    });

    it("should handle escaped percent signs in format strings", () => {
      const parts = parseFormatString("Loading: %d%% complete");
      expect(parts).toEqual([
        { type: "literal", value: "Loading: " },
        { type: "format", value: "%d" },
        { type: "literal", value: "% complete" },
      ]);
    });
  });
});
