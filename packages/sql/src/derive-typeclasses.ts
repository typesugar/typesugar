/**
 * Auto-Derivation for SQL Typeclasses
 *
 * This module provides compile-time derivation of Read, Write, and Codec
 * instances for TypeScript interfaces and types.
 *
 * ## Usage
 *
 * ```typescript
 * @derive(Read, Write)
 * interface User {
 *   id: number;
 *   name: string;
 *   email: string;
 *   /** @column("created_at") *\/
 *   createdAt: Date;
 *   /** @column("is_active") *\/
 *   isActive: boolean;
 *   updatedAt: Date | null;
 * }
 *
 * // Generates:
 * // - ReadUser: Read<User>
 * // - WriteUser: Write<User>
 * //
 * // With proper column mappings (camelCase -> snake_case)
 * // and typeclass instances for each field type.
 * ```
 *
 * ## Column Name Mapping
 *
 * By default, camelCase field names are converted to snake_case:
 * - `userId` → `user_id`
 * - `createdAt` → `created_at`
 *
 * Use a `@column` JSDoc tag to override: `@column created_at`,
 * `@column "created_at"` and `@column("created_at")` are all accepted.
 *
 * ## Type Mapping
 *
 * The following TypeScript types are automatically mapped:
 *
 * | TypeScript Type | SQL Type | Get/Put Instance |
 * |-----------------|----------|------------------|
 * | `string`        | TEXT     | Get.string       |
 * | `number`        | NUMERIC  | Get.number       |
 * | `boolean`       | BOOLEAN  | Get.boolean      |
 * | `bigint`        | BIGINT   | Get.bigint       |
 * | `Date`          | TIMESTAMPTZ | Get.date      |
 * | `Buffer`        | BYTEA    | Get.buffer       |
 * | `T \| null`     | nullable | Get.nullable     |
 * | `T \| undefined`| optional | Get.optional     |
 * | `T[]`           | ARRAY    | Get.array        |
 * | `boolean \| null`, `"a" \| "b"`, enums | (primitive) | collapsed to the primitive |
 *
 * Generated code is pure `ts.factory` AST (see derive-common.ts) and imports
 * every runtime name it uses from `@typesugar/sql` via `ctx.ensureImport`.
 *
 * @module
 */

import * as ts from "typescript";
import { defineDeriveMacro, globalRegistry } from "@typesugar/core";
import type { MacroContext, DeriveTypeInfo } from "@typesugar/core";
import {
  buildReadMake,
  buildWriteMake,
  collectMappings,
  exportConst,
  registerInRegistry,
  runtimeRef,
} from "./derive-common.js";

type DeriveTarget = ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration;

function checkProduct(
  ctx: MacroContext,
  name: string,
  target: DeriveTarget,
  typeInfo: DeriveTypeInfo
): boolean {
  if (typeInfo.kind !== "product") {
    ctx.reportError(target, `@derive(${name}) only supports product types (interfaces/classes)`);
    return false;
  }
  if (!typeInfo.fields || typeInfo.fields.length === 0) {
    ctx.reportError(target, `@derive(${name}) requires at least one field`);
    return false;
  }
  return true;
}

// ============================================================================
// Read Derive Macro
// ============================================================================

/**
 * @derive(Read) — Derives a Read instance for a product type.
 *
 * ```typescript
 * export const ReadUser: Read<User> = Read.make([...mappings], (fields) => fields as User);
 * readRegistry.set("User", ReadUser);
 * ```
 */
export const deriveReadMacro = defineDeriveMacro({
  name: "Read",
  expand(ctx: MacroContext, target: DeriveTarget, typeInfo: DeriveTypeInfo): ts.Statement[] {
    if (!checkProduct(ctx, "Read", target, typeInfo)) return [];
    const typeName = typeInfo.name;
    const mappings = collectMappings(ctx, "Read", target, typeInfo.fields);
    if (!mappings) return [];
    return [
      exportConst(ctx, `Read${typeName}`, "Read", typeName, buildReadMake(ctx, typeName, mappings)),
      registerInRegistry(ctx, "readRegistry", typeName, `Read${typeName}`),
    ];
  },
});

// ============================================================================
// Write Derive Macro
// ============================================================================

/**
 * @derive(Write) — Derives a Write instance for a product type (with per-field
 * metadata, so `setTyped` can write partial values).
 */
export const deriveWriteMacro = defineDeriveMacro({
  name: "Write",
  expand(ctx: MacroContext, target: DeriveTarget, typeInfo: DeriveTypeInfo): ts.Statement[] {
    if (!checkProduct(ctx, "Write", target, typeInfo)) return [];
    const typeName = typeInfo.name;
    const mappings = collectMappings(ctx, "Write", target, typeInfo.fields);
    if (!mappings) return [];
    return [
      exportConst(
        ctx,
        `Write${typeName}`,
        "Write",
        typeName,
        buildWriteMake(ctx, typeName, mappings)
      ),
      registerInRegistry(ctx, "writeRegistry", typeName, `Write${typeName}`),
    ];
  },
});

// ============================================================================
// Codec Derive Macro
// ============================================================================

/**
 * @derive(Codec) — Derives ReadT and WriteT plus a combined CodecT instance.
 */
export const deriveCodecMacro = defineDeriveMacro({
  name: "Codec",
  expand(ctx: MacroContext, target: DeriveTarget, typeInfo: DeriveTypeInfo): ts.Statement[] {
    const factory = ctx.factory;
    const typeName = typeInfo.name;

    const readStatements = deriveReadMacro.expand(ctx, target, typeInfo);
    if (readStatements.length === 0) return [];
    const writeStatements = deriveWriteMacro.expand(ctx, target, typeInfo);
    if (writeStatements.length === 0) return [];

    const codec = exportConst(
      ctx,
      `Codec${typeName}`,
      "Codec",
      typeName,
      factory.createCallExpression(
        factory.createPropertyAccessExpression(runtimeRef(ctx, "Codec"), "fromReadWrite"),
        undefined,
        [factory.createIdentifier(`Read${typeName}`), factory.createIdentifier(`Write${typeName}`)]
      )
    );

    return [...readStatements, ...writeStatements, codec];
  },
});

// ============================================================================
// Registration
// ============================================================================

globalRegistry.register(deriveReadMacro);
globalRegistry.register(deriveWriteMacro);
globalRegistry.register(deriveCodecMacro);
