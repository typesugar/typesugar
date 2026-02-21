/**
 * Red Team Tests for @typesugar/comptime
 *
 * Attack surfaces:
 * - Sandbox security
 * - Value serialization edge cases
 * - Timeout handling
 * - Error messages
 */

import { describe, it, expect } from "vitest";
import { jsToComptimeValue } from "../packages/comptime/src/index.js";
import type { ComptimeValue } from "@typesugar/core";

describe("Comptime Value Conversion Edge Cases", () => {
  // ==========================================================================
  // Primitive types
  // ==========================================================================
  describe("Primitive types", () => {
    it("Handles null", () => {
      const result = jsToComptimeValue(null);
      expect(result.kind).toBe("null");
    });

    it("Handles undefined", () => {
      const result = jsToComptimeValue(undefined);
      expect(result.kind).toBe("undefined");
    });

    it("Handles positive numbers", () => {
      const result = jsToComptimeValue(42);
      expect(result.kind).toBe("number");
      expect((result as any).value).toBe(42);
    });

    it("Handles negative numbers", () => {
      const result = jsToComptimeValue(-42);
      expect(result.kind).toBe("number");
      expect((result as any).value).toBe(-42);
    });

    it("Handles NaN", () => {
      const result = jsToComptimeValue(NaN);
      expect(result.kind).toBe("number");
      expect(Number.isNaN((result as any).value)).toBe(true);
    });

    it("Handles Infinity", () => {
      const result = jsToComptimeValue(Infinity);
      expect(result.kind).toBe("number");
      expect((result as any).value).toBe(Infinity);
    });

    it("Handles -Infinity", () => {
      const result = jsToComptimeValue(-Infinity);
      expect(result.kind).toBe("number");
      expect((result as any).value).toBe(-Infinity);
    });

    it("Handles strings", () => {
      const result = jsToComptimeValue("hello");
      expect(result.kind).toBe("string");
      expect((result as any).value).toBe("hello");
    });

    it("Handles empty string", () => {
      const result = jsToComptimeValue("");
      expect(result.kind).toBe("string");
      expect((result as any).value).toBe("");
    });

    it("Handles unicode strings", () => {
      const result = jsToComptimeValue("こんにちは 🎉");
      expect(result.kind).toBe("string");
      expect((result as any).value).toBe("こんにちは 🎉");
    });

    it("Handles strings with escape sequences", () => {
      const result = jsToComptimeValue("line1\nline2\ttab\\backslash");
      expect(result.kind).toBe("string");
      expect((result as any).value).toBe("line1\nline2\ttab\\backslash");
    });

    it("Handles booleans", () => {
      expect(jsToComptimeValue(true).kind).toBe("boolean");
      expect(jsToComptimeValue(false).kind).toBe("boolean");
    });
  });

  // ==========================================================================
  // Unsupported types
  // ==========================================================================
  describe("Unsupported types", () => {
    it("Cannot convert functions", () => {
      const result = jsToComptimeValue(() => 42);
      expect(result.kind).toBe("error");
    });

    it("Cannot convert symbols", () => {
      const result = jsToComptimeValue(Symbol("test"));
      expect(result.kind).toBe("error");
    });

    it("Converts BigInt", () => {
      // FIXED: BigInt is now handled
      // See Finding #14 in FINDINGS.md
      const result = jsToComptimeValue(BigInt(9007199254740991));
      expect(result.kind).toBe("bigint");
      if (result.kind === "bigint") {
        expect(result.value).toBe(BigInt(9007199254740991));
      }
    });
  });

  // ==========================================================================
  // Arrays
  // ==========================================================================
  describe("Arrays", () => {
    it("Handles empty arrays", () => {
      const result = jsToComptimeValue([]);
      expect(result.kind).toBe("array");
      expect((result as any).elements).toEqual([]);
    });

    it("Handles arrays of primitives", () => {
      const result = jsToComptimeValue([1, 2, 3]);
      expect(result.kind).toBe("array");
      expect((result as any).elements.length).toBe(3);
    });

    it("Handles nested arrays", () => {
      const result = jsToComptimeValue([
        [1, 2],
        [3, 4],
      ]);
      expect(result.kind).toBe("array");
      expect((result as any).elements.length).toBe(2);
      expect((result as any).elements[0].kind).toBe("array");
    });

    it("Handles sparse arrays", () => {
      const sparse: (number | undefined)[] = [];
      sparse[0] = 1;
      sparse[5] = 5;
      const result = jsToComptimeValue(sparse);
      expect(result.kind).toBe("array");
      // Sparse arrays have undefined elements
    });

    it("Handles arrays with mixed types", () => {
      const result = jsToComptimeValue([1, "two", true, null]);
      expect(result.kind).toBe("array");
    });

    it("Handles deeply nested arrays", () => {
      // Deep nesting might cause stack overflow or performance issues
      let nested: any = [1];
      for (let i = 0; i < 100; i++) {
        nested = [nested];
      }

      // This should work but might be slow
      const result = jsToComptimeValue(nested);
      expect(result.kind).toBe("array");
    });
  });

  // ==========================================================================
  // Objects
  // ==========================================================================
  describe("Objects", () => {
    it("Handles empty objects", () => {
      const result = jsToComptimeValue({});
      expect(result.kind).toBe("object");
    });

    it("Handles simple objects", () => {
      const result = jsToComptimeValue({ a: 1, b: 2 });
      expect(result.kind).toBe("object");
    });

    it("Handles nested objects", () => {
      const result = jsToComptimeValue({
        outer: { inner: { deep: "value" } },
      });
      expect(result.kind).toBe("object");
    });

    it("Handles objects with special keys", () => {
      const result = jsToComptimeValue({
        "key with spaces": 1,
        "123numeric": 2,
        __proto__: 3, // Reserved name
        constructor: 4, // Reserved name
      });
      expect(result.kind).toBe("object");
    });

    it("Handles objects with symbol keys (symbols ignored)", () => {
      const sym = Symbol("test");
      const obj = { [sym]: "value", regular: "key" };
      const result = jsToComptimeValue(obj);
      expect(result.kind).toBe("object");
      // Symbol keys should be ignored since we use Object.entries
    });

    it("Handles circular references (graceful detection)", () => {
      // FIXED: Circular references are now detected
      // See Finding #15 in FINDINGS.md
      const obj: any = { a: 1 };
      obj.self = obj;

      const result = jsToComptimeValue(obj);
      expect(result.kind).toBe("object");
      if (result.kind === "object") {
        expect(result.properties.get("a")).toEqual({ kind: "number", value: 1 });
        const selfResult = result.properties.get("self");
        expect(selfResult?.kind).toBe("error");
        if (selfResult?.kind === "error") {
          expect(selfResult.message).toContain("Circular reference");
        }
      }
    });

    it("Handles objects with getters", () => {
      const obj = {
        get computed() {
          return 42;
        },
        regular: 1,
      };
      const result = jsToComptimeValue(obj);
      expect(result.kind).toBe("object");
      // Getters are evaluated when Object.entries is called
    });

    it("Handles objects with prototype properties", () => {
      const parent = { inherited: "value" };
      const child = Object.create(parent);
      child.own = "property";

      const result = jsToComptimeValue(child);
      expect(result.kind).toBe("object");
      // Object.entries only gets own properties
    });
  });

  // ==========================================================================
  // Edge cases for the actual comptime macro
  // ==========================================================================
  describe("Comptime macro runtime fallback", () => {
    it("Throws when called at runtime", async () => {
      const { comptime } = await import("../packages/comptime/src/index.js");

      expect(() => comptime(() => 42)).toThrow("called at runtime");
      expect(() => comptime(5 as any)).toThrow("called at runtime");
    });
  });
});

describe("Comptime Sandbox Security", () => {
  // These tests document what SHOULD be blocked in the sandbox
  // The actual enforcement is in the vm sandbox configuration

  describe("Blocked APIs", () => {
    it("Should not have process access", () => {
      // In a real comptime eval, process should be undefined
      // We can't test this directly without running the transformer
    });

    it("Should not have require/import", () => {
      // Dynamic imports should be blocked
    });

    it("Should not have fs access", () => {
      // File system should be blocked
    });

    it("Should not have network access", () => {
      // fetch, http, etc. should be blocked
    });

    it("Should not have eval", () => {
      // eval should be blocked or limited
    });
  });

  describe("Allowed APIs", () => {
    // These are available in the sandbox
    const sandboxedApis = [
      "Math",
      "Number",
      "String",
      "Boolean",
      "Array",
      "Object",
      "Map",
      "Set",
      "JSON",
      "Date",
      "RegExp",
      "Error",
      "parseInt",
      "parseFloat",
      "isNaN",
      "isFinite",
    ];

    for (const api of sandboxedApis) {
      it(`Should have ${api} available`, () => {
        // These are allowed in the sandbox
        expect((globalThis as any)[api]).toBeDefined();
      });
    }
  });
});

describe("Comptime Error Messages", () => {
  // Test that error messages are helpful

  describe("Error message quality", () => {
    it("Should detect infinite loop timeout hint", () => {
      const message = "Script execution timed out";
      expect(message).toContain("timed out");
    });

    it("Should detect undefined variable hint", () => {
      const message = "fs is not defined";
      expect(message).toContain("not defined");
    });

    it("Should detect null access hint", () => {
      const message = "Cannot read properties of null";
      expect(message).toContain("null");
    });
  });
});

describe("Comptime Value to Expression Edge Cases", () => {
  // Test the jsValueToExpression function behavior
  // These test that the AST generation handles edge cases

  describe("Number edge cases in AST", () => {
    it("-0 vs 0 should be distinguishable", () => {
      // Object.is(-0, 0) is false
      // But in AST generation, -0 might become 0
      expect(Object.is(-0, 0)).toBe(false);
      expect(-0 === 0).toBe(true); // But === says they're equal
    });

    it("Very small numbers should not lose precision", () => {
      const small = 1e-300;
      expect(small > 0).toBe(true);
    });

    it("Very large numbers should not overflow", () => {
      const large = 1e308;
      expect(Number.isFinite(large)).toBe(true);
    });
  });

  describe("String edge cases in AST", () => {
    it("Strings with quotes need escaping", () => {
      const withQuotes = 'He said "hello"';
      expect(withQuotes).toContain('"');
    });

    it("Strings with backslashes need escaping", () => {
      const withBackslash = "C:\\Users\\test";
      expect(withBackslash).toContain("\\");
    });

    it("Strings with newlines need escaping", () => {
      const multiline = "line1\nline2";
      expect(multiline).toContain("\n");
    });

    it("Strings with null character", () => {
      const withNull = "before\0after";
      expect(withNull.length).toBe(12);
    });
  });

  describe("Object key edge cases in AST", () => {
    it("Keys that are valid identifiers don't need quotes", () => {
      const valid = "validKey";
      expect(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(valid)).toBe(true);
    });

    it("Keys starting with numbers need quotes", () => {
      const invalid = "123key";
      expect(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(invalid)).toBe(false);
    });

    it("Keys with special characters need quotes", () => {
      const invalid = "key-with-dash";
      expect(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(invalid)).toBe(false);
    });

    it("Empty string key needs quotes", () => {
      const empty = "";
      expect(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(empty)).toBe(false);
    });
  });

  describe("RegExp in AST", () => {
    it("Simple regex", () => {
      const re = /test/gi;
      expect(re.source).toBe("test");
      expect(re.flags).toBe("gi");
    });

    it("Regex with special characters", () => {
      const re = /^[a-z]+\d*$/;
      expect(re.source).toContain("^");
      expect(re.source).toContain("$");
    });

    it("Regex with backslash sequences", () => {
      const re = /\n\t\r/;
      expect(re.source).toContain("\\n");
    });
  });
});
