/**
 * sql$ Macro — Compile-Time SQL Type Inference
 *
 * This macro parses SQL at compile time and infers:
 * - Parameter types from interpolated values
 * - Result types from SELECT clauses (when schema is available)
 *
 * ## Usage
 *
 * ### Basic Parameter Inference
 *
 * ```typescript
 * // Types inferred from interpolation
 * const findUser = sql$`SELECT * FROM users WHERE id = ${userId}`;
 * // userId: number => TypedFragment<[number], User>
 * ```
 *
 * ### Explicit Result Type
 *
 * ```typescript
 * const findUser = sql$<User>`SELECT id, name FROM users WHERE id = ${userId}`;
 * // TypedFragment<[number], User>
 * ```
 *
 * ### Schema-Based Inference — NOT IMPLEMENTED
 *
 * `@schema("users")` on an interface was meant to make `SELECT * FROM users`
 * infer that interface. It is not implemented: `@schema` only reports a
 * warning, and without an explicit type argument a SELECT infers
 * `Record<string, unknown>`. (`registerSchema` + `tryInferResultType` are the
 * unfinished plumbing for it.)
 *
 * ## SQL Parsing
 *
 * The macro performs basic SQL parsing to:
 * 1. Identify statement type (SELECT, INSERT, UPDATE, DELETE)
 * 2. Extract column names from SELECT
 * 3. Identify table references
 * 4. Track parameter positions
 *
 * ## Zero-Cost
 *
 * The type information exists only at compile time. At runtime the output is
 * `__typed_sql_build<P, R>(segments, [e0, e1, ...])` — interpolated values are
 * bound as plain params and Fragment/TypedFragment interpolations are inlined,
 * exactly like `sql```'s `__sql_build` (SQL-2). Runtime names are imported via
 * `ctx.ensureImport` (SQL-4).
 *
 * @module
 */

import * as ts from "typescript";
import {
  defineAttributeMacro,
  defineExpressionMacro,
  type MacroContext,
  createGenericRegistry,
  type GenericRegistry,
  isSyntheticNode,
} from "@typesugar/core";
import { runtimeRef } from "./derive-common.js";

// ============================================================================
// SQL Statement Types
// ============================================================================

type SqlStatementType = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "WITH" | "UNKNOWN";

interface ParsedSql {
  type: SqlStatementType;
  tables: string[];
  columns: string[] | "*";
  paramCount: number;
  isReturning: boolean;
}

// ============================================================================
// SQL Parser (Compile-Time)
// ============================================================================

/**
 * Parse SQL statement to extract type-relevant information.
 * This is a simplified parser for compile-time use.
 */
function parseSql(sql: string): ParsedSql {
  const normalized = sql.trim().toUpperCase();

  let type: SqlStatementType = "UNKNOWN";
  if (normalized.startsWith("SELECT")) type = "SELECT";
  else if (normalized.startsWith("INSERT")) type = "INSERT";
  else if (normalized.startsWith("UPDATE")) type = "UPDATE";
  else if (normalized.startsWith("DELETE")) type = "DELETE";
  else if (normalized.startsWith("WITH")) type = "WITH";

  // Extract tables (simplified)
  const tables: string[] = [];
  const fromMatch = sql.match(/\bFROM\s+(\w+)/i);
  if (fromMatch) tables.push(fromMatch[1].toLowerCase());

  const intoMatch = sql.match(/\bINTO\s+(\w+)/i);
  if (intoMatch) tables.push(intoMatch[1].toLowerCase());

  const updateMatch = sql.match(/\bUPDATE\s+(\w+)/i);
  if (updateMatch) tables.push(updateMatch[1].toLowerCase());

  // Extract columns from SELECT
  let columns: string[] | "*" = "*";
  if (type === "SELECT" || type === "WITH") {
    const selectMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM/i);
    if (selectMatch) {
      const colStr = selectMatch[1].trim();
      if (colStr === "*") {
        columns = "*";
      } else {
        // Parse column list
        columns = parseColumnList(colStr);
      }
    }
  }

  // Count parameters (? placeholders after transformation)
  const paramCount = (sql.match(/\?/g) || []).length;

  // Check for RETURNING clause
  const isReturning = /\bRETURNING\b/i.test(sql);

  return { type, tables, columns, paramCount, isReturning };
}

/**
 * Parse a SELECT column list into individual column/alias names.
 */
function parseColumnList(colStr: string): string[] {
  const columns: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of colStr) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "," && depth === 0) {
      const col = extractColumnName(current.trim());
      if (col) columns.push(col);
      current = "";
    } else {
      current += char;
    }
  }

  const lastCol = extractColumnName(current.trim());
  if (lastCol) columns.push(lastCol);

  return columns;
}

/**
 * Extract the final column name (after AS alias, or from expression).
 */
function extractColumnName(expr: string): string | null {
  // Handle AS alias
  const asMatch = expr.match(/\bAS\s+["']?(\w+)["']?\s*$/i);
  if (asMatch) return asMatch[1].toLowerCase();

  // Handle table.column
  const dotMatch = expr.match(/\.(\w+)\s*$/);
  if (dotMatch) return dotMatch[1].toLowerCase();

  // Handle simple column name
  const simpleMatch = expr.match(/^["']?(\w+)["']?\s*$/);
  if (simpleMatch) return simpleMatch[1].toLowerCase();

  // Handle function(x) - use function name as hint
  const funcMatch = expr.match(/^(\w+)\s*\(/);
  if (funcMatch) return funcMatch[1].toLowerCase();

  return null;
}

// ============================================================================
// Schema Registry (For Type Inference)
// ============================================================================

/**
 * Global registry mapping table names to their TypeScript types.
 * Nothing populates it yet (`@schema` does not; see schemaMacro), so schema
 * inference never fires unless a macro-time caller uses `registerSchema`.
 */
const schemaRegistry: GenericRegistry<string, string> = createGenericRegistry({
  name: "SchemaRegistry",
  duplicateStrategy: "replace",
});

/**
 * Register a table schema for type inference.
 */
export function registerSchema(tableName: string, typeName: string): void {
  schemaRegistry.set(tableName.toLowerCase(), typeName);
}

// ============================================================================
// sql$ Macro Implementation
// ============================================================================

export const sql$Macro = defineExpressionMacro({
  name: "sql$",
  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const factory = ctx.factory;
    const typeChecker = ctx.typeChecker;

    // Get type arguments if provided: sql$<User>`...`
    const typeArgs = callExpr.typeArguments;
    let explicitResultType: ts.TypeNode | undefined;

    if (typeArgs && typeArgs.length > 0) {
      explicitResultType = typeArgs[0];
    }

    // Must be called with a tagged template literal
    const template = args[0];
    if (!template) {
      ctx.reportError(callExpr, "sql$ requires a template literal argument");
      return callExpr;
    }

    // Handle tagged template: sql$`...`
    if (ts.isTaggedTemplateExpression(callExpr.parent)) {
      return expandTaggedTemplate(ctx, callExpr.parent, explicitResultType);
    }

    // Handle call with template: sql$(`...`)
    if (ts.isTemplateExpression(template) || ts.isNoSubstitutionTemplateLiteral(template)) {
      return expandTemplate(ctx, template, explicitResultType);
    }

    ctx.reportError(
      callExpr,
      "sql$ must be used with a template literal: sql$`...` or sql$(`...`)"
    );
    return callExpr;
  },
});

/**
 * Expand a tagged template: sql$`SELECT ...`
 */
function expandTaggedTemplate(
  ctx: MacroContext,
  node: ts.TaggedTemplateExpression,
  explicitResultType: ts.TypeNode | undefined
): ts.Expression {
  const factory = ctx.factory;
  const template = node.template;

  if (ts.isNoSubstitutionTemplateLiteral(template)) {
    // No interpolations: sql$`SELECT 1`
    const sqlText = template.text;
    const parsed = parseSql(sqlText);

    return createTypedFragmentCall(ctx, [sqlText], [], parsed, explicitResultType);
  }

  if (ts.isTemplateExpression(template)) {
    return expandTemplate(ctx, template, explicitResultType);
  }

  return node;
}

/**
 * Expand a template expression with interpolations.
 */
function expandTemplate(
  ctx: MacroContext,
  template: ts.TemplateExpression | ts.NoSubstitutionTemplateLiteral,
  explicitResultType: ts.TypeNode | undefined
): ts.Expression {
  const factory = ctx.factory;
  const typeChecker = ctx.typeChecker;

  if (ts.isNoSubstitutionTemplateLiteral(template)) {
    const sqlText = template.text;
    const parsed = parseSql(sqlText);
    return createTypedFragmentCall(ctx, [sqlText], [], parsed, explicitResultType);
  }

  // Extract segments and expressions
  const segments: string[] = [template.head.text];
  const expressions: ts.Expression[] = [];
  const paramTypes: ParamSlot[] = [];
  let skippedSynthetic = false;

  for (const span of template.templateSpans) {
    segments.push(span.literal.text);
    expressions.push(span.expression);

    // Get the type of each interpolated expression. A macro-generated
    // (synthetic) interpolation is outside the checker's contract — skip it
    // and type that param as `unknown` (CLAUDE.md; SQL-18).
    if (isSyntheticNode(span.expression)) {
      skippedSynthetic = true;
      paramTypes.push({ kind: "value", type: undefined });
    } else {
      paramTypes.push(
        classifyInterpolation(typeChecker, typeChecker.getTypeAtLocation(span.expression))
      );
    }
  }
  if (skippedSynthetic) {
    ctx.reportWarning(
      template,
      "sql$: some interpolations are macro-generated; their parameter types could not be " +
        "inferred and are typed as unknown"
    );
  }

  // Build full SQL for parsing (with placeholders)
  const fullSql = segments.reduce((acc, seg, i) => {
    if (i === 0) return seg;
    return acc + "?" + seg;
  }, "");

  const parsed = parseSql(fullSql);

  return createTypedFragmentCall(
    ctx,
    segments,
    expressions,
    parsed,
    explicitResultType,
    paramTypes
  );
}

/**
 * One interpolation's contribution to the parameter tuple: a single bound
 * value, or a spliced-in fragment whose own params are spread (`...P2` for a
 * `TypedFragment<P2, _>`, `...unknown[]` for an untyped `Fragment`).
 */
type ParamSlot =
  | { kind: "value"; type: ts.Type | undefined }
  | { kind: "spread"; params: ts.Type | undefined };

function classifyInterpolation(checker: ts.TypeChecker, type: ts.Type): ParamSlot {
  const name = type.getSymbol()?.getName();
  if (name === "TypedFragment") {
    const args = checker.getTypeArguments(type as ts.TypeReference);
    return { kind: "spread", params: args[0] };
  }
  if (name === "Fragment") return { kind: "spread", params: undefined };
  // Widen literal types: `${0}` binds a number, not the literal `0` — a
  // literal param type would make andTyped/orTyped over fragments built from
  // different literals (`${0}` and `${1}`) fail to type-check.
  return { kind: "value", type: checker.getBaseTypeOfLiteralType?.(type) ?? type };
}

/**
 * Create a TypedFragment construction call with inferred types.
 */
function createTypedFragmentCall(
  ctx: MacroContext,
  segments: string[],
  expressions: ts.Expression[],
  parsed: ParsedSql,
  explicitResultType: ts.TypeNode | undefined,
  paramTypes?: ParamSlot[]
): ts.Expression {
  const factory = ctx.factory;
  const typeChecker = ctx.typeChecker;
  const unknownType = () => factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword);

  // Build parameter type tuple. typeToTypeNode can return undefined; fall back
  // to `unknown` rather than leaving a hole that crashes the printer (SQL-18).
  let paramTypeTuple: ts.TypeNode;
  if (paramTypes && paramTypes.length > 0) {
    const toNode = (t: ts.Type | undefined): ts.TypeNode | undefined =>
      t ? typeChecker.typeToTypeNode(t, undefined, ts.NodeBuilderFlags.NoTruncation) : undefined;
    paramTypeTuple = factory.createTupleTypeNode(
      paramTypes.map((slot) =>
        slot.kind === "value"
          ? (toNode(slot.type) ?? unknownType())
          : factory.createRestTypeNode(
              toNode(slot.params) ?? factory.createArrayTypeNode(unknownType())
            )
      )
    );
  } else {
    paramTypeTuple = factory.createTupleTypeNode([]);
  }

  // Determine result type
  let resultType: ts.TypeNode;
  if (explicitResultType) {
    resultType = explicitResultType;
  } else if (parsed.type === "SELECT" || parsed.isReturning) {
    // Try to infer from schema
    const inferredType = tryInferResultType(ctx, parsed);
    // Record<string, unknown> (= SqlRow) built inline: no type-only import needed.
    resultType =
      inferredType ??
      factory.createTypeReferenceNode("Record", [
        factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
        unknownType(),
      ]);
  } else {
    resultType = factory.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword);
  }

  // Create: __typed_sql_build<P, R>(segments, [e0, e1, ...]) — plain params,
  // fragment interpolations inlined at runtime (SQL-2).
  const segmentsArray = factory.createArrayLiteralExpression(
    segments.map((s) => factory.createStringLiteral(s))
  );
  const paramsArray = factory.createArrayLiteralExpression(expressions);

  return factory.createCallExpression(
    runtimeRef(ctx, "__typed_sql_build"),
    [paramTypeTuple, resultType],
    [segmentsArray, paramsArray]
  );
}

/**
 * Try to infer result type from schema registry.
 */
function tryInferResultType(ctx: MacroContext, parsed: ParsedSql): ts.TypeNode | null {
  const factory = ctx.factory;

  if (parsed.tables.length !== 1) return null;
  const tableName = parsed.tables[0];
  const typeName = schemaRegistry.get(tableName);
  if (!typeName) return null;

  if (parsed.columns === "*") {
    // Return full table type
    return factory.createTypeReferenceNode(typeName);
  }

  // Return Pick<TableType, columns>
  const columnUnion = factory.createUnionTypeNode(
    parsed.columns.map((col) => factory.createLiteralTypeNode(factory.createStringLiteral(col)))
  );

  return factory.createTypeReferenceNode("Pick", [
    factory.createTypeReferenceNode(typeName),
    columnUnion,
  ]);
}

// ============================================================================
// @schema Attribute Macro
// ============================================================================

/**
 * @schema — NOT IMPLEMENTED: schema-based result-type inference.
 *
 * ```typescript
 * @schema("users")
 * interface UsersTable {
 *   id: number;
 *   name: string;
 * }
 * ```
 *
 * The intent is that this registers `UsersTable` for table `users` so
 * `sql$\`SELECT * FROM users\`` infers `UsersTable`. That inference is not
 * implemented (PEP-059 P1 #14): the decorator registers nothing and `sql$`
 * keeps inferring `Record<string, unknown>`. Rather than strip the decorator
 * silently, the macro reports a warning saying so and leaves the declaration
 * unchanged. Use `sql$<UsersTable>\`...\`` for an explicit result type.
 */
export const schemaMacro = defineAttributeMacro({
  name: "schema",
  validTargets: ["interface", "type", "class"],
  expand(
    ctx: MacroContext,
    decorator: ts.Decorator,
    target: ts.Node,
    _args: readonly ts.Expression[]
  ): ts.Node {
    ctx.reportWarning(
      decorator,
      "@schema: schema-based result-type inference is not implemented; this decorator " +
        "has no effect and sql$ will not infer row types from it. Give the row type " +
        "explicitly instead: sql$<RowType>`...`"
    );
    return target;
  },
});

// ============================================================================
// Query Builder DSL
// ============================================================================
// NOTE (PEP-050): the runtime `select`/`SelectBuilder` query-builder moved to
// `./query-builder.ts` so the package's `.` entry stays free of `typescript`.
