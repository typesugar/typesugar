import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import {
  specialize,
  mono,
  inlineCall,
  specializeKind,
  SpecializationCache,
  getInlineFailureHelp,
  getResultAlgebra,
  getInstanceMethods,
  isRegisteredInstance,
} from "../src/index.js";
import type {
  Specialized,
  InlineFailureReason,
  ResultAlgebra,
  DictMethodMap,
  DictMethod,
  InlineClassification,
  FlattenAnalysis,
  SpecializeOptions,
} from "../src/index.js";

// ============================================================================
// 1. SpecializationCache deep tests
// ============================================================================

describe("SpecializationCache behavior", () => {
  function makeDummyEntry() {
    const ident = ts.factory.createIdentifier("__test_fn");
    const decl = ts.factory.createVariableStatement(
      undefined,
      ts.factory.createVariableDeclarationList(
        [
          ts.factory.createVariableDeclaration(
            ident,
            undefined,
            undefined,
            ts.factory.createNumericLiteral("42")
          ),
        ],
        ts.NodeFlags.Const
      )
    );
    return { ident, decl };
  }

  it("set makes has return true and get return the entry", () => {
    const cache = new SpecializationCache();
    const key = "fn1×Eq";
    const { ident, decl } = makeDummyEntry();

    expect(cache.has(key)).toBe(false);
    expect(cache.get(key)).toBeUndefined();

    cache.set(key, ident, decl);

    expect(cache.has(key)).toBe(true);
    const entry = cache.get(key);
    expect(entry).toBeDefined();
    expect(entry!.ident).toBe(ident);
    expect(entry!.declaration).toBe(decl);
  });

  it("size increments with each unique set", () => {
    const cache = new SpecializationCache();
    expect(cache.size).toBe(0);

    const { ident: i1, decl: d1 } = makeDummyEntry();
    cache.set("key1", i1, d1);
    expect(cache.size).toBe(1);

    const { ident: i2, decl: d2 } = makeDummyEntry();
    cache.set("key2", i2, d2);
    expect(cache.size).toBe(2);

    const { ident: i3, decl: d3 } = makeDummyEntry();
    cache.set("key3", i3, d3);
    expect(cache.size).toBe(3);
  });

  it("overwriting a key does not increase size", () => {
    const cache = new SpecializationCache();
    const { ident: i1, decl: d1 } = makeDummyEntry();
    const { ident: i2, decl: d2 } = makeDummyEntry();

    cache.set("same-key", i1, d1);
    expect(cache.size).toBe(1);

    cache.set("same-key", i2, d2);
    expect(cache.size).toBe(1);

    const entry = cache.get("same-key");
    expect(entry!.ident).toBe(i2);
  });

  it("clear resets size to 0 and removes all entries", () => {
    const cache = new SpecializationCache();
    const { ident: i1, decl: d1 } = makeDummyEntry();
    const { ident: i2, decl: d2 } = makeDummyEntry();

    cache.set("a", i1, d1);
    cache.set("b", i2, d2);
    expect(cache.size).toBe(2);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(false);
    expect(cache.get("a")).toBeUndefined();
  });

  it("getHoistedDeclarations returns empty array initially", () => {
    const cache = new SpecializationCache();
    const decls = cache.getHoistedDeclarations();
    expect(Array.isArray(decls)).toBe(true);
    expect(decls).toHaveLength(0);
  });

  it("getHoistedDeclarations accumulates declarations from set calls", () => {
    const cache = new SpecializationCache();
    const { ident: i1, decl: d1 } = makeDummyEntry();
    const { ident: i2, decl: d2 } = makeDummyEntry();

    cache.set("k1", i1, d1);
    cache.set("k2", i2, d2);

    const decls = cache.getHoistedDeclarations();
    expect(decls).toHaveLength(2);
    expect(decls[0]).toBe(d1);
    expect(decls[1]).toBe(d2);
  });

  it("clear also resets hoisted declarations", () => {
    const cache = new SpecializationCache();
    const { ident, decl } = makeDummyEntry();

    cache.set("k", ident, decl);
    expect(cache.getHoistedDeclarations()).toHaveLength(1);

    cache.clear();
    expect(cache.getHoistedDeclarations()).toHaveLength(0);
  });

  describe("computeKey", () => {
    it("produces consistent keys regardless of brand order", () => {
      const key1 = SpecializationCache.computeKey("fn", ["Eq", "Show", "Ord"]);
      const key2 = SpecializationCache.computeKey("fn", ["Show", "Ord", "Eq"]);
      const key3 = SpecializationCache.computeKey("fn", ["Ord", "Eq", "Show"]);
      expect(key1).toBe(key2);
      expect(key2).toBe(key3);
    });

    it("uses × separator between fnSymbolId and brands", () => {
      const key = SpecializationCache.computeKey("myFn", ["Eq"]);
      expect(key).toContain("×");
      expect(key).toBe("myFn×Eq");
    });

    it("handles empty brands array", () => {
      const key = SpecializationCache.computeKey("fn", []);
      expect(key).toBe("fn×");
    });

    it("handles single brand", () => {
      const key = SpecializationCache.computeKey("fn", ["Monad"]);
      expect(key).toBe("fn×Monad");
    });

    it("sorts brands alphabetically and joins with comma", () => {
      const key = SpecializationCache.computeKey("fn", ["Zebra", "Alpha", "Mango"]);
      expect(key).toBe("fn×Alpha,Mango,Zebra");
    });

    it("different function names produce different keys", () => {
      const key1 = SpecializationCache.computeKey("fn1", ["Eq"]);
      const key2 = SpecializationCache.computeKey("fn2", ["Eq"]);
      expect(key1).not.toBe(key2);
    });

    it("different brands produce different keys", () => {
      const key1 = SpecializationCache.computeKey("fn", ["Eq"]);
      const key2 = SpecializationCache.computeKey("fn", ["Ord"]);
      expect(key1).not.toBe(key2);
    });

    it("handles duplicate brands by preserving them", () => {
      const key = SpecializationCache.computeKey("fn", ["Eq", "Eq"]);
      expect(key).toBe("fn×Eq,Eq");
    });

    it("accepts numeric fnSymbolId", () => {
      const key = SpecializationCache.computeKey(12345, ["Show"]);
      expect(key).toBe("12345×Show");
    });
  });
});

// ============================================================================
// 2. getInlineFailureHelp comprehensive
// ============================================================================

describe("getInlineFailureHelp", () => {
  const knownReasons: InlineFailureReason[] = [
    "early return",
    "early return (flattenable)",
    "try/catch",
    "loop",
    "mutable variable",
    "throw statement",
    "no return statement",
    "expression statement",
  ];

  for (const reason of knownReasons) {
    it(`returns non-empty help for "${reason}"`, () => {
      const help = getInlineFailureHelp(reason);
      expect(typeof help).toBe("string");
      expect(help.length).toBeGreaterThan(0);
    });
  }

  it("returns specific help text for each reason", () => {
    expect(getInlineFailureHelp("early return")).toContain("helper");
    expect(getInlineFailureHelp("early return (flattenable)")).toContain("ternary");
    expect(getInlineFailureHelp("try/catch")).toContain("error handling");
    expect(getInlineFailureHelp("loop")).toContain("Array");
    expect(getInlineFailureHelp("mutable variable")).toContain("const");
    expect(getInlineFailureHelp("throw statement")).toContain("Result");
    expect(getInlineFailureHelp("no return statement")).toContain("return");
    expect(getInlineFailureHelp("expression statement")).toContain("side effect");
  });

  it("returns empty string for null", () => {
    expect(getInlineFailureHelp(null)).toBe("");
  });
});

// ============================================================================
// 3. getResultAlgebra tests
// ============================================================================

describe("getResultAlgebra", () => {
  it("returns undefined for unknown type names", () => {
    expect(getResultAlgebra("NonExistent")).toBeUndefined();
    expect(getResultAlgebra("")).toBeUndefined();
    expect(getResultAlgebra("FooBar")).toBeUndefined();
  });

  it("returns Option algebra for 'Option'", () => {
    const algebra = getResultAlgebra("Option");
    expect(algebra).toBeDefined();
    expect(algebra!.name).toBe("Option");
    expect(algebra!.preservesError).toBe(false);
    expect(algebra!.targetTypes).toContain("Option");
  });

  it("returns Either algebra for 'Either'", () => {
    const algebra = getResultAlgebra("Either");
    expect(algebra).toBeDefined();
    expect(algebra!.name).toBe("Either");
    expect(algebra!.preservesError).toBe(true);
    expect(algebra!.targetTypes).toContain("Either");
  });

  it("returns Promise algebra for 'Promise'", () => {
    const algebra = getResultAlgebra("Promise");
    expect(algebra).toBeDefined();
    expect(algebra!.name).toBe("Promise");
    expect(algebra!.preservesError).toBe(true);
    expect(algebra!.targetTypes).toContain("Promise");
  });

  it("algebra has rewriteOk and rewriteErr functions", () => {
    const algebra = getResultAlgebra("Option");
    expect(typeof algebra!.rewriteOk).toBe("function");
    expect(typeof algebra!.rewriteErr).toBe("function");
  });
});

// ============================================================================
// 4. Instance method registry behavior
// ============================================================================

describe("instance method registry", () => {
  it("getInstanceMethods returns DictMethodMap for registered instance", () => {
    const methods = getInstanceMethods("arrayFunctor");
    expect(methods).toBeDefined();
    expect(methods!.brand).toBe("Array");
    expect(methods!.methods).toBeInstanceOf(Map);
    expect(methods!.methods.has("map")).toBe(true);
  });

  it("arrayMonad has map, pure, ap, flatMap methods", () => {
    const methods = getInstanceMethods("arrayMonad");
    expect(methods).toBeDefined();
    expect(methods!.brand).toBe("Array");
    expect(methods!.methods.has("map")).toBe(true);
    expect(methods!.methods.has("pure")).toBe(true);
    expect(methods!.methods.has("ap")).toBe(true);
    expect(methods!.methods.has("flatMap")).toBe(true);
  });

  it("optionMonad methods have source strings and params", () => {
    const methods = getInstanceMethods("optionMonad");
    expect(methods).toBeDefined();
    const mapMethod = methods!.methods.get("map");
    expect(mapMethod).toBeDefined();
    expect(mapMethod!.source).toBeDefined();
    expect(mapMethod!.params).toEqual(["fa", "f"]);
  });

  it("isRegisteredInstance returns true for known instances", () => {
    expect(isRegisteredInstance("arrayFunctor")).toBe(true);
    expect(isRegisteredInstance("arrayMonad")).toBe(true);
    expect(isRegisteredInstance("optionMonad")).toBe(true);
    expect(isRegisteredInstance("eitherMonad")).toBe(true);
    expect(isRegisteredInstance("promiseMonad")).toBe(true);
  });

  it("isRegisteredInstance returns false for unknown instances", () => {
    expect(isRegisteredInstance("nonexistent")).toBe(false);
    expect(isRegisteredInstance("")).toBe(false);
    expect(isRegisteredInstance("fakeMonad")).toBe(false);
  });

  it("getInstanceMethods returns undefined for unknown instance", () => {
    expect(getInstanceMethods("doesNotExist")).toBeUndefined();
  });
});

// ============================================================================
// 5. Runtime stub behavior
// ============================================================================

describe("runtime stub behavior", () => {
  it("specialize() throws about the transformer", () => {
    expect(() => specialize((() => {}) as any)).toThrow("transformer");
  });

  it("mono() returns the function unchanged (identity)", () => {
    const fn = (x: number) => x * 2;
    const result = mono(fn as any);
    expect(result).toBe(fn);
  });

  it("inlineCall() returns the value unchanged (identity)", () => {
    const value = { x: 42 };
    const result = inlineCall(value);
    expect(result).toBe(value);
  });

  it("inlineCall() works with primitives", () => {
    expect(inlineCall(42)).toBe(42);
    expect(inlineCall("hello")).toBe("hello");
    expect(inlineCall(true)).toBe(true);
    expect(inlineCall(null)).toBe(null);
  });

  it("specializeKind() throws about compile-time macro", () => {
    expect(() => specializeKind({}, () => 42)).toThrow("specialize$() is a compile-time macro");
  });

  it("specializeKind() error message mentions typesugar transformer", () => {
    try {
      specializeKind({}, () => 42);
    } catch (e: any) {
      expect(e.message).toContain("typesugar transformer");
    }
  });
});

// ============================================================================
// 6. Specialized type utility (type-level tests)
// ============================================================================

describe("Specialized type utility", () => {
  it("Specialized<F, 0> preserves the original signature", () => {
    type Fn = (a: number, b: string) => boolean;
    type Result = Specialized<Fn, 0>;
    const fn: Result = (a: number, b: string) => a > 0;
    expect(fn(1, "x")).toBe(true);
  });

  it("Specialized<F, 1> drops the last parameter", () => {
    type Fn = (a: number, b: string, dict: object) => boolean;
    type Result = Specialized<Fn, 1>;
    const fn: Result = (a: number, b: string) => a > 0;
    expect(fn(1, "x")).toBe(true);
  });

  it("Specialized<F, 2> drops the last two parameters", () => {
    type Fn = (a: number, d1: object, d2: object) => string;
    type Result = Specialized<Fn, 2>;
    const fn: Result = (a: number) => String(a);
    expect(fn(42)).toBe("42");
  });

  it("Specialized preserves return type", () => {
    type Fn = (a: number, dict: object) => number[];
    type Result = Specialized<Fn, 1>;
    const fn: Result = (a: number) => [a, a * 2];
    expect(fn(3)).toEqual([3, 6]);
  });
});

// ============================================================================
// 7. Type export completeness (compile-time verification)
// ============================================================================

describe("type exports are usable", () => {
  it("DictMethodMap is a valid interface type", () => {
    const map: DictMethodMap = {
      brand: "Test",
      methods: new Map<string, DictMethod>(),
    };
    expect(map.brand).toBe("Test");
  });

  it("DictMethod has expected shape", () => {
    const method: DictMethod = {
      source: "(a) => a",
      params: ["a"],
    };
    expect(method.params).toEqual(["a"]);
  });

  it("InlineClassification has reason and canFlatten", () => {
    const classification: InlineClassification = {
      reason: null,
      canFlatten: false,
    };
    expect(classification.reason).toBeNull();
    expect(classification.canFlatten).toBe(false);
  });

  it("FlattenAnalysis has expected fields", () => {
    const analysis: FlattenAnalysis = {
      canFlatten: true,
      bindings: [],
    };
    expect(analysis.canFlatten).toBe(true);
    expect(analysis.bindings).toEqual([]);
  });

  it("SpecializeOptions has expected fields", () => {
    const opts: SpecializeOptions = {
      fnExpr: ts.factory.createIdentifier("fn"),
      dictExprs: [],
      callExpr: ts.factory.createCallExpression(
        ts.factory.createIdentifier("specialize"),
        undefined,
        []
      ),
    };
    expect(opts.fnExpr).toBeDefined();
  });

  it("ResultAlgebra has expected fields", () => {
    const algebra: ResultAlgebra = {
      name: "Test",
      targetTypes: ["Test"],
      rewriteOk: (_ctx, value) => value,
      rewriteErr: (_ctx, error) => error,
      preservesError: false,
    };
    expect(algebra.name).toBe("Test");
    expect(typeof algebra.rewriteOk).toBe("function");
  });

  it("InlineFailureReason accepts all known values", () => {
    const reasons: InlineFailureReason[] = [
      "early return",
      "early return (flattenable)",
      "try/catch",
      "loop",
      "mutable variable",
      "throw statement",
      "no return statement",
      "expression statement",
      null,
    ];
    expect(reasons).toHaveLength(9);
  });
});
