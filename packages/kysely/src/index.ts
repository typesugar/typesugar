/**
 * @typesugar/kysely-adapter
 *
 * Kysely adapter for typesugar - type-safe SQL tagged templates that compile
 * to Kysely's RawBuilder for use with Kysely query builder.
 *
 * ## Usage
 *
 * ```ts
 * import { sql } from "@typesugar/kysely-adapter";
 * import { Kysely, Generated } from "kysely";
 *
 * // Define your database schema
 * interface Database {
 *   users: {
 *     id: Generated<number>;
 *     name: string;
 *     email: string;
 *   };
 * }
 *
 * // Use type-safe SQL templates
 * const db = new Kysely<Database>({ ... });
 *
 * const userId = 123;
 * const query = sql<{ id: number; name: string }>`
 *   SELECT id, name FROM users WHERE id = ${userId}
 * `;
 *
 * // Execute with Kysely
 * const result = await query.execute(db);
 * ```
 *
 * ## Compile-Time Features
 *
 * The `ksql` macro provides compile-time SQL validation and transformation:
 *
 * ```ts
 * import { ksql } from "@typesugar/kysely-adapter";
 *
 * // Compiles to optimized Kysely sql call with type inference
 * const query = ksql<DB>`
 *   SELECT ${sql.ref("users.name")}
 *   FROM users
 *   WHERE ${sql.ref("users.id")} = ${userId}
 * `;
 * ```
 *
 * @module
 */

import * as ts from "typescript";
import {
  type TaggedTemplateMacroDef,
  type ExpressionMacro,
  type MacroContext,
  defineTaggedTemplateMacro,
  defineExpressionMacro,
  globalRegistry,
} from "@typesugar/core";

// ============================================================================
// Kysely SQL Tagged Template Macro
// ============================================================================

/**
 * ksql tagged template macro
 *
 * Transforms SQL template literals into Kysely's sql tagged template calls
 * with compile-time validation and type inference.
 *
 * ```ts
 * const query = ksql`SELECT * FROM users WHERE id = ${userId}`;
 * ```
 *
 * Compiles to:
 *
 * ```ts
 * import { sql } from "kysely";
 * const query = sql`SELECT * FROM users WHERE id = ${userId}`;
 * ```
 */
export const ksqlMacro: TaggedTemplateMacroDef = defineTaggedTemplateMacro({
  name: "ksql",
  expand(ctx: MacroContext, node: ts.TaggedTemplateExpression): ts.Expression {
    const { factory } = ctx;

    // Transform to Kysely's sql tagged template
    // sql`...` from kysely
    const kyselySql = factory.createPropertyAccessExpression(
      factory.createIdentifier("kysely_sql"),
      factory.createIdentifier("sql")
    );

    // Create the tagged template with the same template literal
    return factory.createTaggedTemplateExpression(
      factory.createIdentifier("sql"),
      undefined,
      node.template
    );
  },
  validate(ctx: MacroContext, node: ts.TaggedTemplateExpression): boolean {
    // Basic SQL validation
    const template = node.template;

    if (ts.isNoSubstitutionTemplateLiteral(template)) {
      // Simple template without interpolations - validate SQL syntax
      return validateSqlSyntax(template.text, ctx, node);
    }

    if (ts.isTemplateExpression(template)) {
      // Template with interpolations
      let fullSql = template.head.text;
      for (const span of template.templateSpans) {
        fullSql += "?" + span.literal.text;
      }
      return validateSqlSyntax(fullSql, ctx, node);
    }

    return true;
  },
});

// ============================================================================
// SQL Reference Helper Macro
// ============================================================================

/**
 * ref$ macro - type-safe column/table reference
 *
 * ```ts
 * const col = ref$("users.name");
 * ```
 *
 * Compiles to:
 *
 * ```ts
 * import { sql } from "kysely";
 * const col = sql.ref("users.name");
 * ```
 */
export const refMacro: ExpressionMacro = defineExpressionMacro({
  name: "ref$",
  expand(
    ctx: MacroContext,
    node: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const { factory } = ctx;

    if (args.length !== 1) {
      ctx.reportError(node, "ref$ expects exactly one argument: the column/table reference");
      return node;
    }

    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("sql"),
        factory.createIdentifier("ref")
      ),
      undefined,
      [args[0]]
    );
  },
});

// ============================================================================
// SQL Table Reference Macro
// ============================================================================

/**
 * table$ macro - type-safe table reference
 *
 * ```ts
 * const tbl = table$("users");
 * ```
 *
 * Compiles to:
 *
 * ```ts
 * import { sql } from "kysely";
 * const tbl = sql.table("users");
 * ```
 */
export const tableMacro: ExpressionMacro = defineExpressionMacro({
  name: "table$",
  expand(
    ctx: MacroContext,
    node: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const { factory } = ctx;

    if (args.length !== 1) {
      ctx.reportError(node, "table$ expects exactly one argument: the table name");
      return node;
    }

    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("sql"),
        factory.createIdentifier("table")
      ),
      undefined,
      [args[0]]
    );
  },
});

// ============================================================================
// SQL Identifier Macro
// ============================================================================

/**
 * id$ macro - SQL identifier (escaped)
 *
 * ```ts
 * const col = id$("column_name");
 * ```
 *
 * Compiles to:
 *
 * ```ts
 * import { sql } from "kysely";
 * const col = sql.id("column_name");
 * ```
 */
export const idMacro: ExpressionMacro = defineExpressionMacro({
  name: "id$",
  expand(
    ctx: MacroContext,
    node: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const { factory } = ctx;

    if (args.length !== 1) {
      ctx.reportError(node, "id$ expects exactly one argument: the identifier");
      return node;
    }

    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("sql"),
        factory.createIdentifier("id")
      ),
      undefined,
      [args[0]]
    );
  },
});

// ============================================================================
// SQL Literal Macro
// ============================================================================

/**
 * lit$ macro - SQL literal (unescaped, be careful!)
 *
 * ```ts
 * const order = lit$("DESC");
 * ```
 *
 * Compiles to:
 *
 * ```ts
 * import { sql } from "kysely";
 * const order = sql.lit("DESC");
 * ```
 */
export const litMacro: ExpressionMacro = defineExpressionMacro({
  name: "lit$",
  expand(
    ctx: MacroContext,
    node: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const { factory } = ctx;

    if (args.length !== 1) {
      ctx.reportError(node, "lit$ expects exactly one argument: the literal value");
      return node;
    }

    // Warn about potential SQL injection
    const arg = args[0];
    if (!ts.isStringLiteral(arg) && !ts.isNumericLiteral(arg)) {
      ctx.reportWarning(
        node,
        "lit$ with dynamic values may be vulnerable to SQL injection. Consider using parameterized queries."
      );
    }

    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("sql"),
        factory.createIdentifier("lit")
      ),
      undefined,
      [args[0]]
    );
  },
});

// ============================================================================
// SQL Join Macro
// ============================================================================

/**
 * join$ macro - Join SQL fragments
 *
 * ```ts
 * const cols = join$(columns, sql`, `);
 * ```
 *
 * Compiles to:
 *
 * ```ts
 * import { sql } from "kysely";
 * const cols = sql.join(columns, sql`, `);
 * ```
 */
export const joinMacro: ExpressionMacro = defineExpressionMacro({
  name: "join$",
  expand(
    ctx: MacroContext,
    node: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const { factory } = ctx;

    if (args.length < 1 || args.length > 2) {
      ctx.reportError(
        node,
        "join$ expects one or two arguments: items array and optional separator"
      );
      return node;
    }

    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("sql"),
        factory.createIdentifier("join")
      ),
      undefined,
      [...args]
    );
  },
});

// ============================================================================
// SQL Raw Macro
// ============================================================================

/**
 * raw$ macro - Raw SQL (be very careful!)
 *
 * ```ts
 * const fragment = raw$("NOW()");
 * ```
 *
 * Compiles to:
 *
 * ```ts
 * import { sql } from "kysely";
 * const fragment = sql.raw("NOW()");
 * ```
 */
export const rawMacro: ExpressionMacro = defineExpressionMacro({
  name: "raw$",
  expand(
    ctx: MacroContext,
    node: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const { factory } = ctx;

    if (args.length !== 1) {
      ctx.reportError(node, "raw$ expects exactly one argument: the raw SQL string");
      return node;
    }

    // Strong warning about SQL injection
    const arg = args[0];
    if (!ts.isStringLiteral(arg)) {
      ctx.reportWarning(
        node,
        "raw$ with dynamic values is HIGHLY DANGEROUS and vulnerable to SQL injection. " +
          "Use parameterized queries or sql tagged templates instead."
      );
    }

    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("sql"),
        factory.createIdentifier("raw")
      ),
      undefined,
      [args[0]]
    );
  },
});

import { validateSqlSyntax, QueryableCompanion, DbConnection, Queryable } from "@typesugar/sql";
import type { Compilable } from "kysely";

// ============================================================================
// Registration
// ============================================================================

/**
 * Register all Kysely adapter macros with the global registry.
 */
export function register(): void {
  globalRegistry.register(ksqlMacro);
  globalRegistry.register(refMacro);
  globalRegistry.register(tableMacro);
  globalRegistry.register(idMacro);
  globalRegistry.register(litMacro);
  globalRegistry.register(joinMacro);
  globalRegistry.register(rawMacro);
}

// Auto-register on import
register();

// ============================================================================
// Runtime Helpers & Type Definitions
// ============================================================================

// Re-export for convenience (users should import from kysely directly in most cases)
// These are just for typing when the macro hasn't been transformed yet

/**
 * Runtime placeholder for ksql (should be transformed at compile time)
 */
export function ksql<T = unknown>(_strings: TemplateStringsArray, ..._values: unknown[]): never {
  throw new Error(
    "ksql was not transformed at compile time. " +
      "Make sure @typesugar/kysely-adapter is registered with the transformer."
  );
}

/**
 * Runtime placeholder for ref$
 */
export function ref$(_reference: string): never {
  throw new Error(
    "ref$ was not transformed at compile time. " +
      "Make sure @typesugar/kysely-adapter is registered with the transformer."
  );
}

/**
 * Runtime placeholder for table$
 */
export function table$(_name: string): never {
  throw new Error(
    "table$ was not transformed at compile time. " +
      "Make sure @typesugar/kysely-adapter is registered with the transformer."
  );
}

/**
 * Runtime placeholder for id$
 */
export function id$(_identifier: string): never {
  throw new Error(
    "id$ was not transformed at compile time. " +
      "Make sure @typesugar/kysely-adapter is registered with the transformer."
  );
}

/**
 * Runtime placeholder for lit$
 */
export function lit$<T>(_value: T): never {
  throw new Error(
    "lit$ was not transformed at compile time. " +
      "Make sure @typesugar/kysely-adapter is registered with the transformer."
  );
}

/**
 * Runtime placeholder for join$
 */
export function join$<T>(_items: T[], _separator?: unknown): never {
  throw new Error(
    "join$ was not transformed at compile time. " +
      "Make sure @typesugar/kysely-adapter is registered with the transformer."
  );
}

/**
 * Runtime placeholder for raw$
 */
export function raw$(_sql: string): never {
  throw new Error(
    "raw$ was not transformed at compile time. " +
      "Make sure @typesugar/kysely-adapter is registered with the transformer."
  );
}

// ============================================================================
// Doobie-style ConnectionIO Integration
// ============================================================================

/**
 * KyselyQueryable — A Queryable instance for executing Kysely queries in ConnectionIO.
 *
 * It allows lifting any Kysely `Compilable` (e.g. SelectQueryBuilder, UpdateQueryBuilder, RawBuilder)
 * directly into Doobie-style programs via `ConnectionIO.fromQueryable(query, KyselyQueryable)`.
 */
export const KyselyQueryable: Queryable<Compilable<unknown>> = QueryableCompanion.make(
  async (query: Compilable<unknown>, conn: DbConnection) => {
    const { sql, parameters } = query.compile();
    return await conn.query(sql, parameters as unknown[]);
  }
);

// ============================================================================
// Kysely Integration Types
// ============================================================================

/**
 * Type helper for extracting the result type of a SQL query
 */
export type SqlResult<T> = T extends {
  execute: (db: unknown) => Promise<infer R>;
}
  ? R
  : never;

/**
 * Type helper for defining database column types
 */
export type Column<T> = T;

/**
 * Type helper for generated columns (auto-increment, etc.)
 */
export type Generated<T> = T;

/**
 * Type helper for nullable columns
 */
export type Nullable<T> = T | null;
