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
 *
 * The result must mean exactly what the expression means — the prover
 * deletes the runtime check for anything it proves about this string. It is
 * the expression printed (whitespace/comments normalised) by the TypeScript
 * printer, so every operator survives as written; the earlier hand-rolled
 * printer mapped unknown operators to `?` and every non-`!` prefix operator
 * (`~x`, `+x`) to `-x` (deep review 2026-10, effect-contracts #2).
 */
export function normalizeExpression(expr: ts.Expression): string {
  let sourceFile: ts.SourceFile | undefined;
  try {
    sourceFile = expr.getSourceFile?.();
  } catch {
    sourceFile = undefined;
  }
  return printer
    .printNode(ts.EmitHint.Expression, expr, sourceFile ?? emptySourceFile)
    .replace(/\s*\n\s*/g, " ");
}

const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const emptySourceFile = ts.createSourceFile("__predicate__.ts", "", ts.ScriptTarget.Latest);

/**
 * Called for problems in a contract block that would otherwise be silent
 * (statements that are not conditions, a non-literal message, ...).
 */
export type ContractBlockDiagnostic = (
  node: ts.Node,
  message: string,
  severity: "error" | "warning"
) => void;

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
export function extractConditionsFromBlock(
  block: ts.Block | ts.Statement,
  onDiagnostic?: ContractBlockDiagnostic
): ContractCondition[] {
  const conditions: ContractCondition[] = [];

  const visitStatement = (stmt: ts.Statement) => {
    if (ts.isExpressionStatement(stmt)) {
      conditions.push(expressionToCondition(stmt.expression, onDiagnostic));
    } else if (!ts.isEmptyStatement(stmt)) {
      // A `const`, `if`, loop, ... inside a contract block used to be dropped
      // without a trace. Each condition must be an expression statement.
      onDiagnostic?.(
        stmt,
        "Only expression statements are allowed in a contract block; each one is a " +
          'condition (optionally `(condition, "message");`). This statement is not checked.',
        "error"
      );
    }
  };

  if (ts.isBlock(block)) {
    block.statements.forEach(visitStatement);
  } else {
    visitStatement(block);
  }

  return conditions;
}

function expressionToCondition(
  expr: ts.Expression,
  onDiagnostic?: ContractBlockDiagnostic
): ContractCondition {
  // `condition, "message"` — documented as `(condition, "message");`. The
  // parenthesized form is a ParenthesizedExpression around the comma
  // expression; without unwrapping it the whole comma expression became the
  // condition, whose value is the (truthy) message string, so the check could
  // never fail (deep review 2026-10, effect-contracts #1).
  let inner: ts.Expression = expr;
  while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
  if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    let message: string | undefined;
    if (ts.isStringLiteral(inner.right) || ts.isNoSubstitutionTemplateLiteral(inner.right)) {
      message = inner.right.text;
    } else {
      onDiagnostic?.(
        inner.right,
        "The message after the comma in a contract condition must be a string literal; " +
          "the condition is still checked, with the default message.",
        "warning"
      );
    }
    const condition = inner.left;
    return {
      expression: condition,
      normalized: normalizeExpression(condition),
      sourceText: safeText(condition),
      message,
    };
  }

  return {
    expression: expr,
    normalized: normalizeExpression(expr),
    sourceText: safeText(expr),
  };
}

function safeText(expr: ts.Expression): string {
  try {
    const text = expr.getText?.();
    if (text) return text;
  } catch {
    // Synthesized nodes have no source text.
  }
  return normalizeExpression(expr);
}
