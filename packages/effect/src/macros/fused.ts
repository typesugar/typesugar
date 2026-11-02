/**
 * @fused Attribute Macro — Effect Pipeline Fusion
 *
 * Detects consecutive Effect operations and fuses them into single operations,
 * eliminating intermediate Effect allocations.
 *
 * **Experimental.** Only the nested, data-first call form is recognised.
 *
 * ## Fusion Rules
 *
 * 1. **map∘map fusion**: `Effect.map(Effect.map(x, f), g)` → `Effect.map(x, compose(f, g))`
 * 2. **map-flatMap fusion**: `Effect.flatMap(Effect.map(x, f), g)` → `Effect.flatMap(x, compose(f, g))`
 *
 * `compose(f, g)` is `((f, g) => (x) => g(f(x)))(f, g)`: `f` and `g` are
 * evaluated once, in source order, and nothing is inlined by name.
 * `pipe(x, Effect.map(f), Effect.map(g))` (data-last) is NOT fused.
 *
 * ## Usage
 *
 * ```typescript
 * const pipeline = fusePipeline(
 *   Effect.map(Effect.map(Effect.succeed(1), (x) => x + 1), (x) => x * 2)
 * )
 * // → Effect.map(Effect.succeed(1), compose((x) => x + 1, (x) => x * 2))
 * ```
 *
 * Also provides `fusePipeline(expr)` for inline transformation.
 *
 * @module
 */

import * as ts from "typescript";
import { type MacroContext, defineAttributeMacro, defineExpressionMacro } from "@typesugar/core";

/**
 * Check if a call is Effect.method(...)
 */
function isEffectCall(node: ts.Node, methodName: string): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const obj = callee.expression;
  const prop = callee.name;
  return (
    ts.isIdentifier(obj) &&
    obj.text === "Effect" &&
    ts.isIdentifier(prop) &&
    prop.text === methodName
  );
}

/**
 * Check if expression is Effect.map(effect, fn)
 */
function isEffectMap(node: ts.Node): node is ts.CallExpression {
  return isEffectCall(node, "map");
}

/**
 * Check if expression is Effect.flatMap(effect, fn)
 */
function isEffectFlatMap(node: ts.Node): node is ts.CallExpression {
  return isEffectCall(node, "flatMap");
}

/**
 * Extract the arguments from an Effect.map/flatMap/tap call.
 */
function extractEffectCallArgs(
  call: ts.CallExpression
): { effect: ts.Expression; fn: ts.Expression } | null {
  // Only the data-first `Effect.map(self, f)` form.
  if (call.arguments.length !== 2) return null;
  if (call.arguments.some((a) => ts.isSpreadElement(a))) return null;
  return {
    effect: call.arguments[0],
    fn: call.arguments[1],
  };
}

/**
 * Compose two functions without changing evaluation semantics:
 *
 * ```typescript
 * ((f, g) => (x) => g(f(x)))(F, G)
 * ```
 *
 * `F` and `G` are evaluated exactly once, in their original order (as the
 * nested `Effect.map(Effect.map(e, F), G)` would), and each element runs `F`
 * once. An earlier version substituted `F`'s body into `G`'s by identifier
 * NAME, which rewrote property names/shorthand (`n => ({ n })`), captured
 * shadowed parameters and duplicated `F`'s side effects at every use.
 */
function composeFunctions(ctx: MacroContext, f: ts.Expression, g: ts.Expression): ts.Expression {
  const factory = ctx.factory;
  const fName = ctx.generateUniqueName("f");
  const gName = ctx.generateUniqueName("g");
  const xName = ctx.generateUniqueName("x");
  const param = (n: ts.Identifier) => factory.createParameterDeclaration(undefined, undefined, n);
  const composed = factory.createArrowFunction(
    undefined,
    undefined,
    [param(xName)],
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    factory.createCallExpression(gName, undefined, [
      factory.createCallExpression(fName, undefined, [xName]),
    ])
  );
  const composer = factory.createArrowFunction(
    undefined,
    undefined,
    [param(fName), param(gName)],
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    composed
  );
  return factory.createCallExpression(factory.createParenthesizedExpression(composer), undefined, [
    f,
    g,
  ]);
}

/**
 * Fuse a single level of Effect operations.
 * Returns the fused expression and whether any fusion occurred.
 */
function fuseEffectOps(
  ctx: MacroContext,
  node: ts.Expression
): { result: ts.Expression; fused: boolean } {
  const factory = ctx.factory;

  // Rule 1: map∘map fusion
  // Effect.map(Effect.map(x, f), g) → Effect.map(x, compose(f, g))
  // Rule 3: map-flatMap fusion
  // Effect.flatMap(Effect.map(x, f), g) → Effect.flatMap(x, compose(f, g))
  //
  // (There is intentionally no `Effect.flatMap(Effect.succeed(x), f) → f(x)`
  // rule: it ran `f` when the Effect was CONSTRUCTED instead of when it is run,
  // and every time it is run — an observable change for any effectful `f`.)
  if (isEffectMap(node) || isEffectFlatMap(node)) {
    const outerArgs = extractEffectCallArgs(node);
    if (outerArgs && isEffectMap(outerArgs.effect)) {
      const innerArgs = extractEffectCallArgs(outerArgs.effect);
      if (innerArgs) {
        const composedFn = composeFunctions(ctx, innerArgs.fn, outerArgs.fn);
        return {
          result: factory.updateCallExpression(node, node.expression, node.typeArguments, [
            innerArgs.effect,
            composedFn,
          ]),
          fused: true,
        };
      }
    }
  }

  // Rule 4: consecutive maps after pipe
  // pipe(x, Effect.map(f), Effect.map(g)) - handled by recursively fusing the result

  return { result: node, fused: false };
}

/**
 * Recursively fuse Effect operations until no more fusion is possible.
 */
function fuseRecursively(ctx: MacroContext, node: ts.Expression): ts.Expression {
  let current = node;
  let maxIterations = 100; // Prevent infinite loops

  while (maxIterations-- > 0) {
    const { result, fused } = fuseEffectOps(ctx, current);
    if (!fused) break;
    current = result;
  }

  return current;
}

/**
 * Transform all fuseable patterns in an expression tree.
 */
function transformWithFusion(ctx: MacroContext, node: ts.Node): ts.Node {
  // First transform children
  const transformed = ts.visitEachChild(
    node,
    (child) => transformWithFusion(ctx, child) as ts.Node,
    ctx.transformContext
  );

  // Then try to fuse at this level
  if (ts.isExpression(transformed)) {
    return fuseRecursively(ctx, transformed);
  }

  return transformed;
}

// ============================================================================
// @fused Attribute Macro
// ============================================================================

/**
 * @fused attribute macro.
 *
 * Transforms all Effect pipelines in the decorated declaration to eliminate
 * intermediate Effect allocations through fusion.
 */
export const fusedAttribute = defineAttributeMacro({
  name: "fused",
  module: "@typesugar/effect",
  description: "Fuse Effect pipelines to eliminate intermediate allocations",
  validTargets: ["property", "function"],

  expand(ctx, decorator, target) {
    const transformed = transformWithFusion(ctx, target);
    return transformed as ts.Node;
  },
});

// ============================================================================
// fusePipeline() Expression Macro
// ============================================================================

/**
 * fusePipeline(expr) expression macro.
 *
 * Fuses a single Effect pipeline expression.
 *
 * @example
 * ```typescript
 * // Before
 * const result = fusePipeline(Effect.map(Effect.map(Effect.map(effect, f), g), h))
 *
 * // After (f, g, h each evaluated once)
 * const result = Effect.map(effect, compose(compose(f, g), h))
 * ```
 */
export const fusePipelineExpression = defineExpressionMacro({
  name: "fusePipeline",
  module: "@typesugar/effect",
  description: "Fuse an Effect pipeline expression to eliminate intermediate allocations",

  expand(ctx, call, args) {
    if (args.length !== 1) {
      ctx.reportError(call, "fusePipeline() expects exactly one argument");
      return call;
    }

    const expr = args[0];
    return fuseRecursively(ctx, expr);
  },
});

// ============================================================================
// Runtime Placeholders
// ============================================================================

/**
 * Runtime placeholder for fusePipeline macro.
 */
export function fusePipeline<A, E, R>(
  _effect: import("effect").Effect.Effect<A, E, R>
): import("effect").Effect.Effect<A, E, R> {
  throw new Error(
    "fusePipeline() requires the typesugar transformer. Configure it in your build tool."
  );
}

/**
 * Decorator placeholder for @fused.
 */
export function fused<T>(
  target: T,
  _context?: ClassDecoratorContext | ClassMethodDecoratorContext | ClassFieldDecoratorContext
): T {
  console.warn("@fused decorator requires the typesugar transformer.");
  return target;
}
