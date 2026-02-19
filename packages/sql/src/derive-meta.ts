/**
 * @derive(Meta) — Automatic Meta derivation for product types
 *
 * This module provides a compile-time macro that automatically generates
 * Meta, Read, and Write instances for TypeScript interfaces and types.
 *
 * ## Usage
 *
 * ```typescript
 * @derive(Meta)
 * interface User {
 *   id: number;
 *   name: string;
 *   email: string;
 *   createdAt: Date;
 * }
 *
 * // Expands to:
 * const UserMeta: Read<User> & Write<User> = {
 *   _tag: "Meta",
 *   columns: ["id", "name", "email", "created_at"],
 *   read: (row) => ({
 *     id: numberMeta.unsafeGet(row.id),
 *     name: stringMeta.unsafeGet(row.name),
 *     email: stringMeta.unsafeGet(row.email),
 *     createdAt: dateMeta.unsafeGet(row.created_at),
 *   }),
 *   unsafeRead: (row) => UserMeta.read(row)!,
 *   write: (value) => [
 *     numberMeta.put(value.id),
 *     stringMeta.put(value.name),
 *     stringMeta.put(value.email),
 *     dateMeta.put(value.createdAt),
 *   ],
 * };
 * ```
 *
 * ## Column Name Mapping
 *
 * By default, camelCase field names are converted to snake_case column names:
 * - `userId` → `user_id`
 * - `createdAt` → `created_at`
 * - `firstName` → `first_name`
 *
 * Use the `@column("custom_name")` decorator to override.
 *
 * ## Zero-Cost
 *
 * When used with `specialize`, the generated Meta operations are inlined:
 *
 * ```typescript
 * const readUser = specialize(
 *   <A>(meta: Read<A>, row: SqlRow) => meta.read(row),
 *   UserMeta,
 * );
 *
 * // Compiles to:
 * const readUser = (row: SqlRow) => ({
 *   id: row.id as number,
 *   name: row.name as string,
 *   email: row.email as string,
 *   createdAt: new Date(row.created_at as string),
 * });
 * ```
 *
 * @module
 */

import * as ts from "typescript";
import { defineAttributeMacro, type MacroContext } from "@ttfx/core";
import type { Meta, Read, Write, SqlRow } from "./meta.js";

// ============================================================================
// Type-to-Meta Mapping
// ============================================================================

/**
 * Map from TypeScript types to their Meta instances.
 */
const typeMetaMap: Record<string, string> = {
  string: "stringMeta",
  number: "numberMeta",
  boolean: "booleanMeta",
  bigint: "bigintMeta",
  Date: "dateMeta",
  Buffer: "bufferMeta",
};

/**
 * Convert camelCase to snake_case for SQL column names.
 */
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Get the Meta instance name for a TypeScript type.
 */
function getMetaForType(
  typeChecker: ts.TypeChecker,
  type: ts.Type,
): string | null {
  // Handle primitives
  if (type.flags & ts.TypeFlags.String) return "stringMeta";
  if (type.flags & ts.TypeFlags.Number) return "numberMeta";
  if (type.flags & ts.TypeFlags.Boolean) return "booleanMeta";
  if (type.flags & ts.TypeFlags.BigInt) return "bigintMeta";

  // Handle Date
  const typeStr = typeChecker.typeToString(type);
  if (typeStr === "Date") return "dateMeta";
  if (typeStr === "Buffer") return "bufferMeta";

  // Handle nullable/optional
  if (type.isUnion()) {
    const nonNullTypes = type.types.filter(
      (t) => !(t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)),
    );
    if (nonNullTypes.length === 1) {
      const innerMeta = getMetaForType(typeChecker, nonNullTypes[0]);
      if (innerMeta) {
        const hasNull = type.types.some((t) => t.flags & ts.TypeFlags.Null);
        const hasUndefined = type.types.some(
          (t) => t.flags & ts.TypeFlags.Undefined,
        );
        if (hasNull) return `nullable(${innerMeta})`;
        if (hasUndefined) return `optional(${innerMeta})`;
      }
    }
  }

  // Handle arrays
  if (typeChecker.isArrayType(type)) {
    const typeArgs = (type as ts.TypeReference).typeArguments;
    if (typeArgs && typeArgs.length === 1) {
      const elementMeta = getMetaForType(typeChecker, typeArgs[0]);
      if (elementMeta) return `arrayMeta(${elementMeta})`;
    }
  }

  return null;
}

// ============================================================================
// Field Information
// ============================================================================

interface FieldInfo {
  name: string;
  columnName: string;
  typeMeta: string;
  isNullable: boolean;
  isOptional: boolean;
}

/**
 * Extract field information from a type.
 */
function getFields(
  typeChecker: ts.TypeChecker,
  type: ts.Type,
  ctx: MacroContext,
): FieldInfo[] | null {
  const fields: FieldInfo[] = [];
  const properties = type.getProperties();

  for (const prop of properties) {
    const propType = typeChecker.getTypeOfSymbol(prop);
    const meta = getMetaForType(typeChecker, propType);

    if (!meta) {
      const decl = prop.declarations?.[0];
      if (decl) {
        ctx.reportError(
          decl,
          `Cannot derive Meta for field '${prop.name}': unsupported type '${typeChecker.typeToString(propType)}'`,
        );
      }
      return null;
    }

    // Check for @column decorator to override column name
    let columnName = toSnakeCase(prop.name);
    const decl = prop.declarations?.[0];
    if (decl && ts.isPropertySignature(decl)) {
      // TODO: Check for @column JSDoc tag
      const jsDoc = ts.getJSDocTags(decl);
      const columnTag = jsDoc.find((tag) => tag.tagName.text === "column");
      if (columnTag && typeof columnTag.comment === "string") {
        columnName = columnTag.comment.trim();
      }
    }

    // Check nullability
    const isNullable =
      propType.isUnion() &&
      propType.types.some((t) => t.flags & ts.TypeFlags.Null);
    const isOptional =
      propType.isUnion() &&
      propType.types.some((t) => t.flags & ts.TypeFlags.Undefined);

    fields.push({
      name: prop.name,
      columnName,
      typeMeta: meta,
      isNullable,
      isOptional,
    });
  }

  return fields;
}

// ============================================================================
// Code Generation
// ============================================================================

/**
 * Generate the read function body.
 */
function generateReadBody(
  fields: FieldInfo[],
  factory: ts.NodeFactory,
): ts.Expression {
  const properties = fields.map((field) => {
    // row.columnName
    const rowAccess = factory.createPropertyAccessExpression(
      factory.createIdentifier("row"),
      factory.createIdentifier(field.columnName),
    );

    // meta.unsafeGet(row.columnName) or meta.get(row.columnName)
    const metaCall = factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier(field.typeMeta),
        factory.createIdentifier(
          field.isNullable || field.isOptional ? "get" : "unsafeGet",
        ),
      ),
      undefined,
      [rowAccess],
    );

    return factory.createPropertyAssignment(
      factory.createIdentifier(field.name),
      metaCall,
    );
  });

  return factory.createObjectLiteralExpression(properties, true);
}

/**
 * Generate the write function body.
 */
function generateWriteBody(
  fields: FieldInfo[],
  factory: ts.NodeFactory,
): ts.Expression {
  const elements = fields.map((field) => {
    // value.fieldName
    const valueAccess = factory.createPropertyAccessExpression(
      factory.createIdentifier("value"),
      factory.createIdentifier(field.name),
    );

    // meta.put(value.fieldName)
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier(field.typeMeta),
        factory.createIdentifier("put"),
      ),
      undefined,
      [valueAccess],
    );
  });

  return factory.createArrayLiteralExpression(elements, true);
}

// ============================================================================
// Derive Meta Macro
// ============================================================================

/**
 * @derive(Meta) — Derives Read & Write instances for a type.
 */
export const deriveMetaMacro = defineAttributeMacro({
  name: "derive",
  validTargets: ["interface", "type"],
  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[],
  ): ts.Node[] {
    // Check argument is "Meta"
    const arg = args[0];
    if (!arg || !ts.isIdentifier(arg) || arg.text !== "Meta") {
      return [target];
    }

    const node = target;

    // Must be an interface or type alias
    if (!ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node)) {
      ctx.reportError(
        node,
        "@derive(Meta) can only be applied to interfaces and type aliases",
      );
      return [node];
    }

    const typeName = node.name.text;
    const factory = ctx.factory;
    const typeChecker = ctx.typeChecker;

    // Get the type
    const symbol = typeChecker.getSymbolAtLocation(node.name);
    if (!symbol) {
      ctx.reportError(node, `Cannot resolve type '${typeName}'`);
      return [node];
    }

    const type = typeChecker.getDeclaredTypeOfSymbol(symbol);
    const fields = getFields(typeChecker, type, ctx);
    if (!fields) {
      return [node];
    }

    // Generate column names array
    const columnsArray = factory.createArrayLiteralExpression(
      fields.map((f) => factory.createStringLiteral(f.columnName)),
      false,
    );

    // Generate read function
    const readBody = generateReadBody(fields, factory);
    const readFunction = factory.createArrowFunction(
      undefined,
      undefined,
      [
        factory.createParameterDeclaration(
          undefined,
          undefined,
          factory.createIdentifier("row"),
          undefined,
          factory.createTypeReferenceNode("SqlRow"),
        ),
      ],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      readBody,
    );

    // Generate write function
    const writeBody = generateWriteBody(fields, factory);
    const writeFunction = factory.createArrowFunction(
      undefined,
      undefined,
      [
        factory.createParameterDeclaration(
          undefined,
          undefined,
          factory.createIdentifier("value"),
          undefined,
          factory.createTypeReferenceNode(typeName),
        ),
      ],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      writeBody,
    );

    // Generate the Meta constant
    const metaConst = factory.createVariableStatement(
      [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      factory.createVariableDeclarationList(
        [
          factory.createVariableDeclaration(
            factory.createIdentifier(`${typeName}Meta`),
            undefined,
            factory.createIntersectionTypeNode([
              factory.createTypeReferenceNode("Read", [
                factory.createTypeReferenceNode(typeName),
              ]),
              factory.createTypeReferenceNode("Write", [
                factory.createTypeReferenceNode(typeName),
              ]),
            ]),
            factory.createObjectLiteralExpression(
              [
                factory.createPropertyAssignment(
                  "_tag",
                  factory.createStringLiteral("Meta"),
                ),
                factory.createPropertyAssignment("columns", columnsArray),
                factory.createPropertyAssignment("read", readFunction),
                factory.createPropertyAssignment(
                  "unsafeRead",
                  factory.createArrowFunction(
                    undefined,
                    undefined,
                    [
                      factory.createParameterDeclaration(
                        undefined,
                        undefined,
                        factory.createIdentifier("row"),
                        undefined,
                        factory.createTypeReferenceNode("SqlRow"),
                      ),
                    ],
                    undefined,
                    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                    factory.createNonNullExpression(
                      factory.createCallExpression(
                        factory.createPropertyAccessExpression(
                          factory.createIdentifier(`${typeName}Meta`),
                          factory.createIdentifier("read"),
                        ),
                        undefined,
                        [factory.createIdentifier("row")],
                      ),
                    ),
                  ),
                ),
                factory.createPropertyAssignment("write", writeFunction),
              ],
              true,
            ),
          ),
        ],
        ts.NodeFlags.Const,
      ),
    );

    // Register for specialize
    const registerCall = factory.createExpressionStatement(
      factory.createCallExpression(
        factory.createIdentifier("registerInstanceMethods"),
        undefined,
        [
          factory.createStringLiteral(`${typeName}Meta`),
          factory.createStringLiteral("Meta"),
          factory.createObjectLiteralExpression([
            factory.createPropertyAssignment(
              "read",
              factory.createObjectLiteralExpression([
                factory.createPropertyAssignment(
                  "source",
                  factory.createStringLiteral(
                    `(row) => (${JSON.stringify(
                      Object.fromEntries(
                        fields.map((f) => [f.name, `\${row.${f.columnName}}`]),
                      ),
                    )})`,
                  ),
                ),
                factory.createPropertyAssignment(
                  "params",
                  factory.createArrayLiteralExpression([
                    factory.createStringLiteral("row"),
                  ]),
                ),
              ]),
            ),
          ]),
        ],
      ),
    );

    return [node, metaConst, registerCall];
  },
});
