/**
 * Tests for @typesugar/operators exports
 *
 * Verifies that all expected exports are accessible.
 * Comprehensive operator functionality is tested in root-level tests/red-team-operators.test.ts.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  operators,
  ops,
  pipe,
  compose,
  flow,
  registerOperators,
  getOperatorMethod,
  clearOperatorMappings,
} from "../src/index.js";

describe("@typesugar/operators exports", () => {
  describe("runtime stubs", () => {
    it("should export operators decorator stub", () => {
      expect(typeof operators).toBe("function");
    });

    it("should export ops wrapper", () => {
      expect(typeof ops).toBe("function");
    });

    it("should export pipe function", () => {
      expect(typeof pipe).toBe("function");
    });

    it("should export compose function", () => {
      expect(typeof compose).toBe("function");
    });

    it("should export flow function", () => {
      expect(typeof flow).toBe("function");
    });
  });

  describe("operator registration", () => {
    beforeEach(() => {
      clearOperatorMappings();
    });

    it("should export registerOperators function", () => {
      expect(typeof registerOperators).toBe("function");
    });

    it("should export getOperatorMethod function", () => {
      expect(typeof getOperatorMethod).toBe("function");
    });

    it("should export clearOperatorMappings function", () => {
      expect(typeof clearOperatorMappings).toBe("function");
    });

    it("registerOperators and getOperatorMethod work correctly", () => {
      registerOperators("TestType", { "+": "add", "-": "sub" });

      expect(getOperatorMethod("TestType", "+")).toBe("add");
      expect(getOperatorMethod("TestType", "-")).toBe("sub");
      expect(getOperatorMethod("TestType", "*")).toBeUndefined();
      expect(getOperatorMethod("OtherType", "+")).toBeUndefined();
    });

    it("clearOperatorMappings clears all registrations", () => {
      registerOperators("A", { "+": "add" });
      registerOperators("B", { "-": "sub" });

      clearOperatorMappings();

      expect(getOperatorMethod("A", "+")).toBeUndefined();
      expect(getOperatorMethod("B", "-")).toBeUndefined();
    });
  });

  describe("pipe function", () => {
    it("handles identity (single argument)", () => {
      const obj = { value: 42 };
      expect(pipe(obj)).toBe(obj);
    });

    it("chains functions left to right", () => {
      const result = pipe(
        5,
        (x: number) => x * 2,
        (x: number) => x + 1
      );
      expect(result).toBe(11);
    });

    it("preserves types through chain", () => {
      const result = pipe(
        "hello",
        (s: string) => s.toUpperCase(),
        (s: string) => s.length
      );
      expect(result).toBe(5);
    });
  });

  describe("compose function", () => {
    it("composes functions right to left", () => {
      const add1 = (x: number) => x + 1;
      const mul2 = (x: number) => x * 2;
      const composed = compose(add1, mul2);

      expect(composed(5)).toBe(11); // mul2(5)=10, add1(10)=11
    });
  });

  describe("flow function", () => {
    it("composes functions left to right", () => {
      const add1 = (x: number) => x + 1;
      const mul2 = (x: number) => x * 2;
      const flowed = flow(add1, mul2);

      expect(flowed(5)).toBe(12); // add1(5)=6, mul2(6)=12
    });
  });

  describe("ops wrapper", () => {
    it("passes through values at runtime", () => {
      expect(ops(42)).toBe(42);
      expect(ops("hello")).toBe("hello");
      expect(ops({ a: 1 })).toEqual({ a: 1 });
    });
  });

  describe("macro exports", () => {
    it("should export macro definitions", async () => {
      const exports = await import("../src/index.js");
      expect(exports.operatorsAttribute).toBeDefined();
      expect(exports.opsMacro).toBeDefined();
      expect(exports.pipeMacro).toBeDefined();
      expect(exports.composeMacro).toBeDefined();
    });
  });
});
