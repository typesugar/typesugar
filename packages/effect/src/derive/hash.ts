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
 *   [Hash.symbol](self: User): number {
 *     return Hash.combine(
 *       Hash.hash(self.id),
 *       Hash.combine(Hash.hash(self.name), Hash.hash(self.age))
 *     );
 *   }
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
import {
  call,
  discriminantSwitch,
  exportedSymbolInstance,
  ident,
  member,
  param,
  propOf,
  qualifiedTypeRef,
  ret,
  typeRef,
} from "./codegen-common.js";

/**
 * Build the combine-chain expression that hashes every field of a product:
 * `Hash.combine(Hash.hash(self.a), Hash.combine(Hash.hash(self.b), ...))`.
 *
 * Returns a `ts.Expression` (never a code string) so callers compose it
 * directly into the surrounding AST.
 */
function fieldHashChain(fields: DeriveFieldInfo[]): ts.Expression {
  if (fields.length === 0) {
    return ts.factory.createNumericLiteral(0);
  }

  const hashes = fields.map((f) => call(member("Hash", "hash"), [propOf(ident("self"), f.name)]));

  // Fold right into nested Hash.combine(hash_i, <rest>).
  let result = hashes[hashes.length - 1];
  for (let i = hashes.length - 2; i >= 0; i--) {
    result = call(member("Hash", "combine"), [hashes[i], result]);
  }
  return result;
}

/** `[Hash.symbol](self: <name>): number` — the shared method header for a Hash instance. */
function hashMethod(typeName: string, body: ts.Statement[]) {
  return {
    symbolExpr: member("Hash", "symbol"),
    params: [param("self", typeRef(typeName))],
    returnType: ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
    body,
  };
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
    _ctx: MacroContext,
    _target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const { name, kind, fields, variants, discriminant } = typeInfo;

    if (kind === "sum" && variants && discriminant) {
      return generateSumTypeHash(name, discriminant, variants);
    }

    // Product type.
    return [
      exportedSymbolInstance(
        `${name}Hash`,
        qualifiedTypeRef("Hash", "Hash", [typeRef(name)]),
        hashMethod(name, [ret(fieldHashChain(fields))])
      ),
    ];
  },
});

/**
 * Generate Hash for sum types (discriminated unions).
 */
function generateSumTypeHash(
  typeName: string,
  discriminant: string,
  variants: Array<{ tag: string; typeName: string; fields: DeriveFieldInfo[] }>
): ts.Statement[] {
  const cases = variants.map((variant) => {
    // Seed each variant with a unique base hash derived from its tag.
    const baseHash = call(member("Hash", "hash"), [ts.factory.createStringLiteral(variant.tag)]);
    const combined =
      variant.fields.length > 0
        ? call(member("Hash", "combine"), [baseHash, fieldHashChain(variant.fields)])
        : baseHash;
    return { tag: variant.tag, statements: [ret(combined)] };
  });

  const body = [
    discriminantSwitch(propOf(ident("self"), discriminant), cases, [
      ret(ts.factory.createNumericLiteral(0)),
    ]),
  ];

  return [
    exportedSymbolInstance(
      `${typeName}Hash`,
      qualifiedTypeRef("Hash", "Hash", [typeRef(typeName)]),
      hashMethod(typeName, body)
    ),
  ];
}

/**
 * Runtime placeholder for @derive(EffectHash).
 */
export const EffectHash = "EffectHash";
