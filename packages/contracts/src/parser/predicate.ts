/**
 * Predicate Normalization
 *
 * Converts TypeScript AST expressions into normalized string predicates
 * that the prover can reason about.
 */

import * as ts from "typescript";

/**
 * A parsed contract condition.
 */
export interface ContractCondition {
  /** The original AST expression */
  expression: ts.Expression;
  /** Normalized string form for the prover */
  normalized: string;
  /** Human-readable source text for error messages */
  sourceText: string;
  /** Optional user-provided message */
  message?: string;
}

/**
 * Normalize an expression to a string predicate for the prover.
 * Handles common patterns like `x > 0`, `a + b > 0`, `!frozen`, etc.
 */
export function normalizeExpression(expr: ts.Expression): string {
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }

  if (ts.isPropertyAccessExpression(expr)) {
    return `${normalizeExpression(expr.expression)}.${expr.name.text}`;
  }

  if (ts.isPrefixUnaryExpression(expr)) {
    const op = expr.operator === ts.SyntaxKind.ExclamationToken ? "!" : "-";
    return `${op}${normalizeExpression(expr.operand)}`;
  }

  if (ts.isBinaryExpression(expr)) {
    const left = normalizeExpression(expr.left);
    const right = normalizeExpression(expr.right);
    const op = tokenToString(expr.operatorToken.kind);
    return `${left} ${op} ${right}`;
  }

  if (ts.isParenthesizedExpression(expr)) {
    return `(${normalizeExpression(expr.expression)})`;
  }

  if (ts.isNumericLiteral(expr)) {
    return expr.text;
  }

  if (expr.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return "false";

  // Fallback: use getText if available
  return expr.getText?.() ?? "<complex>";
}

function tokenToString(kind: ts.SyntaxKind): string {
  const map: Record<number, string> = {
    [ts.SyntaxKind.GreaterThanToken]: ">",
    [ts.SyntaxKind.GreaterThanEqualsToken]: ">=",
    [ts.SyntaxKind.LessThanToken]: "<",
    [ts.SyntaxKind.LessThanEqualsToken]: "<=",
    [ts.SyntaxKind.EqualsEqualsEqualsToken]: "===",
    [ts.SyntaxKind.ExclamationEqualsEqualsToken]: "!==",
    [ts.SyntaxKind.EqualsEqualsToken]: "==",
    [ts.SyntaxKind.ExclamationEqualsToken]: "!=",
    [ts.SyntaxKind.PlusToken]: "+",
    [ts.SyntaxKind.MinusToken]: "-",
    [ts.SyntaxKind.AsteriskToken]: "*",
    [ts.SyntaxKind.SlashToken]: "/",
    [ts.SyntaxKind.AmpersandAmpersandToken]: "&&",
    [ts.SyntaxKind.BarBarToken]: "||",
  };
  return map[kind] ?? "?";
}

/**
 * Extract individual conditions from a block of expression statements.
 * Each expression statement in the block is treated as a separate condition.
 *
 * ```typescript
 * requires: {
 *   account.balance >= amount;   // condition 1
 *   !account.frozen;             // condition 2
 * }
 * ```
 */
export function extractConditionsFromBlock(block: ts.Block | ts.Statement): ContractCondition[] {
  const conditions: ContractCondition[] = [];

  if (ts.isBlock(block)) {
    for (const stmt of block.statements) {
      if (ts.isExpressionStatement(stmt)) {
        conditions.push(expressionToCondition(stmt.expression));
      }
    }
  } else if (ts.isExpressionStatement(block)) {
    conditions.push(expressionToCondition(block.expression));
  }

  return conditions;
}

function expressionToCondition(expr: ts.Expression): ContractCondition {
  // Check for comma expression: `condition, "message"`
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    const message = ts.isStringLiteral(expr.right) ? expr.right.text : undefined;
    return {
      expression: expr.left,
      normalized: normalizeExpression(expr.left),
      sourceText: expr.left.getText?.() ?? normalizeExpression(expr.left),
      message,
    };
  }

  return {
    expression: expr,
    normalized: normalizeExpression(expr),
    sourceText: expr.getText?.() ?? normalizeExpression(expr),
  };
}
