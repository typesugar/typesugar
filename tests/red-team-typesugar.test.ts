/**
 * Red Team Tests for typesugar umbrella
 *
 * Attack surfaces:
 * - Re-export completeness (are all expected symbols accessible?)
 * - Subpath import correctness (do typesugar/vite, typesugar/webpack work?)
 * - Namespace vs direct export conflicts (comptime namespace vs comptimeEval)
 * - Derive symbol export correctness (Eq, Ord, Clone, etc.)
 * - Decorator function behavior (derive, deriveDecorator)
 * - registerAllMacros idempotency and side effects
 *
 * NOTE: This file tests runtime behavior of macros, so we opt out of macro expansion.
 *
 * The umbrella root ("typesugar") is runtime-only by design (it must not load
 * the TypeScript compiler): it has no `*Namespace` exports and re-exports
 * @typesugar/core as TYPES only. Core VALUE APIs live at "typesugar/core", so
 * those assertions import from there.
 */
"use no typesugar";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Main umbrella import
import * as typesugar from "typesugar";

// Direct imports of specific exports
import {
  // Direct callable exports
  pipe,
  compose,
  comptime,
  // Derive symbols
  Eq,
  Ord,
  Clone,
  Debug,
  Hash,
  Default,
  Json,
  TypeGuard,
  // Decorator functions
  derive,
  // Registration
  registerAllMacros,
} from "typesugar";

// Core value APIs: "typesugar/core" (the root re-exports core as types only)
import {
  globalRegistry,
  defineExpressionMacro,
  defineAttributeMacro,
  defineDeriveMacro,
  invariant,
  unreachable,
  debugOnly,
  config,
  defineConfig as coreDefineConfig,
} from "typesugar/core";
import { defineConfig } from "typesugar";

describe("Typesugar Umbrella Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Re-export Completeness
  // ==========================================================================
  describe("Re-export completeness", () => {
    it("the runtime-only root has no namespace or core value re-exports", () => {
      const root = typesugar as Record<string, unknown>;
      for (const name of [
        "reflectNamespace",
        "deriveNamespace",
        "typeclassNamespace",
        "globalRegistry",
        "defineExpressionMacro",
      ]) {
        expect([name, root[name]]).toEqual([name, undefined]);
      }
    });

    it("exports all derive markers", () => {
      // Eq, Ord, Hash, Show are frozen objects carrying primitive instances
      expect(typeof Eq).toBe("object");
      expect(Eq.number).toBeDefined();
      expect(typeof Ord).toBe("object");
      expect(Ord.number).toBeDefined();
      expect(typeof Hash).toBe("object");
      expect(Hash.number).toBeDefined();
      // Clone, Debug, Default, Json, TypeGuard remain symbols
      expect(typeof Clone).toBe("symbol");
      expect(typeof Debug).toBe("symbol");
      expect(typeof Default).toBe("symbol");
      expect(typeof Json).toBe("symbol");
      expect(typeof TypeGuard).toBe("symbol");
    });

    it("typesugar/core exports core macro infrastructure", () => {
      expect(globalRegistry).toBeDefined();
      expect(typeof defineExpressionMacro).toBe("function");
      expect(typeof defineAttributeMacro).toBe("function");
      expect(typeof defineDeriveMacro).toBe("function");
    });

    it("typesugar/core exports safety primitives", () => {
      expect(typeof invariant).toBe("function");
      expect(typeof unreachable).toBe("function");
      expect(typeof debugOnly).toBe("function");
    });

    it("exports the config system (root defineConfig is a runtime identity)", () => {
      expect(config).toBeDefined();
      expect(typeof coreDefineConfig).toBe("function");
      expect(typeof defineConfig).toBe("function");
      const cfg = {};
      expect(defineConfig(cfg)).toBe(cfg);
    });
  });

  // ==========================================================================
  // Attack 2: Namespace vs Direct Export Conflicts
  // ==========================================================================
  describe("Namespace vs direct export conflicts", () => {
    it("comptime is exported as a function (no separate namespace)", () => {
      // comptime is just a callable function, not a namespace module
      // (unlike reflect/derive/typeclass/specialize which have separate packages)
      expect(typeof comptime).toBe("function");
    });

    it("direct pipe/compose exports are functions", () => {
      // These are exported directly from @typesugar/macros
      expect(typeof pipe).toBe("function");
      expect(typeof compose).toBe("function");
    });
  });

  // ==========================================================================
  // Attack 3: Decorator Function Behavior
  // ==========================================================================
  describe("Decorator function behavior", () => {
    it("derive is the derive decorator function", () => {
      expect(typeof derive).toBe("function");
    });

    it("derive decorator returns a function (class decorator signature)", () => {
      const decorator = derive(Eq, Clone);
      expect(typeof decorator).toBe("function");
    });

    it("derive decorator can be applied without throwing", () => {
      // The decorator is a no-op at runtime (processed at compile time)
      const decorator = derive(Eq);

      class TestClass {
        value: number = 0;
      }

      // Applying should not throw
      expect(() => decorator(TestClass)).not.toThrow();
    });

    it("derive decorator accepts any number of derive symbols", () => {
      // Single derive
      expect(() => derive(Eq)).not.toThrow();

      // Multiple derives
      expect(() => derive(Eq, Ord, Clone, Debug)).not.toThrow();

      // Empty (edge case - should still return valid decorator)
      const emptyDecorator = derive();
      expect(typeof emptyDecorator).toBe("function");
    });

    it("derive decorator accepts non-symbol arguments without runtime error", () => {
      // At runtime, the decorator is a no-op, so it accepts anything
      // The macro transformer validates at compile time
      const decorator = derive("Eq" as unknown, 123 as unknown);
      expect(typeof decorator).toBe("function");
    });
  });

  // ==========================================================================
  // Attack 4: registerAllMacros Behavior
  // ==========================================================================
  describe("registerAllMacros behavior", () => {
    it("registerAllMacros is a function", () => {
      expect(typeof registerAllMacros).toBe("function");
    });

    it("registerAllMacros can be called multiple times without throwing", () => {
      // Should be idempotent
      expect(() => registerAllMacros()).not.toThrow();
      expect(() => registerAllMacros()).not.toThrow();
      expect(() => registerAllMacros()).not.toThrow();
    });

    it("registerAllMacros is a deprecated no-op", () => {
      // Macros are registered by the transformer (or `import "@typesugar/macros"`);
      // the runtime-only umbrella's registerAllMacros does nothing.
      expect(registerAllMacros()).toBeUndefined();
    });
  });

  // ==========================================================================
  // Attack 5: Runtime Placeholder Function Behavior
  // ==========================================================================
  describe("Runtime placeholder function behavior", () => {
    it("pipe() executes functions left-to-right at runtime", () => {
      const add1 = (x: number) => x + 1;
      const double = (x: number) => x * 2;

      // pipe(5, add1, double) = double(add1(5)) = double(6) = 12
      expect(pipe(5, add1, double)).toBe(12);

      // Single value returns itself
      expect(pipe(42)).toBe(42);
    });

    it("compose() creates right-to-left composition at runtime", () => {
      const add1 = (x: number) => x + 1;
      const double = (x: number) => x * 2;

      // compose(add1, double) = (x) => add1(double(x))
      const composed = compose(add1, double);
      expect(composed(5)).toBe(11); // double(5) = 10, add1(10) = 11

      // Single function returns itself
      const identity = compose(add1);
      expect(identity(5)).toBe(6);
    });

    it("pipe() handles empty chain edge case", () => {
      // With overloads, pipe requires at least one argument at type level
      // At runtime, the variadic signature handles it
      expect(pipe(42)).toBe(42);
    });

    it("compose() handles various arities", () => {
      const f1 = (x: number) => x + 1;
      const f2 = (x: number) => x * 2;
      const f3 = (x: number) => x - 3;

      // compose(f1, f2, f3)(10) = f1(f2(f3(10))) = f1(f2(7)) = f1(14) = 15
      const composed = compose(f1, f2, f3);
      expect(composed(10)).toBe(15);
    });
  });

  // ==========================================================================
  // Attack 6: Type Export Verification
  // ==========================================================================
  describe("Type export verification", () => {
    it("exports MacroContext type (via @typesugar/core)", () => {
      // Type-only check - this verifies the import compiles
      type _Test = import("typesugar").MacroContext;
    });

    it("exports ComptimeValue type (via @typesugar/core)", () => {
      type _Test = import("typesugar").ComptimeValue;
    });

    it("exports MacroDefinition type (via @typesugar/core)", () => {
      type _Test = import("typesugar").MacroDefinition;
    });

    it("exports DeriveTypeInfo type (via @typesugar/core)", () => {
      type _Test = import("typesugar").DeriveTypeInfo;
    });

    it("exports TypesugarConfig type", () => {
      type _Test = import("typesugar").TypesugarConfig;
    });
  });

  // ==========================================================================
  // Attack 7: Cross-Module Consistency
  // ==========================================================================
  describe("Cross-module consistency", () => {
    it("derive marker descriptions match their names", () => {
      // Eq, Ord, Hash, Show are now frozen objects (not symbols)
      // Clone, Debug, Default, Json, TypeGuard remain symbols with descriptions
      expect(Clone.description).toBe("Clone");
      expect(Debug.description).toBe("Debug");
      expect(Default.description).toBe("Default");
      expect(Json.description).toBe("Json");
      expect(TypeGuard.description).toBe("TypeGuard");
    });

    it("derive symbols are unique (not Symbol.for)", () => {
      // Symbol-based markers should be unique, not globally registered
      expect(Eq).not.toBe(Symbol.for("Eq"));
      expect(Ord).not.toBe(Symbol.for("Ord"));

      // And they should be different from each other
      expect(Eq).not.toBe(Ord);
      expect(Clone).not.toBe(Debug);
    });

    it("globalRegistry is a singleton with expected MacroRegistry interface", () => {
      // Verify globalRegistry has the expected MacroRegistry interface
      // This confirms it's the actual registry, not a stub
      expect(typeof globalRegistry.register).toBe("function");
      expect(typeof globalRegistry.getExpression).toBe("function");
      expect(typeof globalRegistry.getAttribute).toBe("function");
      expect(typeof globalRegistry.getDerive).toBe("function");
      expect(typeof globalRegistry.getTaggedTemplate).toBe("function");
      expect(typeof globalRegistry.getType).toBe("function");
      expect(typeof globalRegistry.getLabeledBlock).toBe("function");
      expect(typeof globalRegistry.getAll).toBe("function");
    });
  });
});
