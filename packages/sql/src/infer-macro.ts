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
 * ### Schema-Based Inference (with typeInfo)
 *
 * ```typescript
 * // When @schema is declared, columns are inferred
 * @schema
 * interface UsersTable {
 *   id: number;
 *   name: string;
 *   email: string;
 *   created_at: Date;
 * }
 *
 * const selectAll = sql$`SELECT * FROM users`;
 * // TypedFragment<[], UsersTable>
 *
 * const selectSome = sql$`SELECT id, name FROM users`;
 * // TypedFragment<[], Pick<UsersTable, 'id' | 'name'>>
 * ```
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
 * The type information exists only at compile time. At runtime,
 * sql$ generates the same code as the basic sql`` template.
 *
 * @module
 */

import * as ts from "typescript";
import {
  defineExpressionMacro,
  type MacroContext,
  createGenericRegistry,
  type GenericRegistry,
} from "@typesugar/core";

// ============================================================================
// SQL Statement Types
// ============================================================================

type SqlStatementType =
  | "SELECT"
  | "INSERT"
  | "UPDATE"
  | "DELETE"
  | "WITH"
  | "UNKNOWN";

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
 * Populated by @schema decorator at compile time.
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
    args: readonly ts.Expression[],
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
    if (
      ts.isTemplateExpression(template) ||
      ts.isNoSubstitutionTemplateLiteral(template)
    ) {
      return expandTemplate(ctx, template, explicitResultType);
    }

    ctx.reportError(
      callExpr,
      "sql$ must be used with a template literal: sql$`...` or sql$(`...`)",
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
  explicitResultType: ts.TypeNode | undefined,
): ts.Expression {
  const factory = ctx.factory;
  const template = node.template;

  if (ts.isNoSubstitutionTemplateLiteral(template)) {
    // No interpolations: sql$`SELECT 1`
    const sqlText = template.text;
    const parsed = parseSql(sqlText);

    return createTypedFragmentCall(
      ctx,
      [sqlText],
      [],
      parsed,
      explicitResultType,
    );
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
  explicitResultType: ts.TypeNode | undefined,
): ts.Expression {
  const factory = ctx.factory;
  const typeChecker = ctx.typeChecker;

  if (ts.isNoSubstitutionTemplateLiteral(template)) {
    const sqlText = template.text;
    const parsed = parseSql(sqlText);
    return createTypedFragmentCall(
      ctx,
      [sqlText],
      [],
      parsed,
      explicitResultType,
    );
  }

  // Extract segments and expressions
  const segments: string[] = [template.head.text];
  const expressions: ts.Expression[] = [];
  const paramTypes: ts.Type[] = [];

  for (const span of template.templateSpans) {
    segments.push(span.literal.text);
    expressions.push(span.expression);

    // Get the type of each interpolated expression
    const type = typeChecker.getTypeAtLocation(span.expression);
    paramTypes.push(type);
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
    paramTypes,
  );
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
  paramTypes?: ts.Type[],
): ts.Expression {
  const factory = ctx.factory;
  const typeChecker = ctx.typeChecker;

  // Build parameter type tuple
  let paramTypeTuple: ts.TypeNode;
  if (paramTypes && paramTypes.length > 0) {
    paramTypeTuple = factory.createTupleTypeNode(
      paramTypes.map(
        (t) =>
          typeChecker.typeToTypeNode(t, undefined, ts.NodeBuilderFlags.None)!,
      ),
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
    resultType = inferredType ?? factory.createTypeReferenceNode("SqlRow");
  } else {
    resultType = factory.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword);
  }

  // Create: new TypedFragment<P, R>(segments, params)
  const segmentsArray = factory.createArrayLiteralExpression(
    segments.map((s) => factory.createStringLiteral(s)),
  );

  const paramsArray = factory.createArrayLiteralExpression(
    expressions.map((expr) =>
      factory.createObjectLiteralExpression([
        factory.createPropertyAssignment("value", expr),
      ]),
    ),
  );

  return factory.createNewExpression(
    factory.createIdentifier("TypedFragment"),
    [paramTypeTuple, resultType],
    [segmentsArray, paramsArray],
  );
}

/**
 * Try to infer result type from schema registry.
 */
function tryInferResultType(
  ctx: MacroContext,
  parsed: ParsedSql,
): ts.TypeNode | null {
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
    parsed.columns.map((col) =>
      factory.createLiteralTypeNode(factory.createStringLiteral(col)),
    ),
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
 * @schema — Register a type as a database table schema.
 *
 * ```typescript
 * @schema("users")
 * interface UsersTable {
 *   id: number;
 *   name: string;
 * }
 * ```
 */
export const schemaMacro = defineExpressionMacro({
  name: "schema",
  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    // This is handled at the attribute level, not expression level
    return callExpr;
  },
});

// ============================================================================
// Query Builder DSL
// ============================================================================

/**
 * Start building a SELECT query with type inference.
 *
 * ```typescript
 * const query = select<User>("id", "name")
 *   .from("users")
 *   .where(sql$`active = ${true}`);
 * ```
 */
export function select<R>(...columns: (keyof R)[]): SelectBuilder<R> {
  return new SelectBuilder<R>(columns as string[]);
}

class SelectBuilder<R> {
  private _columns: string[];
  private _from: string = "";
  private _where: string[] = [];
  private _params: unknown[] = [];
  private _joins: string[] = [];
  private _orderBy: string[] = [];
  private _limit: number | null = null;
  private _offset: number | null = null;

  constructor(columns: string[]) {
    this._columns = columns;
  }

  from(table: string): this {
    this._from = table;
    return this;
  }

  where(fragment: { segments: string[]; params: { value: unknown }[] }): this {
    this._where.push(fragment.segments.join("?"));
    this._params.push(...fragment.params.map((p) => p.value));
    return this;
  }

  andWhere(fragment: {
    segments: string[];
    params: { value: unknown }[];
  }): this {
    return this.where(fragment);
  }

  join(table: string, on: string): this {
    this._joins.push(`JOIN ${table} ON ${on}`);
    return this;
  }

  leftJoin(table: string, on: string): this {
    this._joins.push(`LEFT JOIN ${table} ON ${on}`);
    return this;
  }

  orderBy(...columns: string[]): this {
    this._orderBy.push(...columns);
    return this;
  }

  limit(n: number): this {
    this._limit = n;
    return this;
  }

  offset(n: number): this {
    this._offset = n;
    return this;
  }

  build(): { sql: string; params: unknown[] } {
    let sql = `SELECT ${this._columns.join(", ")} FROM ${this._from}`;

    if (this._joins.length > 0) {
      sql += " " + this._joins.join(" ");
    }

    if (this._where.length > 0) {
      sql += " WHERE " + this._where.join(" AND ");
    }

    if (this._orderBy.length > 0) {
      sql += " ORDER BY " + this._orderBy.join(", ");
    }

    if (this._limit !== null) {
      sql += ` LIMIT ${this._limit}`;
    }

    if (this._offset !== null) {
      sql += ` OFFSET ${this._offset}`;
    }

    return { sql, params: this._params };
  }
}
