/**
 * Tests for derive macro functionality
 *
 * This test file demonstrates dogfooding @typesugar/testing macros:
 * - assert() for power assertions with sub-expression capture
 * - typeAssert<>() for compile-time type checks
 */

import { describe, it, expect } from "vitest";
import { assert, typeAssert, type Equal } from "@typesugar/testing";
import { createDerivedFunctionName } from "@typesugar/macros";
import { globalRegistry } from "@typesugar/core";
import { hasGenericDerivation } from "@typesugar/macros";

describe("createDerivedFunctionName", () => {
  it("should create function names with correct conventions", () => {
    assert(createDerivedFunctionName("eq", "User") === "userEq");
    assert(createDerivedFunctionName("compare", "User") === "userCompare");
    assert(createDerivedFunctionName("clone", "User") === "cloneUser");
    assert(createDerivedFunctionName("debug", "Point") === "debugPoint");
    assert(createDerivedFunctionName("hash", "Config") === "hashConfig");
    assert(createDerivedFunctionName("default", "Settings") === "defaultSettings");
    assert(createDerivedFunctionName("toJson", "Data") === "dataToJson");
    assert(createDerivedFunctionName("fromJson", "Data") === "dataFromJson");
    assert(createDerivedFunctionName("typeGuard", "User") === "isUser");
    assert(createDerivedFunctionName("is", "Point") === "isPoint");
  });
});

// ============================================================================
// Unified @derive system tests (PEP-017 Wave 4)
// ============================================================================

describe("unified derive system", () => {
  describe("typeclass auto-derivation strategies exist", () => {
    for (const name of [
      "Show",
      "Eq",
      "Ord",
      "Hash",
      "Clone",
      "Debug",
      "Default",
      "Json",
      "TypeGuard",
      "Semigroup",
      "Monoid",
    ]) {
      it(`should have ${name} derivation strategy via GenericDerivation`, () => {
        assert(hasGenericDerivation(name));
      });
    }
  });

  describe("old defineDeriveMacro-based macros are removed", () => {
    it("should not find old Eq code-gen derive macro in registry", () => {
      const macro = globalRegistry.getDerive("Eq");
      assert(macro === undefined);
    });

    it("should not find old Builder code-gen derive macro in registry", () => {
      const macro = globalRegistry.getDerive("Builder");
      assert(macro === undefined);
    });

    it("should not find old TypeGuard code-gen derive macro in registry", () => {
      const macro = globalRegistry.getDerive("TypeGuard");
      assert(macro === undefined);
    });
  });
});

// ============================================================================
// Type-level assertions (compile-time checks)
// ============================================================================

describe("type-level assertions", () => {
  it("createDerivedFunctionName returns string", () => {
    typeAssert<Equal<ReturnType<typeof createDerivedFunctionName>, string>>();
  });
});
