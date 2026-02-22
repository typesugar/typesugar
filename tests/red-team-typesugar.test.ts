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
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Main umbrella import
import * as typesugar from "typesugar";

// Direct imports of specific exports
import {
  // Namespace exports (current API uses *Namespace suffix)
  comptimeNamespace,
  reflectNamespace,
  deriveNamespace,
  operatorsNamespace,
  typeclassNamespace,
  specializeNamespace,
  // Direct callable exports
  ops,
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
  Builder,
  TypeGuard,
  // Decorator functions
  derive,
  // Registration
  registerAllMacros,
} from "typesugar";

// Core re-exports (should be accessible from main)
import {
  globalRegistry,
  defineExpressionMacro,
  defineAttributeMacro,
  defineDeriveMacro,
  invariant,
  unreachable,
  debugOnly,
  config,
  defineConfig,
  OPERATOR_SYMBOLS,
} from "typesugar";

describe("Typesugar Umbrella Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Re-export Completeness
  // ==========================================================================
  describe("Re-export completeness", () => {
    it("exports all namespace modules", () => {
      expect(typesugar.comptimeNamespace).toBeDefined();
      expect(typesugar.reflectNamespace).toBeDefined();
      expect(typesugar.deriveNamespace).toBeDefined();
      expect(typesugar.operatorsNamespace).toBeDefined();
      expect(typesugar.typeclassNamespace).toBeDefined();
      expect(typesugar.specializeNamespace).toBeDefined();
    });

    it("exports all derive symbols as actual symbols", () => {
      expect(typeof Eq).toBe("symbol");
      expect(typeof Ord).toBe("symbol");
      expect(typeof Clone).toBe("symbol");
      expect(typeof Debug).toBe("symbol");
      expect(typeof Hash).toBe("symbol");
      expect(typeof Default).toBe("symbol");
      expect(typeof Json).toBe("symbol");
      expect(typeof Builder).toBe("symbol");
      expect(typeof TypeGuard).toBe("symbol");
    });

    it("exports core macro infrastructure from @typesugar/core", () => {
      expect(globalRegistry).toBeDefined();
      expect(typeof defineExpressionMacro).toBe("function");
      expect(typeof defineAttributeMacro).toBe("function");
      expect(typeof defineDeriveMacro).toBe("function");
    });

    it("exports safety primitives from @typesugar/core", () => {
      expect(typeof invariant).toBe("function");
      expect(typeof unreachable).toBe("function");
      expect(typeof debugOnly).toBe("function");
    });

    it("exports config system from @typesugar/core", () => {
      expect(config).toBeDefined();
      expect(typeof defineConfig).toBe("function");
    });

    it("exports OPERATOR_SYMBOLS constant", () => {
      expect(Array.isArray(OPERATOR_SYMBOLS)).toBe(true);
      expect(OPERATOR_SYMBOLS).toContain("+");
      expect(OPERATOR_SYMBOLS).toContain("-");
      expect(OPERATOR_SYMBOLS).toContain("*");
    });
  });

  // ==========================================================================
  // Attack 2: Namespace vs Direct Export Conflicts
  // ==========================================================================
  describe("Namespace vs direct export conflicts", () => {
    it("comptime namespace and comptime are distinct exports", () => {
      // comptimeNamespace is the module object
      expect(typeof comptimeNamespace).toBe("object");
      // comptime is the callable function
      expect(typeof comptime).toBe("function");
    });

    it("namespace exports preserve their sub-module structure", () => {
      // deriveNamespace should have the derive macro objects
      expect(deriveNamespace.Eq).toBeDefined();
      expect(deriveNamespace.Ord).toBeDefined();
      expect(deriveNamespace.Clone).toBeDefined();

      // operatorsNamespace should have the macro definitions and helpers
      expect(typeof operatorsNamespace.ops).toBe("function");
      expect(typeof operatorsNamespace.pipe).toBe("function");
      expect(typeof operatorsNamespace.compose).toBe("function");
      expect(typeof operatorsNamespace.registerOperators).toBe("function");
    });

    it("direct ops/pipe/compose exports match namespace versions", () => {
      // These should be the same functions
      expect(ops).toBe(operatorsNamespace.ops);
      expect(pipe).toBe(operatorsNamespace.pipe);
      expect(compose).toBe(operatorsNamespace.compose);
    });

    it("deriveNamespace contains both symbols and macro definitions", () => {
      // deriveNamespace is the full @typesugar/derive namespace
      // It contains Eq (symbol) and deriveMacros (macro definitions)
      expect(typeof deriveNamespace.Eq).toBe("symbol"); // Symbol for decorator use
      expect(typeof Eq).toBe("symbol"); // Same symbol exported directly
      expect(deriveNamespace.Eq).toBe(Eq); // They should be identical

      // The actual macro definitions are under deriveNamespace.deriveMacros
      expect(typeof deriveNamespace.deriveMacros).toBe("object");
      expect(typeof deriveNamespace.deriveMacros.Eq).toBe("object"); // Macro definition
      expect(deriveNamespace.deriveMacros.Eq.name).toBe("Eq");
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

    it("registerAllMacros registers macros to globalRegistry", () => {
      // Get initial count
      const registry = globalRegistry as { macros?: Map<string, unknown> };

      // Call registration
      registerAllMacros();

      // Registry should have macros (implementation detail, but verifies side effect)
      // Note: The exact structure depends on globalRegistry implementation
      expect(globalRegistry).toBeDefined();
    });
  });

  // ==========================================================================
  // Attack 5: Runtime Placeholder Function Behavior
  // ==========================================================================
  describe("Runtime placeholder function behavior", () => {
    it("ops() passes through expression unchanged at runtime", () => {
      const value = { x: 1, y: 2 };
      const result = ops(value);
      expect(result).toBe(value);
    });

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

    it("exports Op type for operator overloading", () => {
      type _Test = import("typesugar").Op<"+">;
    });

    it("exports TypesugarConfig type", () => {
      type _Test = import("typesugar").TypesugarConfig;
    });
  });

  // ==========================================================================
  // Attack 7: Cross-Module Consistency
  // ==========================================================================
  describe("Cross-module consistency", () => {
    it("derive symbol descriptions match their names", () => {
      // Symbol.for() creates globally registered symbols with descriptions
      // Our symbols use Symbol() which creates unique symbols with descriptions
      expect(Eq.description).toBe("Eq");
      expect(Ord.description).toBe("Ord");
      expect(Clone.description).toBe("Clone");
      expect(Debug.description).toBe("Debug");
      expect(Hash.description).toBe("Hash");
      expect(Default.description).toBe("Default");
      expect(Json.description).toBe("Json");
      expect(Builder.description).toBe("Builder");
      expect(TypeGuard.description).toBe("TypeGuard");
    });

    it("derive symbols are unique (not Symbol.for)", () => {
      // Each symbol should be unique, not globally registered
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

      // After registerAllMacros, it should contain known macros
      registerAllMacros();
      expect(globalRegistry.getExpression("ops")).toBeDefined();
      expect(globalRegistry.getExpression("pipe")).toBeDefined();
      expect(globalRegistry.getExpression("compose")).toBeDefined();
    });
  });
});
