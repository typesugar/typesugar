/**
 * let:/yield: Labeled Block Macro
 *
 * Generic do-notation style syntax that works with any type that has a
 * FlatMap instance. Desugars `let: { x << expr }` blocks into flatMap chains.
 *
 * ## Usage
 *
 * ```typescript
 * // With Array
 * let: {
 *   x << [1, 2, 3]
 *   y << [x * 10, x * 20]
 * }
 * yield: ({ x, y })
 * // Compiles to: [1,2,3].flatMap(x => [x*10, x*20].map(y => ({ x, y })))
 *
 * // With Promise
 * let: {
 *   user << fetchUser(id)
 *   posts << fetchPosts(user.id)
 * }
 * yield: ({ user, posts })
 * // Compiles to: fetchUser(id).then(user => fetchPosts(user.id).then(posts => ({ user, posts })))
 *
 * // With Option, Effect, IO, etc. — any type with a registered FlatMap instance
 * ```
 *
 * ## How it works
 *
 * 1. The macro parses bindings from the `let:` block (using `<<` operator)
 * 2. It infers the type constructor from the first binding's expression
 * 3. It looks up the FlatMap instance for that type constructor
 * 4. It generates a chain of flatMap calls, with map for the final binding
 *
 * ## Registering custom types
 *
 * ```typescript
 * import { registerFlatMap } from "@typesugar/std/typeclasses/flatmap";
 *
 * registerFlatMap("MyType", {
 *   map: (fa, f) => fa.map(f),
 *   flatMap: (fa, f) => fa.flatMap(f),
 * });
 * ```
 */

import * as ts from "typescript";
import {
  type LabeledBlockMacro,
  type MacroContext,
  defineLabeledBlockMacro,
  globalRegistry,
} from "@typesugar/core";
import { getFlatMap } from "../typeclasses/flatmap.js";

// ============================================================================
// let:/yield: Labeled Block Macro
// ============================================================================

/**
 * The let:/yield: macro transforms labeled block syntax into FlatMap chains.
 *
 * It resolves the FlatMap instance based on the type of the first binding,
 * then generates appropriate map/flatMap calls.
 */
export const letYieldMacro: LabeledBlockMacro = defineLabeledBlockMacro({
  name: "letYield",
  label: "let",
  continuationLabels: ["yield", "pure", "return"],
  expand(
    ctx: MacroContext,
    mainBlock: ts.LabeledStatement,
    continuation: ts.LabeledStatement | undefined
  ): ts.Statement | ts.Statement[] {
    const { factory, typeChecker } = ctx;

    if (!continuation) {
      ctx.reportError(
        mainBlock,
        "let: block requires a 'yield:', 'pure:', or 'return:' block after it"
      );
      return mainBlock;
    }

    // Parse bindings from the let block
    const bindings = parseBindingsFromBlock(mainBlock.statement, ctx);

    if (bindings.length === 0) {
      ctx.reportError(mainBlock, "let: block must contain at least one binding (x << expression)");
      return mainBlock;
    }

    // Get the yield expression
    const yieldExpr = extractYieldExpression(continuation.statement, ctx);
    if (!yieldExpr) {
      ctx.reportError(continuation, "yield: block must contain an expression");
      return mainBlock;
    }

    // Infer the type constructor from the first binding
    const firstEffect = bindings[0].effect;
    const typeConstructorName = inferTypeConstructor(firstEffect, typeChecker);

    if (!typeConstructorName) {
      ctx.reportError(
        firstEffect,
        "Could not infer type constructor from expression. " +
          "Make sure the expression has a known type (Array, Promise, Option, etc.)"
      );
      return mainBlock;
    }

    // Look up the FlatMap instance
    const flatMapInstance = getFlatMap(typeConstructorName);

    if (!flatMapInstance) {
      ctx.reportError(
        firstEffect,
        `No FlatMap instance registered for '${typeConstructorName}'. ` +
          "Use registerFlatMap() to register an instance."
      );
      return mainBlock;
    }

    // Generate the flatMap chain based on the type constructor
    const result = generateFlatMapChain(ctx, bindings, yieldExpr, typeConstructorName);

    return factory.createExpressionStatement(result);
  },
});

// ============================================================================
// Helper Types
// ============================================================================

interface Binding {
  name: string;
  effect: ts.Expression;
}

// ============================================================================
// Parsing Helpers
// ============================================================================

/**
 * Parse bindings from a block statement.
 * Expects expressions with << operator: { x << getX(); y << getY(x); }
 */
function parseBindingsFromBlock(stmt: ts.Statement, ctx: MacroContext): Binding[] {
  const bindings: Binding[] = [];

  if (ts.isBlock(stmt)) {
    for (const s of stmt.statements) {
      const binding = parseBindingStatement(s, ctx);
      if (binding) {
        bindings.push(binding);
      }
    }
  } else if (ts.isExpressionStatement(stmt)) {
    const binding = parseBindingFromExpression(stmt.expression, ctx);
    if (binding) {
      bindings.push(binding);
    }
  }

  return bindings;
}

/**
 * Parse a single binding from a statement.
 */
function parseBindingStatement(stmt: ts.Statement, ctx: MacroContext): Binding | undefined {
  if (ts.isExpressionStatement(stmt)) {
    return parseBindingFromExpression(stmt.expression, ctx);
  }

  if (ts.isVariableStatement(stmt)) {
    const decl = stmt.declarationList.declarations[0];
    if (decl && decl.initializer && ts.isIdentifier(decl.name)) {
      // Check if initializer is _ << effect — use the declaration name, not the left of <<
      if (
        ts.isBinaryExpression(decl.initializer) &&
        decl.initializer.operatorToken.kind === ts.SyntaxKind.LessThanLessThanToken
      ) {
        return {
          name: decl.name.text,
          effect: decl.initializer.right,
        };
      }
      // Or just a regular expression (use var name as binding name)
      return {
        name: decl.name.text,
        effect: decl.initializer,
      };
    }
  }

  return undefined;
}

/**
 * Parse binding from expression (x << effect format).
 */
function parseBindingFromExpression(expr: ts.Expression, ctx: MacroContext): Binding | undefined {
  if (
    ts.isBinaryExpression(expr) &&
    expr.operatorToken.kind === ts.SyntaxKind.LessThanLessThanToken
  ) {
    const left = expr.left;
    if (ts.isIdentifier(left)) {
      return {
        name: left.text,
        effect: expr.right,
      };
    } else {
      ctx.reportError(left, "Left side of << must be an identifier");
    }
  }
  return undefined;
}

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
 * Extract the yield expression from a block.
 */
function extractYieldExpression(stmt: ts.Statement, ctx: MacroContext): ts.Expression | undefined {
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
 */
function inferTypeConstructor(
  expr: ts.Expression,
  typeChecker: ts.TypeChecker
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

  return undefined;
}

// ============================================================================
// Code Generation
// ============================================================================

/**
 * Generate the flatMap chain for the bindings.
 *
 * For n bindings, generates:
 * - flatMap for bindings 0 to n-2
 * - map for binding n-1 (the last one)
 *
 * This produces: fa.flatMap(a => fb.flatMap(b => fc.map(c => yieldExpr)))
 *
 * **Design decision**: The last binding uses `map` (not `flatMap`), meaning the
 * yield expression is always "pure" — the result is automatically lifted into
 * the type constructor. This differs from Haskell/Scala do-notation where the
 * final expression is monadic. If users need flatMap semantics for the final
 * expression, they should add an extra binding:
 *
 * ```
 * let: { x << fa; result << monadicExpr(x) }
 * yield: result
 * ```
 *
 * ## Effect-TS Integration
 *
 * For Effect.Effect types, we use Effect's native flatMap/map methods which have
 * proper type inference for E (error) and R (requirements) accumulation:
 *
 * ```typescript
 * Effect.flatMap<A, B, E2, R2>(self: Effect<A, E, R>, f: (a: A) => Effect<B, E2, R2>): Effect<B, E | E2, R | R2>
 * ```
 *
 * This means the resulting type correctly shows the union of all errors and
 * requirements from all bound effects:
 *
 * ```typescript
 * let: {
 *   user << fetchUser(id);     // Effect<User, HttpError, HttpClient>
 *   posts << fetchPosts(user); // Effect<Post[], DbError, Database>
 * }
 * yield: ({ user, posts })
 * // Resulting type: Effect<{user: User, posts: Post[]}, HttpError | DbError, HttpClient | Database>
 * ```
 */
function generateFlatMapChain(
  ctx: MacroContext,
  bindings: Binding[],
  yieldExpr: ts.Expression,
  typeConstructor: string
): ts.Expression {
  const { factory } = ctx;

  // Build the chain from inside out, starting with the yield expression
  // wrapped in the innermost map call
  let result: ts.Expression = yieldExpr;

  // Process bindings from last to first
  for (let i = bindings.length - 1; i >= 0; i--) {
    const { name, effect } = bindings[i];
    const isLast = i === bindings.length - 1;

    // For the last binding, use map; for others, use flatMap
    const methodName = isLast ? "map" : "flatMap";

    // Generate: effect.methodName(name => result)
    // or for Array: effect.methodName(name => result)
    result = generateMethodCall(factory, effect, methodName, name, result, typeConstructor);
  }

  return result;
}

/**
 * Generate a method call: expr.method(param => body)
 *
 * For built-in types (Array, Promise), uses native method calls.
 * For Effect, uses Effect.flatMap/Effect.map for proper E/R type inference.
 * For custom types, generates instance.method(expr, param => body).
 */
function generateMethodCall(
  factory: ts.NodeFactory,
  expr: ts.Expression,
  methodName: string,
  paramName: string,
  body: ts.Expression,
  typeConstructor: string
): ts.Expression {
  // For Array and Promise, use native methods directly
  if (typeConstructor === "Array" || typeConstructor === "Promise") {
    // Promise uses .then() for both map and flatMap
    const actualMethod = typeConstructor === "Promise" ? "then" : methodName;

    return factory.createCallExpression(
      factory.createPropertyAccessExpression(expr, factory.createIdentifier(actualMethod)),
      undefined,
      [
        factory.createArrowFunction(
          undefined,
          undefined,
          [
            factory.createParameterDeclaration(
              undefined,
              undefined,
              factory.createIdentifier(paramName)
            ),
          ],
          undefined,
          factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          body
        ),
      ]
    );
  }

  // For Effect, use Effect.flatMap/Effect.map static methods
  // This preserves proper E (error) and R (requirements) type inference:
  //   Effect.flatMap(fa, f) infers Effect<B, E1 | E2, R1 | R2>
  if (typeConstructor === "Effect") {
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("Effect"),
        factory.createIdentifier(methodName)
      ),
      undefined,
      [
        expr,
        factory.createArrowFunction(
          undefined,
          undefined,
          [
            factory.createParameterDeclaration(
              undefined,
              undefined,
              factory.createIdentifier(paramName)
            ),
          ],
          undefined,
          factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          body
        ),
      ]
    );
  }

  // For custom types, generate: require("@typesugar/std/typeclasses/flatmap").getFlatMap("Type")!.method(expr, param => body)
  // Uses inline require() to avoid needing to inject import statements in macro output.
  return factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createNonNullExpression(
        factory.createCallExpression(
          factory.createPropertyAccessExpression(
            factory.createCallExpression(factory.createIdentifier("require"), undefined, [
              factory.createStringLiteral("@typesugar/std/typeclasses/flatmap"),
            ]),
            factory.createIdentifier("getFlatMap")
          ),
          undefined,
          [factory.createStringLiteral(typeConstructor)]
        )
      ),
      factory.createIdentifier(methodName)
    ),
    undefined,
    [
      expr,
      factory.createArrowFunction(
        undefined,
        undefined,
        [
          factory.createParameterDeclaration(
            undefined,
            undefined,
            factory.createIdentifier(paramName)
          ),
        ],
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        body
      ),
    ]
  );
}

// ============================================================================
// Registration
// ============================================================================

/**
 * Register the let:/yield: macro with the global registry.
 */
export function register(): void {
  globalRegistry.register(letYieldMacro);
}

// Auto-register on import
register();
