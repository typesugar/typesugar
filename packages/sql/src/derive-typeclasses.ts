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

/**
 * Instances already emitted for a derive target in the current transform.
 *
 * `@derive(Codec)` also needs `ReadX`/`WriteX`, so in `@derive(Read, Write,
 * Codec)` the same declarations would be emitted twice (a SyntaxError in the
 * output). Each macro records what it emitted here and skips a declaration
 * that is already present.
 *
 * Shape (CLAUDE.md "Resolving things a macro just generated"): a live keyed
 * registry written and read within the same pass, keyed first by the
 * MacroContext (one per transform of a file, so a later re-transform of the
 * same node starts empty) and then by the target declaration node. Not a scan
 * of the source text, which could not see what this pass generated.
 */
const emittedInstances = new WeakMap<object, WeakMap<ts.Node, Set<string>>>();

function emittedFor(ctx: MacroContext, target: DeriveTarget): Set<string> {
  let byTarget = emittedInstances.get(ctx);
  if (!byTarget) {
    byTarget = new WeakMap();
    emittedInstances.set(ctx, byTarget);
  }
  let names = byTarget.get(target);
  if (!names) {
    names = new Set();
    byTarget.set(target, names);
  }
  return names;
}

// ============================================================================
// Read Derive Macro
// ============================================================================

/**
 * `@derive(Read)` derives a Read instance for a product type.
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
    const emitted = emittedFor(ctx, target);
    if (emitted.has("Read")) return []; // already emitted by @derive(Codec)
    const mappings = collectMappings(ctx, "Read", target, typeInfo.fields);
    if (!mappings) return [];
    emitted.add("Read");
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
 * `@derive(Write)` derives a Write instance for a product type (with per-field
 * metadata, so `setTyped` can write partial values).
 */
export const deriveWriteMacro = defineDeriveMacro({
  name: "Write",
  expand(ctx: MacroContext, target: DeriveTarget, typeInfo: DeriveTypeInfo): ts.Statement[] {
    if (!checkProduct(ctx, "Write", target, typeInfo)) return [];
    const typeName = typeInfo.name;
    const emitted = emittedFor(ctx, target);
    if (emitted.has("Write")) return []; // already emitted by @derive(Codec)
    const mappings = collectMappings(ctx, "Write", target, typeInfo.fields);
    if (!mappings) return [];
    emitted.add("Write");
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
 * `@derive(Codec)` derives ReadT and WriteT plus a combined CodecT instance.
 *
 * `ReadT`/`WriteT` are emitted only if this derive list has not already
 * emitted them (`@derive(Read, Write, Codec)` emits each exactly once).
 */
export const deriveCodecMacro = defineDeriveMacro({
  name: "Codec",
  // Expand after Read/Write when they are in the same list, so their
  // declarations come first and Codec reuses them.
  expandAfter: ["Read", "Write"],
  expand(ctx: MacroContext, target: DeriveTarget, typeInfo: DeriveTypeInfo): ts.Statement[] {
    const factory = ctx.factory;
    const typeName = typeInfo.name;
    const emitted = emittedFor(ctx, target);

    const hadRead = emitted.has("Read");
    const readStatements = deriveReadMacro.expand(ctx, target, typeInfo);
    if (!hadRead && readStatements.length === 0) return [];
    const hadWrite = emitted.has("Write");
    const writeStatements = deriveWriteMacro.expand(ctx, target, typeInfo);
    if (!hadWrite && writeStatements.length === 0) return [];

    const codec = exportConst(
      ctx,
      `Codec${typeName}`,
      "Codec",
      typeName,
      factory.createCallExpression(
        factory.createPropertyAccessExpression(runtimeRef(ctx, "Codec"), "fromReadWrite"),
        // Explicit <T> so the instance type does not depend on inference.
        [factory.createTypeReferenceNode(typeName)],
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
