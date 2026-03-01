/**
 * @compiled Attribute Macro — Effect.gen to flatMap compilation
 *
 * Transforms generator-based Effect.gen calls into direct flatMap chains,
 * eliminating generator protocol overhead for zero-cost abstraction.
 *
 * Input:
 * ```typescript
 * @compiled
 * const createUser = (user: UserCreate) =>
 *   Effect.gen(function*() {
 *     const account = yield* accountRepo.insert(Account.make({}))
 *     const accessToken = yield* uuid.generate
 *     const newUser = yield* userRepo.insert(User.make({ ...user, accountId: account.id, accessToken }))
 *     return new UserWithSensitive({ ...newUser, account })
 *   })
 * ```
 *
 * Output:
 * ```typescript
 * const createUser = (user: UserCreate) =>
 *   Effect.flatMap(accountRepo.insert(Account.make({})), (account) =>
 *     Effect.flatMap(uuid.generate, (accessToken) =>
 *       Effect.map(userRepo.insert(User.make({ ...user, accountId: account.id, accessToken })), (newUser) =>
 *         new UserWithSensitive({ ...newUser, account })
 *       )
 *     )
 *   )
 * ```
 *
 * Also provides `compileGen(expr)` expression macro for inline transformation:
 * ```typescript
 * const result = compileGen(Effect.gen(function*() { ... }))
 * ```
 *
 * @module
 */

import * as ts from "typescript";
import {
  type MacroContext,
  defineAttributeMacro,
  defineExpressionMacro,
} from "@typesugar/core";

/**
 * Information about a yield* statement in the generator.
 */
interface YieldBinding {
  /** Variable name bound by the yield (e.g., "account" in "const account = yield* ...") */
  name: string;
  /** The Effect expression being yielded (e.g., "accountRepo.insert(...)") */
  effect: ts.Expression;
  /** Whether this is the last binding (uses map instead of flatMap) */
  isLast: boolean;
}

/**
 * Parse a generator function body to extract yield bindings and final return.
 */
function parseGeneratorBody(
  ctx: MacroContext,
  body: ts.Block
): { bindings: YieldBinding[]; returnExpr: ts.Expression | null } {
  const bindings: YieldBinding[] = [];
  let returnExpr: ts.Expression | null = null;

  for (const statement of body.statements) {
    // Handle: const x = yield* effect
    if (
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.length === 1
    ) {
      const decl = statement.declarationList.declarations[0];
      if (
        ts.isIdentifier(decl.name) &&
        decl.initializer &&
        ts.isYieldExpression(decl.initializer) &&
        decl.initializer.asteriskToken &&
        decl.initializer.expression
      ) {
        bindings.push({
          name: decl.name.text,
          effect: decl.initializer.expression,
          isLast: false,
        });
        continue;
      }
    }

    // Handle: yield* effect (without binding)
    if (
      ts.isExpressionStatement(statement) &&
      ts.isYieldExpression(statement.expression) &&
      statement.expression.asteriskToken &&
      statement.expression.expression
    ) {
      // Generate a unique name for ignored binding
      bindings.push({
        name: `_ignored_${bindings.length}`,
        effect: statement.expression.expression,
        isLast: false,
      });
      continue;
    }

    // Handle: return expr
    if (ts.isReturnStatement(statement) && statement.expression) {
      returnExpr = statement.expression;
      continue;
    }

    // Handle: if (condition) { ... } (guards)
    // TODO: Transform to Effect.if or Effect.when
    if (ts.isIfStatement(statement)) {
      ctx.reportWarning(
        statement,
        "@compiled: if statements in Effect.gen are not yet supported. Use Effect.if or Effect.when instead."
      );
    }
  }

  // Mark the last binding as using map instead of flatMap
  if (bindings.length > 0 && returnExpr) {
    bindings[bindings.length - 1].isLast = true;
  }

  return { bindings, returnExpr };
}

/**
 * Build nested flatMap/map chain from bindings and return expression.
 */
function buildFlatMapChain(
  ctx: MacroContext,
  bindings: YieldBinding[],
  returnExpr: ts.Expression
): ts.Expression {
  const factory = ctx.factory;

  if (bindings.length === 0) {
    // No bindings, just Effect.succeed(returnExpr)
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("Effect"),
        factory.createIdentifier("succeed")
      ),
      undefined,
      [returnExpr]
    );
  }

  // Build from inside out (last binding first)
  let result: ts.Expression = returnExpr;

  for (let i = bindings.length - 1; i >= 0; i--) {
    const binding = bindings[i];
    const isLast = i === bindings.length - 1;

    // Create lambda: (name) => ...
    const lambda = factory.createArrowFunction(
      undefined,
      undefined,
      [
        factory.createParameterDeclaration(
          undefined,
          undefined,
          factory.createIdentifier(binding.name),
          undefined,
          undefined,
          undefined
        ),
      ],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      result
    );

    // Wrap in Effect.map or Effect.flatMap
    const methodName = isLast ? "map" : "flatMap";
    result = factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("Effect"),
        factory.createIdentifier(methodName)
      ),
      undefined,
      [binding.effect, lambda]
    );
  }

  return result;
}

/**
 * Check if an expression is an Effect.gen call.
 */
function isEffectGenCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;

  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;

  const obj = callee.expression;
  const prop = callee.name;

  return (
    ts.isIdentifier(obj) &&
    obj.text === "Effect" &&
    ts.isIdentifier(prop) &&
    prop.text === "gen"
  );
}

/**
 * Extract the generator function from an Effect.gen call.
 */
function extractGeneratorFunction(
  call: ts.CallExpression
): ts.FunctionExpression | null {
  if (call.arguments.length === 0) return null;

  const arg = call.arguments[0];
  if (ts.isFunctionExpression(arg) && arg.asteriskToken) {
    return arg;
  }

  return null;
}

/**
 * Transform an Effect.gen call into a flatMap chain.
 */
function transformEffectGen(
  ctx: MacroContext,
  call: ts.CallExpression
): ts.Expression | null {
  const genFn = extractGeneratorFunction(call);
  if (!genFn || !genFn.body) {
    ctx.reportError(
      call,
      "@compiled: Expected Effect.gen(function*() { ... }) with a function body"
    );
    return null;
  }

  const { bindings, returnExpr } = parseGeneratorBody(ctx, genFn.body);

  if (!returnExpr) {
    ctx.reportError(
      call,
      "@compiled: Effect.gen must have a return statement"
    );
    return null;
  }

  return buildFlatMapChain(ctx, bindings, returnExpr);
}

/**
 * Recursively transform all Effect.gen calls in an expression tree.
 */
function transformExpression(
  ctx: MacroContext,
  node: ts.Node
): ts.Node {
  // If this is an Effect.gen call, transform it
  if (isEffectGenCall(node)) {
    const transformed = transformEffectGen(ctx, node);
    if (transformed) {
      return transformed;
    }
  }

  // Otherwise, recursively transform children
  return ts.visitEachChild(
    node,
    (child) => transformExpression(ctx, child) as ts.Node,
    ctx.transformContext
  );
}

// ============================================================================
// @compiled Attribute Macro
// ============================================================================

/**
 * @compiled attribute macro.
 *
 * Transforms all Effect.gen calls in the decorated declaration into flatMap chains.
 */
export const compiledAttribute = defineAttributeMacro({
  name: "compiled",
  module: "@typesugar/effect",
  description: "Compile Effect.gen to direct flatMap chains for zero-cost abstraction",
  validTargets: ["property", "function"],

  expand(ctx, decorator, target) {
    // Transform the target declaration
    const transformed = transformExpression(ctx, target);
    return transformed as ts.Node;
  },
});

// ============================================================================
// compileGen() Expression Macro
// ============================================================================

/**
 * compileGen(expr) expression macro.
 *
 * Transforms a single Effect.gen call into a flatMap chain.
 *
 * @example
 * ```typescript
 * const result = compileGen(Effect.gen(function*() {
 *   const x = yield* getX()
 *   const y = yield* getY(x)
 *   return x + y
 * }))
 * // Transforms to:
 * // Effect.flatMap(getX(), (x) => Effect.map(getY(x), (y) => x + y))
 * ```
 */
export const compileGenExpression = defineExpressionMacro({
  name: "compileGen",
  module: "@typesugar/effect",
  description: "Compile an Effect.gen call to a direct flatMap chain",

  expand(ctx, call, args) {
    if (args.length !== 1) {
      ctx.reportError(call, "compileGen() expects exactly one argument");
      return call;
    }

    const arg = args[0];

    // Check if argument is an Effect.gen call
    if (!isEffectGenCall(arg)) {
      ctx.reportError(
        arg,
        "compileGen() argument must be an Effect.gen(function*() { ... }) call"
      );
      return call;
    }

    const transformed = transformEffectGen(ctx, arg);
    if (!transformed) {
      return call;
    }

    return transformed;
  },
});

// ============================================================================
// Runtime placeholders (for type checking before transformation)
// ============================================================================

/**
 * Runtime placeholder for compileGen macro.
 * This is replaced at compile time with the transformed expression.
 */
export function compileGen<A, E, R>(
  _effect: import("effect").Effect.Effect<A, E, R>
): import("effect").Effect.Effect<A, E, R> {
  throw new Error(
    "compileGen() requires the typesugar transformer. Configure it in your build tool."
  );
}

/**
 * Decorator placeholder for @compiled.
 * This is replaced at compile time with the transformed declaration.
 */
export function compiled<T>(
  target: T,
  _context?: ClassDecoratorContext | ClassMethodDecoratorContext | ClassFieldDecoratorContext
): T {
  console.warn("@compiled decorator requires the typesugar transformer.");
  return target;
}
