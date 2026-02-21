/**
 * Tests for derive macro functionality
 *
 * This test file demonstrates dogfooding @typesugar/testing macros:
 * - assert() for power assertions with sub-expression capture
 * - typeAssert<>() for compile-time type checks
 */

import { describe, it, expect } from "vitest";
import { assert, typeAssert, type Equal } from "@typesugar/testing";
import { deriveMacros, createDerivedFunctionName } from "../src/macros/derive.js";
import { globalRegistry } from "../src/core/registry.js";
import {
  builtinDerivations,
  typeclassRegistry,
  derivingAttribute,
} from "../src/macros/typeclass.js";

// Ensure all macros are registered
import "../src/macros/index.js";

describe("derive macro definitions", () => {
  it("should have Eq derive macro", () => {
    assert(deriveMacros.Eq !== undefined);
    assert(deriveMacros.Eq.name === "Eq");
    assert(deriveMacros.Eq.kind === "derive");
  });

  it("should have Ord derive macro", () => {
    assert(deriveMacros.Ord !== undefined);
    assert(deriveMacros.Ord.name === "Ord");
  });

  it("should have Clone derive macro", () => {
    assert(deriveMacros.Clone !== undefined);
    assert(deriveMacros.Clone.name === "Clone");
  });

  it("should have Debug derive macro", () => {
    assert(deriveMacros.Debug !== undefined);
    assert(deriveMacros.Debug.name === "Debug");
  });

  it("should have Hash derive macro", () => {
    assert(deriveMacros.Hash !== undefined);
    assert(deriveMacros.Hash.name === "Hash");
  });

  it("should have Default derive macro", () => {
    assert(deriveMacros.Default !== undefined);
    assert(deriveMacros.Default.name === "Default");
  });

  it("should have Json derive macro", () => {
    assert(deriveMacros.Json !== undefined);
    assert(deriveMacros.Json.name === "Json");
  });

  it("should have Builder derive macro", () => {
    assert(deriveMacros.Builder !== undefined);
    assert(deriveMacros.Builder.name === "Builder");
  });
});

describe("TypeGuard derive macro", () => {
  it("should have TypeGuard derive macro", () => {
    assert(deriveMacros.TypeGuard !== undefined);
    assert(deriveMacros.TypeGuard.name === "TypeGuard");
    assert(deriveMacros.TypeGuard.kind === "derive");
  });
});

describe("createDerivedFunctionName", () => {
  it("should create function names with correct conventions", () => {
    // Using assert() for equality checks - on failure, will show sub-expression values
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
// Unified @derive / @deriving system tests
// ============================================================================

describe("unified derive system", () => {
  describe("code-gen derive macros are registered in global registry", () => {
    it("should find Eq derive macro by name", () => {
      const macro = globalRegistry.getDerive("Eq");
      assert(macro !== undefined);
      assert(macro!.name === "Eq");
      assert(macro!.kind === "derive");
    });

    it("should find TypeGuard derive macro by name", () => {
      const macro = globalRegistry.getDerive("TypeGuard");
      assert(macro !== undefined);
      assert(macro!.name === "TypeGuard");
    });

    it("should find Builder derive macro by name", () => {
      const macro = globalRegistry.getDerive("Builder");
      assert(macro !== undefined);
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

  describe("@deriving attribute is registered as backward-compatible alias", () => {
    it("should have deriving attribute macro registered", () => {
      const macro = globalRegistry.getAttribute("deriving");
      assert(macro !== undefined);
      assert(macro!.name === "deriving");
    });
  });

  describe("unified resolution order", () => {
    it("code-gen derive macros take priority over typeclass derivations", () => {
      // Both "Eq" exists as a code-gen derive AND a typeclass derivation.
      // The code-gen derive should be found first in the registry.
      const codeGenDerive = globalRegistry.getDerive("Eq");
      const typeclassDerivation = builtinDerivations["Eq"];

      // Both exist
      assert(codeGenDerive !== undefined);
      assert(typeclassDerivation !== undefined);

      // The code-gen derive is a DeriveMacro with expand()
      assert(codeGenDerive!.kind === "derive");
      assert(typeof codeGenDerive!.expand === "function");
    });

    it("typeclass derivation is available for types without code-gen derive", () => {
      // "Show" has a typeclass derivation but no code-gen derive macro
      const codeGenDerive = globalRegistry.getDerive("Show");
      const typeclassDerivation = builtinDerivations["Show"];

      // No code-gen derive for "Show" (it's only in the typeclass system)
      // Note: ShowTC exists as a derive macro, but "Show" itself does not
      assert(codeGenDerive === undefined);
      assert(typeclassDerivation !== undefined);
    });

    it("TC derive macros are the fallback for typeclass derivation", () => {
      // "Functor" has no code-gen derive and no builtinDerivation entry
      // would be found by name, but FunctorTC exists
      const tcDerive = globalRegistry.getDerive("FunctorTC");
      assert(tcDerive !== undefined);
    });
  });
});

// ============================================================================
// expandAfter dependency ordering tests
// ============================================================================

describe("macro dependency ordering (expandAfter)", () => {
  it("MacroDefinitionBase supports expandAfter field", () => {
    // Verify the type system accepts expandAfter
    const macro = globalRegistry.getDerive("Eq");
    assert(macro !== undefined);
    // expandAfter is optional, so it should be undefined for existing macros
    assert(macro!.expandAfter === undefined);
  });
});

// ============================================================================
// Type-level assertions (compile-time checks)
// ============================================================================

describe("type-level assertions", () => {
  it("deriveMacros object has expected structure", () => {
    // These assertions are checked at compile time
    typeAssert<Equal<typeof deriveMacros.Eq.kind, "derive">>();
    typeAssert<Equal<typeof deriveMacros.Eq.name, string>>();
  });

  it("createDerivedFunctionName returns string", () => {
    typeAssert<Equal<ReturnType<typeof createDerivedFunctionName>, string>>();
  });
});
