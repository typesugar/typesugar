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

/**
 * Map TypeScript primitive types to Effect Schema constructors.
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
 * Generate field definitions for Schema.Struct.
 */
function generateFieldSchemas(fields: DeriveFieldInfo[]): string {
  return fields
    .map((field) => {
      const schema = mapTypeToSchema(field.typeString, field.optional);
      return `  ${field.name}: ${schema}`;
    })
    .join(",\n");
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
    target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const { name, kind, fields, variants, discriminant } = typeInfo;

    if (kind === "sum" && variants && discriminant) {
      return generateSumTypeSchema(ctx, name, discriminant, variants);
    }

    // Product type (struct)
    const fieldSchemas = generateFieldSchemas(fields);
    const schemaName = `${name}Schema`;

    const code = `
export const ${schemaName} = Schema.Struct({
${fieldSchemas}
});
export type ${name}Encoded = Schema.Schema.Encoded<typeof ${schemaName}>;
`;

    return ctx.parseStatements(code);
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

  // Generate variant schemas
  const variantSchemas = variants.map((variant) => {
    const fields = [
      `  ${discriminant}: Schema.Literal("${variant.tag}")`,
      ...variant.fields.map((f) => {
        const schema = mapTypeToSchema(f.typeString, f.optional);
        return `  ${f.name}: ${schema}`;
      }),
    ].join(",\n");

    return `Schema.Struct({
${fields}
})`;
  });

  const code = `
export const ${schemaName} = Schema.Union(
${variantSchemas.map((s) => `  ${s}`).join(",\n")}
);
export type ${typeName}Encoded = Schema.Schema.Encoded<typeof ${schemaName}>;
`;

  return ctx.parseStatements(code);
}

/**
 * Runtime placeholder for @derive(EffectSchema).
 */
export const EffectSchema = "EffectSchema";
