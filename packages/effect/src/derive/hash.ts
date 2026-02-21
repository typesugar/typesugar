/**
 * EffectHash Derive Macro
 *
 * Generates Effect Hash instances from TypeScript interfaces.
 *
 * @example
 * ```typescript
 * @derive(EffectHash)
 * interface User {
 *   id: string;
 *   name: string;
 *   age: number;
 * }
 *
 * // Generates:
 * export const UserHash: Hash.Hash<User> = {
 *   [Hash.symbol]: (self: User) =>
 *     Hash.combine(
 *       Hash.hash(self.id),
 *       Hash.combine(
 *         Hash.hash(self.name),
 *         Hash.hash(self.age)
 *       )
 *     ),
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
 * Generate hash combination for fields.
 */
function generateFieldHashes(fields: DeriveFieldInfo[]): string {
  if (fields.length === 0) {
    return "0";
  }

  if (fields.length === 1) {
    return `Hash.hash(self.${fields[0].name})`;
  }

  // Build nested Hash.combine calls
  // Hash.combine(hash1, Hash.combine(hash2, hash3))
  const hashes = fields.map((f) => `Hash.hash(self.${f.name})`);

  let result = hashes[hashes.length - 1];
  for (let i = hashes.length - 2; i >= 0; i--) {
    result = `Hash.combine(${hashes[i]}, ${result})`;
  }

  return result;
}

/**
 * EffectHash derive macro.
 *
 * Generates an Effect Hash instance for the type.
 */
export const EffectHashDerive: DeriveMacro = defineDeriveMacro({
  name: "EffectHash",
  module: "@typesugar/effect",
  description: "Generate an Effect Hash instance for hashing",

  expand(
    ctx: MacroContext,
    target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const { name, kind, fields, variants, discriminant } = typeInfo;

    if (kind === "sum" && variants && discriminant) {
      return generateSumTypeHash(ctx, name, discriminant, variants);
    }

    // Product type
    const fieldHashes = generateFieldHashes(fields);
    const hashName = `${name}Hash`;

    const code = `
export const ${hashName}: Hash.Hash<${name}> = {
  [Hash.symbol](self: ${name}): number {
    return ${fieldHashes};
  }
};
`;

    return ctx.parseStatements(code);
  },
});

/**
 * Generate Hash for sum types (discriminated unions).
 */
function generateSumTypeHash(
  ctx: MacroContext,
  typeName: string,
  discriminant: string,
  variants: Array<{ tag: string; typeName: string; fields: DeriveFieldInfo[] }>
): ts.Statement[] {
  const hashName = `${typeName}Hash`;

  // Assign a unique base hash to each variant tag
  const cases = variants
    .map((variant, index) => {
      const baseHash = `Hash.hash("${variant.tag}")`;
      const fieldHashes = generateFieldHashes(variant.fields);
      const combinedHash =
        variant.fields.length > 0 ? `Hash.combine(${baseHash}, ${fieldHashes})` : baseHash;
      return `      case "${variant.tag}":
        return ${combinedHash};`;
    })
    .join("\n");

  const code = `
export const ${hashName}: Hash.Hash<${typeName}> = {
  [Hash.symbol](self: ${typeName}): number {
    switch (self.${discriminant}) {
${cases}
      default:
        return 0;
    }
  }
};
`;

  return ctx.parseStatements(code);
}

/**
 * Runtime placeholder for @derive(EffectHash).
 */
export const EffectHash = "EffectHash";
