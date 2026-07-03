/**
 * Tests for typeclass.ts — Typeclass helpers and derivation
 *
 * Covers:
 * - HKT typeclass registration
 * - Derivation context management
 * - Coverage hooks
 *
 * Instance resolution is scope-based (PEP-052) and tested in
 * instance-scanner.test.ts / instance-resolver.test.ts and
 * packages/std/tests/pep052-do-scope.test.ts.
 */

import { describe, it, expect } from "vitest";
import {
  registerHKTTypeclass,
  registerHKTExpansion,
  hktTypeclassNames,
  hktExpansionRegistry,
  withDerivationContext,
  setCoverageHooks,
} from "./typeclass.js";

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
