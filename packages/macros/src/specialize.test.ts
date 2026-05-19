/**
 * Tests for specialize.ts — Specialization cache, result algebras,
 * instance method registry, and inline failure classification
 *
 * Covers:
 * - SpecializationCache: key computation, name generation, caching, hoisting
 * - Result algebras: registration, lookup, built-in algebras
 * - Instance method registry: register, lookup, deprecation, AST methods
 * - Inline failure classification: all failure reasons
 * - getInlineFailureHelp: help text for each reason
 */

import * as ts from "typescript";
import { describe, it, expect, beforeEach } from "vitest";
import {
  SpecializationCache,
  registerResultAlgebra,
  getResultAlgebra,
  hasResultAlgebra,
  getAllResultAlgebras,
  optionResultAlgebra,
  eitherResultAlgebra,
  unsafeResultAlgebra,
  promiseResultAlgebra,
  registerInstanceMethods,
  registerInstanceMethodsFromAST,
  getInstanceMethods,
  isRegisteredInstance,
  getRegisteredInstanceNames,
  getInstanceOrIntrinsicMethods,
  classifyInlineFailure,
  classifyInlineFailureDetailed,
  getInlineFailureHelp,
  type InlineFailureReason,
} from "./specialize.js";

// ============================================================================
// SpecializationCache
// ============================================================================

describe("SpecializationCache", () => {
  describe("computeKey", () => {
    it("creates key from symbol ID and brands", () => {
      const key = SpecializationCache.computeKey("fn1", ["Array"]);
      expect(key).toBe("fn1×Array");
    });

    it("sorts brands alphabetically", () => {
      const key = SpecializationCache.computeKey("fn1", ["Monad", "Functor", "Apply"]);
      expect(key).toBe("fn1×Apply,Functor,Monad");
    });

    it("handles numeric symbol ID", () => {
      const key = SpecializationCache.computeKey(42, ["Show"]);
      expect(key).toBe("42×Show");
    });

    it("handles empty brands", () => {
      const key = SpecializationCache.computeKey("fn1", []);
      expect(key).toBe("fn1×");
    });

    it("produces consistent keys regardless of input order", () => {
      const key1 = SpecializationCache.computeKey("fn", ["B", "A"]);
      const key2 = SpecializationCache.computeKey("fn", ["A", "B"]);
      expect(key1).toBe(key2);
    });
  });

  describe("cache operations", () => {
    let cache: SpecializationCache;
    const factory = ts.factory;

    beforeEach(() => {
      cache = new SpecializationCache();
    });

    it("starts empty", () => {
      expect(cache.size).toBe(0);
      expect(cache.has("any-key")).toBe(false);
    });

    it("stores and retrieves entries", () => {
      const ident = factory.createIdentifier("__fn_Array");
      const decl = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList(
          [factory.createVariableDeclaration(ident, undefined, undefined, factory.createNull())],
          ts.NodeFlags.Const
        )
      );

      cache.set("key1", ident, decl);
      expect(cache.has("key1")).toBe(true);
      expect(cache.size).toBe(1);

      const entry = cache.get("key1");
      expect(entry).toBeDefined();
      expect(entry!.ident).toBe(ident);
      expect(entry!.declaration).toBe(decl);
    });

    it("returns undefined for missing key", () => {
      expect(cache.get("missing")).toBeUndefined();
    });

    it("tracks hoisted declarations", () => {
      const ident1 = factory.createIdentifier("__fn1");
      const ident2 = factory.createIdentifier("__fn2");
      const mkDecl = (id: ts.Identifier) =>
        factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList(
            [factory.createVariableDeclaration(id, undefined, undefined, factory.createNull())],
            ts.NodeFlags.Const
          )
        );

      cache.set("key1", ident1, mkDecl(ident1));
      cache.set("key2", ident2, mkDecl(ident2));

      const hoisted = cache.getHoistedDeclarations();
      expect(hoisted).toHaveLength(2);
    });

    it("clears all state", () => {
      const ident = factory.createIdentifier("__fn");
      const decl = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList(
          [factory.createVariableDeclaration(ident, undefined, undefined, factory.createNull())],
          ts.NodeFlags.Const
        )
      );

      cache.set("key1", ident, decl);
      expect(cache.size).toBe(1);

      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.has("key1")).toBe(false);
      expect(cache.getHoistedDeclarations()).toHaveLength(0);
    });
  });
});

// ============================================================================
// Result Algebras
// ============================================================================

describe("Result algebras", () => {
  describe("built-in algebras exist", () => {
    it("optionResultAlgebra targets Option", () => {
      expect(optionResultAlgebra.name).toBe("Option");
      expect(optionResultAlgebra.targetTypes).toContain("Option");
      expect(optionResultAlgebra.preservesError).toBe(false);
    });

    it("eitherResultAlgebra targets Either", () => {
      expect(eitherResultAlgebra.name).toBe("Either");
      expect(eitherResultAlgebra.targetTypes).toContain("Either");
      expect(eitherResultAlgebra.preservesError).toBe(true);
    });

    it("unsafeResultAlgebra targets raw type", () => {
      expect(unsafeResultAlgebra.name).toBe("Unsafe");
      expect(unsafeResultAlgebra.preservesError).toBe(false);
    });

    it("promiseResultAlgebra targets Promise", () => {
      expect(promiseResultAlgebra.name).toBe("Promise");
      expect(promiseResultAlgebra.targetTypes).toContain("Promise");
      expect(promiseResultAlgebra.preservesError).toBe(true);
    });
  });

  describe("registration and lookup", () => {
    it("getResultAlgebra finds built-in algebras by target type", () => {
      // Built-in algebras are registered at module load
      expect(getResultAlgebra("Option")).toBeDefined();
      expect(getResultAlgebra("Either")).toBeDefined();
      expect(getResultAlgebra("Promise")).toBeDefined();
    });

    it("hasResultAlgebra returns true for registered types", () => {
      expect(hasResultAlgebra("Option")).toBe(true);
      expect(hasResultAlgebra("Either")).toBe(true);
    });

    it("hasResultAlgebra returns false for unregistered types", () => {
      expect(hasResultAlgebra("UnknownType")).toBe(false);
    });

    it("getAllResultAlgebras returns unique algebras", () => {
      const algebras = getAllResultAlgebras();
      const names = algebras.map((a) => a.name);
      // No duplicates
      expect(new Set(names).size).toBe(names.length);
      expect(names).toContain("Option");
      expect(names).toContain("Either");
    });

    it("registerResultAlgebra adds custom algebra", () => {
      registerResultAlgebra({
        name: "TestAlgebra",
        targetTypes: ["TestType"],
        rewriteOk: (_ctx, value) => value,
        rewriteErr: (_ctx, error) => error,
        preservesError: true,
      });

      expect(hasResultAlgebra("TestType")).toBe(true);
      const algebra = getResultAlgebra("TestType");
      expect(algebra!.name).toBe("TestAlgebra");
    });
  });
});

// ============================================================================
// Instance Method Registry
// ============================================================================

describe("instance method registry", () => {
  it("registerInstanceMethods stores methods", () => {
    registerInstanceMethods("testFunctor", "TestF", {
      map: { source: "(fa, f) => fa.map(f)", params: ["fa", "f"] },
    });

    expect(isRegisteredInstance("testFunctor")).toBe(true);
    const methods = getInstanceMethods("testFunctor");
    expect(methods).toBeDefined();
    expect(methods!.brand).toBe("TestF");
    expect(methods!.methods.has("map")).toBe(true);
    expect(methods!.methods.get("map")!.params).toEqual(["fa", "f"]);
  });

  it("registerInstanceMethodsFromAST stores methods with AST nodes", () => {
    const sf = ts.createSourceFile(
      "test.ts",
      `const fn = (a: number) => a + 1;`,
      ts.ScriptTarget.Latest,
      true
    );
    const varStmt = sf.statements[0] as ts.VariableStatement;
    const init = varStmt.declarationList.declarations[0].initializer!;

    const methods = new Map<string, { node?: ts.Expression; params: string[] }>();
    methods.set("increment", { node: init, params: ["a"] });

    registerInstanceMethodsFromAST("testInc", "Inc", methods);

    expect(isRegisteredInstance("testInc")).toBe(true);
    const result = getInstanceMethods("testInc");
    expect(result!.methods.get("increment")!.node).toBe(init);
  });

  it("getRegisteredInstanceNames returns all names", () => {
    registerInstanceMethods("regTestA", "A", {
      foo: { source: "() => 1", params: [] },
    });

    const names = getRegisteredInstanceNames();
    expect(names).toContain("regTestA");
  });

  it("isRegisteredInstance returns false for unknown", () => {
    expect(isRegisteredInstance("nonexistent_xyz_123")).toBe(false);
  });

  it("getInstanceMethods returns undefined for unknown", () => {
    expect(getInstanceMethods("nonexistent_xyz_123")).toBeUndefined();
  });

  it("getInstanceOrIntrinsicMethods falls back to intrinsics", () => {
    // Primitive intrinsics are registered at module load
    // Test that the function at least returns something for known primitives
    // or undefined for unknown ones
    const result = getInstanceOrIntrinsicMethods("nonexistent_xyz_456");
    expect(result).toBeUndefined();
  });
});

// ============================================================================
// Inline Failure Classification
// ============================================================================

describe("classifyInlineFailure", () => {
  /**
   * Helper to create a Block AST node from TypeScript source.
   */
  function parseBlock(body: string): ts.Block {
    const source = `function f() ${body}`;
    const sf = ts.createSourceFile("test.ts", source, ts.ScriptTarget.Latest, true);
    const fn = sf.statements[0] as ts.FunctionDeclaration;
    return fn.body!;
  }

  it("returns null for simple return", () => {
    const block = parseBlock(`{ return 42; }`);
    expect(classifyInlineFailure(block)).toBeNull();
  });

  it("returns null for const + return", () => {
    const block = parseBlock(`{ const x = 1; return x; }`);
    expect(classifyInlineFailure(block)).toBeNull();
  });

  it("detects early return", () => {
    const block = parseBlock(`{ if (x) return 1; return 2; }`);
    const reason = classifyInlineFailure(block);
    expect(reason).toMatch(/early return/);
  });

  it("detects try/catch", () => {
    const block = parseBlock(`{ try { return 1; } catch(e) { return 2; } }`);
    expect(classifyInlineFailure(block)).toBe("try/catch");
  });

  it("detects for loop", () => {
    const block = parseBlock(`{ for (const i in obj) {} return 0; }`);
    expect(classifyInlineFailure(block)).toBe("loop");
  });

  it("detects while loop", () => {
    const block = parseBlock(`{ while (true) { break; } return 0; }`);
    expect(classifyInlineFailure(block)).toBe("loop");
  });

  it("detects for-of loop", () => {
    const block = parseBlock(`{ for (const x of items) {} return 0; }`);
    expect(classifyInlineFailure(block)).toBe("loop");
  });

  it("detects mutable variable (let)", () => {
    const block = parseBlock(`{ let x = 0; return x; }`);
    expect(classifyInlineFailure(block)).toBe("mutable variable");
  });

  it("detects throw statement", () => {
    const block = parseBlock(`{ throw new Error("oops"); }`);
    expect(classifyInlineFailure(block)).toBe("throw statement");
  });

  it("detects no return statement", () => {
    const block = parseBlock(`{}`);
    expect(classifyInlineFailure(block)).toBe("no return statement");
  });

  it("allows const variable (not mutable)", () => {
    const block = parseBlock(`{ const x = 1; return x; }`);
    expect(classifyInlineFailure(block)).toBeNull();
  });

  it("detects nested try/catch in if statement", () => {
    const block = parseBlock(`{ if (x) { try { } catch(e) {} } return 0; }`);
    expect(classifyInlineFailure(block)).toBe("try/catch");
  });

  it("detects nested loop in if statement", () => {
    const block = parseBlock(`{ if (x) { for (const a of b) {} } return 0; }`);
    expect(classifyInlineFailure(block)).toBe("loop");
  });
});

describe("classifyInlineFailureDetailed", () => {
  function parseBlock(body: string): ts.Block {
    const source = `function f() ${body}`;
    const sf = ts.createSourceFile("test.ts", source, ts.ScriptTarget.Latest, true);
    const fn = sf.statements[0] as ts.FunctionDeclaration;
    return fn.body!;
  }

  it("provides canFlatten info for flattenable early returns", () => {
    const block = parseBlock(`{ if (x) { return 1; } return 2; }`);
    const result = classifyInlineFailureDetailed(block);
    expect(result.reason).toMatch(/early return/);
    // canFlatten depends on the flattening analysis
  });

  it("simple return is inlineable", () => {
    const block = parseBlock(`{ return 42; }`);
    const result = classifyInlineFailureDetailed(block);
    expect(result.reason).toBeNull();
    expect(result.canFlatten).toBe(false);
  });

  it("try/catch is not flattenable", () => {
    const block = parseBlock(`{ try { return 1; } catch(e) { return 2; } }`);
    const result = classifyInlineFailureDetailed(block);
    expect(result.reason).toBe("try/catch");
    expect(result.canFlatten).toBe(false);
  });
});

// ============================================================================
// getInlineFailureHelp
// ============================================================================

describe("getInlineFailureHelp", () => {
  const reasons: InlineFailureReason[] = [
    "early return",
    "early return (flattenable)",
    "try/catch",
    "loop",
    "mutable variable",
    "throw statement",
    "no return statement",
    "expression statement",
  ];

  for (const reason of reasons) {
    it(`provides help text for "${reason}"`, () => {
      const help = getInlineFailureHelp(reason);
      expect(typeof help).toBe("string");
      expect(help.length).toBeGreaterThan(0);
    });
  }

  it("returns empty string for null (inlineable)", () => {
    expect(getInlineFailureHelp(null)).toBe("");
  });
});
