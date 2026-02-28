/**
 * Tests for @typesugar/derive exports
 *
 * Verifies that all expected exports are accessible and prevents accidental breakage.
 * Comprehensive derive functionality is tested in root-level tests/derive.test.ts
 * and tests/red-team-derive.test.ts.
 */

import { describe, it, expect } from "vitest";

describe("@typesugar/derive exports", () => {
  describe("runtime stubs", () => {
    it("should export derive function", async () => {
      const { derive } = await import("../src/index.js");
      expect(typeof derive).toBe("function");
    });
  });

  describe("built-in derive macros", () => {
    it("should export all built-in derive macros", async () => {
      const exports = await import("../src/index.js");
      const expectedMacros = [
        "EqDerive",
        "OrdDerive",
        "CloneDerive",
        "DebugDerive",
        "HashDerive",
        "DefaultDerive",
        "JsonDerive",
        "BuilderDerive",
        "TypeGuardDerive",
      ];

      for (const macro of expectedMacros) {
        expect(exports[macro], `${macro} should be exported`).toBeDefined();
      }
    });
  });

  describe("derive name symbols", () => {
    it("should export all derive name symbols", async () => {
      const exports = await import("../src/index.js");
      const expectedSymbols = [
        "Eq",
        "Ord",
        "Clone",
        "Debug",
        "Hash",
        "Default",
        "Json",
        "Builder",
        "TypeGuard",
      ];

      for (const sym of expectedSymbols) {
        expect(exports[sym], `${sym} should be exported`).toBeDefined();
      }
    });
  });

  describe("custom derive API", () => {
    it("should export custom derive functions", async () => {
      const exports = await import("../src/index.js");
      const expectedFns = [
        "defineCustomDerive",
        "defineCustomDeriveAst",
        "defineFieldDerive",
        "defineTypeFunctionDerive",
      ];

      for (const fn of expectedFns) {
        expect(exports[fn], `${fn} should be exported`).toBeDefined();
        expect(typeof exports[fn]).toBe("function");
      }
    });
  });

  describe("generic programming", () => {
    it("should export generic programming utilities", async () => {
      const exports = await import("../src/index.js");
      const expectedExports = [
        "genericDerive",
        "registerGeneric",
        "getGeneric",
        "getGenericMeta",
        "registerGenericMeta",
        "showProduct",
        "showSum",
        "eqProduct",
        "eqSum",
        "ordProduct",
        "hashProduct",
        "deriveShowViaGeneric",
        "deriveEqViaGeneric",
      ];

      for (const exp of expectedExports) {
        expect(exports[exp], `${exp} should be exported`).toBeDefined();
      }
    });
  });

  describe("auto-derivation", () => {
    it("should export auto-derivation utilities", async () => {
      const exports = await import("../src/index.js");
      const expectedExports = [
        "registerGenericDerivation",
        "getGenericDerivation",
        "hasGenericDerivation",
        "tryDeriveViaGeneric",
        "canDeriveViaGeneric",
        "clearDerivationCaches",
        "makePrimitiveChecker",
      ];

      for (const exp of expectedExports) {
        expect(exports[exp], `${exp} should be exported`).toBeDefined();
      }
    });
  });

  describe("testing utilities", () => {
    it("should export deriveMacros and createDerivedFunctionName", async () => {
      const { deriveMacros, createDerivedFunctionName } = await import("../src/index.js");
      expect(deriveMacros).toBeDefined();
      expect(typeof createDerivedFunctionName).toBe("function");
    });
  });
});
