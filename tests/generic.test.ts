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
import {
  DeriveTypeInfo,
  DeriveFieldInfo,
  DeriveVariantInfo,
} from "../src/core/types.js";
import {
  genericDerive,
  getGenericMeta,
  registerGenericMeta,
  GenericMeta,
} from "../src/macros/generic.js";
import {
  builtinDerivations,
  tryExtractSumType,
} from "../src/macros/typeclass.js";
import { globalRegistry } from "../src/core/registry.js";
import { deriveMacros } from "../src/macros/derive.js";

// Ensure all macros are registered
import "../src/macros/index.js";

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

describe("builtinDerivations sum type support", () => {
  it("Show derivation should have deriveSum method", () => {
    const derivation = builtinDerivations["Show"];
    assert(derivation !== undefined);
    assert(typeof derivation.deriveProduct === "function");
    assert(typeof derivation.deriveSum === "function");
  });

  it("Eq derivation should have deriveSum method", () => {
    const derivation = builtinDerivations["Eq"];
    assert(derivation !== undefined);
    assert(typeof derivation.deriveSum === "function");
  });

  it("Ord derivation should have deriveSum method", () => {
    const derivation = builtinDerivations["Ord"];
    assert(derivation !== undefined);
    assert(typeof derivation.deriveSum === "function");
  });

  it("Hash derivation should have deriveSum method", () => {
    const derivation = builtinDerivations["Hash"];
    assert(derivation !== undefined);
    assert(typeof derivation.deriveSum === "function");
  });

  it("Functor derivation should have deriveSum method", () => {
    const derivation = builtinDerivations["Functor"];
    assert(derivation !== undefined);
    assert(typeof derivation.deriveSum === "function");
  });
});

// ============================================================================
// Code Generation Pattern Tests
// ============================================================================

describe("derive macro code generation for sum types", () => {
  const variants = [
    { tag: "circle", typeName: "Circle" },
    { tag: "rectangle", typeName: "Rectangle" },
  ];

  it("Show.deriveSum generates switch-based implementation", () => {
    const code = builtinDerivations["Show"].deriveSum(
      "Shape",
      "kind",
      variants,
    );

    assert(code.includes("switch"));
    assert(code.includes('case "circle"'));
    assert(code.includes('case "rectangle"'));
    assert(code.includes("Shape"));
  });

  it("Eq.deriveSum generates discriminant check", () => {
    const code = builtinDerivations["Eq"].deriveSum("Shape", "kind", variants);

    assert(code.includes("kind"));
    assert(code.includes("switch"));
    assert(code.includes('case "circle"'));
    assert(code.includes('case "rectangle"'));
  });

  it("Ord.deriveSum generates tag ordering", () => {
    const code = builtinDerivations["Ord"].deriveSum("Shape", "kind", variants);

    assert(code.includes("tagOrder"));
    assert(code.includes("switch"));
    assert(code.includes("-1"));
    assert(code.includes("1"));
    assert(code.includes("0"));
  });

  it("Hash.deriveSum generates tag-based hashing", () => {
    const code = builtinDerivations["Hash"].deriveSum(
      "Shape",
      "kind",
      variants,
    );

    assert(code.includes("switch"));
    assert(code.includes("hash"));
  });
});

// ============================================================================
// Generic Sum Type Derivation (for parameterized types like Either<E, A>)
// ============================================================================

describe("deriveGenericSum for parameterized sum types", () => {
  // Mock type parameters like [E, A] in Either<E, A>
  const mockTypeParams = [
    { name: { text: "E" } } as any,
    { name: { text: "A" } } as any,
  ];

  // Variants matching Either<E, A> structure
  const eitherVariants: DeriveVariantInfo[] = [
    {
      tag: "Left",
      typeName: "Left",
      fields: [{ name: "left", typeString: "E" }],
    },
    {
      tag: "Right",
      typeName: "Right",
      fields: [{ name: "right", typeString: "A" }],
    },
  ];

  it("Show.deriveGenericSum generates factory function for generic sum type", () => {
    const derivation = builtinDerivations["Show"];
    assert(derivation.deriveGenericSum !== undefined);

    const code = derivation.deriveGenericSum!(
      "Either",
      "_tag",
      eitherVariants,
      mockTypeParams,
    );

    assert(code !== undefined);
    // Should generate a factory function signature
    assert(code!.includes("export function getShow<E, A>"));
    assert(code!.includes("SE: Show<E>"));
    assert(code!.includes("SA: Show<A>"));
    assert(code!.includes("Show<Either<E, A>>"));
    // Should reference the provided instances for each variant field
    assert(code!.includes("SE.show"));
    assert(code!.includes("SA.show"));
  });

  it("Eq.deriveGenericSum generates factory function for generic sum type", () => {
    const derivation = builtinDerivations["Eq"];
    assert(derivation.deriveGenericSum !== undefined);

    const code = derivation.deriveGenericSum!(
      "Either",
      "_tag",
      eitherVariants,
      mockTypeParams,
    );

    assert(code !== undefined);
    // Should generate a factory function signature
    assert(code!.includes("export function getEq<E, A>"));
    assert(code!.includes("EE: Eq<E>"));
    assert(code!.includes("EA: Eq<A>"));
    assert(code!.includes("Eq<Either<E, A>>"));
    // Should use provided instances
    assert(code!.includes("EE.eqv"));
    assert(code!.includes("EA.eqv"));
    // Should have tag check
    assert(code!.includes("_tag"));
  });

  it("Ord.deriveGenericSum generates factory function for generic sum type", () => {
    const derivation = builtinDerivations["Ord"];
    assert(derivation.deriveGenericSum !== undefined);

    const code = derivation.deriveGenericSum!(
      "Either",
      "_tag",
      eitherVariants,
      mockTypeParams,
    );

    assert(code !== undefined);
    // Should generate a factory function signature
    assert(code!.includes("export function getOrd<E, A>"));
    assert(code!.includes("OE: Ord<E>"));
    assert(code!.includes("OA: Ord<A>"));
    assert(code!.includes("Ord<Either<E, A>>"));
    // Should use provided instances for compare
    assert(code!.includes("OE.compare"));
    assert(code!.includes("OA.compare"));
    // Should include tag ordering logic
    assert(code!.includes("tagOrder"));
  });

  it("deriveGenericSum returns undefined for empty type params", () => {
    const derivation = builtinDerivations["Show"];
    const code = derivation.deriveGenericSum!(
      "Status",
      "_tag",
      [{ tag: "Active", typeName: "Active", fields: [] }],
      [], // No type parameters - should fall back to regular derivation
    );
    // Should return undefined when there are no type parameters
    assert(code === undefined);
  });
});

// ============================================================================
// Derive Macros Support Kind Field
// ============================================================================

describe("derive macros support kind field in DeriveTypeInfo", () => {
  it("Eq derive macro exists", () => {
    assert(deriveMacros.Eq !== undefined);
    assert(deriveMacros.Eq.kind === "derive");
    assert(typeof deriveMacros.Eq.expand === "function");
  });

  it("Ord derive macro exists", () => {
    assert(deriveMacros.Ord !== undefined);
    assert(typeof deriveMacros.Ord.expand === "function");
  });

  it("Clone derive macro exists", () => {
    assert(deriveMacros.Clone !== undefined);
    assert(typeof deriveMacros.Clone.expand === "function");
  });

  it("Debug derive macro exists", () => {
    assert(deriveMacros.Debug !== undefined);
    assert(typeof deriveMacros.Debug.expand === "function");
  });

  it("Hash derive macro exists", () => {
    assert(deriveMacros.Hash !== undefined);
    assert(typeof deriveMacros.Hash.expand === "function");
  });

  it("Default derive macro exists", () => {
    assert(deriveMacros.Default !== undefined);
    assert(typeof deriveMacros.Default.expand === "function");
  });

  it("Json derive macro exists", () => {
    assert(deriveMacros.Json !== undefined);
    assert(typeof deriveMacros.Json.expand === "function");
  });

  it("TypeGuard derive macro exists", () => {
    assert(deriveMacros.TypeGuard !== undefined);
    assert(typeof deriveMacros.TypeGuard.expand === "function");
  });
});

// ============================================================================
// Type-Level Assertions
// ============================================================================

describe("type-level assertions", () => {
  it("DeriveTypeInfo includes kind field", () => {
    typeAssert<
      Equal<
        Pick<DeriveTypeInfo, "kind">,
        { kind: "product" | "sum" | "primitive" }
      >
    >();
  });

  it("DeriveVariantInfo has required fields", () => {
    typeAssert<Equal<keyof DeriveVariantInfo, "tag" | "typeName" | "fields">>();
  });

  it("GenericMeta has kind field", () => {
    typeAssert<
      Equal<
        Pick<GenericMeta, "kind">,
        { kind: "product" | "sum" | "primitive" }
      >
    >();
  });
});
