/**
 * @compiled Attribute Macro — Effect.gen to flatMap compilation
 *
 * Transforms generator-based Effect.gen calls into direct flatMap chains,
 * eliminating generator protocol overhead.
 *
 * **Experimental.** Only straight-line generator bodies are compiled:
 * top-level `const x = yield* e`, `yield* e`, `return ...` and ordinary
 * statements with no `yield`/`return` inside them (kept in order). Anything
 * else — yields inside `if`/loops/`try`, `this`/`arguments`, a generator with
 * parameters — is a compile error; the `Effect.gen` is left as written.
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
 *   Effect.suspend(() => Effect.flatMap(accountRepo.insert(Account.make({})), (account) =>
 *     Effect.flatMap(uuid.generate, (accessToken) =>
 *       Effect.map(userRepo.insert(User.make({ ...user, accountId: account.id, accessToken })), (newUser) =>
 *         new UserWithSensitive({ ...newUser, account })
 *       )
 *     )
 *   ))
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
import { type MacroContext, defineAttributeMacro, defineExpressionMacro } from "@typesugar/core";

/**
 * Find the first construct in `node` that the straight-line compiler can't
 * translate faithfully: a `yield`/`return` that isn't at the top level of the
 * generator body (inside `if`/loops/`try`/expressions), or `this`/`arguments`
 * (whose meaning changes once the body is split into arrow continuations).
 * Nested non-arrow functions are opaque (their yields/returns/this are their
 * own); arrow functions are opaque for yield/return but not for this/arguments.
 */
function findUnsupported(node: ts.Node): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (n: ts.Node, inArrow: boolean): void => {
    if (found) return;
    if (
      ts.isFunctionDeclaration(n) ||
      ts.isFunctionExpression(n) ||
      ts.isMethodDeclaration(n) ||
      ts.isAccessor(n) ||
      ts.isConstructorDeclaration(n) ||
      ts.isClassStaticBlockDeclaration(n)
    ) {
      return;
    }
    if (ts.isPropertyDeclaration(n)) return; // class field initializers have their own `this`
    if (!inArrow && (ts.isYieldExpression(n) || ts.isReturnStatement(n))) {
      found = n;
      return;
    }
    if (n.kind === ts.SyntaxKind.ThisKeyword || (ts.isIdentifier(n) && n.text === "arguments")) {
      found = n;
      return;
    }
    ts.forEachChild(n, (c) => visit(c, inArrow || ts.isArrowFunction(n)));
  };
  visit(node, false);
  return found;
}

class UnsupportedGenError extends Error {
  constructor(
    public readonly node: ts.Node,
    message: string
  ) {
    super(message);
  }
}

/** `yield* e` with no nested unsupported constructs → `e`. */
function asYieldStar(expr: ts.Expression | undefined): ts.Expression | undefined {
  if (!expr) return undefined;
  let e = expr;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isYieldExpression(e) && e.asteriskToken && e.expression) {
    const bad = findUnsupported(e.expression);
    if (bad)
      throw new UnsupportedGenError(bad, "nested yield/this/arguments inside a yield* operand");
    return e.expression;
  }
  return undefined;
}

/**
 * Compile `statements[from..]` of a generator body into one Effect expression.
 *
 * - `const x = yield* e; rest` → `Effect.flatMap(e, (x) => rest)` (or
 *   `Effect.map(e, (x) => v)` when `rest` is just `return v`)
 * - `yield* e; rest`           → `Effect.flatMap(e, () => rest)`
 * - `return yield* e`          → `e`
 * - `return v`                 → `Effect.succeed(v)`
 * - falling off the end        → `Effect.void`
 * - any other statement with no yield/return in it is kept, in order, in the
 *   continuation's block body: `(x) => { stmt; stmt; return rest; }`
 *
 * Anything else (yields inside if/for/try/expressions, `return` inside a
 * block, `this`/`arguments`) throws UnsupportedGenError — the caller reports
 * it and leaves the `Effect.gen` untouched rather than silently dropping code.
 */
function compileStatements(
  ctx: MacroContext,
  effectId: ts.Expression,
  statements: readonly ts.Statement[],
  from: number
): { pure: ts.Statement[]; effect: ts.Expression; succeedValue?: ts.Expression } {
  const factory = ctx.factory;
  const call = (method: string, args: ts.Expression[]) =>
    factory.createCallExpression(
      factory.createPropertyAccessExpression(effectId, factory.createIdentifier(method)),
      undefined,
      args
    );
  const pure: ts.Statement[] = [];

  for (let i = from; i < statements.length; i++) {
    const stmt = statements[i];

    let bindName: ts.BindingName | undefined;
    let bound: ts.Expression | undefined;
    if (ts.isVariableStatement(stmt) && stmt.declarationList.declarations.length === 1) {
      const decl = stmt.declarationList.declarations[0];
      const e = asYieldStar(decl.initializer);
      if (e) {
        bindName = decl.name;
        bound = e;
      }
    } else if (ts.isExpressionStatement(stmt)) {
      bound = asYieldStar(stmt.expression);
    }

    if (bound) {
      const rest = compileStatements(ctx, effectId, statements, i + 1);
      const params = bindName
        ? [factory.createParameterDeclaration(undefined, undefined, bindName)]
        : [];
      const useMap = rest.pure.length === 0 && rest.succeedValue !== undefined;
      const body: ts.ConciseBody = useMap
        ? rest.succeedValue!
        : rest.pure.length === 0
          ? rest.effect
          : factory.createBlock([...rest.pure, factory.createReturnStatement(rest.effect)], true);
      const lambda = factory.createArrowFunction(
        undefined,
        undefined,
        params,
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        ts.isObjectLiteralExpression(body as ts.Node)
          ? factory.createParenthesizedExpression(body as ts.Expression)
          : body
      );
      return { pure, effect: call(useMap ? "map" : "flatMap", [bound, lambda]) };
    }

    if (ts.isReturnStatement(stmt)) {
      if (i !== statements.length - 1) {
        throw new UnsupportedGenError(statements[i + 1], "unreachable statements after return");
      }
      if (!stmt.expression) {
        return { pure, effect: factory.createPropertyAccessExpression(effectId, "void") };
      }
      const e = asYieldStar(stmt.expression);
      if (e) return { pure, effect: e };
      const bad = findUnsupported(stmt.expression);
      if (bad)
        throw new UnsupportedGenError(bad, "yield/this/arguments inside a return expression");
      return { pure, effect: call("succeed", [stmt.expression]), succeedValue: stmt.expression };
    }

    const bad = findUnsupported(stmt);
    if (bad) {
      throw new UnsupportedGenError(
        bad,
        ts.isYieldExpression(bad) || ts.isReturnStatement(bad)
          ? "yield*/return is only supported as a top-level statement of the generator body " +
              "(`const x = yield* e`, `yield* e`, `return ...`), not inside if/loops/try/expressions"
          : "`this`/`arguments` are not supported"
      );
    }
    pure.push(stmt);
  }

  return { pure, effect: factory.createPropertyAccessExpression(effectId, "void") };
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
    ts.isIdentifier(obj) && obj.text === "Effect" && ts.isIdentifier(prop) && prop.text === "gen"
  );
}

/**
 * Transform an Effect.gen call into a flatMap chain. Reports an error and
 * returns null (leaving the call as written) when the body uses anything the
 * straight-line compiler can't translate.
 *
 * The whole chain is wrapped in `Effect.suspend(() => ...)` so that, like
 * `Effect.gen`, nothing in the body (not even the first yielded expression)
 * runs until the Effect is executed — and runs again on every execution.
 */
function transformEffectGen(ctx: MacroContext, call: ts.CallExpression): ts.Expression | null {
  const genFn = call.arguments.length === 1 ? call.arguments[0] : undefined;
  if (
    !genFn ||
    !ts.isFunctionExpression(genFn) ||
    !genFn.asteriskToken ||
    genFn.parameters.length > 0 ||
    !genFn.body
  ) {
    ctx.reportError(
      call,
      "compileGen/@compiled: expected Effect.gen(function* () { ... }) with a single " +
        "parameterless generator function"
    );
    return null;
  }
  const effectId = (call.expression as ts.PropertyAccessExpression).expression;
  const factory = ctx.factory;

  let compiled: ReturnType<typeof compileStatements>;
  try {
    compiled = compileStatements(ctx, effectId, genFn.body.statements, 0);
  } catch (e) {
    if (e instanceof UnsupportedGenError) {
      ctx.reportError(
        e.node,
        `compileGen/@compiled cannot compile this Effect.gen body: ${e.message}. ` +
          "Remove compileGen()/@compiled here or restructure the generator."
      );
      return null;
    }
    throw e;
  }

  const body: ts.ConciseBody =
    compiled.pure.length === 0
      ? compiled.effect
      : factory.createBlock(
          [...compiled.pure, factory.createReturnStatement(compiled.effect)],
          true
        );
  return factory.createCallExpression(
    factory.createPropertyAccessExpression(effectId, factory.createIdentifier("suspend")),
    undefined,
    [
      factory.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        body
      ),
    ]
  );
}

/**
 * Recursively transform all Effect.gen calls in an expression tree.
 */
function transformExpression(ctx: MacroContext, node: ts.Node): ts.Node {
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
 * // Effect.suspend(() => Effect.flatMap(getX(), (x) => Effect.map(getY(x), (y) => x + y)))
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
      ctx.reportError(arg, "compileGen() argument must be an Effect.gen(function*() { ... }) call");
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
