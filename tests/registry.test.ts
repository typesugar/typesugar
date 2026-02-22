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

    it("should allow idempotent registration of the same macro", () => {
      const macro = defineExpressionMacro({
        name: "duplicate",
        expand: (_ctx, callExpr) => callExpr,
      });

      registry.register(macro);
      expect(() => registry.register(macro)).not.toThrow();
    });

    it("should throw when registering a different macro with the same name", () => {
      const macro1 = defineExpressionMacro({
        name: "duplicate",
        module: "module-a",
        expand: (_ctx, callExpr) => callExpr,
      });
      const macro2 = defineExpressionMacro({
        name: "duplicate",
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
      expand(ctx: MacroContext, _callExpr: ts.CallExpression, args: readonly ts.Expression[]) {
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
        return [...ctx.parseStatements(`export function derived() { return 42; }`)];
      },
    });

    expect(macro.kind).toBe("derive");
    expect(macro.name).toBe("MyDerive");
  });
});
