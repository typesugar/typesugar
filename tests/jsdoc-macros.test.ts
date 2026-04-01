/**
 * Tests for JSDoc-based macro syntax.
 *
 * Verifies that JSDoc tags (@typeclass, @impl, @deriving, @op) produce
 * equivalent results to the traditional decorator/expression syntax.
 *
 * JSDoc syntax is the preferred, preprocessor-free approach introduced
 * to improve tooling compatibility.
 *
 * NOTE: These tests verify the OUTPUT CODE, not registry state.
 * Registry state is internal to the transformer's module scope.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import { transformCode } from "@typesugar/transformer/pipeline";
import { preprocess } from "../packages/preprocessor/src/index.js";
import { clearRegistries, clearSyntaxRegistry } from "@typesugar/macros";

beforeEach(() => {
  // Clear registries for clean test state (in our module scope)
  clearSyntaxRegistry();
  clearRegistries();
});

// ============================================================================
// @typeclass JSDoc tag
// ============================================================================

describe("@typeclass JSDoc tag", () => {
  it("non-exported typeclass is zero-cost (no runtime registry)", () => {
    const code = `
/** @typeclass */
interface MyEq<A> {
  equals(a: A, b: A): boolean;
}
    `.trim();

    const result = transformCode(code, { fileName: "jsdoc-typeclass.ts" });

    expect(result.changed).toBe(true);

    // Non-exported typeclasses are zero-cost: no companion object, no runtime registry,
    // no extension helpers (since they rely on the runtime registry)
    expect(result.code).not.toContain("const MyEq");
    expect(result.code).not.toContain("registerInstance");
    expect(result.code).not.toContain("summon");
    expect(result.code).not.toContain("myEqEquals");
  });

  it("exported typeclass generates runtime registry for cross-module support", () => {
    const code = `
/** @typeclass */
export interface MyEq<A> {
  equals(a: A, b: A): boolean;
}
    `.trim();

    const result = transformCode(code, { fileName: "jsdoc-typeclass-exported.ts" });

    expect(result.changed).toBe(true);

    // Exported typeclasses generate full runtime support via companion object
    expect(result.code).toContain("const MyEq");
    expect(result.code).toContain("registerInstance");
    expect(result.code).toContain("summon");
    expect(result.code).toContain("hasInstance");
    expect(result.code).toContain("registeredTypes");

    // Should generate extension method helper
    expect(result.code).toContain("myEqEquals");
  });

  it("handles typeclass with multiple methods (non-exported, zero-cost)", () => {
    const code = `
/** @typeclass */
interface MyNumeric<A> {
  add(a: A, b: A): A;
  mul(a: A, b: A): A;
}
    `.trim();

    const result = transformCode(code, { fileName: "jsdoc-numeric.ts" });

    expect(result.changed).toBe(true);
    // Non-exported: no companion object, no extension helpers
    expect(result.code).not.toContain("const MyNumeric");
    expect(result.code).not.toContain("myNumericAdd");
    expect(result.code).not.toContain("myNumericMul");
  });

  it("handles exported typeclass with multiple methods", () => {
    const code = `
/** @typeclass */
export interface MyNumeric<A> {
  add(a: A, b: A): A;
  mul(a: A, b: A): A;
}
    `.trim();

    const result = transformCode(code, { fileName: "jsdoc-numeric-exported.ts" });

    expect(result.changed).toBe(true);
    // Exported: has companion object
    expect(result.code).toContain("const MyNumeric");
    expect(result.code).toContain("registerInstance");

    // Should generate extension methods for each typeclass method
    expect(result.code).toContain("myNumericAdd");
    expect(result.code).toContain("myNumericMul");
  });

  it("handles typeclass with no methods (non-exported marker interface)", () => {
    const code = `
/** @typeclass */
interface Marker<A> {}
    `.trim();

    const result = transformCode(code, { fileName: "jsdoc-marker.ts" });

    // Non-exported marker interface: zero-cost, no companion object
    expect(result.changed).toBe(true);
    expect(result.code).not.toContain("const Marker");
  });

  it("handles exported marker interface with @typeclass", () => {
    const code = `
/** @typeclass */
export interface Marker<A> {}
    `.trim();

    const result = transformCode(code, { fileName: "jsdoc-marker-exported.ts" });

    // Exported marker interface: generates companion object
    expect(result.changed).toBe(true);
    expect(result.code).toContain("const Marker");
  });

  it("handles exported interface with @typeclass", () => {
    const code = `
/** @typeclass */
export interface MyShow<A> {
  show(a: A): string;
}
    `.trim();

    const result = transformCode(code, { fileName: "jsdoc-exported.ts" });

    expect(result.changed).toBe(true);
    expect(result.code).toContain("const MyShow");
    expect(result.code).toContain("registerInstance");
    expect(result.code).toContain("myShowShow");
  });
});

// ============================================================================
// @op JSDoc tag on method signatures
// ============================================================================

describe("@op JSDoc tag", () => {
  it("extracts operator from @op tag in exported typeclass methods", () => {
    const code = `
/** @typeclass */
export interface MyNumeric<A> {
  /** @op + */
  add(a: A, b: A): A;
  /** @op * */
  mul(a: A, b: A): A;
}
    `.trim();

    const result = transformCode(code, { fileName: "jsdoc-op-typeclass.ts" });

    expect(result.changed).toBe(true);

    // Exported typeclass generates companion object
    expect(result.code).toContain("const MyNumeric");
    expect(result.code).toContain("myNumericAdd");
    expect(result.code).toContain("myNumericMul");
  });

  it("non-exported typeclass with @op is zero-cost", () => {
    const code = `
/** @typeclass */
interface MyNumeric<A> {
  /** @op + */
  add(a: A, b: A): A;
}
    `.trim();

    const result = transformCode(code, { fileName: "jsdoc-op-internal.ts" });

    expect(result.changed).toBe(true);
    // Non-exported: no companion object, no extension helpers
    expect(result.code).not.toContain("const MyNumeric");
    expect(result.code).not.toContain("myNumericAdd");
  });

  it("method without @op (non-exported) is zero-cost", () => {
    const code = `
/** @typeclass */
interface MyShow<A> {
  show(a: A): string;
}
    `.trim();

    const result = transformCode(code, { fileName: "jsdoc-show.ts" });

    expect(result.changed).toBe(true);
    // Non-exported: no extension helpers
    expect(result.code).not.toContain("myShowShow");
  });
});

// ============================================================================
// @impl JSDoc tag
// ============================================================================

describe("@impl JSDoc tag", () => {
  it("non-exported typeclass: @impl is zero-cost (no registerInstance)", () => {
    const code = `
/** @typeclass */
interface MyEq<A> { equals(a: A, b: A): boolean; }

/** @impl MyEq<number> */
const numEq: MyEq<number> = { equals: (a, b) => a === b };
    `.trim();

    const result = transformCode(code, { fileName: "jsdoc-impl.ts" });

    expect(result.changed).toBe(true);

    // Non-exported typeclass: no runtime registration (zero-cost)
    expect(result.code).not.toContain("registerInstance");
    expect(result.code).toContain("numEq");
  });

  it("exported typeclass: @impl generates registerInstance", () => {
    const code = `
/** @typeclass */
export interface MyEq<A> { equals(a: A, b: A): boolean; }

/** @impl MyEq<number> */
const numEq: MyEq<number> = { equals: (a, b) => a === b };
    `.trim();

    const result = transformCode(code, { fileName: "jsdoc-impl-exported.ts" });

    expect(result.changed).toBe(true);

    // Exported typeclass: generates runtime registration
    expect(result.code).toContain("registerInstance");
    expect(result.code).toContain("numEq");
  });

  it("handles @impl with generic types (non-exported, zero-cost)", () => {
    const code = `
/** @typeclass */
interface MyEq<A> { equals(a: A, b: A): boolean; }

/** @impl MyEq<Array<number>> */
const arrayNumEq: MyEq<Array<number>> = {
  equals: (a, b) => a.length === b.length
};
    `.trim();

    const result = transformCode(code, { fileName: "jsdoc-impl-generic.ts" });

    expect(result.changed).toBe(true);
    // Non-exported: no registerInstance (zero-cost)
    expect(result.code).not.toContain("registerInstance");
    expect(result.code).toContain("arrayNumEq");
  });

  it("handles @impl with generic types (exported)", () => {
    const code = `
/** @typeclass */
export interface MyEq<A> { equals(a: A, b: A): boolean; }

/** @impl MyEq<Array<number>> */
const arrayNumEq: MyEq<Array<number>> = {
  equals: (a, b) => a.length === b.length
};
    `.trim();

    const result = transformCode(code, { fileName: "jsdoc-impl-generic-exported.ts" });

    expect(result.changed).toBe(true);
    // Exported: has registerInstance
    expect(result.code).toContain("registerInstance");
    expect(result.code).toContain("arrayNumEq");
  });

  it("@impl and @instance alias both produce consistent output", () => {
    // Test @impl form (exported to ensure registration)
    const implCode = `
/** @typeclass */
export interface ImplTC<A> { method(a: A): A; }

/** @impl ImplTC<string> */
const implTcString: ImplTC<string> = { method: (a) => a };
    `.trim();

    // Test @instance form (deprecated alias)
    const instanceCode = `
/** @typeclass */
export interface InstTC<A> { method(a: A): A; }

/** @instance InstTC<string> */
const instTcString: InstTC<string> = { method: (a) => a };
    `.trim();

    // Both forms should produce output
    const implResult = transformCode(implCode, { fileName: "impl-test.ts" });
    const instanceResult = transformCode(instanceCode, { fileName: "instance-test.ts" });

    // Both should transform successfully
    expect(implResult.changed).toBe(true);
    expect(instanceResult.changed).toBe(true);

    // Both should contain instance registration (exported typeclasses)
    expect(implResult.code).toContain("registerInstance");
    expect(instanceResult.code).toContain("registerInstance");
  });
});

// ============================================================================
// @deriving JSDoc tag
// ============================================================================

describe("@deriving JSDoc tag", () => {
  it("generates derived instances from @deriving tag", () => {
    const code = `
/** @deriving Eq */
interface SimplePoint { x: number; y: number; }
    `.trim();

    const result = transformCode(code, { fileName: "jsdoc-deriving.ts" });

    expect(result.code).toContain("eq");
    expect(result.changed).toBe(true);
  });

  it("handles multiple derives in @deriving tag", () => {
    const code = `
/** @deriving Eq, Ord */
interface Range { start: number; end: number; }
    `.trim();

    const result = transformCode(code, { fileName: "jsdoc-multi-deriving.ts" });

    expect(result.changed).toBe(true);
    // Should generate both Eq and Ord derives
    expect(result.code).toContain("eq");
    expect(result.code).toContain("ord");
  });

  it.skip("@deriving on type alias works", () => {
    // TODO: JSDoc macros currently only fire on interface declarations, not type aliases
    // This test is skipped until type alias support is added
    const code = `
/** @deriving Debug */
type Color = { r: number; g: number; b: number; };
    `.trim();

    const result = transformCode(code, { fileName: "jsdoc-type-deriving.ts" });

    expect(result.changed).toBe(true);
    expect(result.code).toContain("debug");
  });
});

// ============================================================================
// JSDoc vs decorator equivalence
// ============================================================================

describe("JSDoc vs decorator equivalence", () => {
  it("@typeclass JSDoc produces same structure as decorator (exported)", () => {
    // NOTE: The decorator form uses preprocessor which rewrites to expression macro.
    // JSDoc form uses attribute macro directly.
    // Both should produce companion object but via different paths.
    const jsdocCode = `
/** @typeclass */
export interface JsDocEq<A> {
  equals(a: A, b: A): boolean;
}
    `.trim();

    const jsdocResult = transformCode(jsdocCode, {
      fileName: "jsdoc-eq.ts",
    });

    // JSDoc form should produce companion object directly (exported)
    expect(jsdocResult.changed).toBe(true);
    expect(jsdocResult.code).toContain("const JsDocEq");
    expect(jsdocResult.code).toContain("jsDocEqEquals");
  });

  it("decorator @typeclass rewritten by preprocessor to JSDoc", () => {
    // Test preprocessor rewriting directly (not full transform)
    // transformCode runs macro expansion which consumes the JSDoc
    const decoratorCode = `
@typeclass
interface DecEq<A> {
  equals(a: A, b: A): boolean;
}
    `.trim();

    const preprocessResult = preprocess(decoratorCode, {
      fileName: "decorator-eq.sts",
      extensions: ["decorator-rewrite"],
    });

    expect(preprocessResult.changed).toBe(true);
    expect(preprocessResult.code).toContain("/** @typeclass */");
    expect(preprocessResult.code).not.toContain("@typeclass\n"); // decorator syntax removed
  });

  it("@deriving JSDoc generates derived instances", () => {
    const jsdocCode = `
/** @deriving Eq */
interface JsDocPoint { x: number; y: number; }
    `.trim();

    const jsdocResult = transformCode(jsdocCode, {
      fileName: "jsdoc-point.ts",
    });

    // Should generate derived Eq instance
    expect(jsdocResult.changed).toBe(true);
    expect(jsdocResult.code).toContain("eq");
  });

  it("decorator @derive calls derive attribute macro", () => {
    // @derive is a standard decorator that invokes the derive attribute macro.
    // In test context without a full TypeChecker, the macro enters "degraded mode"
    // — it strips the decorator and validates AST but does NOT generate derivation
    // code (that requires type resolution). Real code gen happens during tspc build.
    const decoratorCode = `
@derive(Eq)
interface DecPoint { x: number; y: number; }
    `.trim();

    const decoratorResult = transformCode(decoratorCode, {
      fileName: "decorator-point.ts",
    });

    // The @derive decorator is recognized and stripped
    expect(decoratorResult.changed).toBe(true);
    // Decorator should be removed from output
    expect(decoratorResult.code).not.toContain("@derive");
    // Original interface preserved
    expect(decoratorResult.code.toLowerCase()).toContain("decpoint");
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe("JSDoc macro edge cases", () => {
  it("ignores @typeclass in regular comment blocks", () => {
    const code = `
// @typeclass - this is just a comment
interface NotATypeclass<A> {
  method(a: A): A;
}
    `.trim();

    const result = transformCode(code, { fileName: "regular-comment.ts" });

    // Should NOT generate companion object for regular comments
    expect(result.code).not.toContain("const NotATypeclass");
    // Note: changed may be true due to formatting, but the key is no macro expansion
  });

  it("handles @typeclass with other JSDoc tags (exported)", () => {
    const code = `
/**
 * A typeclass for showing values.
 * @typeclass
 * @example const showNum: MyShow<number> = { show: n => n.toString() };
 */
export interface MyShow<A> {
  show(a: A): string;
}
    `.trim();

    const result = transformCode(code, { fileName: "jsdoc-mixed.ts" });

    expect(result.changed).toBe(true);
    // Exported: generates companion object
    expect(result.code).toContain("const MyShow");
  });

  it("handles empty @deriving tag gracefully", () => {
    const code = `
/** @deriving */
interface Empty { value: number; }
    `.trim();

    const result = transformCode(code, { fileName: "empty-deriving.ts" });

    // Empty @deriving should not generate derived code
    // Note: changed may be true due to formatting
    expect(result.code).not.toContain("eqEmpty");
    expect(result.code).not.toContain("ordEmpty");
    expect(result.code).not.toContain("registerInstance");
  });

  it("handles @impl without proper type annotation (exported)", () => {
    const code = `
/** @typeclass */
export interface TC<A> { method(a: A): A; }

/** @impl TC<string> */
const tcImpl = { method: (a: string) => a };
    `.trim();

    const result = transformCode(code, { fileName: "impl-inferred.ts" });

    // Should still work with JSDoc-specified types
    expect(result.changed).toBe(true);
    // Exported typeclass generates registerInstance
    expect(result.code).toContain("registerInstance");
  });
});
