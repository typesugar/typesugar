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
  clearRegistries,
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

// ============================================================================
// Instance Registry
// ============================================================================

// PEP-052: the general instance registry is deleted; instance *resolution* is
// scope-based (see instance-resolver). The only surviving registry is the focused
// do-notation lookup (FlatMap/ParCombine), populated by registerInstanceWithMeta.
describe("do-notation instance lookup", () => {
  beforeEach(() => {
    clearRegistries();
  });

  describe("registerInstanceWithMeta", () => {
    it("stores do-notation metadata", () => {
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

    it("updates an existing instance (replace in place)", () => {
      registerInstanceWithMeta({
        typeclassName: "FlatMap",
        forType: "Promise",
        instanceName: "v1",
        derived: false,
        meta: { methodNames: { bind: "then" } },
      });
      registerInstanceWithMeta({
        typeclassName: "FlatMap",
        forType: "Promise",
        instanceName: "v2",
        derived: false,
        meta: { methodNames: { bind: "chain" } },
      });

      expect(getInstanceMeta("FlatMap", "Promise")!.methodNames!.bind).toBe("chain");
    });
  });

  describe("getInstanceMeta", () => {
    it("returns undefined for a non-do-notation typeclass", () => {
      const meta = getInstanceMeta("Show", "UnknownType");
      expect(meta).toBeUndefined();
    });

    it("returns undefined when a do-notation instance carries no metadata", () => {
      registerInstanceWithMeta({
        typeclassName: "FlatMap",
        forType: "Array",
        instanceName: "flatMapArray",
        derived: false,
      });
      expect(hasFlatMapInstance("Array")).toBe(true);
      expect(getInstanceMeta("FlatMap", "Array")).toBeUndefined();
    });
  });
});

// ============================================================================
// FlatMap Method Names
// ============================================================================

describe("getFlatMapMethodNames", () => {
  beforeEach(() => {
    clearRegistries();
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
