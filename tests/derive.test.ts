/**
 * Tests for derive macro functionality
 *
 * This test file demonstrates dogfooding @typesugar/testing macros:
 * - assert() for power assertions with sub-expression capture
 * - typeAssert<>() for compile-time type checks
 */

import { describe, it, expect } from "vitest";
import { assert, typeAssert, type Equal } from "@typesugar/testing";
import { createDerivedFunctionName, deriveAttribute } from "@typesugar/macros";
import { globalRegistry } from "@typesugar/core";
import { builtinDerivations, derivingAttribute } from "@typesugar/macros";

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
  describe("@derive attribute macro is registered", () => {
    it("should have derive attribute macro registered", () => {
      const macro = globalRegistry.getAttribute("derive");
      assert(macro !== undefined);
      assert(macro!.name === "derive");
    });

    it("deriveAttribute export matches the registered macro", () => {
      assert(deriveAttribute !== undefined);
      assert(deriveAttribute.name === "derive");
      assert(deriveAttribute.kind === "attribute");
    });
  });

  describe("@deriving attribute is registered as deprecated alias", () => {
    it("should have deriving attribute macro registered", () => {
      const macro = globalRegistry.getAttribute("deriving");
      assert(macro !== undefined);
      assert(macro!.name === "deriving");
    });

    it("derivingAttribute export matches the registered macro", () => {
      assert(derivingAttribute !== undefined);
      assert(derivingAttribute.name === "deriving");
    });
  });

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

  describe("typeclass TC derive macros are registered", () => {
    it("should find ShowTC derive macro", () => {
      const macro = globalRegistry.getDerive("ShowTC");
      assert(macro !== undefined);
      assert(macro!.kind === "derive");
    });

    it("should find EqTC derive macro", () => {
      const macro = globalRegistry.getDerive("EqTC");
      assert(macro !== undefined);
    });

    it("should find OrdTC derive macro", () => {
      const macro = globalRegistry.getDerive("OrdTC");
      assert(macro !== undefined);
    });

    it("should find HashTC derive macro", () => {
      const macro = globalRegistry.getDerive("HashTC");
      assert(macro !== undefined);
    });

    it("should find FunctorTC derive macro", () => {
      const macro = globalRegistry.getDerive("FunctorTC");
      assert(macro !== undefined);
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
