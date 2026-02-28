/**
 * Tests for @typesugar/strings
 *
 * Tests the runtime helper functions and macro definitions.
 * Comprehensive edge case testing is in root-level tests/red-team-strings.test.ts.
 */

import { describe, it, expect } from "vitest";
import { __typesugar_escapeHtml } from "../src/index.js";

describe("@typesugar/strings", () => {
  describe("HTML escape helper (__typesugar_escapeHtml)", () => {
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
    });

    it("preserves safe characters", () => {
      expect(__typesugar_escapeHtml("hello world")).toBe("hello world");
      expect(__typesugar_escapeHtml("123")).toBe("123");
    });

    it("handles repeated escapes correctly", () => {
      expect(__typesugar_escapeHtml("&lt;")).toBe("&amp;lt;");
    });
  });

  describe("macro exports", () => {
    it("should export all macro definitions", async () => {
      const exports = await import("../src/index.js");
      expect(exports.regexMacro).toBeDefined();
      expect(exports.htmlMacro).toBeDefined();
      expect(exports.fmtMacro).toBeDefined();
      expect(exports.jsonMacro).toBeDefined();
      expect(exports.rawMacro).toBeDefined();
    });

    it("macros should have correct names", async () => {
      const { regexMacro, htmlMacro, fmtMacro, jsonMacro, rawMacro } = await import(
        "../src/index.js"
      );
      expect(regexMacro.name).toBe("regex");
      expect(htmlMacro.name).toBe("html");
      expect(fmtMacro.name).toBe("fmt");
      expect(jsonMacro.name).toBe("json");
      expect(rawMacro.name).toBe("raw");
    });

    it("macros should have expand functions", async () => {
      const { regexMacro, htmlMacro, fmtMacro, jsonMacro, rawMacro } = await import(
        "../src/index.js"
      );
      expect(typeof regexMacro.expand).toBe("function");
      expect(typeof htmlMacro.expand).toBe("function");
      expect(typeof fmtMacro.expand).toBe("function");
      expect(typeof jsonMacro.expand).toBe("function");
      expect(typeof rawMacro.expand).toBe("function");
    });
  });

  describe("register function", () => {
    it("should export register function", async () => {
      const { register } = await import("../src/index.js");
      expect(typeof register).toBe("function");
    });

    it("register should be idempotent", async () => {
      const { register } = await import("../src/index.js");
      expect(() => {
        register();
        register();
        register();
      }).not.toThrow();
    });
  });
});
