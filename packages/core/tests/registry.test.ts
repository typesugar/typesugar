/**
 * Tests for the macro registry
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import {
  createRegistry,
  defineExpressionMacro,
  defineAttributeMacro,
  defineDeriveMacro,
  registerMacros,
} from "@typesugar/core";
import type { MacroRegistry, MacroContext } from "@typesugar/core";

describe("MacroRegistry", () => {
  let registry: MacroRegistry;

  beforeEach(() => {
    registry = createRegistry();
  });

  describe("expression macros", () => {
    it("should register expression macros", () => {
      const macro = defineExpressionMacro({
        name: "testMacro",
        description: "A test macro",
        expand: (_ctx, callExpr) => callExpr,
      });

      registry.register(macro);

      const retrieved = registry.getExpression("testMacro");
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("testMacro");
      expect(retrieved?.kind).toBe("expression");
    });

    it("should return undefined for non-existent macros", () => {
      const retrieved = registry.getExpression("nonExistent");
      expect(retrieved).toBeUndefined();
    });

    it("should allow idempotent registration of same macro", () => {
      const macro = defineExpressionMacro({
        name: "duplicate",
        expand: (_ctx, callExpr) => callExpr,
      });

      registry.register(macro);
      // Same object reference should be idempotent (no throw)
      expect(() => registry.register(macro)).not.toThrow();
    });

    it("should throw when registering different macros with same name and different modules", () => {
      const macro1 = defineExpressionMacro({
        name: "conflicting",
        module: "module-a",
        expand: (_ctx, callExpr) => callExpr,
      });
      const macro2 = defineExpressionMacro({
        name: "conflicting",
        module: "module-b",
        expand: (_ctx, callExpr) => callExpr,
      });

      registry.register(macro1);
      expect(() => registry.register(macro2)).toThrow(/already registered/);
    });
  });

  describe("attribute macros", () => {
    it("should register attribute macros", () => {
      const macro = defineAttributeMacro({
        name: "testAttr",
        description: "A test attribute macro",
        validTargets: ["class", "method"],
        expand: (_ctx, _decorator, target) => target,
      });

      registry.register(macro);

      const retrieved = registry.getAttribute("testAttr");
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("testAttr");
      expect(retrieved?.kind).toBe("attribute");
      expect(retrieved?.validTargets).toContain("class");
    });
  });

  describe("derive macros", () => {
    it("should register derive macros", () => {
      const macro = defineDeriveMacro({
        name: "TestDerive",
        description: "A test derive macro",
        expand: () => [],
      });

      registry.register(macro);

      const retrieved = registry.getDerive("TestDerive");
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("TestDerive");
      expect(retrieved?.kind).toBe("derive");
    });
  });

  describe("getAll", () => {
    it("should return all registered macros", () => {
      const expr = defineExpressionMacro({
        name: "expr1",
        expand: (_ctx, callExpr) => callExpr,
      });

      const attr = defineAttributeMacro({
        name: "attr1",
        validTargets: ["class"],
        expand: (_ctx, _decorator, target) => target,
      });

      const derive = defineDeriveMacro({
        name: "Derive1",
        expand: () => [],
      });

      registry.register(expr);
      registry.register(attr);
      registry.register(derive);

      const all = registry.getAll();
      expect(all).toHaveLength(3);
      expect(all.map((m) => m.name)).toContain("expr1");
      expect(all.map((m) => m.name)).toContain("attr1");
      expect(all.map((m) => m.name)).toContain("Derive1");
    });

    it("should return empty array when no macros registered", () => {
      expect(registry.getAll()).toHaveLength(0);
    });
  });

  describe("registerMacros helper", () => {
    it("should register multiple macros at once", () => {
      const macro1 = defineExpressionMacro({
        name: "multi1",
        expand: (_ctx, callExpr) => callExpr,
      });

      const macro2 = defineExpressionMacro({
        name: "multi2",
        expand: (_ctx, callExpr) => callExpr,
      });

      registerMacros(registry, macro1, macro2);

      expect(registry.getExpression("multi1")).toBeDefined();
      expect(registry.getExpression("multi2")).toBeDefined();
    });
  });
});

describe("defineExpressionMacro", () => {
  it("should create a properly typed expression macro", () => {
    const macro = defineExpressionMacro({
      name: "myMacro",
      description: "My macro",
      expand(
        ctx: MacroContext,
        _callExpr: ts.CallExpression,
        args: readonly ts.Expression[],
      ) {
        if (args.length > 0) {
          return ctx.createNumericLiteral(42);
        }
        return ctx.createStringLiteral("no args");
      },
    });

    expect(macro.kind).toBe("expression");
    expect(macro.name).toBe("myMacro");
    expect(macro.description).toBe("My macro");
    expect(typeof macro.expand).toBe("function");
  });
});

describe("defineAttributeMacro", () => {
  it("should create a properly typed attribute macro", () => {
    const macro = defineAttributeMacro({
      name: "myAttr",
      validTargets: ["class", "function"],
      expand(_ctx, _decorator, target) {
        return target;
      },
    });

    expect(macro.kind).toBe("attribute");
    expect(macro.name).toBe("myAttr");
    expect(macro.validTargets).toEqual(["class", "function"]);
  });
});

describe("defineDeriveMacro", () => {
  it("should create a properly typed derive macro", () => {
    const macro = defineDeriveMacro({
      name: "MyDerive",
      expand(ctx) {
        return [
          ...ctx.parseStatements(`export function derived() { return 42; }`),
        ];
      },
    });

    expect(macro.kind).toBe("derive");
    expect(macro.name).toBe("MyDerive");
  });
});

// ============================================================================
// GenericRegistry Tests
// ============================================================================

import {
  createGenericRegistry,
  type GenericRegistry,
} from "@typesugar/core";

describe("GenericRegistry", () => {
  describe("basic operations", () => {
    it("should set and get values", () => {
      const registry = createGenericRegistry<string, number>({ name: "Test" });
      
      registry.set("a", 1);
      registry.set("b", 2);
      
      expect(registry.get("a")).toBe(1);
      expect(registry.get("b")).toBe(2);
    });

    it("should return undefined for missing keys", () => {
      const registry = createGenericRegistry<string, number>({ name: "Test" });
      
      expect(registry.get("missing")).toBeUndefined();
    });

    it("should track size correctly", () => {
      const registry = createGenericRegistry<string, number>({ name: "Test" });
      
      expect(registry.size).toBe(0);
      registry.set("a", 1);
      expect(registry.size).toBe(1);
      registry.set("b", 2);
      expect(registry.size).toBe(2);
    });

    it("should support has() check", () => {
      const registry = createGenericRegistry<string, number>({ name: "Test" });
      
      registry.set("a", 1);
      expect(registry.has("a")).toBe(true);
      expect(registry.has("b")).toBe(false);
    });

    it("should support delete()", () => {
      const registry = createGenericRegistry<string, number>({ name: "Test" });
      
      registry.set("a", 1);
      expect(registry.has("a")).toBe(true);
      
      const deleted = registry.delete("a");
      expect(deleted).toBe(true);
      expect(registry.has("a")).toBe(false);
      expect(registry.delete("a")).toBe(false);
    });

    it("should support clear()", () => {
      const registry = createGenericRegistry<string, number>({ name: "Test" });
      
      registry.set("a", 1);
      registry.set("b", 2);
      registry.clear();
      
      expect(registry.size).toBe(0);
      expect(registry.has("a")).toBe(false);
    });
  });

  describe("iteration", () => {
    it("should support for...of iteration", () => {
      const registry = createGenericRegistry<string, number>({ name: "Test" });
      registry.set("a", 1);
      registry.set("b", 2);
      
      const entries: [string, number][] = [];
      for (const entry of registry) {
        entries.push(entry);
      }
      
      expect(entries).toHaveLength(2);
      expect(entries).toContainEqual(["a", 1]);
      expect(entries).toContainEqual(["b", 2]);
    });

    it("should support entries()", () => {
      const registry = createGenericRegistry<string, number>({ name: "Test" });
      registry.set("a", 1);
      
      const entries = [...registry.entries()];
      expect(entries).toEqual([["a", 1]]);
    });

    it("should support keys()", () => {
      const registry = createGenericRegistry<string, number>({ name: "Test" });
      registry.set("a", 1);
      registry.set("b", 2);
      
      const keys = [...registry.keys()];
      expect(keys).toContain("a");
      expect(keys).toContain("b");
    });

    it("should support values()", () => {
      const registry = createGenericRegistry<string, number>({ name: "Test" });
      registry.set("a", 1);
      registry.set("b", 2);
      
      const values = [...registry.values()];
      expect(values).toContain(1);
      expect(values).toContain(2);
    });

    it("should support forEach()", () => {
      const registry = createGenericRegistry<string, number>({ name: "Test" });
      registry.set("a", 1);
      registry.set("b", 2);
      
      const seen: [string, number][] = [];
      registry.forEach((value, key) => {
        seen.push([key, value]);
      });
      
      expect(seen).toHaveLength(2);
      expect(seen).toContainEqual(["a", 1]);
      expect(seen).toContainEqual(["b", 2]);
    });
  });

  describe("duplicate strategies", () => {
    it("should error on duplicates with 'error' strategy", () => {
      const registry = createGenericRegistry<string, number>({
        name: "Test",
        duplicateStrategy: "error",
      });
      
      registry.set("a", 1);
      expect(() => registry.set("a", 2)).toThrow(/already exists/);
    });

    it("should skip duplicates with 'skip' strategy", () => {
      const registry = createGenericRegistry<string, number>({
        name: "Test",
        duplicateStrategy: "skip",
      });
      
      registry.set("a", 1);
      registry.set("a", 2);
      
      expect(registry.get("a")).toBe(1);
    });

    it("should replace duplicates with 'replace' strategy", () => {
      const registry = createGenericRegistry<string, number>({
        name: "Test",
        duplicateStrategy: "replace",
      });
      
      registry.set("a", 1);
      registry.set("a", 2);
      
      expect(registry.get("a")).toBe(2);
    });

    it("should merge duplicates with 'merge' strategy and custom merger", () => {
      const registry = createGenericRegistry<string, number[]>({
        name: "Test",
        duplicateStrategy: "merge",
        merge: (existing, incoming) => [...existing, ...incoming],
      });
      
      registry.set("a", [1, 2]);
      registry.set("a", [3, 4]);
      
      expect(registry.get("a")).toEqual([1, 2, 3, 4]);
    });

    it("should require merge function for merge strategy", () => {
      expect(() => createGenericRegistry<string, number>({
        name: "Test",
        duplicateStrategy: "merge",
      })).toThrow(/merge function is required/);
    });
  });

  describe("valueEquals option", () => {
    it("should use valueEquals to detect true duplicates in skip mode", () => {
      interface Item { id: number; name: string }
      
      const registry = createGenericRegistry<string, Item>({
        name: "Test",
        duplicateStrategy: "skip",
        valueEquals: (a, b) => a.id === b.id,
      });
      
      registry.set("a", { id: 1, name: "first" });
      registry.set("a", { id: 1, name: "second" });
      
      expect(registry.get("a")?.name).toBe("first");
    });
  });
});
