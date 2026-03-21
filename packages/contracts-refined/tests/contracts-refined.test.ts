/**
 * Package-level tests for @typesugar/contracts-refined
 *
 * Tests the integration layer between @typesugar/contracts and
 * @typesugar/type-system refinement types.
 */
import { describe, it, expect } from "vitest";
import {
  // Re-exported from contracts
  getRefinementPredicate,
  registerSubtypingRule,
  canWiden,
  getSubtypingRule,
  getAllSubtypingRules,
  registerDecidability,
  getDecidability,
  getPreferredStrategy,
  isCompileTimeDecidable,
  requiresRuntimeCheck,
  getAllDecidabilityInfo,
  registerDynamicPredicateGenerator,
  // Own exports
  registerRefinementPredicate,
  getRegisteredPredicates,
  hasRefinementPredicate,
  // Re-exported from type-system
  widen,
  widenTo,
  isSubtype,
  getSubtypingDeclaration,
  getAllSubtypingDeclarations,
  VEC_PREDICATE_PATTERN,
  extractVecLength,
  generateVecPredicate,
  VecConstructors,
  isVec,
} from "../src/index.js";

// ============================================================================
// 1. All Exports Are Defined
// ============================================================================

describe("exports", () => {
  it("re-exports contract functions", () => {
    expect(typeof getRefinementPredicate).toBe("function");
    expect(typeof registerSubtypingRule).toBe("function");
    expect(typeof canWiden).toBe("function");
    expect(typeof getSubtypingRule).toBe("function");
    expect(typeof getAllSubtypingRules).toBe("function");
    expect(typeof registerDecidability).toBe("function");
    expect(typeof getDecidability).toBe("function");
    expect(typeof getPreferredStrategy).toBe("function");
    expect(typeof isCompileTimeDecidable).toBe("function");
    expect(typeof requiresRuntimeCheck).toBe("function");
    expect(typeof getAllDecidabilityInfo).toBe("function");
    expect(typeof registerDynamicPredicateGenerator).toBe("function");
  });

  it("exports own functions", () => {
    expect(typeof registerRefinementPredicate).toBe("function");
    expect(typeof getRegisteredPredicates).toBe("function");
    expect(typeof hasRefinementPredicate).toBe("function");
  });

  it("re-exports type-system functions", () => {
    expect(typeof widen).toBe("function");
    expect(typeof widenTo).toBe("function");
    expect(typeof isSubtype).toBe("function");
    expect(typeof getSubtypingDeclaration).toBe("function");
    expect(typeof getAllSubtypingDeclarations).toBe("function");
    expect(typeof extractVecLength).toBe("function");
    expect(typeof generateVecPredicate).toBe("function");
    expect(typeof isVec).toBe("function");
  });

  it("re-exports VEC_PREDICATE_PATTERN as a RegExp", () => {
    expect(VEC_PREDICATE_PATTERN).toBeInstanceOf(RegExp);
  });

  it("re-exports VecConstructors", () => {
    expect(VecConstructors).toBeDefined();
  });
});

// ============================================================================
// 2. Auto-Registration of Built-in Predicates
// ============================================================================

describe("built-in predicate registration", () => {
  describe("numeric predicates", () => {
    const numericBrands = [
      "Positive",
      "NonNegative",
      "Negative",
      "NonZero",
      "Int",
      "Byte",
      "Port",
      "Percentage",
      "Finite",
    ];

    for (const brand of numericBrands) {
      it(`registers ${brand}`, () => {
        expect(hasRefinementPredicate(brand)).toBe(true);
        expect(typeof getRefinementPredicate(brand)).toBe("string");
      });
    }
  });

  describe("string predicates", () => {
    const stringBrands = ["NonEmpty", "Trimmed", "Lowercase", "Uppercase", "Email", "Url", "Uuid"];

    for (const brand of stringBrands) {
      it(`registers ${brand}`, () => {
        expect(hasRefinementPredicate(brand)).toBe(true);
        expect(typeof getRefinementPredicate(brand)).toBe("string");
      });
    }
  });

  describe("array predicates", () => {
    it("registers NonEmptyArray", () => {
      expect(hasRefinementPredicate("NonEmptyArray")).toBe(true);
    });
  });

  it("getRegisteredPredicates() returns all built-in predicates", () => {
    const predicates = getRegisteredPredicates();
    expect(predicates.length).toBeGreaterThan(0);
    const brands = predicates.map((p) => p.brand);
    expect(brands).toContain("Positive");
    expect(brands).toContain("Byte");
    expect(brands).toContain("NonEmpty");
    expect(brands).toContain("NonEmptyArray");
  });

  it("predicates use $ placeholder in predicate strings", () => {
    const positive = getRefinementPredicate("Positive");
    expect(positive).toContain("$");
    const byte = getRefinementPredicate("Byte");
    expect(byte).toContain("$");
  });
});

// ============================================================================
// 3. registerRefinementPredicate (custom predicates)
// ============================================================================

describe("registerRefinementPredicate", () => {
  it("registers and retrieves a custom predicate", () => {
    registerRefinementPredicate("TestCustomA", "$ > 42");
    expect(hasRefinementPredicate("TestCustomA")).toBe(true);
    expect(getRefinementPredicate("TestCustomA")).toBe("$ > 42");
  });

  it("custom predicate appears in getRegisteredPredicates()", () => {
    registerRefinementPredicate("TestCustomB", "$ !== null");
    const all = getRegisteredPredicates();
    const found = all.find((p) => p.brand === "TestCustomB");
    expect(found).toBeDefined();
    expect(found!.predicate).toBe("$ !== null");
    expect(found!.description).toBe("Custom");
  });

  it("accepts a decidability parameter", () => {
    registerRefinementPredicate("TestCustomDecidable", "$ > 100", "compile-time");
    const all = getRegisteredPredicates();
    const found = all.find((p) => p.brand === "TestCustomDecidable");
    expect(found).toBeDefined();
    expect(found!.decidability).toBe("compile-time");
  });

  it("defaults decidability to runtime", () => {
    registerRefinementPredicate("TestCustomDefault", "$ < 0");
    const all = getRegisteredPredicates();
    const found = all.find((p) => p.brand === "TestCustomDefault");
    expect(found).toBeDefined();
    expect(found!.decidability).toBe("runtime");
  });

  it("duplicate registration overwrites in the core registry", () => {
    registerRefinementPredicate("TestDup", "$ > 10");
    registerRefinementPredicate("TestDup", "$ > 20");
    expect(getRefinementPredicate("TestDup")).toBe("$ > 20");
  });

  it("stores predicate with invalid JS syntax as-is (no validation)", () => {
    registerRefinementPredicate("TestInvalidSyntax", "$ >>> &&& !!!");
    expect(getRefinementPredicate("TestInvalidSyntax")).toBe("$ >>> &&& !!!");
  });
});

// ============================================================================
// 4. registerSubtypingRule and Subtyping Queries
// ============================================================================

describe("subtyping rules", () => {
  describe("built-in subtyping rules are registered", () => {
    it("Positive widens to NonNegative", () => {
      expect(canWiden("Positive", "NonNegative")).toBe(true);
    });

    it("Port widens to Positive", () => {
      expect(canWiden("Port", "Positive")).toBe(true);
    });

    it("Byte widens to NonNegative", () => {
      expect(canWiden("Byte", "NonNegative")).toBe(true);
    });

    it("Byte widens to Int", () => {
      expect(canWiden("Byte", "Int")).toBe(true);
    });
  });

  describe("invalid widening is rejected", () => {
    it("NonNegative does not widen to Positive", () => {
      expect(canWiden("NonNegative", "Positive")).toBe(false);
    });

    it("Int does not widen to Byte", () => {
      expect(canWiden("Int", "Byte")).toBe(false);
    });
  });

  it("registerSubtypingRule adds a new rule", () => {
    registerSubtypingRule({
      from: "TestSubFrom",
      to: "TestSubTo",
      proof: "trivial",
      justification: "test rule",
    });
    expect(canWiden("TestSubFrom", "TestSubTo")).toBe(true);
  });

  it("getSubtypingRule retrieves a registered rule", () => {
    registerSubtypingRule({
      from: "TestRuleFrom",
      to: "TestRuleTo",
      proof: "trivial",
      justification: "test retrieval",
    });
    const rule = getSubtypingRule("TestRuleFrom", "TestRuleTo");
    expect(rule).toBeDefined();
    if (rule) {
      expect(rule.justification).toBe("test retrieval");
    }
  });

  it("getAllSubtypingRules returns at least the built-in rules", () => {
    const rules = getAllSubtypingRules();
    expect(rules.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// 5. Vec<N> Dynamic Predicate Generation
// ============================================================================

describe("Vec<N> dynamic predicate generation", () => {
  describe("VEC_PREDICATE_PATTERN", () => {
    it("matches Vec<N> format", () => {
      expect(VEC_PREDICATE_PATTERN.test("Vec<5>")).toBe(true);
      expect(VEC_PREDICATE_PATTERN.test("Vec<0>")).toBe(true);
      expect(VEC_PREDICATE_PATTERN.test("Vec<123>")).toBe(true);
    });

    it("rejects invalid formats", () => {
      expect(VEC_PREDICATE_PATTERN.test("Vec")).toBe(false);
      expect(VEC_PREDICATE_PATTERN.test("Vec<>")).toBe(false);
      expect(VEC_PREDICATE_PATTERN.test("Vec<abc>")).toBe(false);
      expect(VEC_PREDICATE_PATTERN.test("Array<5>")).toBe(false);
    });
  });

  describe("extractVecLength", () => {
    it("extracts length from Vec<5>", () => {
      expect(extractVecLength("Vec<5>")).toBe(5);
    });

    it("extracts length from Vec<0>", () => {
      expect(extractVecLength("Vec<0>")).toBe(0);
    });

    it("extracts length from Vec<100>", () => {
      expect(extractVecLength("Vec<100>")).toBe(100);
    });

    it("returns undefined for non-Vec types", () => {
      expect(extractVecLength("Array")).toBeUndefined();
      expect(extractVecLength("Byte")).toBeUndefined();
      expect(extractVecLength("Vec")).toBeUndefined();
    });

    it("returns undefined for malformed Vec types", () => {
      expect(extractVecLength("Vec<>")).toBeUndefined();
      expect(extractVecLength("Vec<abc>")).toBeUndefined();
      expect(extractVecLength("Vec<-1>")).toBeUndefined();
    });
  });

  describe("generateVecPredicate", () => {
    it("generates predicate for Vec<5>", () => {
      expect(generateVecPredicate("Vec<5>")).toBe("$.length === 5");
    });

    it("generates predicate for Vec<0>", () => {
      expect(generateVecPredicate("Vec<0>")).toBe("$.length === 0");
    });

    it("returns undefined for non-Vec types", () => {
      expect(generateVecPredicate("Array")).toBeUndefined();
      expect(generateVecPredicate("Byte")).toBeUndefined();
    });
  });

  describe("isVec runtime check", () => {
    it("returns false for plain arrays (no Vec brand)", () => {
      expect(isVec([1, 2, 3])).toBe(false);
    });

    it("returns false for empty plain array", () => {
      expect(isVec([])).toBe(false);
    });

    it("returns false for non-array values", () => {
      expect(isVec("hello")).toBe(false);
      expect(isVec(42)).toBe(false);
      expect(isVec(null)).toBe(false);
      expect(isVec(undefined)).toBe(false);
    });

    it("returns true for Vec created via VecConstructors", () => {
      const vec = VecConstructors.tuple(1, 2, 3);
      expect(isVec(vec)).toBe(true);
    });
  });
});

// ============================================================================
// 6. Decidability Annotations
// ============================================================================

describe("decidability annotations", () => {
  describe("compile-time decidable predicates", () => {
    it("Positive is compile-time decidable", () => {
      expect(isCompileTimeDecidable("Positive")).toBe(true);
    });

    it("NonNegative is compile-time decidable", () => {
      expect(isCompileTimeDecidable("NonNegative")).toBe(true);
    });

    it("Byte is compile-time decidable", () => {
      expect(isCompileTimeDecidable("Byte")).toBe(true);
    });
  });

  describe("runtime-only predicates", () => {
    it("Trimmed requires runtime check", () => {
      expect(requiresRuntimeCheck("Trimmed")).toBe(true);
    });

    it("Email requires runtime check", () => {
      expect(requiresRuntimeCheck("Email")).toBe(true);
    });

    it("Uuid requires runtime check", () => {
      expect(requiresRuntimeCheck("Uuid")).toBe(true);
    });
  });

  describe("getDecidability", () => {
    it("returns info for registered predicates", () => {
      const info = getDecidability("Positive");
      expect(info).toBeDefined();
      if (info) {
        expect(info.decidability).toBe("compile-time");
      }
    });

    it("returns undefined for unregistered predicates", () => {
      expect(getDecidability("NonExistentPredicate")).toBeUndefined();
    });
  });

  describe("registerDecidability for custom predicates", () => {
    it("registers decidability for a new brand", () => {
      registerRefinementPredicate("TestDecidableCustom", "$ > 999", "compile-time");
      registerDecidability({
        brand: "TestDecidableCustom",
        decidability: "compile-time",
        preferredStrategy: "algebra",
      });
      expect(isCompileTimeDecidable("TestDecidableCustom")).toBe(true);
    });
  });

  describe("getAllDecidabilityInfo", () => {
    it("returns a non-empty array of info entries", () => {
      const all = getAllDecidabilityInfo();
      expect(Array.isArray(all)).toBe(true);
      expect(all.length).toBeGreaterThan(0);
    });

    it("includes entries for built-in predicates", () => {
      const all = getAllDecidabilityInfo();
      const brands = all.map((d) => d.brand);
      expect(brands).toContain("Positive");
    });
  });
});

// ============================================================================
// 7. Edge Cases
// ============================================================================

describe("edge cases", () => {
  it("hasRefinementPredicate returns false for unknown brands", () => {
    expect(hasRefinementPredicate("CompletelyUnknownBrand")).toBe(false);
  });

  it("getRefinementPredicate returns undefined for unknown brands", () => {
    expect(getRefinementPredicate("CompletelyUnknownBrand")).toBeUndefined();
  });

  it("canWiden returns false for unknown source type", () => {
    expect(canWiden("UnknownSrc", "Positive")).toBe(false);
  });

  it("canWiden returns false for unknown target type", () => {
    expect(canWiden("Positive", "UnknownTarget")).toBe(false);
  });

  it("isSubtype is reflexive (any type is subtype of itself)", () => {
    expect(isSubtype("Positive", "Positive")).toBe(true);
    expect(isSubtype("Byte", "Byte")).toBe(true);
    expect(isSubtype("NonEmpty", "NonEmpty")).toBe(true);
  });

  it("isSubtype returns false for unrelated types", () => {
    expect(isSubtype("NonEmpty", "Positive")).toBe(false);
    expect(isSubtype("Positive", "NonEmpty")).toBe(false);
  });

  it("getSubtypingRule returns undefined for non-existent rule", () => {
    expect(getSubtypingRule("FooFake", "BarFake")).toBeUndefined();
  });

  it("duplicate subtyping rule registration does not throw", () => {
    registerSubtypingRule({
      from: "TestEdgeDup",
      to: "TestEdgeDupTarget",
      proof: "trivial",
      justification: "first",
    });
    // Should not throw on duplicate
    expect(() => {
      registerSubtypingRule({
        from: "TestEdgeDup",
        to: "TestEdgeDupTarget",
        proof: "trivial",
        justification: "second",
      });
    }).not.toThrow();
  });

  it("predicate string with empty $ usage is still stored", () => {
    registerRefinementPredicate("TestNoPlaceholder", "true");
    expect(getRefinementPredicate("TestNoPlaceholder")).toBe("true");
  });
});
