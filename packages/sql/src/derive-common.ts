/**
 * Shared AST builders for the SQL derive macros (`@derive(Read|Write|Codec|Meta)`).
 *
 * BUILD-TIME ONLY (imports `typescript`).
 *
 * Every instance expression is built directly with `ts.factory` from a small
 * structural descriptor ({@link InstanceDesc}) — no code strings, no
 * `ctx.parseExpression`, no whole expressions smuggled through
 * `createIdentifier` (CLAUDE.md AST rule; SQL-12). Every runtime name the
 * generated code references (`Get`, `Put`, `Read`, `Write`, `Codec`,
 * `readRegistry`, …) goes through `ctx.ensureImport(name, "@typesugar/sql")`, so
 * the output is self-contained even when the user imported nothing but the
 * derive name (SQL-4).
 */

import * as ts from "typescript";
import type { MacroContext, DeriveFieldInfo } from "@typesugar/core";

/** Module the generated code imports its runtime helpers from. */
export const SQL_RUNTIME_MODULE = "@typesugar/sql";

/** A fresh identifier for a runtime export, with an import guaranteed. */
export function runtimeRef(ctx: MacroContext, name: string): ts.Identifier {
  // ensureImport may hand back a cached node; clone so no node appears twice in the tree.
  return ctx.factory.createIdentifier(ctx.ensureImport(name, SQL_RUNTIME_MODULE).text);
}

// ============================================================================
// Type → instance descriptor
// ============================================================================

export type PrimitiveName = "string" | "number" | "boolean" | "bigint" | "date" | "buffer";

export type InstanceDesc =
  | { readonly kind: "prim"; readonly name: PrimitiveName }
  | { readonly kind: "nullable" | "optional" | "array"; readonly inner: InstanceDesc };

/** Primitive kind of a single (non-union-of-differing) type, incl. literal and enum-literal types. */
function primitiveKind(type: ts.Type): PrimitiveName | null {
  const f = type.flags;
  if (f & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral)) return "string";
  if (f & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) return "number";
  if (f & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) return "boolean";
  if (f & (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral)) return "bigint";
  return null;
}

/**
 * Describe the Get/Put/Meta instance for a field type, or null if unsupported.
 *
 * Handles (SQL-13): `boolean | null` (TS represents `boolean` as `true | false`,
 * so the non-null part has two members), string/number literal unions, and
 * enums (unions of enum-literal members) — all collapse to their primitive.
 */
export function describeType(checker: ts.TypeChecker, type: ts.Type): InstanceDesc | null {
  const prim = primitiveKind(type);
  // (A union's own flags never carry String/Number/…Literal; `boolean` itself
  // carries Boolean, so it lands here.)
  if (prim) return { kind: "prim", name: prim };

  const typeStr = checker.typeToString(type);
  if (typeStr === "Date") return { kind: "prim", name: "date" };
  if (typeStr === "Buffer") return { kind: "prim", name: "buffer" };

  if (type.isUnion()) {
    const isNullish = (t: ts.Type) => !!(t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined));
    const nonNull = type.types.filter((t) => !isNullish(t));
    const hasNull = type.types.some((t) => t.flags & ts.TypeFlags.Null);
    const hasUndefined = type.types.some((t) => t.flags & ts.TypeFlags.Undefined);

    let inner: InstanceDesc | null = null;
    if (nonNull.length === 1) {
      inner = describeType(checker, nonNull[0]);
    } else if (nonNull.length > 1) {
      // All members share one primitive kind: true|false, "a"|"b", enum members.
      const kinds = new Set(nonNull.map(primitiveKind));
      if (kinds.size === 1) {
        const [k] = kinds;
        if (k) inner = { kind: "prim", name: k };
      }
    }
    if (!inner) return null;
    if (hasNull) return { kind: "nullable", inner };
    if (hasUndefined) return { kind: "optional", inner };
    return inner;
  }

  if (checker.isArrayType(type)) {
    const typeArgs = checker.getTypeArguments(type as ts.TypeReference);
    if (typeArgs.length === 1) {
      const element = describeType(checker, typeArgs[0]);
      if (element) return { kind: "array", inner: element };
    }
  }

  return null;
}

/** True if the descriptor's outermost layer accepts NULL. */
export function isNullableDesc(d: InstanceDesc): boolean {
  return d.kind === "nullable" || d.kind === "optional";
}

/**
 * Build the instance expression for a descriptor against a companion
 * namespace: `Get.nullable(Get.string)`, `Put.array(Put.number)`, … as AST.
 */
export function buildInstanceExpr(
  ctx: MacroContext,
  ns: "Get" | "Put" | "Meta",
  desc: InstanceDesc
): ts.Expression {
  const f = ctx.factory;
  if (desc.kind === "prim") {
    return f.createPropertyAccessExpression(runtimeRef(ctx, ns), desc.name);
  }
  return f.createCallExpression(
    f.createPropertyAccessExpression(runtimeRef(ctx, ns), desc.kind),
    undefined,
    [buildInstanceExpr(ctx, ns, desc.inner)]
  );
}

// ============================================================================
// Column names
// ============================================================================

/** camelCase → snake_case */
export function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Parse the text of a `@column` JSDoc tag. Accepts every documented form:
 * `@column created_at`, `@column "created_at"`, `@column("created_at")`,
 * `@column('created_at')` (SQL-6). Returns null if nothing usable is found.
 */
export function parseColumnTagText(text: string): string | null {
  const m = /^\(?\s*["'`]?([^"'`()\s]+)["'`]?\s*\)?$/.exec(text.trim());
  return m ? m[1] : null;
}

/** Column name for a field: its `@column` JSDoc override, else snake_case of the field name. */
export function columnNameFor(ctx: MacroContext, field: DeriveFieldInfo): string {
  const decl = field.symbol?.declarations?.[0];
  if (decl) {
    const tag = ts.getJSDocTags(decl).find((t) => t.tagName.text === "column");
    if (tag) {
      const text = ts.getTextOfJSDocComment(tag.comment) ?? "";
      const parsed = parseColumnTagText(text);
      if (parsed) return parsed;
      ctx.reportWarning(
        decl,
        `Ignoring malformed @column tag on '${field.name}' (${JSON.stringify(text)}); ` +
          `using '${toSnakeCase(field.name)}'`
      );
    }
  }
  return toSnakeCase(field.name);
}

// ============================================================================
// Read.make / Write.make builders
// ============================================================================

export interface FieldMapping {
  readonly field: string;
  readonly column: string;
  readonly desc: InstanceDesc;
}

/**
 * Resolve every field to a mapping, reporting an error (and returning null)
 * on the first unsupported field type.
 */
export function collectMappings(
  ctx: MacroContext,
  deriveName: string,
  target: ts.Node,
  fields: readonly DeriveFieldInfo[]
): FieldMapping[] | null {
  const out: FieldMapping[] = [];
  for (const field of fields) {
    const desc = describeType(ctx.typeChecker, field.type);
    if (!desc) {
      ctx.reportError(
        target,
        `Cannot derive ${deriveName} for field '${field.name}': unsupported type ` +
          `'${ctx.typeChecker.typeToString(field.type)}'`
      );
      return null;
    }
    out.push({ field: field.name, column: columnNameFor(ctx, field), desc });
  }
  return out;
}

/** `value.<field>` (or `value["<field>"]` when the name isn't an identifier). */
function fieldAccess(f: ts.NodeFactory, obj: string, field: string): ts.Expression {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(field)
    ? f.createPropertyAccessExpression(f.createIdentifier(obj), field)
    : f.createElementAccessExpression(f.createIdentifier(obj), f.createStringLiteral(field));
}

/** `Read.make([{ field, column, get, nullable }, …], (fields) => fields as T)` */
export function buildReadMake(
  ctx: MacroContext,
  typeName: string,
  mappings: readonly FieldMapping[]
): ts.Expression {
  const f = ctx.factory;
  const mappingsArray = f.createArrayLiteralExpression(
    mappings.map((m) =>
      f.createObjectLiteralExpression([
        f.createPropertyAssignment("field", f.createStringLiteral(m.field)),
        f.createPropertyAssignment("column", f.createStringLiteral(m.column)),
        f.createPropertyAssignment("get", buildInstanceExpr(ctx, "Get", m.desc)),
        f.createPropertyAssignment(
          "nullable",
          isNullableDesc(m.desc) ? f.createTrue() : f.createFalse()
        ),
      ])
    ),
    true
  );
  const construct = f.createArrowFunction(
    undefined,
    undefined,
    [f.createParameterDeclaration(undefined, undefined, "fields")],
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    // `fields as unknown as T`: a direct `Record<string, unknown> as T` is a
    // TS2352 error in the output under strict type-checking.
    f.createAsExpression(
      f.createAsExpression(
        f.createIdentifier("fields"),
        f.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)
      ),
      f.createTypeReferenceNode(typeName)
    )
  );
  return f.createCallExpression(
    f.createPropertyAccessExpression(runtimeRef(ctx, "Read"), "make"),
    undefined,
    [mappingsArray, construct]
  );
}

/** `Write.make([columns], [(value: T) => Put.x.put(value.f), …], [fields])` */
export function buildWriteMake(
  ctx: MacroContext,
  typeName: string,
  mappings: readonly FieldMapping[]
): ts.Expression {
  const f = ctx.factory;
  const columns = f.createArrayLiteralExpression(
    mappings.map((m) => f.createStringLiteral(m.column))
  );
  const extractors = f.createArrayLiteralExpression(
    mappings.map((m) =>
      f.createArrowFunction(
        undefined,
        undefined,
        [
          f.createParameterDeclaration(
            undefined,
            undefined,
            "value",
            undefined,
            f.createTypeReferenceNode(typeName)
          ),
        ],
        undefined,
        f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        f.createCallExpression(
          f.createPropertyAccessExpression(buildInstanceExpr(ctx, "Put", m.desc), "put"),
          undefined,
          [fieldAccess(f, "value", m.field)]
        )
      )
    ),
    true
  );
  const fieldNames = f.createArrayLiteralExpression(
    mappings.map((m) => f.createStringLiteral(m.field))
  );
  return f.createCallExpression(
    f.createPropertyAccessExpression(runtimeRef(ctx, "Write"), "make"),
    undefined,
    [columns, extractors, fieldNames]
  );
}

/** `export const <name>: <Tc><T> = <init>;` */
export function exportConst(
  ctx: MacroContext,
  name: string,
  typeclass: string,
  typeName: string,
  init: ts.Expression
): ts.VariableStatement {
  const f = ctx.factory;
  return f.createVariableStatement(
    [f.createModifier(ts.SyntaxKind.ExportKeyword)],
    f.createVariableDeclarationList(
      [
        f.createVariableDeclaration(
          name,
          undefined,
          f.createTypeReferenceNode(runtimeRef(ctx, typeclass), [
            f.createTypeReferenceNode(typeName),
          ]),
          init
        ),
      ],
      ts.NodeFlags.Const
    )
  );
}

/** `<registry>.set("<T>", <instance>);` */
export function registerInRegistry(
  ctx: MacroContext,
  registry: string,
  typeName: string,
  instance: string
): ts.Statement {
  const f = ctx.factory;
  return f.createExpressionStatement(
    f.createCallExpression(
      f.createPropertyAccessExpression(runtimeRef(ctx, registry), "set"),
      undefined,
      [
        f.createStringLiteral(typeName),
        // `as never`: the registries hold `Write<unknown>` etc., and a
        // `Write<T>` is not assignable to that (contravariant `write`), so
        // the output would not type-check under strict without the cast.
        f.createAsExpression(
          f.createIdentifier(instance),
          f.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
        ),
      ]
    )
  );
}
