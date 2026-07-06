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
 *   [Equal.symbol](self: User, that: User): boolean {
 *     return Equal.equals(self.id, that.id) &&
 *       Equal.equals(self.name, that.name) &&
 *       Equal.equals(self.age, that.age);
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
 * Build the `&&`-chained equality expression for a product's fields:
 * `Equal.equals(self.a, that.a) && Equal.equals(self.b, that.b) && ...`.
 *
 * Returns a `ts.Expression` (an empty field set yields the `true` literal),
 * composed directly into the surrounding AST.
 */
function fieldEqualityChain(fields: DeriveFieldInfo[]): ts.Expression {
  if (fields.length === 0) {
    return ts.factory.createTrue();
  }

  const checks = fields.map((field) =>
    call(member("Equal", "equals"), [
      propOf(ident("self"), field.name),
      propOf(ident("that"), field.name),
    ])
  );

  return checks
    .slice(1)
    .reduce<ts.Expression>(
      (acc, check) =>
        ts.factory.createBinaryExpression(acc, ts.SyntaxKind.AmpersandAmpersandToken, check),
      checks[0]
    );
}

/** `[Equal.symbol](self: <name>, that: <name>): boolean` — shared method header for an Equal instance. */
function equalMethod(typeName: string, body: ts.Statement[]) {
  return {
    symbolExpr: member("Equal", "symbol"),
    params: [param("self", typeRef(typeName)), param("that", typeRef(typeName))],
    returnType: ts.factory.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword),
    body,
  };
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
    _ctx: MacroContext,
    _target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const { name, kind, fields, variants, discriminant } = typeInfo;

    if (kind === "sum" && variants && discriminant) {
      return generateSumTypeEqual(name, discriminant, variants);
    }

    // Product type.
    return [
      exportedSymbolInstance(
        `${name}Equal`,
        qualifiedTypeRef("Equal", "Equal", [typeRef(name)]),
        equalMethod(name, [ret(fieldEqualityChain(fields))])
      ),
    ];
  },
});

/**
 * Generate Equal for sum types (discriminated unions).
 */
function generateSumTypeEqual(
  typeName: string,
  discriminant: string,
  variants: Array<{ tag: string; typeName: string; fields: DeriveFieldInfo[] }>
): ts.Statement[] {
  // Fast-path guard: different discriminants can never be equal.
  const guard = ts.factory.createIfStatement(
    ts.factory.createBinaryExpression(
      propOf(ident("self"), discriminant),
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
      propOf(ident("that"), discriminant)
    ),
    ret(ts.factory.createFalse())
  );

  const cases = variants.map((variant) => ({
    tag: variant.tag,
    statements: [ret(fieldEqualityChain(variant.fields))],
  }));

  const body = [
    guard,
    discriminantSwitch(propOf(ident("self"), discriminant), cases, [ret(ts.factory.createFalse())]),
  ];

  return [
    exportedSymbolInstance(
      `${typeName}Equal`,
      qualifiedTypeRef("Equal", "Equal", [typeRef(typeName)]),
      equalMethod(typeName, body)
    ),
  ];
}

/**
 * Runtime placeholder for @derive(EffectEqual).
 */
export const EffectEqual = "EffectEqual";
