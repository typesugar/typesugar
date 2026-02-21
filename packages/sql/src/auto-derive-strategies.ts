/**
 * Scala 3-Style Derivation Strategies for SQL Typeclasses
 *
 * Registers `derived` strategies with the core typesugar derivation infrastructure.
 * This enables Scala 3-style auto-derivation for SQL typeclasses:
 *
 * ```typescript
 * interface User { id: number; name: string; email: string | null; }
 *
 * // summon auto-derives — no annotations needed!
 * const reader = summon<Read<User>>();
 * ```
 *
 * The pattern mirrors Scala 3 `derives`:
 * - The compiler synthesizes `Mirror.ProductOf[User]` automatically
 *   (typesugar: the TypeChecker inspects User's fields)
 * - `Read.derived` uses Mirror + `Get` instances per element type
 * - `summon[Read[User]]` resolves the derived instance
 *
 * @module
 */

import {
  registerGenericDerivation,
  makePrimitiveChecker,
  type GenericDerivation,
} from "../../../src/macros/auto-derive.js";
import type { GenericMeta } from "../../../src/macros/generic.js";
import type { MacroContext } from "../../../src/core/types.js";
import { toSnakeCase } from "./typeclasses.js";

// ============================================================================
// Primitive type sets for field instance checking
// ============================================================================

const GET_PRIMITIVES = new Set(["number", "string", "boolean", "bigint", "Date", "Buffer"]);

const PUT_PRIMITIVES = new Set(["number", "string", "boolean", "bigint", "Date", "Buffer"]);

const META_PRIMITIVES = new Set(["number", "string", "boolean", "bigint", "Date", "Buffer"]);

// ============================================================================
// Read<A> derivation: requires Get for each field
// ============================================================================

const readDerivation: GenericDerivation = {
  typeclassName: "Read",
  fieldTypeclass: "Get",

  hasFieldInstance: makePrimitiveChecker(GET_PRIMITIVES),

  deriveProduct(ctx: MacroContext, typeName: string, meta: GenericMeta): string | null {
    if (!meta.fieldNames || !meta.fieldTypes) return null;

    const mappings = meta.fieldNames.map((name, i) => {
      const fieldType = meta.fieldTypes![i];
      const getExpr = resolveGetExpr(fieldType);
      if (!getExpr) return null;

      const isNullable = fieldType.includes("| null") || fieldType.includes("| undefined");

      return `{ field: "${name}", column: "${toSnakeCase(name)}", get: ${getExpr}, nullable: ${isNullable} }`;
    });

    if (mappings.some((m) => m === null)) return null;

    return `Read.make([${mappings.join(", ")}], (fields) => fields as ${typeName})`;
  },
};

// ============================================================================
// Write<A> derivation: requires Put for each field
// ============================================================================

const writeDerivation: GenericDerivation = {
  typeclassName: "Write",
  fieldTypeclass: "Put",

  hasFieldInstance: makePrimitiveChecker(PUT_PRIMITIVES),

  deriveProduct(ctx: MacroContext, typeName: string, meta: GenericMeta): string | null {
    if (!meta.fieldNames || !meta.fieldTypes) return null;

    const columns = meta.fieldNames.map((name) => `"${toSnakeCase(name)}"`);

    const extractors = meta.fieldNames.map((name, i) => {
      const fieldType = meta.fieldTypes![i];
      const putExpr = resolvePutExpr(fieldType);
      if (!putExpr) return null;

      return `(v: ${typeName}) => ${putExpr}.put(v.${name})`;
    });

    if (extractors.some((e) => e === null)) return null;

    return `Write.make([${columns.join(", ")}], [${extractors.join(", ")}])`;
  },
};

// ============================================================================
// Codec<A> derivation: requires both Read and Write
// ============================================================================

const codecDerivation: GenericDerivation = {
  typeclassName: "Codec",
  fieldTypeclass: "Meta",

  hasFieldInstance: makePrimitiveChecker(META_PRIMITIVES),

  deriveProduct(ctx: MacroContext, typeName: string, meta: GenericMeta): string | null {
    const readCode = readDerivation.deriveProduct(ctx, typeName, meta);
    const writeCode = writeDerivation.deriveProduct(ctx, typeName, meta);

    if (!readCode || !writeCode) return null;

    return `Codec.fromReadWrite(${readCode}, ${writeCode})`;
  },
};

// ============================================================================
// Helpers: resolve Get/Put companion expressions from type strings
// ============================================================================

function resolveGetExpr(typeStr: string): string | null {
  if (typeStr.includes("| null") || typeStr.includes("null |")) {
    const inner = stripUnionMember(typeStr, "null");
    const innerExpr = resolveGetExpr(inner);
    return innerExpr ? `Get.nullable(${innerExpr})` : null;
  }

  if (typeStr.includes("| undefined") || typeStr.includes("undefined |")) {
    const inner = stripUnionMember(typeStr, "undefined");
    const innerExpr = resolveGetExpr(inner);
    return innerExpr ? `Get.optional(${innerExpr})` : null;
  }

  if (typeStr.endsWith("[]")) {
    const inner = typeStr.slice(0, -2).trim();
    const innerExpr = resolveGetExpr(inner);
    return innerExpr ? `Get.array(${innerExpr})` : null;
  }

  if (typeStr.startsWith("Array<") && typeStr.endsWith(">")) {
    const inner = typeStr.slice(6, -1).trim();
    const innerExpr = resolveGetExpr(inner);
    return innerExpr ? `Get.array(${innerExpr})` : null;
  }

  const map: Record<string, string> = {
    string: "Get.string",
    number: "Get.number",
    boolean: "Get.boolean",
    bigint: "Get.bigint",
    Date: "Get.date",
    Buffer: "Get.buffer",
  };

  return map[typeStr] ?? null;
}

function resolvePutExpr(typeStr: string): string | null {
  if (typeStr.includes("| null") || typeStr.includes("null |")) {
    const inner = stripUnionMember(typeStr, "null");
    const innerExpr = resolvePutExpr(inner);
    return innerExpr ? `Put.nullable(${innerExpr})` : null;
  }

  if (typeStr.includes("| undefined") || typeStr.includes("undefined |")) {
    const inner = stripUnionMember(typeStr, "undefined");
    const innerExpr = resolvePutExpr(inner);
    return innerExpr ? `Put.optional(${innerExpr})` : null;
  }

  if (typeStr.endsWith("[]")) {
    const inner = typeStr.slice(0, -2).trim();
    const innerExpr = resolvePutExpr(inner);
    return innerExpr ? `Put.array(${innerExpr})` : null;
  }

  if (typeStr.startsWith("Array<") && typeStr.endsWith(">")) {
    const inner = typeStr.slice(6, -1).trim();
    const innerExpr = resolvePutExpr(inner);
    return innerExpr ? `Put.array(${innerExpr})` : null;
  }

  const map: Record<string, string> = {
    string: "Put.string",
    number: "Put.number",
    boolean: "Put.boolean",
    bigint: "Put.bigint",
    Date: "Put.date",
    Buffer: "Put.buffer",
  };

  return map[typeStr] ?? null;
}

function stripUnionMember(typeStr: string, member: string): string {
  return typeStr
    .replace(new RegExp(`\\s*\\|\\s*${member}\\s*`, "g"), "")
    .replace(new RegExp(`\\s*${member}\\s*\\|\\s*`, "g"), "")
    .trim();
}

// ============================================================================
// Register with core infrastructure
// ============================================================================

registerGenericDerivation("Read", readDerivation);
registerGenericDerivation("Write", writeDerivation);
registerGenericDerivation("Codec", codecDerivation);

export { readDerivation, writeDerivation, codecDerivation };
