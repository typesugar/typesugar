/**
 * Generic Programming for Typeclass Derivation
 *
 * This module provides structural representations (Product/Sum) that enable
 * "derive once, use everywhere" typeclass instances.
 *
 * ## Overview
 *
 * Instead of generating Show/Eq/etc. code for every type, we:
 * 1. Define Show/Eq/etc. for Product<Fields> and Sum<Variants> ONCE
 * 2. Auto-derive Generic<T> that converts T <-> its structural form
 * 3. @derive(Show) just bridges through the generic representation
 *
 * ## Example
 *
 * ```typescript
 * // Define your type
 * interface Point { x: number; y: number; }
 *
 * // @derive(Generic) creates:
 * // - Type-level: type PointRep = Product<[["x", number], ["y", number]]>
 * // - to/from functions for runtime conversion
 *
 * // @derive(Show) then just uses:
 * // show(point) → showProduct.show(Generic.to(point))
 * ```
 *
 * ## Key Types
 *
 * - `Product<Fields>` - Structural representation of records/structs
 * - `Sum<Variants>` - Structural representation of discriminated unions
 * - `Generic<T, Rep>` - Typeclass for converting T <-> Rep
 *
 * @packageDocumentation
 */

import * as ts from "typescript";
import { defineAttributeMacro, globalRegistry } from "@typesugar/core";
import { MacroContext, DeriveFieldInfo, DeriveVariantInfo } from "@typesugar/core";
import { instanceRegistry, typeclassRegistry, tryExtractSumType } from "./typeclass.js";

// ============================================================================
// Structural Representation Types
// ============================================================================

/**
 * A field in a product type: [name, value]
 */
export type Field<Name extends string, Value> = readonly [Name, Value];

/**
 * Product type - represents structs/records as a tuple of fields.
 *
 * ```typescript
 * // Point { x: number, y: number } becomes:
 * type PointRep = Product<[Field<"x", number>, Field<"y", number>]>;
 * ```
 */
export type Product<Fields extends readonly Field<string, unknown>[]> = {
  readonly _tag: "Product";
  readonly fields: { [K in keyof Fields]: Fields[K][1] };
  readonly names: { [K in keyof Fields]: Fields[K][0] };
};

/**
 * A variant in a sum type: [tag, payload]
 */
export type Variant<Tag extends string, Payload> = readonly [Tag, Payload];

/**
 * Sum type - represents discriminated unions.
 *
 * ```typescript
 * // type Shape = Circle | Rectangle becomes:
 * type ShapeRep = Sum<[Variant<"circle", Circle>, Variant<"rectangle", Rectangle>]>;
 * ```
 */
export type Sum<Variants extends readonly Variant<string, unknown>[]> = {
  readonly _tag: "Sum";
  readonly discriminant: string;
  readonly value: Variants[number];
};

/**
 * Type-level helper to extract the representation type for a given type.
 * This is populated by @derive(Generic).
 */
export type Rep<T> = T extends { __rep__: infer R } ? R : never;

// ============================================================================
// Generic Typeclass
// ============================================================================

/**
 * Generic typeclass - converts between a type and its structural representation.
 *
 * This is the key abstraction: once we can convert T <-> Product/Sum,
 * any typeclass defined on Product/Sum works for T automatically.
 */
export interface Generic<T, R> {
  /** Convert from the original type to its generic representation */
  to(value: T): R;
  /** Convert from the generic representation back to the original type */
  from(rep: R): T;
}

// Registry for Generic instances
const genericRegistry = new Map<string, Generic<unknown, unknown>>();

export function registerGeneric<T, R>(typeName: string, instance: Generic<T, R>): void {
  genericRegistry.set(typeName, instance as Generic<unknown, unknown>);
}

export function getGeneric<T, R>(typeName: string): Generic<T, R> | undefined {
  return genericRegistry.get(typeName) as Generic<T, R> | undefined;
}

// ============================================================================
// Product/Sum Typeclass Instances
// ============================================================================

/**
 * Show for Product types - works for ANY product!
 */
export function showProduct<Fields extends readonly Field<string, unknown>[]>(
  fieldShows: { [K in keyof Fields]: { show: (a: Fields[K][1]) => string } },
  fieldNames: { [K in keyof Fields]: Fields[K][0] }
): { show: (p: Product<Fields>) => string } {
  return {
    show: (p: Product<Fields>): string => {
      const parts: string[] = [];
      for (let i = 0; i < fieldNames.length; i++) {
        const name = fieldNames[i];
        const value = p.fields[i];
        const showFn = fieldShows[i];
        parts.push(`${name} = ${showFn.show(value)}`);
      }
      return `(${parts.join(", ")})`;
    },
  };
}

/**
 * Show for Sum types - works for ANY sum!
 */
export function showSum<Variants extends readonly Variant<string, unknown>[]>(
  variantShows: {
    [K in keyof Variants]: { show: (a: Variants[K][1]) => string };
  },
  variantTags: { [K in keyof Variants]: Variants[K][0] }
): { show: (s: Sum<Variants>) => string } {
  return {
    show: (s: Sum<Variants>): string => {
      const [tag, value] = s.value;
      const idx = variantTags.indexOf(tag as Variants[number][0]);
      if (idx >= 0) {
        const showFn = variantShows[idx];
        return `${tag}(${showFn.show(value)})`;
      }
      return `Unknown(${tag})`;
    },
  };
}

/**
 * Eq for Product types
 */
export function eqProduct<Fields extends readonly Field<string, unknown>[]>(fieldEqs: {
  [K in keyof Fields]: { eq: (a: Fields[K][1], b: Fields[K][1]) => boolean };
}): { eq: (a: Product<Fields>, b: Product<Fields>) => boolean } {
  return {
    eq: (a: Product<Fields>, b: Product<Fields>): boolean => {
      for (let i = 0; i < fieldEqs.length; i++) {
        if (!fieldEqs[i].eq(a.fields[i], b.fields[i])) {
          return false;
        }
      }
      return true;
    },
  };
}

/**
 * Eq for Sum types
 */
export function eqSum<Variants extends readonly Variant<string, unknown>[]>(
  variantEqs: {
    [K in keyof Variants]: {
      eq: (a: Variants[K][1], b: Variants[K][1]) => boolean;
    };
  },
  variantTags: { [K in keyof Variants]: Variants[K][0] }
): { eq: (a: Sum<Variants>, b: Sum<Variants>) => boolean } {
  return {
    eq: (a: Sum<Variants>, b: Sum<Variants>): boolean => {
      const [tagA, valueA] = a.value;
      const [tagB, valueB] = b.value;
      if (tagA !== tagB) return false;
      const idx = variantTags.indexOf(tagA as Variants[number][0]);
      if (idx >= 0) {
        return variantEqs[idx].eq(valueA, valueB);
      }
      return false;
    },
  };
}

/**
 * Ord for Product types (lexicographic)
 */
export function ordProduct<Fields extends readonly Field<string, unknown>[]>(fieldOrds: {
  [K in keyof Fields]: {
    compare: (a: Fields[K][1], b: Fields[K][1]) => number;
  };
}): { compare: (a: Product<Fields>, b: Product<Fields>) => number } {
  return {
    compare: (a: Product<Fields>, b: Product<Fields>): number => {
      for (let i = 0; i < fieldOrds.length; i++) {
        const c = fieldOrds[i].compare(a.fields[i], b.fields[i]);
        if (c !== 0) return c;
      }
      return 0;
    },
  };
}

/**
 * Hash for Product types
 */
export function hashProduct<Fields extends readonly Field<string, unknown>[]>(fieldHashes: {
  [K in keyof Fields]: { hash: (a: Fields[K][1]) => number };
}): { hash: (a: Product<Fields>) => number } {
  return {
    hash: (a: Product<Fields>): number => {
      let hash = 0;
      for (let i = 0; i < fieldHashes.length; i++) {
        hash = ((hash << 5) + hash) ^ fieldHashes[i].hash(a.fields[i]);
      }
      return hash >>> 0;
    },
  };
}

// ============================================================================
// Primitive Generic Instances (for recursion base cases)
// ============================================================================

// Primitives are their own representation
export const genericNumber: Generic<number, number> = {
  to: (n) => n,
  from: (n) => n,
};

export const genericString: Generic<string, string> = {
  to: (s) => s,
  from: (s) => s,
};

export const genericBoolean: Generic<boolean, boolean> = {
  to: (b) => b,
  from: (b) => b,
};

// Register primitive generics
registerGeneric("number", genericNumber);
registerGeneric("string", genericString);
registerGeneric("boolean", genericBoolean);

// ============================================================================
// @derive(Generic) - Auto-derive Generic instance for a type
// ============================================================================

/**
 * Structural type mirror — analogous to Scala 3's Mirror.ProductOf / Mirror.SumOf.
 *
 * Stores the structural representation of a type for use by typeclass derivation.
 * - `fieldNames` ≈ `MirroredElemLabels`
 * - `fieldTypes` ≈ `MirroredElemTypes`
 * - `kind` ≈ `Mirror.Product` vs `Mirror.Sum`
 */
export interface GenericMeta {
  readonly kind: "product" | "sum" | "primitive";
  readonly discriminant?: string;
  readonly variants?: Array<{ tag: string; typeName: string }>;
  readonly fieldNames?: string[];
  readonly fieldTypes?: string[];
}

const genericMetaRegistry = new Map<string, GenericMeta>();

export function getGenericMeta(typeName: string): GenericMeta | undefined {
  return genericMetaRegistry.get(typeName);
}

export function registerGenericMeta(typeName: string, meta: GenericMeta): void {
  genericMetaRegistry.set(typeName, meta);
}

export const genericDerive = defineAttributeMacro({
  name: "Generic",
  module: "typesugar",
  description: "Derive Generic instance for structural programming",
  validTargets: ["interface", "class", "type"],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    _args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    if (
      !ts.isInterfaceDeclaration(target) &&
      !ts.isClassDeclaration(target) &&
      !ts.isTypeAliasDeclaration(target)
    ) {
      ctx.reportError(target, "@derive(Generic) requires interface, class, or type alias");
      return target;
    }

    const typeName = target.name?.text ?? "Anonymous";

    // Check if this is a sum type (discriminated union)
    if (ts.isTypeAliasDeclaration(target)) {
      const sumInfo = tryExtractSumType(ctx, target);
      if (sumInfo) {
        return expandGenericForSumType(ctx, target, typeName, sumInfo);
      }
    }

    // Product type (interface, class, or non-union type alias)
    return expandGenericForProductType(ctx, target, typeName);
  },
});

/**
 * Expand @derive(Generic) for a product type (interface, class, record).
 * Generates zero-cost identity conversion with metadata registration.
 */
function expandGenericForProductType(
  ctx: MacroContext,
  target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
  typeName: string
): ts.Node[] {
  const type = ctx.typeChecker.getTypeAtLocation(target);
  const properties = ctx.typeChecker.getPropertiesOfType(type);

  const fieldNames: string[] = [];
  const fieldTypes: string[] = [];

  for (const prop of properties) {
    fieldNames.push(prop.name);
    const decls = prop.getDeclarations();
    if (decls && decls.length > 0) {
      const propType = ctx.typeChecker.getTypeOfSymbolAtLocation(prop, decls[0]);
      fieldTypes.push(ctx.typeChecker.typeToString(propType));
    } else {
      fieldTypes.push("unknown");
    }
  }

  // Generate zero-cost Generic instance with identity to/from
  // The metadata is what drives derivation, not runtime conversion
  const code = `
// Zero-cost Generic instance for ${typeName} (product type)
const generic${typeName}: Generic<${typeName}, ${typeName}> = {
  to: (value) => value,
  from: (rep) => rep,
};

// Register type metadata for derivation
registerGenericMeta("${typeName}", {
  kind: "product",
  fieldNames: ${JSON.stringify(fieldNames)},
  fieldTypes: ${JSON.stringify(fieldTypes)},
});

registerGeneric("${typeName}", generic${typeName});
`;

  const statements = ctx.parseStatements(code);

  // Register in compile-time instance registry
  instanceRegistry.push({
    typeclassName: "Generic",
    forType: typeName,
    instanceName: `generic${typeName}`,
    derived: true,
  });

  // Also register metadata at compile time for immediate use
  genericMetaRegistry.set(typeName, {
    kind: "product",
    fieldNames,
    fieldTypes,
  });

  return [target, ...statements];
}

/**
 * Expand @derive(Generic) for a sum type (discriminated union).
 * Generates zero-cost identity conversion - native union stays native.
 */
function expandGenericForSumType(
  ctx: MacroContext,
  target: ts.TypeAliasDeclaration,
  typeName: string,
  sumInfo: {
    discriminant: string;
    variants: Array<{ tag: string; typeName: string }>;
  }
): ts.Node[] {
  // Get variant field information for each variant
  const variantMeta: Array<{
    tag: string;
    typeName: string;
    fieldNames: string[];
    fieldTypes: string[];
  }> = [];

  if (ts.isUnionTypeNode(target.type)) {
    for (const member of target.type.types) {
      if (!ts.isTypeReferenceNode(member)) continue;

      const variantTypeName = member.typeName.getText();
      const variantInfo = sumInfo.variants.find((v) => v.typeName === variantTypeName);
      if (!variantInfo) continue;

      const memberType = ctx.typeChecker.getTypeFromTypeNode(member);
      const fieldNames: string[] = [];
      const fieldTypes: string[] = [];

      try {
        const props = ctx.typeChecker.getPropertiesOfType(memberType);
        for (const prop of props) {
          // Skip the discriminant field
          if (prop.name === sumInfo.discriminant) continue;

          fieldNames.push(prop.name);
          const decls = prop.getDeclarations();
          if (decls && decls.length > 0) {
            const propType = ctx.typeChecker.getTypeOfSymbolAtLocation(prop, decls[0]);
            fieldTypes.push(ctx.typeChecker.typeToString(propType));
          } else {
            fieldTypes.push("unknown");
          }
        }
      } catch {
        // Skip if we can't get properties
      }

      variantMeta.push({
        tag: variantInfo.tag,
        typeName: variantTypeName,
        fieldNames,
        fieldTypes,
      });
    }
  }

  // Generate zero-cost Generic instance with identity to/from
  // Sum types keep their native discriminated union form
  const code = `
// Zero-cost Generic instance for ${typeName} (sum type)
const generic${typeName}: Generic<${typeName}, ${typeName}> = {
  to: (value) => value,
  from: (rep) => rep,
};

// Register type metadata for derivation
registerGenericMeta("${typeName}", {
  kind: "sum",
  discriminant: "${sumInfo.discriminant}",
  variants: ${JSON.stringify(sumInfo.variants)},
});

registerGeneric("${typeName}", generic${typeName});
`;

  const statements = ctx.parseStatements(code);

  // Register in compile-time instance registry
  instanceRegistry.push({
    typeclassName: "Generic",
    forType: typeName,
    instanceName: `generic${typeName}`,
    derived: true,
  });

  // Also register metadata at compile time for immediate use
  genericMetaRegistry.set(typeName, {
    kind: "sum",
    discriminant: sumInfo.discriminant,
    variants: sumInfo.variants,
  });

  return [target, ...statements];
}

// ============================================================================
// Generic-based Show/Eq/etc derivation
// ============================================================================

/**
 * Create a Show instance for any type with a Generic instance.
 *
 * This is the "derive once" pattern - one function works for all types!
 */
export function deriveShowViaGeneric<T>(
  typeName: string,
  fieldShows: { show: (a: unknown) => string }[],
  fieldNames: string[]
): { show: (a: T) => string } {
  const gen = getGeneric<T, Product<Field<string, unknown>[]>>(typeName);
  if (!gen) {
    throw new Error(`No Generic instance for ${typeName}`);
  }

  return {
    show: (a: T): string => {
      const rep = gen.to(a);
      const parts = fieldNames.map((name, i) => `${name} = ${fieldShows[i].show(rep.fields[i])}`);
      return `${typeName}(${parts.join(", ")})`;
    },
  };
}

/**
 * Create an Eq instance for any type with a Generic instance.
 */
export function deriveEqViaGeneric<T>(
  typeName: string,
  fieldEqs: { eq: (a: unknown, b: unknown) => boolean }[]
): { eq: (a: T, b: T) => boolean } {
  const gen = getGeneric<T, Product<Field<string, unknown>[]>>(typeName);
  if (!gen) {
    throw new Error(`No Generic instance for ${typeName}`);
  }

  return {
    eq: (a: T, b: T): boolean => {
      const repA = gen.to(a);
      const repB = gen.to(b);
      for (let i = 0; i < fieldEqs.length; i++) {
        if (!fieldEqs[i].eq(repA.fields[i], repB.fields[i])) {
          return false;
        }
      }
      return true;
    },
  };
}

// ============================================================================
// Register macros
// ============================================================================

globalRegistry.register(genericDerive);

// All exports are inline (export function, export type, export const)
