import { describe, it, expect } from "vitest";
import {
  specialize,
  mono,
  inlineCall,
  specializeKind,
  specializeMacro,
  specializeInlineMacro,
  monoMacro,
  inlineCallMacro,
  getInstanceMethods,
  isRegisteredInstance,
  classifyInlineFailure,
  classifyInlineFailureDetailed,
  getInlineFailureHelp,
  flattenReturnsToExpression,
  analyzeForFlattening,
  createSpecializedFunction,
  SpecializationCache,
  createHoistedSpecialization,
  getResultAlgebra,
} from "../src/index.js";
import type {
  Specialized,
  ResultAlgebra,
  DictMethodMap,
  DictMethod,
  InlineFailureReason,
  InlineClassification,
  FlattenAnalysis,
  SpecializeOptions,
} from "../src/index.js";

describe("@typesugar/specialize exports", () => {
  describe("runtime stubs", () => {
    it("exports specialize function", () => {
      expect(specialize).toBeDefined();
      expect(typeof specialize).toBe("function");
    });

    it("exports mono function", () => {
      expect(mono).toBeDefined();
      expect(typeof mono).toBe("function");
    });

    it("exports inlineCall function", () => {
      expect(inlineCall).toBeDefined();
      expect(typeof inlineCall).toBe("function");
    });

    it("exports specializeKind function", () => {
      expect(specializeKind).toBeDefined();
      expect(typeof specializeKind).toBe("function");
    });

    it("specializeKind throws at runtime (requires transformer)", () => {
      expect(() => specializeKind({}, () => 42)).toThrow("specialize$() is a compile-time macro");
    });
  });

  describe("macro definitions", () => {
    it("exports specializeMacro", () => {
      expect(specializeMacro).toBeDefined();
    });

    it("exports specializeInlineMacro", () => {
      expect(specializeInlineMacro).toBeDefined();
    });

    it("exports monoMacro", () => {
      expect(monoMacro).toBeDefined();
    });

    it("exports inlineCallMacro", () => {
      expect(inlineCallMacro).toBeDefined();
    });
  });

  describe("instance method utilities", () => {
    it("exports getInstanceMethods", () => {
      expect(getInstanceMethods).toBeDefined();
      expect(typeof getInstanceMethods).toBe("function");
    });

    it("exports isRegisteredInstance", () => {
      expect(isRegisteredInstance).toBeDefined();
      expect(typeof isRegisteredInstance).toBe("function");
    });

    it("getInstanceMethods returns empty map for unregistered instance", () => {
      const methods = getInstanceMethods("nonexistent");
      expect(methods).toBeUndefined();
    });

    it("isRegisteredInstance returns false for unregistered instance", () => {
      expect(isRegisteredInstance("nonexistent")).toBe(false);
    });
  });

  describe("inline analysis utilities", () => {
    it("exports classifyInlineFailure", () => {
      expect(classifyInlineFailure).toBeDefined();
      expect(typeof classifyInlineFailure).toBe("function");
    });

    it("exports classifyInlineFailureDetailed", () => {
      expect(classifyInlineFailureDetailed).toBeDefined();
      expect(typeof classifyInlineFailureDetailed).toBe("function");
    });

    it("exports getInlineFailureHelp", () => {
      expect(getInlineFailureHelp).toBeDefined();
      expect(typeof getInlineFailureHelp).toBe("function");
    });

    it("exports flattenReturnsToExpression", () => {
      expect(flattenReturnsToExpression).toBeDefined();
      expect(typeof flattenReturnsToExpression).toBe("function");
    });

    it("exports analyzeForFlattening", () => {
      expect(analyzeForFlattening).toBeDefined();
      expect(typeof analyzeForFlattening).toBe("function");
    });

    it("getInlineFailureHelp returns help text for known reasons", () => {
      const help = getInlineFailureHelp("early return");
      expect(typeof help).toBe("string");
      expect(help.length).toBeGreaterThan(0);
    });

    it("getInlineFailureHelp returns empty string for null", () => {
      const help = getInlineFailureHelp(null);
      expect(help).toBe("");
    });
  });

  describe("specialization utilities", () => {
    it("exports createSpecializedFunction", () => {
      expect(createSpecializedFunction).toBeDefined();
      expect(typeof createSpecializedFunction).toBe("function");
    });

    it("exports SpecializationCache", () => {
      expect(SpecializationCache).toBeDefined();
    });

    it("exports createHoistedSpecialization", () => {
      expect(createHoistedSpecialization).toBeDefined();
      expect(typeof createHoistedSpecialization).toBe("function");
    });

    it("exports getResultAlgebra", () => {
      expect(getResultAlgebra).toBeDefined();
      expect(typeof getResultAlgebra).toBe("function");
    });
  });

  describe("SpecializationCache", () => {
    it("can be instantiated", () => {
      const cache = new SpecializationCache();
      expect(cache).toBeInstanceOf(SpecializationCache);
    });

    it("has has/get/set methods", () => {
      const cache = new SpecializationCache();
      expect(typeof cache.has).toBe("function");
      expect(typeof cache.get).toBe("function");
      expect(typeof cache.set).toBe("function");
    });

    it("has static computeKey method", () => {
      expect(typeof SpecializationCache.computeKey).toBe("function");
    });

    it("computeKey generates consistent keys", () => {
      const key1 = SpecializationCache.computeKey("fn1", ["Eq", "Show"]);
      const key2 = SpecializationCache.computeKey("fn1", ["Show", "Eq"]);
      // Keys should be consistent regardless of brand order
      expect(key1).toBe(key2);
    });

    it("computeKey generates different keys for different functions", () => {
      const key1 = SpecializationCache.computeKey("fn1", ["Eq"]);
      const key2 = SpecializationCache.computeKey("fn2", ["Eq"]);
      expect(key1).not.toBe(key2);
    });

    it("tracks size correctly", () => {
      const cache = new SpecializationCache();
      expect(cache.size).toBe(0);
    });

    it("clear resets the cache", () => {
      const cache = new SpecializationCache();
      cache.clear();
      expect(cache.size).toBe(0);
    });

    it("getHoistedDeclarations returns array", () => {
      const cache = new SpecializationCache();
      const declarations = cache.getHoistedDeclarations();
      expect(Array.isArray(declarations)).toBe(true);
      expect(declarations.length).toBe(0);
    });
  });
});

describe("type exports", () => {
  it("Specialized type is usable", () => {
    type TestSpecialized = Specialized<(x: number) => number>;
    const fn: TestSpecialized = (x: number) => x * 2;
    expect(fn(21)).toBe(42);
  });

  it("InlineFailureReason type is usable", () => {
    const reason: InlineFailureReason = "early return";
    expect(reason).toBe("early return");
  });
});
