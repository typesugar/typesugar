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
import { builtinDerivations } from "@typesugar/macros";

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
    it("should have Show derivation strategy", () => {
      assert(builtinDerivations["Show"] !== undefined);
      assert(typeof builtinDerivations["Show"].deriveProduct === "function");
      assert(typeof builtinDerivations["Show"].deriveSum === "function");
    });

    it("should have Eq derivation strategy", () => {
      assert(builtinDerivations["Eq"] !== undefined);
    });

    it("should have Ord derivation strategy", () => {
      assert(builtinDerivations["Ord"] !== undefined);
    });

    it("should have Hash derivation strategy", () => {
      assert(builtinDerivations["Hash"] !== undefined);
    });

    it("should have Clone derivation strategy", () => {
      assert(builtinDerivations["Clone"] !== undefined);
    });

    it("should have Debug derivation strategy", () => {
      assert(builtinDerivations["Debug"] !== undefined);
    });

    it("should have Default derivation strategy", () => {
      assert(builtinDerivations["Default"] !== undefined);
    });

    it("should have Json derivation strategy", () => {
      assert(builtinDerivations["Json"] !== undefined);
    });

    it("should have TypeGuard derivation strategy", () => {
      assert(builtinDerivations["TypeGuard"] !== undefined);
    });

    it("should have Semigroup derivation strategy", () => {
      assert(builtinDerivations["Semigroup"] !== undefined);
    });

    it("should have Monoid derivation strategy", () => {
      assert(builtinDerivations["Monoid"] !== undefined);
    });

    it("should have Functor derivation strategy", () => {
      assert(builtinDerivations["Functor"] !== undefined);
    });
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
