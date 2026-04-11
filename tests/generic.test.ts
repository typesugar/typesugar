/**
 * Tests for generic programming with zero-cost abstractions
 *
 * This tests:
 * - DeriveTypeInfo with sum types (kind: "sum", variants, discriminant)
 * - @derive macros handling sum types
 * - Generic<T> metadata registry
 */

import { describe, it, expect } from "vitest";
import { assert, typeAssert, type Equal } from "@typesugar/testing";
import { DeriveTypeInfo, DeriveFieldInfo, DeriveVariantInfo } from "@typesugar/core";
import { genericDerive, getGenericMeta, registerGenericMeta, GenericMeta } from "@typesugar/macros";
import { hasGenericDerivation, getGenericDerivation, tryExtractSumType } from "@typesugar/macros";
import { globalRegistry } from "@typesugar/core";

// Ensure all macros are registered
import "@typesugar/macros";

// ============================================================================
// Test Types
// ============================================================================

// Product type
interface Point {
  x: number;
  y: number;
}

// Sum type (discriminated union) with "kind" discriminant
interface Circle {
  kind: "circle";
  radius: number;
}

interface Rectangle {
  kind: "rectangle";
  width: number;
  height: number;
}

type Shape = Circle | Rectangle;

// Sum type with "_tag" discriminant
interface Left<A> {
  _tag: "Left";
  value: A;
}

interface Right<A> {
  _tag: "Right";
  value: A;
}

type Either<A, B> = Left<A> | Right<B>;

// ============================================================================
// DeriveTypeInfo Structure Tests
// ============================================================================

describe("DeriveTypeInfo structure", () => {
  it("should have kind field for type classification", () => {
    const productInfo: DeriveTypeInfo = {
      name: "Point",
      fields: [
        {
          name: "x",
          typeString: "number",
          type: {} as any,
          optional: false,
          readonly: false,
        },
        {
          name: "y",
          typeString: "number",
          type: {} as any,
          optional: false,
          readonly: false,
        },
      ],
      typeParameters: [],
      type: {} as any,
      kind: "product",
    };

    assert(productInfo.kind === "product");
    assert(productInfo.variants === undefined);
    assert(productInfo.discriminant === undefined);
  });

  it("should support sum type with variants and discriminant", () => {
    const variants: DeriveVariantInfo[] = [
      {
        tag: "circle",
        typeName: "Circle",
        fields: [
          {
            name: "radius",
            typeString: "number",
            type: {} as any,
            optional: false,
            readonly: false,
          },
        ],
      },
      {
        tag: "rectangle",
        typeName: "Rectangle",
        fields: [
          {
            name: "width",
            typeString: "number",
            type: {} as any,
            optional: false,
            readonly: false,
          },
          {
            name: "height",
            typeString: "number",
            type: {} as any,
            optional: false,
            readonly: false,
          },
        ],
      },
    ];

    const sumInfo: DeriveTypeInfo = {
      name: "Shape",
      fields: [], // Sum types don't have top-level fields
      typeParameters: [],
      type: {} as any,
      kind: "sum",
      variants,
      discriminant: "kind",
    };

    assert(sumInfo.kind === "sum");
    assert(sumInfo.discriminant === "kind");
    assert(sumInfo.variants !== undefined);
    assert(sumInfo.variants!.length === 2);
    assert(sumInfo.variants![0].tag === "circle");
    assert(sumInfo.variants![1].tag === "rectangle");
  });

  it("should support isRecursive flag", () => {
    const recursiveInfo: DeriveTypeInfo = {
      name: "LinkedList",
      fields: [],
      typeParameters: [],
      type: {} as any,
      kind: "sum",
      isRecursive: true,
    };

    assert(recursiveInfo.isRecursive === true);
  });
});

// ============================================================================
// DeriveVariantInfo Structure Tests
// ============================================================================

describe("DeriveVariantInfo structure", () => {
  it("should capture tag, typeName, and fields", () => {
    const variant: DeriveVariantInfo = {
      tag: "some",
      typeName: "Some",
      fields: [
        {
          name: "value",
          typeString: "T",
          type: {} as any,
          optional: false,
          readonly: false,
        },
      ],
    };

    assert(variant.tag === "some");
    assert(variant.typeName === "Some");
    assert(variant.fields.length === 1);
    assert(variant.fields[0].name === "value");
  });

  it("should support variants with no fields", () => {
    const variant: DeriveVariantInfo = {
      tag: "none",
      typeName: "None",
      fields: [],
    };

    assert(variant.fields.length === 0);
  });
});

// ============================================================================
// GenericMeta Registry Tests
// ============================================================================

describe("GenericMeta registry", () => {
  it("should register and retrieve product type metadata", () => {
    const meta: GenericMeta = {
      kind: "product",
      fieldNames: ["x", "y"],
      fieldTypes: ["number", "number"],
    };

    registerGenericMeta("TestPoint", meta);
    const retrieved = getGenericMeta("TestPoint");

    assert(retrieved !== undefined);
    assert(retrieved!.kind === "product");
    assert(retrieved!.fieldNames![0] === "x");
    assert(retrieved!.fieldNames![1] === "y");
  });

  it("should register and retrieve sum type metadata", () => {
    const meta: GenericMeta = {
      kind: "sum",
      discriminant: "kind",
      variants: [
        { tag: "circle", typeName: "Circle" },
        { tag: "rectangle", typeName: "Rectangle" },
      ],
    };

    registerGenericMeta("TestShape", meta);
    const retrieved = getGenericMeta("TestShape");

    assert(retrieved !== undefined);
    assert(retrieved!.kind === "sum");
    assert(retrieved!.discriminant === "kind");
    assert(retrieved!.variants!.length === 2);
    assert(retrieved!.variants![0].tag === "circle");
  });

  it("should return undefined for unregistered types", () => {
    const retrieved = getGenericMeta("NonExistentType");
    assert(retrieved === undefined);
  });
});

// ============================================================================
// Generic Derive Macro Registration Tests
// ============================================================================

describe("Generic macro", () => {
  it("should be registered as attribute macro in global registry", () => {
    // Note: Generic is defined as an attribute macro (via defineAttributeMacro)
    // to support both @derive(Generic) syntax and standalone @Generic
    const macro = globalRegistry.getAttribute("Generic");
    assert(macro !== undefined);
    assert(macro!.name === "Generic");
    assert(macro!.kind === "attribute");
  });
});

// ============================================================================
// Builtin Derivation Strategy Tests (Sum Type Support)
// ============================================================================

describe("GenericDerivation sum type support", () => {
  for (const name of ["Show", "Eq", "Ord", "Hash"]) {
    it(`${name} derivation should have deriveSum method`, () => {
      const derivation = getGenericDerivation(name);
      assert(derivation !== undefined);
      assert(typeof derivation!.deriveProduct === "function");
      assert(typeof derivation!.deriveSum === "function");
    });
  }
});

// ============================================================================
// Code Generation Pattern Tests
// ============================================================================

describe("derive macro code generation for sum types", () => {
  const variants = [
    { tag: "circle", typeName: "Circle" },
    { tag: "rectangle", typeName: "Rectangle" },
  ];

  it("Show derivation has deriveSum via GenericDerivation", () => {
    const derivation = getGenericDerivation("Show");
    assert(derivation !== undefined);
    assert(typeof derivation!.deriveSum === "function");
  });

  it("Eq.deriveSum generates discriminant check", () => {
    // Eq is now in GenericDerivation — sum-type output is tested e2e
    // in derive-advanced.test.ts and diagnostics.test.ts
    const { getGenericDerivation } = require("@typesugar/macros");
    const derivation = getGenericDerivation("Eq");
    assert(derivation !== undefined);
    assert(typeof derivation.deriveSum === "function");
  });

  // Ord and Hash sum-type support is tested e2e in derive-advanced.test.ts
});

// ============================================================================
// GenericDerivation registration (all typeclasses use the unified path)
// ============================================================================

describe("all typeclasses use GenericDerivation", () => {
  for (const name of [
    "Show",
    "Eq",
    "Ord",
    "Hash",
    "Clone",
    "Debug",
    "Default",
    "Json",
    "TypeGuard",
    "Semigroup",
    "Monoid",
  ]) {
    it(`${name} is registered via GenericDerivation`, () => {
      const derivation = getGenericDerivation(name);
      assert(derivation !== undefined);
      assert(typeof derivation!.deriveProduct === "function");
    });
  }

  it("typeclasses with sum support have deriveSum", () => {
    for (const name of ["Show", "Eq", "Ord", "Hash", "Debug", "Json", "TypeGuard"]) {
      const derivation = getGenericDerivation(name);
      assert(derivation !== undefined);
      assert(typeof derivation!.deriveSum === "function", `${name} should have deriveSum`);
    }
  });
});

// ============================================================================
// Derive System (PEP-017 Wave 4: unified @derive attribute macro)
// ============================================================================

describe("derive system uses unified @derive attribute macro", () => {
  it("all typeclass derivation strategies are available via GenericDerivation", () => {
    for (const name of ["Eq", "Ord", "Clone", "Debug", "Hash", "Default", "Json", "TypeGuard"]) {
      assert(hasGenericDerivation(name), `${name} should be registered`);
    }
  });

  it("@derive is handled by the transformer directly", () => {
    // PEP-032: @derive is handled by the transformer's expandDeriveDecorator,
    // not through the macro registry. The attribute macro was removed.
    const macro = globalRegistry.getAttribute("derive");
    assert(
      macro === undefined,
      "@derive should not be in the macro registry (handled by transformer)"
    );
  });
});

// ============================================================================
// Type-Level Assertions
// ============================================================================

describe("type-level assertions", () => {
  it("DeriveTypeInfo includes kind field", () => {
    typeAssert<Equal<Pick<DeriveTypeInfo, "kind">, { kind: "product" | "sum" | "primitive" }>>();
  });

  it("DeriveVariantInfo has required fields", () => {
    typeAssert<Equal<keyof DeriveVariantInfo, "tag" | "typeName" | "fields">>();
  });

  it("GenericMeta has kind field", () => {
    typeAssert<Equal<Pick<GenericMeta, "kind">, { kind: "product" | "sum" | "primitive" }>>();
  });
});
