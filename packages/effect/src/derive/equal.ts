/**
 * EffectEqual Derive Macro
 *
 * Generates a structural equality function for a TypeScript interface/type,
 * typed as Effect's `Equivalence.Equivalence<T>` (`(self: T, that: T) => boolean`)
 * and comparing each field with `Equal.equals`.
 *
 * Effect 3's `Equal.Equal` is NOT a type-class instance: it is an interface an
 * object implements on itself (`[Equal.symbol](that: Equal): boolean`, plus
 * `[Hash.symbol](): number`). An external `{ [Equal.symbol](self, that) }`
 * object is never consulted by `Equal.equals`, so this derive produces an
 * `Equivalence` — the Effect type for "how to compare two Ts" — instead.
 *
 * @example
 * ```typescript
 * @derive(EffectEqual)
 * interface User {
 *   id: string;
 *   name: string;
 * }
 *
 * // Generates:
 * export const UserEqual = (self: User, that: User): boolean =>
 *   Equal.equals(self["id"], that["id"]) && Equal.equals(self["name"], that["name"]);
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

function anyCast(f: ts.NodeFactory, e: ts.Expression): ts.Expression {
  return f.createParenthesizedExpression(
    f.createAsExpression(e, f.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword))
  );
}

/** `Equal.equals(self[k], that[k]) && ...` (or `true` for no fields). */
function fieldEqualities(
  ctx: MacroContext,
  fields: DeriveFieldInfo[],
  self: ts.Expression,
  that: ts.Expression
): ts.Expression {
  const f = ctx.factory;
  if (fields.length === 0) return f.createTrue();
  return fields
    .map(
      (field): ts.Expression =>
        f.createCallExpression(
          f.createPropertyAccessExpression(ctx.ensureImport("Equal", "effect"), "equals"),
          undefined,
          [
            f.createElementAccessExpression(self, f.createStringLiteral(field.name)),
            f.createElementAccessExpression(that, f.createStringLiteral(field.name)),
          ]
        )
    )
    .reduce((acc, e) => f.createBinaryExpression(acc, ts.SyntaxKind.AmpersandAmpersandToken, e));
}

function param(f: ts.NodeFactory, name: string, typeName: string): ts.ParameterDeclaration {
  return f.createParameterDeclaration(
    undefined,
    undefined,
    name,
    undefined,
    f.createTypeReferenceNode(typeName)
  );
}

/** `export const <name> = (self: T, that: T): boolean => <body>;` */
function exportArrow(
  f: ts.NodeFactory,
  constName: string,
  typeName: string,
  body: ts.ConciseBody
): ts.Statement {
  return f.createVariableStatement(
    [f.createModifier(ts.SyntaxKind.ExportKeyword)],
    f.createVariableDeclarationList(
      [
        f.createVariableDeclaration(
          constName,
          undefined,
          undefined,
          f.createArrowFunction(
            undefined,
            undefined,
            [param(f, "self", typeName), param(f, "that", typeName)],
            f.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword),
            f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
            body
          )
        ),
      ],
      ts.NodeFlags.Const
    )
  );
}

/**
 * EffectEqual derive macro.
 */
export const EffectEqualDerive: DeriveMacro = defineDeriveMacro({
  name: "EffectEqual",
  module: "@typesugar/effect",
  description: "Generate an Effect Equivalence (structural equality) for a type",

  expand(
    ctx: MacroContext,
    _target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const f = ctx.factory;
    const { name, kind, fields, variants, discriminant } = typeInfo;
    const self = f.createIdentifier("self");
    const that = f.createIdentifier("that");

    if (kind === "sum" && (!variants || variants.length === 0 || !discriminant)) {
      // Derive type info only resolves variants that are NAMED types
      // (`type S = Circle | Rect`); for inline object-literal members it
      // reports none, and an empty switch/Union would silently be wrong.
      ctx.reportError(
        _target,
        `@derive(EffectEqual) on ${name}: could not resolve the union's variants. ` +
          "Declare each variant as a named interface/type (type S = A | B) with a literal discriminant."
      );
      return [];
    }
    if (kind === "sum" && variants && discriminant) {
      const selfAny = anyCast(f, self);
      const thatAny = anyCast(f, that);
      const tagOf = (e: ts.Expression) =>
        f.createElementAccessExpression(e, f.createStringLiteral(discriminant));
      const body = f.createBlock(
        [
          f.createIfStatement(
            f.createBinaryExpression(
              tagOf(selfAny),
              ts.SyntaxKind.ExclamationEqualsEqualsToken,
              tagOf(thatAny)
            ),
            f.createReturnStatement(f.createFalse())
          ),
          f.createSwitchStatement(
            tagOf(selfAny),
            f.createCaseBlock([
              ...variants.map((v) =>
                f.createCaseClause(f.createStringLiteral(v.tag), [
                  f.createReturnStatement(fieldEqualities(ctx, v.fields, selfAny, thatAny)),
                ])
              ),
              f.createDefaultClause([f.createReturnStatement(f.createFalse())]),
            ])
          ),
        ],
        true
      );
      return [exportArrow(f, `${name}Equal`, name, body)];
    }

    return [exportArrow(f, `${name}Equal`, name, fieldEqualities(ctx, fields, self, that))];
  },
});

/**
 * Runtime placeholder for @derive(EffectEqual).
 */
export const EffectEqual = "EffectEqual";
