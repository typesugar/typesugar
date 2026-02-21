import * as ts from "typescript";
import { type MacroContext } from "@typesugar/core";

/**
 * Basic SQL syntax validation for template literals.
 * Checks for unbalanced parentheses and potentially dangerous patterns.
 */
export function validateSqlSyntax(sql: string, ctx: MacroContext, node: ts.Node): boolean {
  const trimmed = sql.trim().toUpperCase();

  // Check for common SQL injection patterns
  const dangerousPatterns = [
    /;\s*DROP\s+TABLE/i,
    /;\s*DELETE\s+FROM/i,
    /;\s*TRUNCATE/i,
    /--.*$/m,
    /\/\*.*\*\//s,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(sql)) {
      ctx.reportWarning(node, "SQL contains potentially dangerous patterns. Review carefully.");
      break;
    }
  }

  // Basic keyword validation
  const validStarters = [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "WITH",
    "CREATE",
    "ALTER",
    "DROP",
    "TRUNCATE",
  ];
  const startsValid = validStarters.some((kw) => trimmed.startsWith(kw));

  if (!startsValid && trimmed.length > 0) {
    // Allow fragments that don't start with keywords
    // (they might be subqueries or conditions)
    return true;
  }

  // Check for unbalanced parentheses
  let parenCount = 0;
  for (const char of sql) {
    if (char === "(") parenCount++;
    if (char === ")") parenCount--;
    if (parenCount < 0) {
      ctx.reportError(node, "SQL has unbalanced parentheses: too many closing parentheses");
      return false;
    }
  }
  if (parenCount !== 0) {
    ctx.reportError(node, "SQL has unbalanced parentheses: missing closing parentheses");
    return false;
  }

  return true;
}
