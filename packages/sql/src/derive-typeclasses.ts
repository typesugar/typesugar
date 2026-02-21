/**
 * Auto-Derivation for SQL Typeclasses
 *
 * This module provides compile-time derivation of Read, Write, and Codec
 * instances for TypeScript interfaces and types.
 *
 * ## Usage
 *
 * ```typescript
 * @deriving(Read, Write)
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
 * Use `@column("custom_name")` JSDoc tag to override.
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
 *
 * @module
 */

import * as ts from "typescript";
import { defineDeriveMacro, globalRegistry } from "@typesugar/core";
import type { MacroContext, DeriveTypeInfo, DeriveFieldInfo } from "@typesugar/core";

// ============================================================================
// Type-to-Instance Mapping
// ============================================================================

/**
 * Map from TypeScript type strings to Get instance expressions.
 */
function getGetInstanceForType(typeChecker: ts.TypeChecker, type: ts.Type): string | null {
  // Handle primitives
  if (type.flags & ts.TypeFlags.String) return "Get.string";
  if (type.flags & ts.TypeFlags.Number) return "Get.number";
  if (type.flags & ts.TypeFlags.Boolean) return "Get.boolean";
  if (type.flags & ts.TypeFlags.BigInt) return "Get.bigint";

  // Handle Date, Buffer
  const typeStr = typeChecker.typeToString(type);
  if (typeStr === "Date") return "Get.date";
  if (typeStr === "Buffer") return "Get.buffer";

  // Handle nullable/optional unions
  if (type.isUnion()) {
    const nonNullTypes = type.types.filter(
      (t) => !(t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined))
    );
    if (nonNullTypes.length === 1) {
      const innerGet = getGetInstanceForType(typeChecker, nonNullTypes[0]);
      if (innerGet) {
        const hasNull = type.types.some((t) => t.flags & ts.TypeFlags.Null);
        const hasUndefined = type.types.some((t) => t.flags & ts.TypeFlags.Undefined);
        if (hasNull) return `Get.nullable(${innerGet})`;
        if (hasUndefined) return `Get.optional(${innerGet})`;
      }
    }
  }

  // Handle arrays
  if (typeChecker.isArrayType(type)) {
    const typeArgs = (type as ts.TypeReference).typeArguments;
    if (typeArgs && typeArgs.length === 1) {
      const elementGet = getGetInstanceForType(typeChecker, typeArgs[0]);
      if (elementGet) return `Get.array(${elementGet})`;
    }
  }

  return null;
}

/**
 * Map from TypeScript type strings to Put instance expressions.
 */
function getPutInstanceForType(typeChecker: ts.TypeChecker, type: ts.Type): string | null {
  // Handle primitives
  if (type.flags & ts.TypeFlags.String) return "Put.string";
  if (type.flags & ts.TypeFlags.Number) return "Put.number";
  if (type.flags & ts.TypeFlags.Boolean) return "Put.boolean";
  if (type.flags & ts.TypeFlags.BigInt) return "Put.bigint";

  // Handle Date, Buffer
  const typeStr = typeChecker.typeToString(type);
  if (typeStr === "Date") return "Put.date";
  if (typeStr === "Buffer") return "Put.buffer";

  // Handle nullable/optional unions
  if (type.isUnion()) {
    const nonNullTypes = type.types.filter(
      (t) => !(t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined))
    );
    if (nonNullTypes.length === 1) {
      const innerPut = getPutInstanceForType(typeChecker, nonNullTypes[0]);
      if (innerPut) {
        const hasNull = type.types.some((t) => t.flags & ts.TypeFlags.Null);
        const hasUndefined = type.types.some((t) => t.flags & ts.TypeFlags.Undefined);
        if (hasNull) return `Put.nullable(${innerPut})`;
        if (hasUndefined) return `Put.optional(${innerPut})`;
      }
    }
  }

  // Handle arrays
  if (typeChecker.isArrayType(type)) {
    const typeArgs = (type as ts.TypeReference).typeArguments;
    if (typeArgs && typeArgs.length === 1) {
      const elementPut = getPutInstanceForType(typeChecker, typeArgs[0]);
      if (elementPut) return `Put.array(${elementPut})`;
    }
  }

  return null;
}

/**
 * Map from TypeScript type strings to Meta instance expressions.
 */
function getMetaInstanceForType(typeChecker: ts.TypeChecker, type: ts.Type): string | null {
  // Handle primitives
  if (type.flags & ts.TypeFlags.String) return "Meta.string";
  if (type.flags & ts.TypeFlags.Number) return "Meta.number";
  if (type.flags & ts.TypeFlags.Boolean) return "Meta.boolean";
  if (type.flags & ts.TypeFlags.BigInt) return "Meta.bigint";

  // Handle Date, Buffer
  const typeStr = typeChecker.typeToString(type);
  if (typeStr === "Date") return "Meta.date";
  if (typeStr === "Buffer") return "Meta.buffer";

  // Handle nullable/optional unions
  if (type.isUnion()) {
    const nonNullTypes = type.types.filter(
      (t) => !(t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined))
    );
    if (nonNullTypes.length === 1) {
      const innerMeta = getMetaInstanceForType(typeChecker, nonNullTypes[0]);
      if (innerMeta) {
        const hasNull = type.types.some((t) => t.flags & ts.TypeFlags.Null);
        const hasUndefined = type.types.some((t) => t.flags & ts.TypeFlags.Undefined);
        if (hasNull) return `Meta.nullable(${innerMeta})`;
        if (hasUndefined) return `Meta.optional(${innerMeta})`;
      }
    }
  }

  // Handle arrays
  if (typeChecker.isArrayType(type)) {
    const typeArgs = (type as ts.TypeReference).typeArguments;
    if (typeArgs && typeArgs.length === 1) {
      const elementMeta = getMetaInstanceForType(typeChecker, typeArgs[0]);
      if (elementMeta) return `Meta.array(${elementMeta})`;
    }
  }

  return null;
}

/**
 * Convert camelCase to snake_case.
 */
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Check for @column JSDoc tag override.
 */
function getColumnName(field: DeriveFieldInfo, ctx: MacroContext): string {
  // Check for @column JSDoc tag
  const symbol = field.symbol;
  if (symbol) {
    const decl = symbol.declarations?.[0];
    if (decl) {
      const jsDocTags = ts.getJSDocTags(decl);
      const columnTag = jsDocTags.find((tag) => tag.tagName.text === "column");
      if (columnTag && typeof columnTag.comment === "string") {
        return columnTag.comment.trim().replace(/['"]/g, "");
      }
    }
  }
  return toSnakeCase(field.name);
}

// ============================================================================
// Read Derive Macro
// ============================================================================

/**
 * @derive(Read) — Derives a Read instance for a product type.
 *
 * Generates a Read<T> instance that reads each field using its Get instance.
 */
export const deriveReadMacro = defineDeriveMacro({
  name: "Read",
  expand(
    ctx: MacroContext,
    target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const factory = ctx.factory;
    const typeChecker = ctx.typeChecker;
    const typeName = typeInfo.name;

    // Only support product types
    if (typeInfo.kind !== "product") {
      ctx.reportError(target, `@derive(Read) only supports product types (interfaces/classes)`);
      return [];
    }

    const fields = typeInfo.fields;
    if (!fields || fields.length === 0) {
      ctx.reportError(target, `@derive(Read) requires at least one field`);
      return [];
    }

    // Build column mappings
    const mappings: Array<{
      field: string;
      column: string;
      getExpr: string;
      nullable: boolean;
    }> = [];

    for (const field of fields) {
      const fieldType = field.type;
      const getExpr = getGetInstanceForType(typeChecker, fieldType);

      if (!getExpr) {
        ctx.reportError(
          target,
          `Cannot derive Read for field '${field.name}': unsupported type '${typeChecker.typeToString(fieldType)}'`
        );
        return [];
      }

      const isNullable =
        fieldType.isUnion() &&
        fieldType.types.some((t) => t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined));

      mappings.push({
        field: field.name,
        column: getColumnName(field, ctx),
        getExpr,
        nullable: isNullable,
      });
    }

    // Generate the Read instance
    //
    // const ReadUser: Read<User> = Read.make(
    //   [
    //     { field: "id", column: "id", get: Get.number, nullable: false },
    //     { field: "name", column: "name", get: Get.string, nullable: false },
    //     ...
    //   ],
    //   (fields) => fields as User,
    // );

    const mappingsArray = factory.createArrayLiteralExpression(
      mappings.map((m) =>
        factory.createObjectLiteralExpression([
          factory.createPropertyAssignment("field", factory.createStringLiteral(m.field)),
          factory.createPropertyAssignment("column", factory.createStringLiteral(m.column)),
          factory.createPropertyAssignment("get", ctx.parseExpression(m.getExpr)),
          factory.createPropertyAssignment(
            "nullable",
            m.nullable ? factory.createTrue() : factory.createFalse()
          ),
        ])
      ),
      true
    );

    const constructFn = factory.createArrowFunction(
      undefined,
      undefined,
      [factory.createParameterDeclaration(undefined, undefined, "fields")],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      factory.createAsExpression(
        factory.createIdentifier("fields"),
        factory.createTypeReferenceNode(typeName)
      )
    );

    const readInstance = factory.createVariableStatement(
      [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      factory.createVariableDeclarationList(
        [
          factory.createVariableDeclaration(
            `Read${typeName}`,
            undefined,
            factory.createTypeReferenceNode("Read", [factory.createTypeReferenceNode(typeName)]),
            factory.createCallExpression(
              factory.createPropertyAccessExpression(factory.createIdentifier("Read"), "make"),
              undefined,
              [mappingsArray, constructFn]
            )
          ),
        ],
        ts.NodeFlags.Const
      )
    );

    // Generate registration statement for implicit resolution using the registry
    // readRegistry.set("User", ReadUser);
    const registerStatement = factory.createExpressionStatement(
      factory.createCallExpression(
        factory.createPropertyAccessExpression(factory.createIdentifier("readRegistry"), "set"),
        undefined,
        [factory.createStringLiteral(typeName), factory.createIdentifier(`Read${typeName}`)]
      )
    );

    return [readInstance, registerStatement];
  },
});

// ============================================================================
// Write Derive Macro
// ============================================================================

/**
 * @derive(Write) — Derives a Write instance for a product type.
 *
 * Generates a Write<T> instance that writes each field using its Put instance.
 */
export const deriveWriteMacro = defineDeriveMacro({
  name: "Write",
  expand(
    ctx: MacroContext,
    target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const factory = ctx.factory;
    const typeChecker = ctx.typeChecker;
    const typeName = typeInfo.name;

    // Only support product types
    if (typeInfo.kind !== "product") {
      ctx.reportError(target, `@derive(Write) only supports product types (interfaces/classes)`);
      return [];
    }

    const fields = typeInfo.fields;
    if (!fields || fields.length === 0) {
      ctx.reportError(target, `@derive(Write) requires at least one field`);
      return [];
    }

    // Build column mappings
    const mappings: Array<{
      field: string;
      column: string;
      putExpr: string;
    }> = [];

    for (const field of fields) {
      const fieldType = field.type;
      const putExpr = getPutInstanceForType(typeChecker, fieldType);

      if (!putExpr) {
        ctx.reportError(
          target,
          `Cannot derive Write for field '${field.name}': unsupported type '${typeChecker.typeToString(fieldType)}'`
        );
        return [];
      }

      mappings.push({
        field: field.name,
        column: getColumnName(field, ctx),
        putExpr,
      });
    }

    // Generate columns array
    const columnsArray = factory.createArrayLiteralExpression(
      mappings.map((m) => factory.createStringLiteral(m.column))
    );

    // Generate extractors array
    const extractorsArray = factory.createArrayLiteralExpression(
      mappings.map((m) =>
        factory.createArrowFunction(
          undefined,
          undefined,
          [
            factory.createParameterDeclaration(
              undefined,
              undefined,
              "value",
              undefined,
              factory.createTypeReferenceNode(typeName)
            ),
          ],
          undefined,
          factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          factory.createCallExpression(
            factory.createPropertyAccessExpression(ctx.parseExpression(m.putExpr), "put"),
            undefined,
            [factory.createPropertyAccessExpression(factory.createIdentifier("value"), m.field)]
          )
        )
      ),
      true
    );

    const writeInstance = factory.createVariableStatement(
      [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      factory.createVariableDeclarationList(
        [
          factory.createVariableDeclaration(
            `Write${typeName}`,
            undefined,
            factory.createTypeReferenceNode("Write", [factory.createTypeReferenceNode(typeName)]),
            factory.createCallExpression(
              factory.createPropertyAccessExpression(factory.createIdentifier("Write"), "make"),
              undefined,
              [columnsArray, extractorsArray]
            )
          ),
        ],
        ts.NodeFlags.Const
      )
    );

    // Generate registration statement for implicit resolution using the registry
    // writeRegistry.set("User", WriteUser);
    const registerStatement = factory.createExpressionStatement(
      factory.createCallExpression(
        factory.createPropertyAccessExpression(factory.createIdentifier("writeRegistry"), "set"),
        undefined,
        [factory.createStringLiteral(typeName), factory.createIdentifier(`Write${typeName}`)]
      )
    );

    return [writeInstance, registerStatement];
  },
});

// ============================================================================
// Codec Derive Macro
// ============================================================================

/**
 * @derive(Codec) — Derives both Read and Write instances.
 *
 * Convenience derive that generates both ReadT and WriteT,
 * plus a combined CodecT instance.
 */
export const deriveCodecMacro = defineDeriveMacro({
  name: "Codec",
  expand(
    ctx: MacroContext,
    target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const factory = ctx.factory;
    const typeName = typeInfo.name;

    // First derive Read and Write
    const readStatements = deriveReadMacro.expand(ctx, target, typeInfo);
    const writeStatements = deriveWriteMacro.expand(ctx, target, typeInfo);

    if (readStatements.length === 0 || writeStatements.length === 0) {
      return [];
    }

    // Create combined Codec
    const codecInstance = factory.createVariableStatement(
      [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      factory.createVariableDeclarationList(
        [
          factory.createVariableDeclaration(
            `Codec${typeName}`,
            undefined,
            factory.createTypeReferenceNode("Codec", [factory.createTypeReferenceNode(typeName)]),
            factory.createCallExpression(
              factory.createPropertyAccessExpression(
                factory.createIdentifier("Codec"),
                "fromReadWrite"
              ),
              undefined,
              [
                factory.createIdentifier(`Read${typeName}`),
                factory.createIdentifier(`Write${typeName}`),
              ]
            )
          ),
        ],
        ts.NodeFlags.Const
      )
    );

    // Generate registration statement for implicit resolution
    // Codec.registerInstance<User>("User", CodecUser);
    const registerStatement = factory.createExpressionStatement(
      factory.createCallExpression(
        factory.createPropertyAccessExpression(
          factory.createIdentifier("Codec"),
          "registerInstance"
        ),
        [factory.createTypeReferenceNode(typeName)],
        [factory.createStringLiteral(typeName), factory.createIdentifier(`Codec${typeName}`)]
      )
    );

    return [...readStatements, ...writeStatements, codecInstance, registerStatement];
  },
});

// ============================================================================
// Registration
// ============================================================================

// Register the derive macros
globalRegistry.register(deriveReadMacro);
globalRegistry.register(deriveWriteMacro);
globalRegistry.register(deriveCodecMacro);
