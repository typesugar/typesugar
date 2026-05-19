/**
 * Tests for comptime.ts — Compile-time expression evaluation
 *
 * Covers:
 * - jsToComptimeValue conversion for all types
 * - Circular reference detection
 * - Edge cases: empty objects/arrays, nested structures, unsupported types
 */

import { describe, it, expect } from "vitest";
import { jsToComptimeValue } from "./comptime.js";

// ============================================================================
// jsToComptimeValue — JS to ComptimeValue conversion
// ============================================================================

describe("jsToComptimeValue", () => {
  describe("primitives", () => {
    it("converts null", () => {
      expect(jsToComptimeValue(null)).toEqual({ kind: "null" });
    });

    it("converts undefined", () => {
      expect(jsToComptimeValue(undefined)).toEqual({ kind: "undefined" });
    });

    it("converts numbers", () => {
      expect(jsToComptimeValue(42)).toEqual({ kind: "number", value: 42 });
      expect(jsToComptimeValue(0)).toEqual({ kind: "number", value: 0 });
      expect(jsToComptimeValue(-1)).toEqual({ kind: "number", value: -1 });
      expect(jsToComptimeValue(3.14)).toEqual({ kind: "number", value: 3.14 });
      expect(jsToComptimeValue(NaN)).toEqual({ kind: "number", value: NaN });
      expect(jsToComptimeValue(Infinity)).toEqual({ kind: "number", value: Infinity });
    });

    it("converts strings", () => {
      expect(jsToComptimeValue("hello")).toEqual({ kind: "string", value: "hello" });
      expect(jsToComptimeValue("")).toEqual({ kind: "string", value: "" });
    });

    it("converts booleans", () => {
      expect(jsToComptimeValue(true)).toEqual({ kind: "boolean", value: true });
      expect(jsToComptimeValue(false)).toEqual({ kind: "boolean", value: false });
    });

    it("converts bigint", () => {
      expect(jsToComptimeValue(42n)).toEqual({ kind: "bigint", value: 42n });
      expect(jsToComptimeValue(0n)).toEqual({ kind: "bigint", value: 0n });
    });
  });

  describe("arrays", () => {
    it("converts empty array", () => {
      expect(jsToComptimeValue([])).toEqual({ kind: "array", elements: [] });
    });

    it("converts array of primitives", () => {
      const result = jsToComptimeValue([1, "two", true]);
      expect(result).toEqual({
        kind: "array",
        elements: [
          { kind: "number", value: 1 },
          { kind: "string", value: "two" },
          { kind: "boolean", value: true },
        ],
      });
    });

    it("converts nested arrays", () => {
      const result = jsToComptimeValue([[1, 2], [3]]);
      expect(result).toEqual({
        kind: "array",
        elements: [
          {
            kind: "array",
            elements: [
              { kind: "number", value: 1 },
              { kind: "number", value: 2 },
            ],
          },
          {
            kind: "array",
            elements: [{ kind: "number", value: 3 }],
          },
        ],
      });
    });

    it("converts array with null/undefined elements", () => {
      const result = jsToComptimeValue([null, undefined]);
      expect(result).toEqual({
        kind: "array",
        elements: [{ kind: "null" }, { kind: "undefined" }],
      });
    });
  });

  describe("objects", () => {
    it("converts empty object", () => {
      const result = jsToComptimeValue({});
      expect(result).toEqual({ kind: "object", properties: new Map() });
    });

    it("converts simple object", () => {
      const result = jsToComptimeValue({ x: 1, y: "hello" });
      expect(result).toEqual({
        kind: "object",
        properties: new Map([
          ["x", { kind: "number", value: 1 }],
          ["y", { kind: "string", value: "hello" }],
        ]),
      });
    });

    it("converts nested objects", () => {
      const result = jsToComptimeValue({ inner: { value: 42 } });
      expect(result.kind).toBe("object");
      if (result.kind === "object") {
        const inner = result.properties.get("inner");
        expect(inner?.kind).toBe("object");
        if (inner?.kind === "object") {
          expect(inner.properties.get("value")).toEqual({ kind: "number", value: 42 });
        }
      }
    });

    it("converts object with array values", () => {
      const result = jsToComptimeValue({ items: [1, 2, 3] });
      expect(result.kind).toBe("object");
      if (result.kind === "object") {
        const items = result.properties.get("items");
        expect(items?.kind).toBe("array");
      }
    });
  });

  describe("circular references", () => {
    it("detects circular reference in object", () => {
      const obj: any = { a: 1 };
      obj.self = obj;
      const result = jsToComptimeValue(obj);
      expect(result.kind).toBe("object");
      if (result.kind === "object") {
        const selfRef = result.properties.get("self");
        expect(selfRef).toEqual({
          kind: "error",
          message: "Circular reference detected in object",
        });
      }
    });

    it("detects circular reference in array", () => {
      const arr: any[] = [1, 2];
      arr.push(arr);
      const result = jsToComptimeValue(arr);
      expect(result.kind).toBe("array");
      if (result.kind === "array") {
        expect(result.elements[2]).toEqual({
          kind: "error",
          message: "Circular reference detected in array",
        });
      }
    });

    it("treats shared (non-circular) references as circular — known limitation", () => {
      const shared = { x: 1 };
      // DAG (shared ref, not circular) — but WeakSet tracking can't distinguish
      // DAGs from true cycles, so the second encounter is flagged as circular.
      // This is a deliberate trade-off: safe over-reporting vs missing real cycles.
      const result = jsToComptimeValue({ a: shared, b: shared });
      expect(result.kind).toBe("object");
      if (result.kind === "object") {
        expect(result.properties.get("a")?.kind).toBe("object");
        // second ref to same object detected as circular
        expect(result.properties.get("b")).toEqual({
          kind: "error",
          message: "Circular reference detected in object",
        });
      }
    });
  });

  describe("unsupported types", () => {
    it("returns error for functions", () => {
      const result = jsToComptimeValue(() => {});
      expect(result).toEqual({
        kind: "error",
        message: "Cannot convert function to ComptimeValue",
      });
    });

    it("returns error for symbols", () => {
      const result = jsToComptimeValue(Symbol("test"));
      expect(result).toEqual({
        kind: "error",
        message: "Cannot convert symbol to ComptimeValue",
      });
    });
  });
});
