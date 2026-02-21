/**
 * Tests for yield: syntax parsing
 *
 * Verifies what AST is produced for different yield syntaxes
 * to understand error handling behavior.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";

function parseYieldSyntax(code: string): { kind: string; text?: string }[] {
  const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

  const results: { kind: string; text?: string }[] = [];

  function visit(node: ts.Node, depth: number = 0) {
    const kindName = ts.SyntaxKind[node.kind];

    if (ts.isIdentifier(node)) {
      results.push({ kind: kindName, text: node.text });
    } else {
      results.push({ kind: kindName });
    }

    ts.forEachChild(node, (child) => visit(child, depth + 1));
  }

  visit(sourceFile);
  return results;
}

function getYieldExpressionKind(code: string): string | undefined {
  const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

  // The labeled statement's statement is what we care about
  const firstStmt = sourceFile.statements[0];
  if (!ts.isLabeledStatement(firstStmt)) return undefined;

  const labeledBody = firstStmt.statement;
  const kindName = ts.SyntaxKind[labeledBody.kind];

  // If it's a block, get the expression inside
  if (ts.isBlock(labeledBody)) {
    const lastStmt = labeledBody.statements[labeledBody.statements.length - 1];
    if (lastStmt && ts.isExpressionStatement(lastStmt)) {
      return `Block containing ${ts.SyntaxKind[lastStmt.expression.kind]}`;
    }
    return `Block (${labeledBody.statements.length} statements)`;
  }

  // If it's an expression statement, get the expression type
  if (ts.isExpressionStatement(labeledBody)) {
    return ts.SyntaxKind[labeledBody.expression.kind];
  }

  return kindName;
}

describe("yield: syntax parsing", () => {
  it("yield: { user, posts } - parses as block with comma expression (SILENT BUG)", () => {
    const result = getYieldExpressionKind(`yield: { user, posts }`);

    // This is the bug case! It parses as a comma expression, not an object literal
    expect(result).toBe("Block containing BinaryExpression");
    // The comma expression `user, posts` returns just `posts`
    // No error is shown to the user!
  });

  it("yield: ({ user, posts }) - parses correctly as object literal", () => {
    const result = getYieldExpressionKind(`yield: ({ user, posts })`);

    // Parentheses force object literal interpretation
    expect(result).toBe("ParenthesizedExpression");

    // Let's verify the inner expression is an object literal
    const sourceFile = ts.createSourceFile(
      "test.ts",
      `yield: ({ user, posts })`,
      ts.ScriptTarget.Latest,
      true
    );
    const stmt = sourceFile.statements[0] as ts.LabeledStatement;
    const exprStmt = stmt.statement as ts.ExpressionStatement;
    const paren = exprStmt.expression as ts.ParenthesizedExpression;
    expect(ts.isObjectLiteralExpression(paren.expression)).toBe(true);
  });

  it("yield: { { user, posts } } - ALSO BROKEN: parses as nested blocks, not object literal", () => {
    const code = `yield: { { user, posts } }`;
    const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
    const stmt = sourceFile.statements[0] as ts.LabeledStatement;
    const block = stmt.statement as ts.Block;

    // Double braces creates nested BLOCKS, not block + object literal
    // This is because { } in statement position is always parsed as a block
    expect(block.statements.length).toBe(1);
    const innerStmt = block.statements[0];

    // Inner is ALSO a block, not an expression statement!
    expect(ts.isBlock(innerStmt)).toBe(true);
    expect(ts.isExpressionStatement(innerStmt)).toBe(false);

    // So this syntax ALSO doesn't work for returning objects
  });

  it("the ONLY correct syntax for object literals is parentheses", () => {
    // All these are WRONG for returning { user, posts }:
    // - yield: { user, posts }       → comma expression, returns just `posts`
    // - yield: { { user, posts } }   → nested blocks, syntax error inside

    // The ONLY correct syntax:
    // - yield: ({ user, posts })     → parenthesized object literal

    const code = `yield: ({ user, posts })`;
    const sourceFile = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
    const stmt = sourceFile.statements[0] as ts.LabeledStatement;
    const exprStmt = stmt.statement as ts.ExpressionStatement;
    const paren = exprStmt.expression as ts.ParenthesizedExpression;

    expect(ts.isObjectLiteralExpression(paren.expression)).toBe(true);
  });

  it("yield: user + posts - simple expression works", () => {
    const result = getYieldExpressionKind(`yield: user + posts`);

    // Direct expression statement
    expect(result).toBe("BinaryExpression");
  });

  it("yield: result - single identifier works", () => {
    const result = getYieldExpressionKind(`yield: result`);
    expect(result).toBe("Identifier");
  });
});

describe("comma expression behavior", () => {
  it("demonstrates the comma expression bug", () => {
    // In JavaScript, `a, b` evaluates both but returns only b
    const commaResult = (1, 2, 3);
    expect(commaResult).toBe(3);

    // So `yield: { user, posts }` would generate code that:
    // 1. Evaluates `user` (for side effects only)
    // 2. Returns `posts`
    // This is NOT what the user wants!
  });
});
