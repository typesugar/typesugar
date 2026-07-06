/**
 * EffectSchema Derive Macro
 *
 * Generates Effect Schema definitions from TypeScript interfaces.
 *
 * @example
 * ```typescript
 * @derive(EffectSchema)
 * interface User {
 *   id: string;
 *   name: string;
 *   email: string;
 *   age: number;
 *   role: "admin" | "user";
 *   active?: boolean;
 * }
 *
 * // Generates:
 * export const UserSchema = Schema.Struct({
 *   id: Schema.String,
 *   name: Schema.String,
 *   email: Schema.String,
 *   age: Schema.Number,
 *   role: Schema.Literal("admin", "user"),
 *   active: Schema.optional(Schema.Boolean),
 * });
 * export type UserEncoded = Schema.Schema.Encoded<typeof UserSchema>;
 * ```
 *
 * @module
 */

import * as ts from "typescript";
import {
  type DeriveMacro,
  type MacroContext,
  type DeriveTypeInfo,
  type DeriveFieldInfo,
  defineDeriveMacro,
} from "@typesugar/core";
import { call, exportedConst, ident, member } from "./codegen-common.js";

/**
 * Map TypeScript primitive types to Effect Schema constructors.
 *
 * NOTE (CLAUDE.md exception): this function is the one string→AST holdout in
 * this file. It recurses over `field.typeString` — the type textualized by
 * `typeChecker.typeToString` upstream — and returns a schema-source string
 * that the macro re-parses with `ctx.parseExpression`. See the matching entry
 * in the repo CLAUDE.md exception list. Everything ELSE in this file (the
 * `Schema.Struct`/`Schema.Union` calls, the exported const, and the `Encoded`
 * type alias) is built with `ts.factory.create*` and must stay that way.
 */
function mapTypeToSchema(typeString: string, optional: boolean): string {
  const type = typeString.trim();
  let schema: string;

  // Handle primitives
  if (type === "string") {
    schema = "Schema.String";
  } else if (type === "number") {
    schema = "Schema.Number";
  } else if (type === "boolean") {
    schema = "Schema.Boolean";
  } else if (type === "bigint") {
    schema = "Schema.BigInt";
  } else if (type === "undefined" || type === "void") {
    schema = "Schema.Undefined";
  } else if (type === "null") {
    schema = "Schema.Null";
  } else if (type === "unknown") {
    schema = "Schema.Unknown";
  } else if (type === "Date") {
    schema = "Schema.Date";
  }
  // Handle literal types
  else if (/^"[^"]*"$/.test(type) || /^'[^']*'$/.test(type)) {
    // String literal
    schema = `Schema.Literal(${type})`;
  } else if (/^\d+$/.test(type)) {
    // Number literal
    schema = `Schema.Literal(${type})`;
  } else if (type === "true" || type === "false") {
    schema = `Schema.Literal(${type})`;
  }
  // Handle union of literals (e.g., "admin" | "user")
  else if (type.includes(" | ")) {
    const parts = type.split(" | ").map((p) => p.trim());
    const allLiterals = parts.every(
      (p) =>
        /^"[^"]*"$/.test(p) ||
        /^'[^']*'$/.test(p) ||
        /^\d+$/.test(p) ||
        p === "true" ||
        p === "false"
    );
    if (allLiterals) {
      schema = `Schema.Literal(${parts.join(", ")})`;
    } else {
      // Union of types
      const schemas = parts.map((p) => mapTypeToSchema(p, false));
      schema = `Schema.Union(${schemas.join(", ")})`;
    }
  }
  // Handle arrays
  else if (type.endsWith("[]")) {
    const elementType = type.slice(0, -2);
    const elementSchema = mapTypeToSchema(elementType, false);
    schema = `Schema.Array(${elementSchema})`;
  } else if (type.startsWith("Array<") && type.endsWith(">")) {
    const elementType = type.slice(6, -1);
    const elementSchema = mapTypeToSchema(elementType, false);
    schema = `Schema.Array(${elementSchema})`;
  }
  // Handle ReadonlyArray
  else if (type.startsWith("ReadonlyArray<") && type.endsWith(">")) {
    const elementType = type.slice(14, -1);
    const elementSchema = mapTypeToSchema(elementType, false);
    schema = `Schema.Array(${elementSchema})`;
  }
  // Handle Record
  else if (type.startsWith("Record<") && type.endsWith(">")) {
    const inner = type.slice(7, -1);
    const [keyType, valueType] = splitGenericArgs(inner);
    const keySchema = mapTypeToSchema(keyType, false);
    const valueSchema = mapTypeToSchema(valueType, false);
    schema = `Schema.Record({ key: ${keySchema}, value: ${valueSchema} })`;
  }
  // Handle Map
  else if (type.startsWith("Map<") && type.endsWith(">")) {
    const inner = type.slice(4, -1);
    const [keyType, valueType] = splitGenericArgs(inner);
    const keySchema = mapTypeToSchema(keyType, false);
    const valueSchema = mapTypeToSchema(valueType, false);
    schema = `Schema.Map({ key: ${keySchema}, value: ${valueSchema} })`;
  }
  // Handle Set
  else if (type.startsWith("Set<") && type.endsWith(">")) {
    const elementType = type.slice(4, -1);
    const elementSchema = mapTypeToSchema(elementType, false);
    schema = `Schema.Set(${elementSchema})`;
  }
  // Handle Option (Effect's Option)
  else if (type.startsWith("Option<") && type.endsWith(">")) {
    const elementType = type.slice(7, -1);
    const elementSchema = mapTypeToSchema(elementType, false);
    schema = `Schema.Option(${elementSchema})`;
  }
  // Handle Either (Effect's Either)
  else if (type.startsWith("Either<") && type.endsWith(">")) {
    const inner = type.slice(7, -1);
    const [leftType, rightType] = splitGenericArgs(inner);
    const leftSchema = mapTypeToSchema(leftType, false);
    const rightSchema = mapTypeToSchema(rightType, false);
    schema = `Schema.Either({ left: ${leftSchema}, right: ${rightSchema} })`;
  }
  // Fallback: assume it's a reference to another schema
  else {
    schema = `${type}Schema`;
  }

  // Wrap in optional if needed
  if (optional) {
    return `Schema.optional(${schema})`;
  }
  return schema;
}

/**
 * Split generic type arguments (handles nested generics).
 */
function splitGenericArgs(inner: string): [string, string] {
  let depth = 0;
  let splitIndex = -1;

  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (char === "<") depth++;
    else if (char === ">") depth--;
    else if (char === "," && depth === 0) {
      splitIndex = i;
      break;
    }
  }

  if (splitIndex === -1) {
    return [inner.trim(), "unknown"];
  }

  return [inner.slice(0, splitIndex).trim(), inner.slice(splitIndex + 1).trim()];
}

/**
 * Build the per-field property assignment `<name>: <schema-expression>`.
 *
 * The schema expression itself is produced by `mapTypeToSchema` (string) and
 * lifted to AST via `ctx.parseExpression` — the documented CLAUDE.md
 * exception. The property assignment that wraps it is AST-built.
 */
function fieldSchemaProperty(ctx: MacroContext, field: DeriveFieldInfo): ts.PropertyAssignment {
  const schemaExpr = ctx.parseExpression(mapTypeToSchema(field.typeString, field.optional));
  return ts.factory.createPropertyAssignment(field.name, schemaExpr);
}

/**
 * Build `export type <name>Encoded = Schema.Schema.Encoded<typeof <schemaName>>;`.
 */
function encodedTypeAlias(typeName: string, schemaName: string): ts.TypeAliasDeclaration {
  const encodedRef = ts.factory.createTypeReferenceNode(
    // Schema.Schema.Encoded — a doubly-qualified entity name.
    ts.factory.createQualifiedName(
      ts.factory.createQualifiedName(ident("Schema"), "Schema"),
      "Encoded"
    ),
    [ts.factory.createTypeQueryNode(ident(schemaName))]
  );

  return ts.factory.createTypeAliasDeclaration(
    [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
    ident(`${typeName}Encoded`),
    undefined,
    encodedRef
  );
}

/**
 * EffectSchema derive macro.
 *
 * Generates an Effect Schema struct definition from type fields.
 */
export const EffectSchemaDerive: DeriveMacro = defineDeriveMacro({
  name: "EffectSchema",
  module: "@typesugar/effect",
  description: "Generate an Effect Schema definition from type fields",

  expand(
    ctx: MacroContext,
    _target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const { name, kind, fields, variants, discriminant } = typeInfo;

    if (kind === "sum" && variants && discriminant) {
      return generateSumTypeSchema(ctx, name, discriminant, variants);
    }

    // Product type (struct).
    const schemaName = `${name}Schema`;
    const struct = call(member("Schema", "Struct"), [
      ts.factory.createObjectLiteralExpression(
        fields.map((f) => fieldSchemaProperty(ctx, f)),
        true
      ),
    ]);

    return [exportedConst(schemaName, undefined, struct), encodedTypeAlias(name, schemaName)];
  },
});

/**
 * Generate schema for sum types (discriminated unions).
 */
function generateSumTypeSchema(
  ctx: MacroContext,
  typeName: string,
  discriminant: string,
  variants: Array<{ tag: string; typeName: string; fields: DeriveFieldInfo[] }>
): ts.Statement[] {
  const schemaName = `${typeName}Schema`;

  // Each variant becomes a Schema.Struct tagged with a discriminant literal.
  const variantStructs = variants.map((variant) => {
    const discriminantProp = ts.factory.createPropertyAssignment(
      discriminant,
      call(member("Schema", "Literal"), [ts.factory.createStringLiteral(variant.tag)])
    );
    const properties = [
      discriminantProp,
      ...variant.fields.map((f) => fieldSchemaProperty(ctx, f)),
    ];
    return call(member("Schema", "Struct"), [
      ts.factory.createObjectLiteralExpression(properties, true),
    ]);
  });

  const union = call(member("Schema", "Union"), variantStructs);

  return [exportedConst(schemaName, undefined, union), encodedTypeAlias(typeName, schemaName)];
}

/**
 * Runtime placeholder for @derive(EffectSchema).
 */
export const EffectSchema = "EffectSchema";
