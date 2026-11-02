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
 *   age: number;
 *   role: "admin" | "user";
 *   active?: boolean;
 *   friends: User[];
 * }
 *
 * // Generates:
 * export const UserSchema: Schema.Schema<User, any> = Schema.Struct({
 *   id: Schema.String,
 *   age: Schema.Number,
 *   role: Schema.Literal("admin", "user"),
 *   active: Schema.optional(Schema.Boolean),
 *   friends: Schema.Array(Schema.suspend(() => UserSchema)),
 * });
 * export type UserEncoded = Schema.Schema.Encoded<typeof UserSchema>;
 * ```
 *
 * The schema is built from each field's declared TYPE NODE (not its printed
 * type text). References to other named types become
 * `Schema.suspend(() => <Name>Schema)`, so recursive and out-of-order types
 * don't hit the temporal dead zone. A self-referential schema is annotated
 * `Schema.Schema<T, any>` (TypeScript can't infer a type for a const that
 * references itself). `Date` maps to `Schema.Date` and `bigint` to
 * `Schema.BigInt` — Effect's JSON-oriented transformations from string. Field
 * types that have no Schema equivalent here (generics, mapped/conditional
 * types, functions, ...) are a compile error.
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

class UnsupportedFieldType extends Error {}

interface SchemaGen {
  ctx: MacroContext;
  /** Name of the type being derived (for self-reference detection). */
  selfName: string;
  /** Set when the schema references its own `<selfName>Schema`. */
  selfReferenced: boolean;
}

function schemaRef(g: SchemaGen, member: string): ts.Expression {
  return g.ctx.factory.createPropertyAccessExpression(
    g.ctx.ensureImport("Schema", "effect"),
    member
  );
}

function schemaCall(g: SchemaGen, member: string, args: ts.Expression[]): ts.Expression {
  return g.ctx.factory.createCallExpression(schemaRef(g, member), undefined, args);
}

/** A literal type node → the literal VALUE expression for `Schema.Literal(...)`. */
function literalValue(f: ts.NodeFactory, node: ts.TypeNode): ts.Expression | undefined {
  if (!ts.isLiteralTypeNode(node)) return undefined;
  const lit = node.literal;
  if (ts.isStringLiteral(lit) || ts.isNoSubstitutionTemplateLiteral(lit)) {
    return f.createStringLiteral(lit.text);
  }
  if (ts.isNumericLiteral(lit)) return f.createNumericLiteral(lit.text);
  if (ts.isBigIntLiteral(lit)) return f.createBigIntLiteral(lit.text);
  if (lit.kind === ts.SyntaxKind.TrueKeyword) return f.createTrue();
  if (lit.kind === ts.SyntaxKind.FalseKeyword) return f.createFalse();
  if (lit.kind === ts.SyntaxKind.NullKeyword) return f.createNull();
  if (
    ts.isPrefixUnaryExpression(lit) &&
    lit.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(lit.operand)
  ) {
    return f.createPrefixUnaryExpression(
      ts.SyntaxKind.MinusToken,
      f.createNumericLiteral(lit.operand.text)
    );
  }
  return undefined;
}

function typeArgs(node: ts.TypeReferenceNode, n: number): ts.TypeNode[] {
  const args = node.typeArguments ?? [];
  if (args.length !== n) {
    const name = ts.isIdentifier(node.typeName) ? node.typeName.text : "type";
    throw new UnsupportedFieldType(`${name} expects ${n} type argument(s)`);
  }
  return [...args];
}

/** Map a field's TYPE NODE to a Schema expression (AST). */
function schemaForTypeNode(g: SchemaGen, node: ts.TypeNode): ts.Expression {
  const f = g.ctx.factory;
  switch (node.kind) {
    case ts.SyntaxKind.StringKeyword:
      return schemaRef(g, "String");
    case ts.SyntaxKind.NumberKeyword:
      return schemaRef(g, "Number");
    case ts.SyntaxKind.BooleanKeyword:
      return schemaRef(g, "Boolean");
    case ts.SyntaxKind.BigIntKeyword:
      return schemaRef(g, "BigInt");
    case ts.SyntaxKind.UndefinedKeyword:
    case ts.SyntaxKind.VoidKeyword:
      return schemaRef(g, "Undefined");
    case ts.SyntaxKind.UnknownKeyword:
      return schemaRef(g, "Unknown");
    case ts.SyntaxKind.AnyKeyword:
      return schemaRef(g, "Any");
    case ts.SyntaxKind.NeverKeyword:
      return schemaRef(g, "Never");
    case ts.SyntaxKind.ObjectKeyword:
      return schemaRef(g, "Object");
  }

  if (ts.isParenthesizedTypeNode(node)) return schemaForTypeNode(g, node.type);

  if (ts.isLiteralTypeNode(node)) {
    const v = literalValue(f, node);
    if (!v) throw new UnsupportedFieldType("unsupported literal type");
    return node.literal.kind === ts.SyntaxKind.NullKeyword
      ? schemaRef(g, "Null")
      : schemaCall(g, "Literal", [v]);
  }

  if (ts.isUnionTypeNode(node)) {
    const values = node.types.map((t) => literalValue(f, t));
    if (values.every((v) => v !== undefined)) {
      return schemaCall(g, "Literal", values as ts.Expression[]);
    }
    return schemaCall(
      g,
      "Union",
      node.types.map((t) => schemaForTypeNode(g, t))
    );
  }

  if (ts.isArrayTypeNode(node)) {
    return schemaCall(g, "Array", [schemaForTypeNode(g, node.elementType)]);
  }

  if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) {
    return schemaForTypeNode(g, node.type);
  }

  if (ts.isTupleTypeNode(node)) {
    if (
      node.elements.some(
        (e) => ts.isNamedTupleMember(e) || ts.isOptionalTypeNode(e) || ts.isRestTypeNode(e)
      )
    ) {
      throw new UnsupportedFieldType("named/optional/rest tuple elements are not supported");
    }
    return schemaCall(
      g,
      "Tuple",
      node.elements.map((e) => schemaForTypeNode(g, e))
    );
  }

  if (ts.isTypeLiteralNode(node)) {
    return schemaCall(g, "Struct", [structFields(g, node.members)]);
  }

  if (ts.isTypeReferenceNode(node)) {
    const name = ts.isIdentifier(node.typeName) ? node.typeName.text : undefined;
    if (name === undefined) {
      throw new UnsupportedFieldType("qualified type names are not supported");
    }
    switch (name) {
      case "Array":
      case "ReadonlyArray":
        return schemaCall(g, "Array", [schemaForTypeNode(g, typeArgs(node, 1)[0])]);
      case "Date":
        return schemaRef(g, "Date");
      case "Record": {
        const [k, v] = typeArgs(node, 2);
        return schemaCall(g, "Record", [
          f.createObjectLiteralExpression([
            f.createPropertyAssignment("key", schemaForTypeNode(g, k)),
            f.createPropertyAssignment("value", schemaForTypeNode(g, v)),
          ]),
        ]);
      }
      case "Map":
      case "ReadonlyMap": {
        const [k, v] = typeArgs(node, 2);
        return schemaCall(g, name === "Map" ? "Map" : "ReadonlyMap", [
          f.createObjectLiteralExpression([
            f.createPropertyAssignment("key", schemaForTypeNode(g, k)),
            f.createPropertyAssignment("value", schemaForTypeNode(g, v)),
          ]),
        ]);
      }
      case "Set":
      case "ReadonlySet":
        return schemaCall(g, name === "Set" ? "Set" : "ReadonlySet", [
          schemaForTypeNode(g, typeArgs(node, 1)[0]),
        ]);
      case "Option":
        return schemaCall(g, "Option", [schemaForTypeNode(g, typeArgs(node, 1)[0])]);
      case "Either": {
        // Effect 3: Either<R, L> — the RIGHT (success) type comes first.
        const [r, l] = typeArgs(node, 2);
        return schemaCall(g, "Either", [
          f.createObjectLiteralExpression([
            f.createPropertyAssignment("right", schemaForTypeNode(g, r)),
            f.createPropertyAssignment("left", schemaForTypeNode(g, l)),
          ]),
        ]);
      }
    }
    if (node.typeArguments && node.typeArguments.length > 0) {
      throw new UnsupportedFieldType(`generic type reference ${name}<...> is not supported`);
    }
    // Another (possibly the same) derived type: reference its schema lazily.
    if (name === g.selfName) g.selfReferenced = true;
    return schemaCall(g, "suspend", [
      f.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        f.createIdentifier(`${name}Schema`)
      ),
    ]);
  }

  throw new UnsupportedFieldType(`type ${ts.SyntaxKind[node.kind]} has no Schema mapping`);
}

/** Primitive fallback from the checker when a field has no declared type node. */
function schemaForType(g: SchemaGen, type: ts.Type): ts.Expression {
  if (type.flags & ts.TypeFlags.StringLike) return schemaRef(g, "String");
  if (type.flags & ts.TypeFlags.NumberLike) return schemaRef(g, "Number");
  if (type.flags & ts.TypeFlags.BooleanLike) return schemaRef(g, "Boolean");
  if (type.flags & ts.TypeFlags.BigIntLike) return schemaRef(g, "BigInt");
  throw new UnsupportedFieldType("field has no type annotation and an inferred non-primitive type");
}

function withOptional(g: SchemaGen, schema: ts.Expression, optional: boolean): ts.Expression {
  return optional ? schemaCall(g, "optional", [schema]) : schema;
}

function propertyName(f: ts.NodeFactory, name: string): ts.PropertyName {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
    ? f.createIdentifier(name)
    : f.createStringLiteral(name);
}

function structFields(
  g: SchemaGen,
  members: readonly ts.TypeElement[]
): ts.ObjectLiteralExpression {
  const f = g.ctx.factory;
  const props: ts.PropertyAssignment[] = [];
  for (const m of members) {
    if (!ts.isPropertySignature(m) || !m.type) {
      throw new UnsupportedFieldType("only property signatures with a type are supported");
    }
    const key =
      ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) || ts.isNumericLiteral(m.name)
        ? m.name.text
        : undefined;
    if (key === undefined)
      throw new UnsupportedFieldType("computed property names are not supported");
    props.push(
      f.createPropertyAssignment(
        propertyName(f, key),
        withOptional(g, schemaForTypeNode(g, m.type), m.questionToken !== undefined)
      )
    );
  }
  return f.createObjectLiteralExpression(props, true);
}

function fieldTypeNode(field: DeriveFieldInfo): ts.TypeNode | undefined {
  for (const decl of field.symbol?.declarations ?? []) {
    if ((ts.isPropertySignature(decl) || ts.isPropertyDeclaration(decl)) && decl.type) {
      return decl.type;
    }
  }
  return undefined;
}

function fieldAssignment(g: SchemaGen, field: DeriveFieldInfo): ts.PropertyAssignment {
  const node = fieldTypeNode(field);
  const schema = node ? schemaForTypeNode(g, node) : schemaForType(g, field.type);
  return g.ctx.factory.createPropertyAssignment(
    propertyName(g.ctx.factory, field.name),
    withOptional(g, schema, field.optional)
  );
}

/**
 * `export const <T>Schema[: Schema.Schema<T, any>] = <init>;`
 * `export type <T>Encoded = Schema.Schema.Encoded<typeof <T>Schema>;`
 */
function emit(g: SchemaGen, typeName: string, init: ts.Expression): ts.Statement[] {
  const f = g.ctx.factory;
  const schemaName = `${typeName}Schema`;
  const schemaNs = g.ctx.ensureImport("Schema", "effect");
  const qualified = (...parts: string[]): ts.EntityName =>
    parts.reduce<ts.EntityName>((acc, p) => f.createQualifiedName(acc, p), schemaNs);
  const annotation = g.selfReferenced
    ? f.createTypeReferenceNode(qualified("Schema"), [
        f.createTypeReferenceNode(typeName),
        f.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
      ])
    : undefined;
  return [
    f.createVariableStatement(
      [f.createModifier(ts.SyntaxKind.ExportKeyword)],
      f.createVariableDeclarationList(
        [f.createVariableDeclaration(schemaName, undefined, annotation, init)],
        ts.NodeFlags.Const
      )
    ),
    f.createTypeAliasDeclaration(
      [f.createModifier(ts.SyntaxKind.ExportKeyword)],
      `${typeName}Encoded`,
      undefined,
      f.createTypeReferenceNode(qualified("Schema", "Encoded"), [
        f.createTypeQueryNode(f.createIdentifier(schemaName)),
      ])
    ),
  ];
}

/**
 * EffectSchema derive macro.
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
    const f = ctx.factory;
    const { name, kind, fields, variants, discriminant } = typeInfo;
    const g: SchemaGen = { ctx, selfName: name, selfReferenced: false };

    try {
      if (kind === "sum" && (!variants || variants.length === 0 || !discriminant)) {
        // Derive type info only resolves variants that are NAMED types
        // (`type S = Circle | Rect`); for inline object-literal members it
        // reports none, and an empty switch/Union would silently be wrong.
        ctx.reportError(
          target,
          `@derive(EffectSchema) on ${name}: could not resolve the union's variants. ` +
            "Declare each variant as a named interface/type (type S = A | B) with a literal discriminant."
        );
        return [];
      }
      if (kind === "sum" && variants && discriminant) {
        const members = variants.map((variant) =>
          schemaCall(g, "Struct", [
            f.createObjectLiteralExpression(
              [
                f.createPropertyAssignment(
                  propertyName(f, discriminant),
                  schemaCall(g, "Literal", [f.createStringLiteral(variant.tag)])
                ),
                ...variant.fields.map((fi) => fieldAssignment(g, fi)),
              ],
              true
            ),
          ])
        );
        return emit(g, name, schemaCall(g, "Union", members));
      }

      return emit(
        g,
        name,
        schemaCall(g, "Struct", [
          f.createObjectLiteralExpression(
            fields.map((fi) => fieldAssignment(g, fi)),
            true
          ),
        ])
      );
    } catch (e) {
      if (e instanceof UnsupportedFieldType) {
        ctx.reportError(
          target,
          `@derive(EffectSchema) cannot derive a Schema for ${name}: ${e.message}`
        );
        return [];
      }
      throw e;
    }
  },
});

/**
 * Runtime placeholder for @derive(EffectSchema).
 */
export const EffectSchema = "EffectSchema";
