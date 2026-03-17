/**
 * Behavioral tests for @typesugar/reflect
 *
 * Covers:
 * - Runtime stubs throw with expected "must be processed" message
 * - reflect decorator returns target (no throw)
 * - Edge cases: empty fields, empty methods in TypeInfo
 */
import { describe, it, expect } from "vitest";
import { reflect, typeInfo, fieldNames, validator, type TypeInfo } from "../src/index";

describe("runtime stub behavior", () => {
  describe("typeInfo", () => {
    it("throws with expected message when called at runtime (macro not expanded)", () => {
      expect(() => typeInfo()).toThrow(
        "typeInfo() must be processed by the typesugar transformer at compile time"
      );
    });
  });

  describe("fieldNames", () => {
    it("throws with expected message when called at runtime (macro not expanded)", () => {
      expect(() => fieldNames()).toThrow(
        "fieldNames() must be processed by the typesugar transformer at compile time"
      );
    });
  });

  describe("validator", () => {
    it("throws with expected message when called at runtime (macro not expanded)", () => {
      expect(() => validator()).toThrow(
        "validator() must be processed by the typesugar transformer at compile time"
      );
    });
  });

  describe("reflect decorator", () => {
    it("returns target when applied (no throw)", () => {
      const target = {};
      const result = reflect(target as any);
      expect(result).toBe(target);
    });
  });
});

describe("TypeInfo edge cases", () => {
  it("accepts TypeInfo with empty fields array", () => {
    const info: TypeInfo = {
      name: "Empty",
      kind: "interface",
      fields: [],
      typeParameters: [],
    };

    expect(info.fields).toEqual([]);
    expect(info.fields).toHaveLength(0);
  });

  it("accepts TypeInfo with empty methods array", () => {
    const info: TypeInfo = {
      name: "NoMethods",
      kind: "class",
      fields: [{ name: "x", type: "number", optional: false, readonly: false }],
      methods: [],
      typeParameters: [],
    };

    expect(info.methods).toEqual([]);
    expect(info.methods).toHaveLength(0);
  });

  it("accepts TypeInfo with undefined fields (optional)", () => {
    const info: TypeInfo = {
      name: "Minimal",
      kind: "primitive",
    };

    expect(info.fields).toBeUndefined();
    expect(info.methods).toBeUndefined();
  });

  it("handles fields!.map when fields may be empty", () => {
    const info: TypeInfo = {
      name: "User",
      kind: "interface",
      fields: [],
    };

    const names = (info.fields ?? []).map((f) => f.name);
    expect(names).toEqual([]);
  });
});
