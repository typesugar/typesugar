/**
 * `@derive(Destructure)`: extractor patterns for a user's own product
 * interfaces and discriminated unions (PEP-008 Wave 11).
 *
 * ```ts
 * /** @derive(Destructure) *\/
 * export interface Point { x: number; y: number }
 * ```
 *
 * generates, next to the type,
 *
 * ```ts
 * export function Point(x: number, y: number): Point { return { x, y }; }
 * /**
 *  * @impl Destructure<typeof Point, Point, [number, number]>
 *  * @destructure always -> x, y
 *  *\/
 * export const destructurePoint = { extract: (v: Point): [number, number] => [v.x, v.y] };
 * ```
 *
 * The FUNCTION is the value a pattern names (`case Point(x, y)`), and it
 * builds one (`Point(1, 2)`), as a Scala case class's `apply`/`unapply` pair.
 * A union gets one function and instance per variant (`Circle(r)`,
 * `Rect(w, h)`). What the names and fields are is decided in
 * destructure-plan.ts.
 *
 * **Why a function, and not a member of the derive companion namespace**
 * (`Point.Eq`, ...): a namespace compiles to an IIFE that no bundler drops,
 * so the extractor would cost bytes in every bundle that imports the module;
 * a function declaration and a `const` object literal are dropped when
 * unused. A function also merges with an interface, a type alias, and the
 * namespace other derives emit (which must come after it: the transformer
 * puts derive-generated functions first).
 *
 * **Zero cost.** The match macro inlines the `@destructure` descriptor, so
 * patterns read fields and test the discriminant directly, and reference
 * neither the function nor the instance. The descriptor is a JSDoc tag, so it
 * survives `.d.ts` emit and a library's consumers inline it too.
 */

import * as ts from "typescript";
import { defineDeriveMacro, globalRegistry, type MacroContext } from "@typesugar/core";
import {
  planDestructure,
  registerSynthesizedDestructure,
  type DestructurePlan,
  type ExtractorPlan,
  type FieldPlan,
} from "./destructure-plan.js";

export const destructureDeriveMacro = defineDeriveMacro({
  name: "Destructure",
  module: "@typesugar/std",
  description:
    "Derive extractor patterns (Destructure instances and constructor functions) for a product or discriminated union",

  expand(ctx, target) {
    let plan: ReturnType<typeof planDestructure>;
    try {
      plan = planDestructure(ctx.typeChecker, target);
    } catch (e) {
      ctx.reportError(
        target,
        `@derive(Destructure): the type checker failed on ${target.name?.text ?? "this type"} ` +
          `(${e instanceof Error ? e.message : String(e)})`
      );
      return [];
    }
    if ("error" in plan) {
      ctx.reportError(plan.at, `@derive(Destructure): ${plan.error}.`);
      return [];
    }
    // Live same-pass registry: a match later in this file sees these extractors.
    registerSynthesizedDestructure(ctx.program, ctx.sourceFile.fileName, plan);
    return plan.extractors.flatMap((e) => [
      constructorFunction(ctx, plan, e),
      instanceConst(ctx, plan, e),
    ]);
  },
});

globalRegistry.register(destructureDeriveMacro);

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

const printer = ts.createPrinter({ removeComments: true });

function exportModifiers(f: ts.NodeFactory, e: ExtractorPlan): ts.Modifier[] | undefined {
  return e.exported ? [f.createModifier(ts.SyntaxKind.ExportKeyword)] : undefined;
}

/** Copies of type parameters (without `in`/`out`, which functions don't take). */
function typeParams(
  f: ts.NodeFactory,
  params: readonly ts.TypeParameterDeclaration[] | undefined
): ts.TypeParameterDeclaration[] | undefined {
  if (!params?.length) return undefined;
  return params.map((p) =>
    f.createTypeParameterDeclaration(undefined, p.name.text, p.constraint, p.default)
  );
}

function typeRef(
  f: ts.NodeFactory,
  name: string,
  params: readonly ts.TypeParameterDeclaration[] | undefined
): ts.TypeReferenceNode {
  return f.createTypeReferenceNode(
    name,
    params?.length ? params.map((p) => f.createTypeReferenceNode(p.name.text)) : undefined
  );
}

function fieldType(f: ts.NodeFactory, field: FieldPlan): ts.TypeNode {
  return field.type ?? f.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);
}

/** A field's value type: optional fields read as `T | undefined`. */
function fieldValueType(f: ts.NodeFactory, field: FieldPlan): ts.TypeNode {
  const t = fieldType(f, field);
  return field.optional
    ? f.createUnionTypeNode([t, f.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword)])
    : t;
}

/** A parameter name for a field (a reserved word can't be one). */
function paramName(name: string): string {
  const kind = ts.identifierToKeywordKind(ts.factory.createIdentifier(name));
  const reserved =
    (kind !== undefined &&
      kind >= ts.SyntaxKind.FirstReservedWord &&
      kind <= ts.SyntaxKind.LastFutureReservedWord) ||
    name === "arguments" ||
    name === "eval";
  return reserved ? `${name}_` : name;
}

/** Type parameters of the function (and the type it returns). */
function ownTypeParams(
  plan: DestructurePlan,
  e: ExtractorPlan
): readonly ts.TypeParameterDeclaration[] | undefined {
  return (e.merges ?? plan.target).typeParameters;
}

function discriminantLiteral(f: ts.NodeFactory, value: string | boolean): ts.Expression {
  return typeof value === "boolean"
    ? value
      ? f.createTrue()
      : f.createFalse()
    : f.createStringLiteral(value);
}

function describe(plan: DestructurePlan, e: ExtractorPlan): string {
  const call = e.fields.length ? `${e.name}(${e.fields.map((x) => x.name).join(", ")})` : e.name;
  const what = e.discriminant
    ? `the \`${e.discriminant.field}: ${JSON.stringify(e.discriminant.value).replace(/\*\//g, "*\\/")}\` variant of ${plan.target.name.text}`
    : `a ${e.name}`;
  const verb = e.fields.length ? "destructures" : "matches";
  return `* Builds ${what}. In a pattern, \`${call}\` ${verb} one (@derive(Destructure)). `;
}

/** `function Point(x: number, y: number): Point { return { x, y }; }` */
function constructorFunction(
  ctx: MacroContext,
  plan: DestructurePlan,
  e: ExtractorPlan
): ts.FunctionDeclaration {
  const f = ctx.factory;
  const tps = ownTypeParams(plan, e);
  const params = e.fields.map((field, i) =>
    f.createParameterDeclaration(
      undefined,
      undefined,
      paramName(field.name),
      // Optional only when every later field is too.
      e.fields.slice(i).every((x) => x.optional)
        ? f.createToken(ts.SyntaxKind.QuestionToken)
        : undefined,
      fieldType(f, field)
    )
  );

  let returnType: ts.TypeNode;
  if (e.literal) {
    returnType = f.createTypeLiteralNode(e.literal.members);
  } else {
    returnType = typeRef(f, e.merges!.name.text, tps);
  }

  const props: ts.ObjectLiteralElementLike[] = [];
  if (e.discriminant) {
    props.push(
      f.createPropertyAssignment(e.discriminant.field, discriminantLiteral(f, e.discriminant.value))
    );
  }
  for (const field of e.fields) {
    const p = paramName(field.name);
    const prop =
      p === field.name
        ? f.createShorthandPropertyAssignment(field.name)
        : f.createPropertyAssignment(field.name, f.createIdentifier(p));
    if (!field.optional) {
      props.push(prop);
      continue;
    }
    // `...(label === undefined ? {} : { label })`: an absent optional field
    // stays absent (exactOptionalPropertyTypes).
    props.push(
      f.createSpreadAssignment(
        f.createParenthesizedExpression(
          f.createConditionalExpression(
            f.createStrictEquality(f.createIdentifier(p), f.createIdentifier("undefined")),
            undefined,
            f.createObjectLiteralExpression([]),
            undefined,
            f.createObjectLiteralExpression([prop])
          )
        )
      )
    );
  }

  const fn = f.createFunctionDeclaration(
    exportModifiers(f, e),
    undefined,
    e.name,
    typeParams(f, tps),
    params,
    returnType,
    f.createBlock([f.createReturnStatement(f.createObjectLiteralExpression(props))], true)
  );
  return ts.addSyntheticLeadingComment(
    fn,
    ts.SyntaxKind.MultiLineCommentTrivia,
    describe(plan, e),
    true
  );
}

/**
 * The instance:
 *
 *     /**
 *      * @impl Destructure<typeof Circle, Shape, number>
 *      * @destructure kind = "circle" -> r
 *      *\/
 *     export const destructureCircle = {
 *       extract: (v: Shape): number | undefined => v.kind === "circle" ? v.r : undefined,
 *     };
 *
 * It has no `Destructure<...>` annotation, which would need an import of the
 * type; the `@impl` tag says what it is (match-extractors.ts reads either).
 */
function instanceConst(
  ctx: MacroContext,
  plan: DestructurePlan,
  e: ExtractorPlan
): ts.VariableStatement {
  const f = ctx.factory;
  const v = f.createIdentifier("v");
  // The instance's types are in terms of the TARGET's type parameters (a
  // union's input is the union): a generic extract.
  const tps = plan.target.typeParameters;
  const input = typeRef(f, plan.target.name.text, tps);

  const valueType = (field: FieldPlan): ts.TypeNode =>
    e.memberRef
      ? // A named variant's field types are in ITS type parameters; index
        // the union member as written instead (`Some<A>["value"]`).
        f.createIndexedAccessTypeNode(
          e.memberRef,
          f.createLiteralTypeNode(f.createStringLiteral(field.name))
        )
      : fieldValueType(f, field);

  let output: ts.TypeNode;
  let payload: ts.Expression;
  if (e.fields.length === 0) {
    output = f.createLiteralTypeNode(f.createTrue());
    payload = f.createTrue();
  } else if (e.fields.length === 1) {
    output = valueType(e.fields[0]);
    payload = f.createPropertyAccessExpression(v, e.fields[0].name);
  } else {
    output = ts.setEmitFlags(
      f.createTupleTypeNode(e.fields.map(valueType)),
      ts.EmitFlags.SingleLine
    );
    payload = f.createArrayLiteralExpression(
      e.fields.map((field) => f.createPropertyAccessExpression(v, field.name))
    );
  }

  const body = e.discriminant
    ? f.createConditionalExpression(
        f.createStrictEquality(
          f.createPropertyAccessExpression(v, e.discriminant.field),
          discriminantLiteral(f, e.discriminant.value)
        ),
        undefined,
        payload,
        undefined,
        f.createIdentifier("undefined")
      )
    : payload;
  const returnType = e.discriminant
    ? f.createUnionTypeNode([output, f.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword)])
    : output;

  const extract = f.createArrowFunction(
    undefined,
    typeParams(f, tps),
    [f.createParameterDeclaration(undefined, undefined, v, undefined, input)],
    returnType,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    body
  );

  const stmt = f.createVariableStatement(
    exportModifiers(f, e),
    f.createVariableDeclarationList(
      [
        f.createVariableDeclaration(
          e.instanceName,
          undefined,
          undefined,
          f.createObjectLiteralExpression([f.createPropertyAssignment("extract", extract)])
        ),
      ],
      ts.NodeFlags.Const
    )
  );

  const implType = f.createTypeReferenceNode("Destructure", [
    f.createTypeQueryNode(f.createIdentifier(e.name)),
    input,
    output,
  ]);
  const implText = printer
    .printNode(ts.EmitHint.Unspecified, implType, ctx.sourceFile)
    .replace(/\*\//g, "*\\/");
  return ts.addSyntheticLeadingComment(
    stmt,
    ts.SyntaxKind.MultiLineCommentTrivia,
    `*\n * @impl ${implText}\n * @destructure ${e.descriptor}\n `,
    true
  );
}
