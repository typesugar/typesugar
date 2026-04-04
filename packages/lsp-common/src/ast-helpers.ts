/**
 * AST helper functions shared between LSP server and TS plugin.
 */

import * as ts from "typescript";

/**
 * Find the most specific AST node at a given byte offset.
 */
export function findNodeAtOffset(sourceFile: ts.SourceFile, offset: number): ts.Node | undefined {
  function find(node: ts.Node): ts.Node | undefined {
    if (offset >= node.getStart(sourceFile) && offset < node.getEnd()) {
      return ts.forEachChild(node, find) || node;
    }
    return undefined;
  }
  return find(sourceFile);
}

/**
 * Walk up the parent chain to find an ancestor matching a predicate.
 */
export function findAncestor(
  node: ts.Node,
  predicate: (n: ts.Node) => boolean
): ts.Node | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (predicate(current)) return current;
    current = current.parent;
  }
  return undefined;
}

/**
 * Extract the name from a decorator expression.
 * Handles both `@foo` and `@foo(args)` forms.
 */
export function getDecoratorName(decorator: ts.Decorator): string | undefined {
  const expr = decorator.expression;
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text;
  }
  return undefined;
}
