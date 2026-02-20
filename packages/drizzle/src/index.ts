/**
 * @typesugar/drizzle
 *
 * Drizzle adapter for typemacro - type-safe SQL tagged templates that compile
 * to Drizzle's sql tagged template.
 *
 * ## Usage
 *
 * ```ts
 * import { dsql } from "@typesugar/drizzle";
 * import { drizzle } from "drizzle-orm/postgres-js";
 *
 * const db = drizzle(client);
 *
 * const userId = 123;
 * const query = dsql`
 *   SELECT id, name FROM users WHERE id = ${userId}
 * `;
 *
 * // Execute with Drizzle
 * const result = await db.execute(query);
 * ```
 *
 * ## Compile-Time Features
 *
 * The `dsql` macro provides compile-time SQL validation and transformation:
 *
 * ```ts
 * import { dsql, ref$ } from "@typesugar/drizzle";
 *
 * // Compiles to optimized Drizzle sql call with type inference
 * const query = dsql`
 *   SELECT ${ref$("users.name")}
 *   FROM users
 *   WHERE ${ref$("users.id")} = ${userId}
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
import {
  validateSqlSyntax,
  QueryableCompanion,
  DbConnection,
  Queryable,
} from "@typesugar/sql";

// ============================================================================
// Drizzle SQL Tagged Template Macro
// ============================================================================

/**
 * dsql tagged template macro
 *
 * Transforms SQL template literals into Drizzle's sql tagged template calls
 * with compile-time validation and type inference.
 *
 * ```ts
 * const query = dsql`SELECT * FROM users WHERE id = ${userId}`;
 * ```
 *
 * Compiles to:
 *
 * ```ts
 * import { sql } from "drizzle-orm";
 * const query = sql`SELECT * FROM users WHERE id = ${userId}`;
 * ```
 */
export const dsqlMacro: TaggedTemplateMacroDef = defineTaggedTemplateMacro({
  name: "dsql",
  expand(ctx: MacroContext, node: ts.TaggedTemplateExpression): ts.Expression {
    const { factory } = ctx;

    // Transform to Drizzle's sql tagged template
    return factory.createTaggedTemplateExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("drizzle_orm"),
        factory.createIdentifier("sql"),
      ),
      undefined,
      node.template,
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
 * import { sql } from "drizzle-orm";
 * const col = sql.identifier("users.name");
 * ```
 */
export const refMacro: ExpressionMacro = defineExpressionMacro({
  name: "ref$",
  expand(
    ctx: MacroContext,
    node: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    const { factory } = ctx;

    if (args.length !== 1) {
      ctx.reportError(
        node,
        "ref$ expects exactly one argument: the column/table reference",
      );
      return node;
    }

    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createPropertyAccessExpression(
          factory.createIdentifier("drizzle_orm"),
          factory.createIdentifier("sql"),
        ),
        factory.createIdentifier("identifier"),
      ),
      undefined,
      [args[0]],
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
 * import { sql } from "drizzle-orm";
 * const col = sql.identifier("column_name");
 * ```
 */
export const idMacro: ExpressionMacro = defineExpressionMacro({
  name: "id$",
  expand(
    ctx: MacroContext,
    node: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    const { factory } = ctx;

    if (args.length !== 1) {
      ctx.reportError(node, "id$ expects exactly one argument: the identifier");
      return node;
    }

    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createPropertyAccessExpression(
          factory.createIdentifier("drizzle_orm"),
          factory.createIdentifier("sql"),
        ),
        factory.createIdentifier("identifier"),
      ),
      undefined,
      [args[0]],
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
 * const cols = join$(columns, dsql`, `);
 * ```
 *
 * Compiles to:
 *
 * ```ts
 * import { sql } from "drizzle-orm";
 * const cols = sql.join(columns, sql`, `);
 * ```
 */
export const joinMacro: ExpressionMacro = defineExpressionMacro({
  name: "join$",
  expand(
    ctx: MacroContext,
    node: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    const { factory } = ctx;

    if (args.length < 1 || args.length > 2) {
      ctx.reportError(
        node,
        "join$ expects one or two arguments: items array and optional separator",
      );
      return node;
    }

    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createPropertyAccessExpression(
          factory.createIdentifier("drizzle_orm"),
          factory.createIdentifier("sql"),
        ),
        factory.createIdentifier("join"),
      ),
      undefined,
      [...args],
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
 * import { sql } from "drizzle-orm";
 * const fragment = sql.raw("NOW()");
 * ```
 */
export const rawMacro: ExpressionMacro = defineExpressionMacro({
  name: "raw$",
  expand(
    ctx: MacroContext,
    node: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    const { factory } = ctx;

    if (args.length !== 1) {
      ctx.reportError(
        node,
        "raw$ expects exactly one argument: the raw SQL string",
      );
      return node;
    }

    // Strong warning about SQL injection
    const arg = args[0];
    if (!ts.isStringLiteral(arg)) {
      ctx.reportWarning(
        node,
        "raw$ with dynamic values is HIGHLY DANGEROUS and vulnerable to SQL injection. " +
          "Use parameterized queries or dsql tagged templates instead.",
      );
    }

    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createPropertyAccessExpression(
          factory.createIdentifier("drizzle_orm"),
          factory.createIdentifier("sql"),
        ),
        factory.createIdentifier("raw"),
      ),
      undefined,
      [args[0]],
    );
  },
});

// ============================================================================
// Registration
// ============================================================================

/**
 * Register all Drizzle adapter macros with the global registry.
 */
export function register(): void {
  globalRegistry.register(dsqlMacro);
  globalRegistry.register(refMacro);
  globalRegistry.register(idMacro);
  globalRegistry.register(joinMacro);
  globalRegistry.register(rawMacro);
}

// Auto-register on import
register();

// ============================================================================
// Runtime Helpers & Type Definitions
// ============================================================================

/**
 * Runtime placeholder for dsql (should be transformed at compile time)
 */
export function dsql<T = unknown>(
  _strings: TemplateStringsArray,
  ..._values: unknown[]
): never {
  throw new Error(
    "dsql was not transformed at compile time. " +
      "Make sure @typesugar/drizzle is registered with the transformer.",
  );
}

/**
 * Runtime placeholder for ref$
 */
export function ref$(_reference: string): never {
  throw new Error(
    "ref$ was not transformed at compile time. " +
      "Make sure @typesugar/drizzle is registered with the transformer.",
  );
}

/**
 * Runtime placeholder for id$
 */
export function id$(_identifier: string): never {
  throw new Error(
    "id$ was not transformed at compile time. " +
      "Make sure @typesugar/drizzle is registered with the transformer.",
  );
}

/**
 * Runtime placeholder for join$
 */
export function join$<T>(_items: T[], _separator?: unknown): never {
  throw new Error(
    "join$ was not transformed at compile time. " +
      "Make sure @typesugar/drizzle is registered with the transformer.",
  );
}

/**
 * Runtime placeholder for raw$
 */
export function raw$(_sql: string): never {
  throw new Error(
    "raw$ was not transformed at compile time. " +
      "Make sure @typesugar/drizzle is registered with the transformer.",
  );
}

// ============================================================================
// Doobie-style ConnectionIO Integration
// ============================================================================

/**
 * DrizzleQueryable — A Queryable instance for executing Drizzle queries in ConnectionIO.
 *
 * It allows lifting any Drizzle query builder (that implements `.toSQL()`)
 * directly into Doobie-style programs via `ConnectionIO.fromQueryable(query, DrizzleQueryable)`.
 */
export const DrizzleQueryable: Queryable<{
  toSQL(): { sql: string; params: unknown[] };
}> = QueryableCompanion.make(
  async (
    query: { toSQL(): { sql: string; params: unknown[] } },
    conn: DbConnection,
  ) => {
    const { sql, params } = query.toSQL();
    return await conn.query(sql, params);
  },
);
