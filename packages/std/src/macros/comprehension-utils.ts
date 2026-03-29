/**
 * Comprehension Utilities
 *
 * Shared types and helper functions for the `let:/yield:` and `par:/yield:`
 * labeled block macros.
 */

import * as ts from "typescript";
import type { MacroContext } from "@typesugar/core";

// ============================================================================
// Comprehension Step Types
// ============================================================================

/**
 * A monadic bind step: `name << expr` or `name << expr || fallback`
 *
 * Binds the result of a monadic expression to a name. For intermediate steps,
 * generates `.flatMap(name => ...)`. For the final step, generates `.map(name => ...)`.
 *
 * If `orElse` is present, wraps the expression with `.orElse(() => fallback)`.
 */
export interface BindStep {
  kind: "bind";
  /** The variable name to bind (or "_" for discarded results) */
  name: string;
  /** The monadic expression to bind */
  effect: ts.Expression;
  /** Optional fallback expression (from `<< expr || alt` or `<< expr ?? alt`) */
  orElse?: ts.Expression;
  /** Original AST node for error reporting */
  node: ts.Node;
}

/**
 * A pure map step: `name = expr`
 *
 * Computes a pure value from previous bindings without unwrapping a monadic type.
 * Generated as an IIFE: `((name) => continuation)(expr)`
 */
export interface MapStep {
  kind: "map";
  /** The variable name to bind */
  name: string;
  /** The pure expression to compute */
  expression: ts.Expression;
  /** Original AST node for error reporting */
  node: ts.Node;
}

/**
 * A guard/filter step: `if (cond) {}`
 *
 * Short-circuits the comprehension if the condition is false.
 * Generated as a ternary: `cond ? continuation : undefined`
 *
 * Note: Guards are only supported in monadic `let:` blocks, not applicative `par:` blocks.
 */
export interface GuardStep {
  kind: "guard";
  /** The condition to check */
  condition: ts.Expression;
  /** Original AST node for error reporting */
  node: ts.Node;
}

/**
 * A group of parallel bindings nested inside a sequential comprehension.
 *
 * When `par: { ... }` or `all: { ... }` appears inside a `seq:` / `let:` block,
 * the steps are grouped together and executed in parallel (Promise.all or map/ap).
 */
export interface ParallelGroupStep {
  kind: "parallel-group";
  /** The bind/map steps to execute in parallel */
  steps: (BindStep | MapStep)[];
  /** The label used (for error messages) */
  label: string;
  /** Original AST node for error reporting */
  node: ts.Node;
}

/**
 * A step in a comprehension (let: or par: block).
 */
export type ComprehensionStep = BindStep | MapStep | GuardStep | ParallelGroupStep;

// ============================================================================
// Yield Expression Extraction
// ============================================================================

/**
 * Check if an expression is a comma expression (e.g., `a, b, c`).
 * Comma expressions evaluate all operands but return only the last value.
 */
function isCommaExpression(expr: ts.Expression): boolean {
  return ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.CommaToken;
}

/**
 * Check if an expression looks like it was intended to be an object literal
 * but was parsed as a comma expression due to missing parentheses.
 *
 * Common mistake: `yield: { user, posts }` parses as `{ user, posts }` where
 * `user, posts` is a comma expression returning just `posts`, NOT an object literal.
 */
function looksLikeIntendedObjectLiteral(expr: ts.Expression): boolean {
  if (!isCommaExpression(expr)) return false;

  // Check if all parts of the comma expression are simple identifiers
  // This pattern strongly suggests the user meant to write an object literal shorthand
  const parts: ts.Expression[] = [];
  let current: ts.Expression = expr;

  while (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.CommaToken
  ) {
    parts.push(current.right);
    current = current.left;
  }
  parts.push(current);

  // If all parts are identifiers, this is almost certainly meant to be { a, b, c }
  return parts.every((p) => ts.isIdentifier(p));
}

/**
 * Extract the yield/return expression from a continuation block.
 *
 * Handles:
 * - Block with single expression statement: `yield: { expr }`
 * - Block with return statement: `yield: { return expr; }`
 * - Expression statement: `yield: expr`
 *
 * Detects common mistakes:
 * - Comma expressions that should be object literals: `yield: { a, b }`
 * - Nested blocks: `yield: { { a, b } }`
 */
export function extractReturnExpr(
  ctx: MacroContext,
  stmt: ts.Statement
): ts.Expression | undefined {
  if (ts.isBlock(stmt)) {
    const lastStmt = stmt.statements[stmt.statements.length - 1];
    if (stmt.statements.length > 1) {
      ctx.reportWarning(
        stmt,
        "yield: block has multiple statements; only the last expression is used. " +
          "Preceding statements will be discarded."
      );
    }
    if (lastStmt && ts.isExpressionStatement(lastStmt)) {
      const expr = lastStmt.expression;

      // Detect common mistake: `yield: { user, posts }` where user meant object literal
      if (looksLikeIntendedObjectLiteral(expr)) {
        ctx.reportError(
          lastStmt,
          "yield: block contains a comma expression, not an object literal. " +
            "Did you mean `yield: ({ user, posts })`? Use parentheses to create an object literal."
        );
        // Still return the expression so compilation can continue with a warning
        return expr;
      }

      return expr;
    }
    if (lastStmt && ts.isReturnStatement(lastStmt) && lastStmt.expression) {
      return lastStmt.expression;
    }

    // Detect nested block - user might have tried `yield: { { user, posts } }`
    // thinking double braces would create an object literal
    if (lastStmt && ts.isBlock(lastStmt)) {
      ctx.reportError(
        lastStmt,
        "yield: contains a nested block, not an object literal. " +
          "To return an object, use `yield: ({ user, posts })` with parentheses."
      );
      return undefined;
    }

    if (stmt.statements.length === 0) {
      ctx.reportError(stmt, "yield: block is empty. It must contain an expression.");
      return undefined;
    }

    ctx.reportError(stmt, "yield: block should contain a single expression or object literal");
    return undefined;
  }

  if (ts.isExpressionStatement(stmt)) {
    return stmt.expression;
  }

  return undefined;
}

// ============================================================================
// Type Inference
// ============================================================================

/**
 * Infer the type constructor name from an expression's type.
 *
 * Used to determine which FlatMap instance to use and whether to emit
 * `.then()` for Promises, `Effect.flatMap()` for Effect, etc.
 *
 * @returns The type constructor name (e.g., "Array", "Promise", "Option", "Effect")
 */
export function inferTypeConstructor(
  expr: ts.Expression,
  typeChecker: ts.TypeChecker,
  sourceFile?: ts.SourceFile
): string | undefined {
  const type = typeChecker.getTypeAtLocation(expr);
  const typeString = typeChecker.typeToString(type);

  // Handle Array<T> or T[]
  if (type.symbol?.name === "Array" || /^[A-Za-z_]\w*\[\]$/.test(typeString)) {
    return "Array";
  }

  // Handle Promise<T>
  if (type.symbol?.name === "Promise" || typeString.startsWith("Promise<")) {
    return "Promise";
  }

  // Handle Effect.Effect<A, E, R>
  // Effect types are branded and may appear as "Effect<A, E, R>" in the type string
  if (
    type.symbol?.name === "Effect" ||
    typeString.startsWith("Effect<") ||
    typeString.includes("Effect.Effect<")
  ) {
    return "Effect";
  }

  // Handle Iterable<T>
  if (type.symbol?.name === "Iterable" || typeString.startsWith("Iterable<")) {
    return "Iterable";
  }

  // Handle AsyncIterable<T>
  if (type.symbol?.name === "AsyncIterable" || typeString.startsWith("AsyncIterable<")) {
    return "AsyncIterable";
  }

  // For other types, try to get the symbol name
  if (type.symbol?.name) {
    return type.symbol.name;
  }

  // Try to extract from type string (e.g., "Option<number>" -> "Option")
  const match = typeString.match(/^(\w+)</);
  if (match) {
    return match[1];
  }

  // When the type is `any`, the expression might reference a macro-generated
  // When the type is `any`, the expression might call a method on a macro-generated
  // namespace (e.g., Greeter.greet() from @service). The @service macro generates the
  // namespace in the same transform pass, so the type checker doesn't know about it yet.
  //
  // Fallback: scan the source file for an interface named X that has a method matching
  // the call. Extract the return type's type constructor from the type annotation.
  // This is generic — works for any type constructor (Effect, IO, Task, etc.), not
  // just Effect.
  if (typeString === "any" && ts.isCallExpression(expr)) {
    const callee = expr.expression;
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
      const interfaceName = callee.expression.text;
      const methodName = callee.name.text;
      const sf = sourceFile ?? expr.getSourceFile?.();
      if (sf) {
        for (const stmt of sf.statements) {
          if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === interfaceName) {
            for (const member of stmt.members) {
              if (
                (ts.isMethodSignature(member) || ts.isPropertySignature(member)) &&
                ts.isIdentifier(member.name) &&
                member.name.text === methodName &&
                member.type
              ) {
                // Extract the type constructor from the return type annotation.
                // For `Effect.Effect<A>`, the type reference is a qualified name.
                // For `IO<A>`, it's a simple identifier.
                const returnType = member.type;
                if (ts.isTypeReferenceNode(returnType)) {
                  if (ts.isQualifiedName(returnType.typeName)) {
                    // Effect.Effect<A> → "Effect"
                    return returnType.typeName.left.getText(sf);
                  }
                  if (ts.isIdentifier(returnType.typeName)) {
                    // IO<A> → "IO"
                    return returnType.typeName.text;
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return undefined;
}

// ============================================================================
// Independence Validation (for par:)
// ============================================================================

/**
 * Collect all identifiers referenced in an expression (deep scan).
 * Used to validate that par: bindings are independent.
 */
export function collectReferencedIdentifiers(expr: ts.Expression): Set<string> {
  const refs = new Set<string>();

  function walk(node: ts.Node): void {
    if (ts.isIdentifier(node)) {
      refs.add(node.text);
    }
    ts.forEachChild(node, walk);
  }

  walk(expr);
  return refs;
}

// ============================================================================
// Code Generation Helpers
// ============================================================================

/**
 * Create an arrow function: `(param) => body`
 */
export function createArrowFn(
  factory: ts.NodeFactory,
  paramName: string,
  body: ts.Expression
): ts.ArrowFunction {
  return factory.createArrowFunction(
    undefined,
    undefined,
    [factory.createParameterDeclaration(undefined, undefined, factory.createIdentifier(paramName))],
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    body
  );
}

/**
 * Create a method call: `expr.method(arg)`
 */
export function createMethodCall(
  factory: ts.NodeFactory,
  expr: ts.Expression,
  method: string,
  arg: ts.Expression
): ts.CallExpression {
  return factory.createCallExpression(
    factory.createPropertyAccessExpression(expr, factory.createIdentifier(method)),
    undefined,
    [arg]
  );
}

/**
 * Create an IIFE: `((param) => body)(arg)`
 *
 * Used for pure map steps to inline computations.
 */
export function createIIFE(
  factory: ts.NodeFactory,
  paramName: string,
  body: ts.Expression,
  arg: ts.Expression
): ts.CallExpression {
  return factory.createCallExpression(
    factory.createParenthesizedExpression(createArrowFn(factory, paramName, body)),
    undefined,
    [arg]
  );
}
