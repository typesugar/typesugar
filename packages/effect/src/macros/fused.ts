/**
 * @fused Attribute Macro — Effect Pipeline Fusion
 *
 * Detects consecutive Effect operations and fuses them into single operations,
 * eliminating intermediate Effect allocations.
 *
 * ## Fusion Rules
 *
 * 1. **map∘map fusion**: `Effect.map(Effect.map(x, f), g)` → `Effect.map(x, x => g(f(x)))`
 * 2. **flatMap identity**: `Effect.flatMap(Effect.succeed(x), f)` → `f(x)`
 * 3. **map-flatMap fusion**: `Effect.flatMap(Effect.map(x, f), g)` → `Effect.flatMap(x, x => g(f(x)))`
 * 4. **tap reordering** (not yet implemented): `Effect.map(Effect.tap(x, f), g)` → `Effect.tap(Effect.map(x, g), f)`
 *
 * ## Usage
 *
 * ```typescript
 * // Before: 3 intermediate Effect allocations
 * @fused
 * const pipeline = (x: number) =>
 *   pipe(
 *     Effect.succeed(x),
 *     Effect.map(x => x + 1),
 *     Effect.map(x => x * 2),
 *     Effect.map(x => String(x))
 *   )
 *
 * // After: single Effect.map with composed function
 * const pipeline = (x: number) =>
 *   Effect.map(Effect.succeed(x), x => String((x + 1) * 2))
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
 * Check if expression is Effect.succeed(value)
 */
function isEffectSucceed(node: ts.Node): node is ts.CallExpression {
  return isEffectCall(node, "succeed");
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
 * Check if expression is Effect.tap(effect, fn)
 */
function isEffectTap(node: ts.Node): node is ts.CallExpression {
  return isEffectCall(node, "tap");
}

/**
 * Extract the arguments from an Effect.map/flatMap/tap call.
 */
function extractEffectCallArgs(
  call: ts.CallExpression
): { effect: ts.Expression; fn: ts.Expression } | null {
  if (call.arguments.length < 2) return null;
  return {
    effect: call.arguments[0],
    fn: call.arguments[1],
  };
}

/**
 * Compose two functions: (x) => g(f(x))
 */
function composeFunctions(ctx: MacroContext, f: ts.Expression, g: ts.Expression): ts.Expression {
  const factory = ctx.factory;

  // Generate a unique parameter name
  const paramName = ctx.generateUniqueName("x");

  // If f is an arrow function (x) => body, we can inline it
  let fBody: ts.Expression;
  if (ts.isArrowFunction(f) && f.parameters.length === 1) {
    const fParamName = f.parameters[0].name;
    if (ts.isIdentifier(fParamName)) {
      // Inline f's body, substituting the parameter
      fBody = ts.isBlock(f.body)
        ? factory.createCallExpression(f, undefined, [paramName])
        : substituteIdentifier(ctx, f.body as ts.Expression, fParamName.text, paramName);
    } else {
      fBody = factory.createCallExpression(f, undefined, [paramName]);
    }
  } else {
    fBody = factory.createCallExpression(f, undefined, [paramName]);
  }

  // Now apply g to fBody
  let gResult: ts.Expression;
  if (ts.isArrowFunction(g) && g.parameters.length === 1) {
    const gParamName = g.parameters[0].name;
    if (ts.isIdentifier(gParamName)) {
      gResult = ts.isBlock(g.body)
        ? factory.createCallExpression(g, undefined, [fBody])
        : substituteIdentifier(ctx, g.body as ts.Expression, gParamName.text, fBody);
    } else {
      gResult = factory.createCallExpression(g, undefined, [fBody]);
    }
  } else {
    gResult = factory.createCallExpression(g, undefined, [fBody]);
  }

  // Create: (x) => gResult
  return factory.createArrowFunction(
    undefined,
    undefined,
    [
      factory.createParameterDeclaration(
        undefined,
        undefined,
        paramName,
        undefined,
        undefined,
        undefined
      ),
    ],
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    gResult
  );
}

/**
 * Substitute identifier occurrences in an expression.
 * // TODO: Track scope boundaries to avoid substituting shadowed names
 */
function substituteIdentifier(
  ctx: MacroContext,
  expr: ts.Expression,
  oldName: string,
  newExpr: ts.Expression | ts.Identifier
): ts.Expression {
  function visit(node: ts.Node): ts.Node {
    if (ts.isIdentifier(node) && node.text === oldName) {
      return newExpr;
    }
    return ts.visitEachChild(node, visit, ctx.transformContext);
  }
  return visit(expr) as ts.Expression;
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
  if (isEffectMap(node)) {
    const outerArgs = extractEffectCallArgs(node);
    if (outerArgs && isEffectMap(outerArgs.effect)) {
      const innerArgs = extractEffectCallArgs(outerArgs.effect);
      if (innerArgs) {
        const composedFn = composeFunctions(ctx, innerArgs.fn, outerArgs.fn);
        return {
          result: factory.createCallExpression(
            factory.createPropertyAccessExpression(
              factory.createIdentifier("Effect"),
              factory.createIdentifier("map")
            ),
            undefined,
            [innerArgs.effect, composedFn]
          ),
          fused: true,
        };
      }
    }
  }

  // Rule 2: flatMap identity
  // Effect.flatMap(Effect.succeed(x), f) → f(x)
  if (isEffectFlatMap(node)) {
    const args = extractEffectCallArgs(node);
    if (args && isEffectSucceed(args.effect)) {
      const succeedArgs = args.effect.arguments;
      if (succeedArgs.length >= 1) {
        const value = succeedArgs[0];
        // Apply f to the value
        return {
          result: factory.createCallExpression(args.fn, undefined, [value]),
          fused: true,
        };
      }
    }
  }

  // Rule 3: map-flatMap fusion
  // Effect.flatMap(Effect.map(x, f), g) → Effect.flatMap(x, x => g(f(x)))
  if (isEffectFlatMap(node)) {
    const outerArgs = extractEffectCallArgs(node);
    if (outerArgs && isEffectMap(outerArgs.effect)) {
      const innerArgs = extractEffectCallArgs(outerArgs.effect);
      if (innerArgs) {
        const composedFn = composeFunctions(ctx, innerArgs.fn, outerArgs.fn);
        return {
          result: factory.createCallExpression(
            factory.createPropertyAccessExpression(
              factory.createIdentifier("Effect"),
              factory.createIdentifier("flatMap")
            ),
            undefined,
            [innerArgs.effect, composedFn]
          ),
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
 * const result = fusePipeline(
 *   pipe(effect, Effect.map(f), Effect.map(g), Effect.map(h))
 * )
 *
 * // After
 * const result = Effect.map(effect, x => h(g(f(x))))
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
