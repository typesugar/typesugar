/**
 * Tests for typeclass.ts — Typeclass registry, instance management, and derivation
 *
 * Covers:
 * - Typeclass registry: register, lookup, clear, standard typeclasses
 * - Instance registry: register, lookup, duplicate detection, update
 * - Derivation context management
 * - HKT typeclass registration
 * - Operator syntax mapping
 * - FlatMap/ParCombine instance management
 * - ParCombine builder registry
 * - Coverage hooks
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getTypeclasses,
  getInstances,
  clearRegistries,
  registerStandardTypeclasses,
  registerTypeclassDef,
  updateTypeclassSyntax,
  registerInstanceWithMeta,
  getInstanceMeta,
  getFlatMapMethodNames,
  hasFlatMapInstance,
  hasParCombineInstance,
  registerParCombineBuilder,
  getParCombineBuilderFromRegistry,
  registerHKTTypeclass,
  registerHKTExpansion,
  hktTypeclassNames,
  hktExpansionRegistry,
  withDerivationContext,
  setCoverageHooks,
} from "./typeclass.js";

// ============================================================================
// Registry Setup
// ============================================================================

describe("typeclass registry", () => {
  beforeEach(() => {
    clearRegistries();
  });

  describe("clearRegistries", () => {
    it("clears all typeclasses", () => {
      registerStandardTypeclasses();
      expect(getTypeclasses().size).toBeGreaterThan(0);
      clearRegistries();
      expect(getTypeclasses().size).toBe(0);
    });

    it("clears all instances", () => {
      registerInstanceWithMeta({
        typeclassName: "Eq",
        forType: "number",
        instanceName: "eqNumber",
        derived: false,
      });
      expect(getInstances().size).toBe(1);
      clearRegistries();
      expect(getInstances().size).toBe(0);
    });
  });

  describe("registerStandardTypeclasses", () => {
    it("registers Eq, Ord, Semigroup, Monoid, Clone, Debug, and more", () => {
      registerStandardTypeclasses();
      const tcs = getTypeclasses();
      expect(tcs.has("Eq")).toBe(true);
      expect(tcs.has("Ord")).toBe(true);
      expect(tcs.has("Semigroup")).toBe(true);
      expect(tcs.has("Monoid")).toBe(true);
      expect(tcs.has("Clone")).toBe(true);
      expect(tcs.has("Debug")).toBe(true);
    });

    it("Eq has correct methods", () => {
      registerStandardTypeclasses();
      const eq = getTypeclasses().get("Eq")!;
      expect(eq.methods.length).toBe(2);
      const methodNames = eq.methods.map((m) => m.name);
      expect(methodNames).toContain("equals");
      expect(methodNames).toContain("notEquals");
    });

    it("Eq can derive products and sums", () => {
      registerStandardTypeclasses();
      const eq = getTypeclasses().get("Eq")!;
      expect(eq.canDeriveProduct).toBe(true);
      expect(eq.canDeriveSum).toBe(true);
    });

    it("Semigroup can derive products but not sums", () => {
      registerStandardTypeclasses();
      const sg = getTypeclasses().get("Semigroup")!;
      expect(sg.canDeriveProduct).toBe(true);
      expect(sg.canDeriveSum).toBe(false);
    });

    it("Eq has operator syntax", () => {
      registerStandardTypeclasses();
      const eq = getTypeclasses().get("Eq")!;
      expect(eq.syntax).toBeDefined();
      expect(eq.syntax!.get("===")).toBe("equals");
      expect(eq.syntax!.get("!==")).toBe("notEquals");
    });

    it("Ord has comparison operator syntax", () => {
      registerStandardTypeclasses();
      const ord = getTypeclasses().get("Ord")!;
      expect(ord.syntax!.get("<")).toBe("lessThan");
      expect(ord.syntax!.get("<=")).toBe("lessThanOrEqual");
      expect(ord.syntax!.get(">")).toBe("greaterThan");
      expect(ord.syntax!.get(">=")).toBe("greaterThanOrEqual");
    });
  });

  describe("getTypeclasses", () => {
    it("returns a copy of the registry", () => {
      registerStandardTypeclasses();
      const tcs1 = getTypeclasses();
      const tcs2 = getTypeclasses();
      // Different map instances
      expect(tcs1).not.toBe(tcs2);
      // Same content
      expect(tcs1.size).toBe(tcs2.size);
    });

    it("mutations to returned map don't affect registry", () => {
      registerStandardTypeclasses();
      const tcs = getTypeclasses();
      tcs.delete("Eq");
      // Original registry should still have Eq
      expect(getTypeclasses().has("Eq")).toBe(true);
    });
  });

  describe("registerTypeclassDef", () => {
    it("registers a new typeclass", () => {
      registerTypeclassDef({
        name: "Pretty",
        typeParam: "A",
        methods: [
          {
            name: "prettyPrint",
            params: [{ name: "a", typeString: "A" }],
            returnType: "string",
            isSelfMethod: true,
          },
        ],
        canDeriveProduct: true,
        canDeriveSum: false,
      });

      const tcs = getTypeclasses();
      expect(tcs.has("Pretty")).toBe(true);
      const pretty = tcs.get("Pretty")!;
      expect(pretty.typeParam).toBe("A");
      expect(pretty.methods[0].name).toBe("prettyPrint");
    });

    it("overwrites existing registration", () => {
      registerTypeclassDef({
        name: "Foo",
        typeParam: "A",
        methods: [],
        canDeriveProduct: false,
        canDeriveSum: false,
      });
      registerTypeclassDef({
        name: "Foo",
        typeParam: "B",
        methods: [],
        canDeriveProduct: true,
        canDeriveSum: true,
      });

      const foo = getTypeclasses().get("Foo")!;
      expect(foo.typeParam).toBe("B");
      expect(foo.canDeriveProduct).toBe(true);
    });
  });

  describe("updateTypeclassSyntax", () => {
    it("adds syntax to existing typeclass", () => {
      registerStandardTypeclasses();
      const newSyntax = new Map([["==", "looseEquals"]]);
      updateTypeclassSyntax("Eq", newSyntax);

      const eq = getTypeclasses().get("Eq")!;
      expect(eq.syntax!.get("==")).toBe("looseEquals");
      // Existing syntax preserved
      expect(eq.syntax!.get("===")).toBe("equals");
    });

    it("creates placeholder for unknown typeclass", () => {
      const syntax = new Map([["@", "at"]]);
      updateTypeclassSyntax("AtTypeclass", syntax);

      const tc = getTypeclasses().get("AtTypeclass")!;
      expect(tc).toBeDefined();
      expect(tc.syntax!.get("@")).toBe("at");
      expect(tc.methods).toEqual([]);
      expect(tc.canDeriveProduct).toBe(false);
    });
  });
});

// ============================================================================
// Instance Registry
// ============================================================================

describe("instance registry", () => {
  beforeEach(() => {
    clearRegistries();
    registerStandardTypeclasses();
  });

  describe("registerInstanceWithMeta", () => {
    it("registers a new instance", () => {
      registerInstanceWithMeta({
        typeclassName: "Show",
        forType: "number",
        instanceName: "showNumber",
        derived: false,
      });

      const instances = getInstances();
      expect(instances.has("Show<number>")).toBe(true);
      const inst = instances.get("Show<number>")!;
      expect(inst.instanceName).toBe("showNumber");
      expect(inst.derived).toBe(false);
    });

    it("updates existing instance (duplicate detection)", () => {
      registerInstanceWithMeta({
        typeclassName: "Eq",
        forType: "Point",
        instanceName: "eqPoint_v1",
        derived: true,
      });
      registerInstanceWithMeta({
        typeclassName: "Eq",
        forType: "Point",
        instanceName: "eqPoint_v2",
        derived: false,
      });

      const instances = getInstances();
      const inst = instances.get("Eq<Point>")!;
      // Should have the updated instance
      expect(inst.instanceName).toBe("eqPoint_v2");
      expect(inst.derived).toBe(false);
    });

    it("auto-computes companionPath for primitives when instanceValue provided", () => {
      registerInstanceWithMeta(
        {
          typeclassName: "Show",
          forType: "number",
          instanceName: "showNumber",
          derived: false,
        },
        { show: (a: number) => String(a) }
      );

      const inst = getInstances().get("Show<number>")!;
      expect(inst.companionPath).toBe("Show.number");
    });

    it("auto-computes companionPath for user types when instanceValue provided", () => {
      registerInstanceWithMeta(
        {
          typeclassName: "Eq",
          forType: "Point",
          instanceName: "eqPoint",
          derived: true,
        },
        { equals: () => true }
      );

      const inst = getInstances().get("Eq<Point>")!;
      expect(inst.companionPath).toBe("Point.Eq");
    });

    it("does not override explicit companionPath", () => {
      registerInstanceWithMeta(
        {
          typeclassName: "Eq",
          forType: "Point",
          instanceName: "eqPoint",
          companionPath: "Custom.Path",
          derived: false,
        },
        {}
      );

      const inst = getInstances().get("Eq<Point>")!;
      expect(inst.companionPath).toBe("Custom.Path");
    });

    it("stores metadata", () => {
      registerInstanceWithMeta({
        typeclassName: "FlatMap",
        forType: "Promise",
        instanceName: "flatMapPromise",
        derived: false,
        meta: {
          methodNames: { bind: "then", map: "then", orElse: "catch" },
        },
      });

      const meta = getInstanceMeta("FlatMap", "Promise");
      expect(meta).toBeDefined();
      expect(meta!.methodNames!.bind).toBe("then");
      expect(meta!.methodNames!.map).toBe("then");
      expect(meta!.methodNames!.orElse).toBe("catch");
    });
  });

  describe("getInstances", () => {
    it("returns a copy keyed by Typeclass<Type>", () => {
      registerInstanceWithMeta({
        typeclassName: "Show",
        forType: "number",
        instanceName: "showNumber",
        derived: false,
      });
      registerInstanceWithMeta({
        typeclassName: "Eq",
        forType: "string",
        instanceName: "eqString",
        derived: false,
      });

      const instances = getInstances();
      expect(instances.size).toBe(2);
      expect(instances.has("Show<number>")).toBe(true);
      expect(instances.has("Eq<string>")).toBe(true);
    });
  });

  describe("getInstanceMeta", () => {
    it("returns undefined for non-existent instance", () => {
      const meta = getInstanceMeta("Show", "UnknownType");
      expect(meta).toBeUndefined();
    });

    it("returns undefined when instance has no metadata", () => {
      registerInstanceWithMeta({
        typeclassName: "Eq",
        forType: "Point",
        instanceName: "eqPoint",
        derived: true,
      });
      const meta = getInstanceMeta("Eq", "Point");
      expect(meta).toBeUndefined();
    });
  });
});

// ============================================================================
// FlatMap Method Names
// ============================================================================

describe("getFlatMapMethodNames", () => {
  beforeEach(() => {
    clearRegistries();
    registerStandardTypeclasses();
  });

  it("returns defaults for unknown type", () => {
    const names = getFlatMapMethodNames("Array");
    expect(names.bind).toBe("flatMap");
    expect(names.map).toBe("map");
    expect(names.orElse).toBe("orElse");
  });

  it("returns Promise-specific method names", () => {
    const names = getFlatMapMethodNames("Promise");
    expect(names.bind).toBe("then");
    expect(names.map).toBe("then");
    expect(names.orElse).toBe("catch");
  });

  it("returns Effect-specific method names", () => {
    const names = getFlatMapMethodNames("Effect");
    expect(names.bind).toBe("flatMap");
    expect(names.map).toBe("map");
    expect(names.orElse).toBe("catchAll");
  });

  it("uses custom method names from metadata", () => {
    registerInstanceWithMeta({
      typeclassName: "FlatMap",
      forType: "Task",
      instanceName: "flatMapTask",
      derived: false,
      meta: {
        methodNames: { bind: "chain", map: "fmap" },
      },
    });

    const names = getFlatMapMethodNames("Task");
    expect(names.bind).toBe("chain");
    expect(names.map).toBe("fmap");
    expect(names.orElse).toBe("orElse"); // falls back to default
  });
});

// ============================================================================
// hasFlatMapInstance / hasParCombineInstance
// ============================================================================

describe("hasFlatMapInstance / hasParCombineInstance", () => {
  beforeEach(() => {
    clearRegistries();
    registerStandardTypeclasses();
  });

  it("hasFlatMapInstance returns false when no instance registered", () => {
    expect(hasFlatMapInstance("Array")).toBe(false);
  });

  it("hasFlatMapInstance returns true when instance registered", () => {
    registerInstanceWithMeta({
      typeclassName: "FlatMap",
      forType: "Array",
      instanceName: "flatMapArray",
      derived: false,
    });
    expect(hasFlatMapInstance("Array")).toBe(true);
  });

  it("hasParCombineInstance returns false when no instance registered", () => {
    expect(hasParCombineInstance("Promise")).toBe(false);
  });

  it("hasParCombineInstance returns true when instance registered", () => {
    registerInstanceWithMeta({
      typeclassName: "ParCombine",
      forType: "Promise",
      instanceName: "parCombinePromise",
      derived: false,
    });
    expect(hasParCombineInstance("Promise")).toBe(true);
  });
});

// ============================================================================
// ParCombine Builder Registry
// ============================================================================

describe("ParCombine builder registry", () => {
  it("registers and retrieves a builder", () => {
    const mockBuilder = (() => {}) as any;
    registerParCombineBuilder("Promise", mockBuilder);
    expect(getParCombineBuilderFromRegistry("Promise")).toBe(mockBuilder);
  });

  it("returns undefined for unregistered builder", () => {
    expect(getParCombineBuilderFromRegistry("NonexistentType")).toBeUndefined();
  });
});

// ============================================================================
// HKT Registration
// ============================================================================

describe("HKT registration", () => {
  it("hktTypeclassNames contains standard HKT typeclasses", () => {
    expect(hktTypeclassNames.has("Functor")).toBe(true);
    expect(hktTypeclassNames.has("Monad")).toBe(true);
    expect(hktTypeclassNames.has("Foldable")).toBe(true);
    expect(hktTypeclassNames.has("Traverse")).toBe(true);
  });

  it("registerHKTTypeclass adds to hktTypeclassNames", () => {
    registerHKTTypeclass("MyHKT");
    expect(hktTypeclassNames.has("MyHKT")).toBe(true);
    // cleanup
    hktTypeclassNames.delete("MyHKT");
  });

  it("hktExpansionRegistry has standard expansions", () => {
    expect(hktExpansionRegistry.has("OptionF")).toBe(true);
    expect(hktExpansionRegistry.get("OptionF")).toBe("Option");
  });

  it("registerHKTExpansion adds expansion", () => {
    registerHKTExpansion("TaskF", "Task");
    expect(hktExpansionRegistry.get("TaskF")).toBe("Task");
    // cleanup
    hktExpansionRegistry.delete("TaskF");
  });
});

// ============================================================================
// withDerivationContext
// ============================================================================

describe("withDerivationContext", () => {
  it("returns the value from the callback", () => {
    const result = withDerivationContext(null as any, () => 42);
    expect(result).toBe(42);
  });

  it("restores context after normal return", () => {
    // Just test that no errors occur with nested calls
    const result = withDerivationContext(null as any, () => {
      return withDerivationContext(null as any, () => "inner");
    });
    expect(result).toBe("inner");
  });

  it("restores context after exception", () => {
    try {
      withDerivationContext(null as any, () => {
        throw new Error("test error");
      });
    } catch (e) {
      // Error is expected; context should be cleaned up
    }
    // Should not throw on next call
    const result = withDerivationContext(null as any, () => "recovered");
    expect(result).toBe("recovered");
  });
});

// ============================================================================
// Coverage Hooks
// ============================================================================

describe("setCoverageHooks", () => {
  it("accepts hook functions without error", () => {
    // setCoverageHooks registers callbacks used during the derive pipeline.
    // The hooks are invoked by notifyPrimitiveRegistered() and
    // checkCoverageForDerive() — both internal to the derivation flow
    // which requires a full MacroContext. Here we verify registration
    // itself doesn't throw and the validate hook shape is accepted.
    const registerFn = (_typeName: string, _tcName: string) => {};
    const validateFn = () => true;
    expect(() => setCoverageHooks(registerFn, validateFn)).not.toThrow();
  });
});
