/**
 * Doobie-like SQL Macro
 *
 * Compile-time transformation of sql`` tagged template literals into
 * Fragment construction calls. The macro:
 *
 * 1. Parses the template literal segments and interpolations
 * 2. Distinguishes between Fragment-typed interpolations (inlined as sub-fragments)
 *    and plain values (bound as parameters)
 * 3. Validates basic SQL syntax at compile time
 * 4. Generates efficient Fragment construction code
 *
 * @example
 * ```typescript
 * // Input:
 * const q = sql`SELECT * FROM users WHERE name = ${name} AND age > ${age}`;
 *
 * // Expands to:
 * const q = new Fragment(
 *   ["SELECT * FROM users WHERE name = ", " AND age > ", ""],
 *   [name, age]
 * );
 * ```
 *
 * Fragment interpolations are composed at the Fragment level:
 * ```typescript
 * const cond = sql`WHERE active = ${true}`;
 * const q = sql`SELECT * FROM users ${cond}`;
 *
 * // Expands to:
 * const q = __sql_compose(
 *   ["SELECT * FROM users ", ""],
 *   [cond]
 * );
 * ```
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry, MacroContext } from "@typesugar/core";

// ============================================================================
// SQL Macro Definition
// ============================================================================

export const sqlMacro = defineExpressionMacro({
  name: "sql",
  description: "Doobie-style composable SQL fragments with type-safe parameter binding",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const factory = ctx.factory;

    // sql`` is invoked as an expression macro wrapping a template literal
    if (args.length !== 1 || !ts.isTemplateLiteral(args[0])) {
      ctx.reportError(callExpr, "sql expects a tagged template literal: sql`...`");
      return callExpr;
    }

    const template = args[0];

    // -----------------------------------------------------------------------
    // No-substitution template: sql`SELECT 1`
    // -----------------------------------------------------------------------
    if (ts.isNoSubstitutionTemplateLiteral(template)) {
      const sqlText = template.text;
      const validationError = validateSqlFragment(sqlText);
      if (validationError) {
        ctx.reportWarning(callExpr, `SQL warning: ${validationError}`);
      }

      // new Fragment(["SELECT 1"], [])
      return createFragmentConstructor(factory, [sqlText], []);
    }

    // -----------------------------------------------------------------------
    // Template with interpolations
    // -----------------------------------------------------------------------
    if (ts.isTemplateExpression(template)) {
      const segments: string[] = [template.head.text];
      const interpolations: ts.Expression[] = [];

      for (const span of template.templateSpans) {
        interpolations.push(span.expression);
        segments.push(span.literal.text);
      }

      // Validate the combined SQL text (with placeholders)
      const combinedSql = segments.join("?");
      const validationError = validateSqlFragment(combinedSql);
      if (validationError) {
        ctx.reportWarning(callExpr, `SQL warning: ${validationError}`);
      }

      // Generate: __sql_build(["seg0", "seg1", ...], [expr0, expr1, ...])
      // The runtime helper handles Fragment vs plain value interpolations
      return createSqlBuildCall(factory, segments, interpolations);
    }

    return callExpr;
  },
});

// ============================================================================
// AST Construction Helpers
// ============================================================================

/**
 * Generate: new Fragment(segments, params)
 *
 * Used when all interpolations are known to be plain params (no sub-fragments).
 */
function createFragmentConstructor(
  factory: ts.NodeFactory,
  segments: string[],
  params: ts.Expression[]
): ts.Expression {
  const segmentsArray = factory.createArrayLiteralExpression(
    segments.map((s) => factory.createStringLiteral(s))
  );

  const paramsArray = factory.createArrayLiteralExpression(params);

  return factory.createNewExpression(factory.createIdentifier("Fragment"), undefined, [
    segmentsArray,
    paramsArray,
  ]);
}

/**
 * Generate: __sql_build(["seg0", "seg1", ...], [expr0, expr1, ...])
 *
 * INTENTIONALLY UNHYGIENIC: __sql_build is a runtime helper exported from @typesugar/sql.
 * Users must import it for the generated code to work.
 *
 * The runtime helper inspects each interpolation at runtime:
 * - If it's a Fragment, it inlines its SQL and params
 * - Otherwise, it treats it as a bound parameter
 *
 * This allows mixing Fragment composition and parameter binding in one template.
 */
function createSqlBuildCall(
  factory: ts.NodeFactory,
  segments: string[],
  interpolations: ts.Expression[]
): ts.Expression {
  const segmentsArray = factory.createArrayLiteralExpression(
    segments.map((s) => factory.createStringLiteral(s))
  );

  const interpolationsArray = factory.createArrayLiteralExpression(interpolations);

  return factory.createCallExpression(factory.createIdentifier("__sql_build"), undefined, [
    segmentsArray,
    interpolationsArray,
  ]);
}

// ============================================================================
// Compile-Time SQL Validation
// ============================================================================

function validateSqlFragment(sql: string): string | null {
  const normalized = sql.toLowerCase().trim();

  if (!normalized) return null;

  // Check for unbalanced parentheses
  let depth = 0;
  for (const char of sql) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (depth < 0) return "Unbalanced parentheses";
  }
  if (depth !== 0) return "Unbalanced parentheses";

  // Check for unbalanced single quotes (basic string literal check)
  const singleQuotes = (sql.match(/'/g) || []).length;
  if (singleQuotes % 2 !== 0) return "Unbalanced single quotes";

  // Warn about SQL comments
  if (normalized.includes("--")) {
    return "SQL comment detected — ensure this is intentional";
  }

  return null;
}

// ============================================================================
// Register
// ============================================================================

export function register(): void {
  globalRegistry.register(sqlMacro);
}

// Auto-register
register();
