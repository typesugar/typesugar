/**
 * Shared AST utility functions for macro implementations.
 *
 * This module consolidates common AST manipulation helpers that were previously
 * duplicated across multiple macro files.
 */

import ts from "typescript";
import type { MacroContext } from "./types.js";

// =============================================================================
// stripDecorator — Remove a specific decorator from a declaration
// =============================================================================

/**
 * Strip a decorator from a declaration, preserving other decorators and modifiers.
 *
 * Handles: MethodDeclaration, PropertyDeclaration, ClassDeclaration,
 * FunctionDeclaration, VariableStatement.
 */
export function stripDecorator(
  ctx: MacroContext,
  target: ts.Declaration,
  decoratorToRemove: ts.Decorator,
): ts.Node {
  if (!ts.canHaveDecorators(target)) return target;

  const existingDecorators = ts.getDecorators(target);
  if (!existingDecorators) return target;

  const remainingDecorators = existingDecorators.filter(
    (d) => d !== decoratorToRemove,
  );

  const existingModifiers = ts.canHaveModifiers(target)
    ? ts.getModifiers(target)
    : undefined;

  const newModifiers = [...remainingDecorators, ...(existingModifiers ?? [])];

  if (ts.isMethodDeclaration(target)) {
    return ctx.factory.updateMethodDeclaration(
      target,
      newModifiers.length > 0 ? newModifiers : undefined,
      target.asteriskToken,
      target.name,
      target.questionToken,
      target.typeParameters,
      target.parameters,
      target.type,
      target.body,
    );
  }

  if (ts.isPropertyDeclaration(target)) {
    return ctx.factory.updatePropertyDeclaration(
      target,
      newModifiers.length > 0 ? newModifiers : undefined,
      target.name,
      target.questionToken ?? target.exclamationToken,
      target.type,
      target.initializer,
    );
  }

  if (ts.isClassDeclaration(target)) {
    return ctx.factory.updateClassDeclaration(
      target,
      newModifiers.length > 0 ? newModifiers : undefined,
      target.name,
      target.typeParameters,
      target.heritageClauses,
      target.members,
    );
  }

  // Cast to avoid TypeScript's overly-aggressive narrowing to `never`
  // (ts.Declaration includes more types than we explicitly handle above)
  const maybeNode = target as ts.Node;

  if (ts.isVariableStatement(maybeNode)) {
    return ctx.factory.updateVariableStatement(
      maybeNode,
      newModifiers.length > 0 ? newModifiers : undefined,
      maybeNode.declarationList,
    );
  }

  const maybeFunc = maybeNode as ts.Declaration;
  if (ts.isFunctionDeclaration(maybeFunc)) {
    return ctx.factory.updateFunctionDeclaration(
      maybeFunc,
      newModifiers.length > 0 ? newModifiers : undefined,
      maybeFunc.asteriskToken,
      maybeFunc.name,
      maybeFunc.typeParameters,
      maybeFunc.parameters,
      maybeFunc.type,
      maybeFunc.body,
    );
  }

  return target;
}

// =============================================================================
// stripPositions — Mark AST nodes as synthetic
// =============================================================================

/**
 * Recursively mark AST nodes as synthetic by setting positions to -1.
 *
 * Useful when creating or cloning nodes that should not be associated
 * with specific source positions.
 */
export function stripPositions<T extends ts.Node>(node: T): T {
  ts.setTextRange(node, { pos: -1, end: -1 });
  return ts.visitEachChild(
    node,
    (child) => stripPositions(child),
    undefined as unknown as ts.TransformationContext,
  ) as T;
}

// =============================================================================
// jsValueToExpression — Convert runtime JS values to AST expressions
// =============================================================================

/**
 * Context interface for jsValueToExpression (subset of MacroContext).
 */
export interface JsValueContext {
  factory: ts.NodeFactory;
  reportError(node: ts.Node, message: string): void;
}

/**
 * Convert a JavaScript value to a TypeScript AST expression.
 *
 * Handles: null, undefined, numbers (including negative, Infinity, NaN),
 * strings, booleans, bigint, arrays, RegExp, and plain objects.
 *
 * @param ctx - Context providing factory and error reporting
 * @param value - The JS value to convert
 * @param errorNode - Node to report errors against (for non-serializable values)
 */
export function jsValueToExpression(
  ctx: JsValueContext,
  value: unknown,
  errorNode: ts.Node,
): ts.Expression {
  if (value === null) {
    return ctx.factory.createNull();
  }

  if (value === undefined) {
    return ctx.factory.createIdentifier("undefined");
  }

  if (typeof value === "number") {
    if (value < 0) {
      return ctx.factory.createPrefixUnaryExpression(
        ts.SyntaxKind.MinusToken,
        ctx.factory.createNumericLiteral(Math.abs(value)),
      );
    }
    if (!isFinite(value)) {
      return ctx.factory.createIdentifier(value > 0 ? "Infinity" : "-Infinity");
    }
    if (isNaN(value)) {
      return ctx.factory.createIdentifier("NaN");
    }
    return ctx.factory.createNumericLiteral(value);
  }

  if (typeof value === "string") {
    return ctx.factory.createStringLiteral(value);
  }

  if (typeof value === "boolean") {
    return value ? ctx.factory.createTrue() : ctx.factory.createFalse();
  }

  if (typeof value === "bigint") {
    return ctx.factory.createBigIntLiteral(value.toString());
  }

  if (Array.isArray(value)) {
    const elements = value.map((el) => jsValueToExpression(ctx, el, errorNode));
    return ctx.factory.createArrayLiteralExpression(elements);
  }

  if (value instanceof RegExp) {
    return ctx.factory.createCallExpression(
      ctx.factory.createIdentifier("RegExp"),
      undefined,
      [
        ctx.factory.createStringLiteral(value.source),
        ctx.factory.createStringLiteral(value.flags),
      ],
    );
  }

  if (typeof value === "object") {
    const properties: ts.PropertyAssignment[] = [];
    for (const [key, val] of Object.entries(value)) {
      properties.push(
        ctx.factory.createPropertyAssignment(
          /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)
            ? ctx.factory.createIdentifier(key)
            : ctx.factory.createStringLiteral(key),
          jsValueToExpression(ctx, val, errorNode),
        ),
      );
    }
    return ctx.factory.createObjectLiteralExpression(properties, true);
  }

  // Functions, symbols, etc. cannot be serialized to AST
  ctx.reportError(
    errorNode,
    `Cannot serialize value of type ${typeof value} to AST`,
  );
  return ctx.factory.createIdentifier("undefined");
}

// =============================================================================
// Shared printer and dummy source file utilities
// =============================================================================

let sharedPrinter: ts.Printer | undefined;
let sharedDummySourceFile: ts.SourceFile | undefined;

/**
 * Get a shared printer instance for converting AST nodes to source text.
 */
export function getPrinter(): ts.Printer {
  return (sharedPrinter ??= ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
  }));
}

/**
 * Get a dummy source file for printing synthetic nodes.
 *
 * When printing nodes that were created synthetically (not parsed from a file),
 * a source file context is still required by the printer.
 */
export function getDummySourceFile(): ts.SourceFile {
  return (sharedDummySourceFile ??= ts.createSourceFile(
    "__ast_utils_temp__.ts",
    "",
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  ));
}

/**
 * Print a node to source text, handling synthetic nodes that lack source positions.
 *
 * @param node - The AST node to print
 * @param sourceFile - Optional source file context (uses dummy if not provided)
 */
export function printNode(
  node: ts.Node,
  sourceFile?: ts.SourceFile,
): string {
  const printer = getPrinter();
  const sf = sourceFile ?? getDummySourceFile();

  if (ts.isExpression(node)) {
    return printer.printNode(ts.EmitHint.Expression, node, sf);
  }
  return printer.printNode(ts.EmitHint.Unspecified, node, sf);
}

// =============================================================================
// Condition expression evaluation helpers
// =============================================================================

/**
 * Split an expression on a top-level operator (not inside parentheses).
 */
export function splitTopLevel(expr: string, op: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === "(") depth++;
    else if (expr[i] === ")") depth--;

    if (depth === 0 && expr.slice(i, i + op.length) === op) {
      parts.push(current);
      current = "";
      i += op.length - 1;
    } else {
      current += expr[i];
    }
  }

  parts.push(current);
  return parts;
}

/**
 * Find the index of the matching closing parenthesis.
 */
export function findMatchingParen(expr: string, start: number): number {
  let depth = 0;
  for (let i = start; i < expr.length; i++) {
    if (expr[i] === "(") depth++;
    else if (expr[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Get a nested value from an object using dot notation.
 *
 * @example
 * getNestedValue({ a: { b: 1 } }, "a.b") // => 1
 */
export function getNestedValue(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  const parts = path.trim().split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Evaluate a condition expression against a configuration object.
 *
 * Supports: boolean expressions with &&, ||, !, parentheses,
 * equality (==), inequality (!=), and truthy checks.
 *
 * @param expr - The condition expression (e.g., "debug && !production")
 * @param config - Configuration object to evaluate against
 */
export function evaluateConditionExpr(
  expr: string,
  config: Record<string, unknown>,
): boolean {
  expr = expr.trim();

  // Handle OR (lowest precedence)
  const orParts = splitTopLevel(expr, "||");
  if (orParts.length > 1) {
    return orParts.some((part) => evaluateConditionExpr(part, config));
  }

  // Handle AND
  const andParts = splitTopLevel(expr, "&&");
  if (andParts.length > 1) {
    return andParts.every((part) => evaluateConditionExpr(part, config));
  }

  // Handle parentheses
  if (expr.startsWith("(") && findMatchingParen(expr, 0) === expr.length - 1) {
    return evaluateConditionExpr(expr.slice(1, -1), config);
  }

  // Handle negation
  if (expr.startsWith("!")) {
    return !evaluateConditionExpr(expr.slice(1), config);
  }

  // Handle equality: key == 'value' or key == "value"
  const eqMatch = expr.match(/^([\w.]+)\s*==\s*['"](.+)['"]\s*$/);
  if (eqMatch) {
    const value = getNestedValue(config, eqMatch[1]);
    return String(value) === eqMatch[2];
  }

  // Handle inequality: key != 'value'
  const neqMatch = expr.match(/^([\w.]+)\s*!=\s*['"](.+)['"]\s*$/);
  if (neqMatch) {
    const value = getNestedValue(config, neqMatch[1]);
    return String(value) !== neqMatch[2];
  }

  // Simple key — truthy check
  const value = getNestedValue(config, expr);
  return !!value;
}
