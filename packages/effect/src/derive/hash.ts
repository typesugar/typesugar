/**
 * EffectHash Derive Macro
 *
 * Generates a structural hash function for a TypeScript interface/type,
 * combining `Hash.hash` of each field with Effect 3's curried
 * `Hash.combine(b)(self)`.
 *
 * Effect 3's `Hash.Hash` is not a type-class instance: it is an interface an
 * object implements on itself (`[Hash.symbol](): number`), so an external
 * `{ [Hash.symbol](self) }` object is never consulted by `Hash.hash`. This
 * derive therefore produces a plain `(self: T) => number` function, consistent
 * with `@derive(EffectEqual)` (equal values hash equally, because both use
 * Effect's structural `Equal.equals` / `Hash.hash` per field).
 *
 * @example
 * ```typescript
 * @derive(EffectHash)
 * interface Point { x: number; y: number }
 *
 * // Generates:
 * export const PointHash = (self: Point): number =>
 *   Hash.combine(Hash.hash(self["y"]))(Hash.combine(Hash.hash(self["x"]))(Hash.string("Point")));
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

function hashCall(ctx: MacroContext, fn: string, arg: ts.Expression): ts.Expression {
  return ctx.factory.createCallExpression(
    ctx.factory.createPropertyAccessExpression(ctx.ensureImport("Hash", "effect"), fn),
    undefined,
    [arg]
  );
}

/** Fold the fields into `seed` with `Hash.combine(Hash.hash(self[k]))(acc)`. */
function foldFields(
  ctx: MacroContext,
  fields: DeriveFieldInfo[],
  self: ts.Expression,
  seed: ts.Expression
): ts.Expression {
  const f = ctx.factory;
  let acc = seed;
  for (const field of fields) {
    acc = f.createCallExpression(
      hashCall(
        ctx,
        "combine",
        hashCall(
          ctx,
          "hash",
          f.createElementAccessExpression(self, f.createStringLiteral(field.name))
        )
      ),
      undefined,
      [acc]
    );
  }
  return acc;
}

/** `export const <name> = (self: T): number => <body>;` */
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
            [
              f.createParameterDeclaration(
                undefined,
                undefined,
                "self",
                undefined,
                f.createTypeReferenceNode(typeName)
              ),
            ],
            f.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
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
 * EffectHash derive macro.
 */
export const EffectHashDerive: DeriveMacro = defineDeriveMacro({
  name: "EffectHash",
  module: "@typesugar/effect",
  description: "Generate an Effect-compatible structural hash function for a type",

  expand(
    ctx: MacroContext,
    _target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const f = ctx.factory;
    const { name, kind, fields, variants, discriminant } = typeInfo;
    const self = f.createIdentifier("self");

    if (kind === "sum" && (!variants || variants.length === 0 || !discriminant)) {
      // Derive type info only resolves variants that are NAMED types
      // (`type S = Circle | Rect`); for inline object-literal members it
      // reports none, and an empty switch/Union would silently be wrong.
      ctx.reportError(
        _target,
        `@derive(EffectHash) on ${name}: could not resolve the union's variants. ` +
          "Declare each variant as a named interface/type (type S = A | B) with a literal discriminant."
      );
      return [];
    }
    if (kind === "sum" && variants && discriminant) {
      const selfAny = f.createParenthesizedExpression(
        f.createAsExpression(self, f.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword))
      );
      const body = f.createBlock(
        [
          f.createSwitchStatement(
            f.createElementAccessExpression(selfAny, f.createStringLiteral(discriminant)),
            f.createCaseBlock([
              ...variants.map((v) =>
                f.createCaseClause(f.createStringLiteral(v.tag), [
                  f.createReturnStatement(
                    foldFields(
                      ctx,
                      v.fields,
                      selfAny,
                      hashCall(ctx, "string", f.createStringLiteral(v.tag))
                    )
                  ),
                ])
              ),
              f.createDefaultClause([f.createReturnStatement(hashCall(ctx, "hash", self))]),
            ])
          ),
        ],
        true
      );
      return [exportArrow(f, `${name}Hash`, name, body)];
    }

    return [
      exportArrow(
        f,
        `${name}Hash`,
        name,
        foldFields(ctx, fields, self, hashCall(ctx, "string", f.createStringLiteral(name)))
      ),
    ];
  },
});

/**
 * Runtime placeholder for @derive(EffectHash).
 */
export const EffectHash = "EffectHash";
