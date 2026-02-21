/**
 * EffectEqual Derive Macro
 *
 * Generates Effect Equal instances from TypeScript interfaces.
 *
 * @example
 * ```typescript
 * @derive(EffectEqual)
 * interface User {
 *   id: string;
 *   name: string;
 *   age: number;
 * }
 *
 * // Generates:
 * export const UserEqual: Equal.Equal<User> = {
 *   [Equal.symbol]: (self: User, that: User) =>
 *     Equal.equals(self.id, that.id) &&
 *     Equal.equals(self.name, that.name) &&
 *     Equal.equals(self.age, that.age),
 * };
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
 * Generate equality checks for fields.
 */
function generateFieldEqualities(fields: DeriveFieldInfo[]): string {
  if (fields.length === 0) {
    return "true";
  }

  return fields
    .map((field) => {
      // Use Equal.equals for structural equality
      return `Equal.equals(self.${field.name}, that.${field.name})`;
    })
    .join(" &&\n    ");
}

/**
 * EffectEqual derive macro.
 *
 * Generates an Effect Equal instance for structural equality.
 */
export const EffectEqualDerive: DeriveMacro = defineDeriveMacro({
  name: "EffectEqual",
  module: "@typesugar/effect",
  description: "Generate an Effect Equal instance for structural equality",

  expand(
    ctx: MacroContext,
    target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const { name, kind, fields, variants, discriminant } = typeInfo;

    if (kind === "sum" && variants && discriminant) {
      return generateSumTypeEqual(ctx, name, discriminant, variants);
    }

    // Product type
    const fieldEqualities = generateFieldEqualities(fields);
    const equalName = `${name}Equal`;

    const code = `
export const ${equalName}: Equal.Equal<${name}> = {
  [Equal.symbol](self: ${name}, that: ${name}): boolean {
    return ${fieldEqualities};
  }
};
`;

    return ctx.parseStatements(code);
  },
});

/**
 * Generate Equal for sum types (discriminated unions).
 */
function generateSumTypeEqual(
  ctx: MacroContext,
  typeName: string,
  discriminant: string,
  variants: Array<{ tag: string; typeName: string; fields: DeriveFieldInfo[] }>
): ts.Statement[] {
  const equalName = `${typeName}Equal`;

  // Generate cases for each variant
  const cases = variants
    .map((variant) => {
      const fieldEqualities = generateFieldEqualities(variant.fields);
      return `      case "${variant.tag}":
        return ${fieldEqualities || "true"};`;
    })
    .join("\n");

  const code = `
export const ${equalName}: Equal.Equal<${typeName}> = {
  [Equal.symbol](self: ${typeName}, that: ${typeName}): boolean {
    if (self.${discriminant} !== that.${discriminant}) return false;
    switch (self.${discriminant}) {
${cases}
      default:
        return false;
    }
  }
};
`;

  return ctx.parseStatements(code);
}

/**
 * Runtime placeholder for @derive(EffectEqual).
 */
export const EffectEqual = "EffectEqual";
