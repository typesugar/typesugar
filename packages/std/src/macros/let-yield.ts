/**
 * let:/yield: Labeled Block Macro
 *
 * Generic do-notation style syntax that works with any type that has a
 * FlatMap instance. Desugars `let: { x << expr }` blocks into flatMap chains.
 *
 * ## Syntax
 *
 * ```typescript
 * let: {
 *   x << expr1           // Monadic bind: flatMap
 *   y = x * 2            // Pure map: inline computation
 *   _ << sideEffect()    // Discard: bind but ignore result
 *   z << expr2 || alt    // orElse: fallback on failure
 *   if (condition) {}    // Guard: short-circuit on false
 * }
 * yield: { resultExpr }
 * ```
 *
 * ## Examples
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
 * // With guards and orElse
 * let: {
 *   x << someOption
 *   if (x > 0) {}           // Guards: short-circuit if false
 *   y << getY() || default  // orElse: fallback on failure
 * }
 * yield: (x + y)
 *
 * // Implicit yield (returns last binding)
 * let: {
 *   x << Some(42)
 * }
 * // Returns Some(42) directly
 * ```
 *
 * ## How it works
 *
 * 1. The macro parses steps from the `let:` block (binds, maps, guards)
 * 2. It infers the type constructor from the first bind's expression
 * 3. It looks up the FlatMap instance for that type constructor
 * 4. It generates a chain: flatMap for intermediate binds, map for the last
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
import { findInstance, getFlatMapMethodNames, hasFlatMapInstance } from "@typesugar/macros";
import {
  type ComprehensionStep,
  type BindStep,
  type MapStep,
  type GuardStep,
  extractReturnExpr,
  inferTypeConstructor,
  createArrowFn,
  createMethodCall,
  createIIFE,
} from "./comprehension-utils.js";

/**
 * Method names for FlatMap operations.
 * Different types may use different method names (e.g., Promise uses "then").
 */
interface MethodNames {
  bind: string;
  map: string;
  orElse?: string;
}

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

    // The main block must be a Block
    if (!ts.isBlock(mainBlock.statement)) {
      ctx.reportError(mainBlock, "let: must be followed by a block { ... }");
      return mainBlock;
    }

    // Extract steps from the let block
    const steps = extractSteps(ctx, mainBlock.statement);
    if (!steps || steps.length === 0) {
      ctx.reportError(mainBlock, "let: block must contain at least one binding or guard");
      return mainBlock;
    }

    // Must have at least one bind step
    const hasBindStep = steps.some((s): s is BindStep => s.kind === "bind");
    if (!hasBindStep) {
      ctx.reportError(
        mainBlock,
        "let: block must contain at least one `name << expression` binding"
      );
      return mainBlock;
    }

    // Infer the type constructor from the first bind step
    const firstBind = steps.find((s): s is BindStep => s.kind === "bind")!;
    const typeConstructorName = inferTypeConstructor(firstBind.effect, typeChecker);

    if (!typeConstructorName) {
      ctx.reportError(
        firstBind.effect,
        "Could not infer type constructor from expression. " +
          "Make sure the expression has a known type (Array, Promise, Option, etc.)"
      );
      return mainBlock;
    }

    // Look up the FlatMap instance in unified registry
    if (!hasFlatMapInstance(typeConstructorName)) {
      ctx.reportError(
        firstBind.effect,
        `No FlatMap instance registered for '${typeConstructorName}'. ` +
          "Use @instance decorator or registerFlatMap() to register an instance."
      );
      return mainBlock;
    }

    // Determine method names from unified registry
    const methods = getFlatMapMethodNames(typeConstructorName);

    // Handle yield expression or implicit return
    let returnExpr: ts.Expression;
    if (continuation) {
      if (!ts.isBlock(continuation.statement)) {
        ctx.reportError(
          continuation,
          `${continuation.label.text}: must be followed by a block { ... }`
        );
        return mainBlock;
      }

      const extracted = extractReturnExpr(ctx, continuation.statement);
      if (!extracted) {
        return mainBlock;
      }
      returnExpr = extracted;
    } else {
      // No yield/pure block — return the last bind step's result directly
      const lastBind = [...steps].reverse().find((s): s is BindStep => s.kind === "bind");
      if (!lastBind) {
        ctx.reportError(mainBlock, "No bind step found for implicit return");
        return mainBlock;
      }

      // Remove the last bind from steps and use its expression as the tail
      const stepsWithoutLast = steps.slice(0, steps.lastIndexOf(lastBind));
      if (stepsWithoutLast.length === 0) {
        // Only one bind step — just return the expression directly
        return factory.createExpressionStatement(lastBind.effect);
      }
      const chain = buildChain(
        ctx,
        stepsWithoutLast,
        lastBind.effect,
        methods,
        typeConstructorName
      );
      return factory.createExpressionStatement(chain);
    }

    // Build the chain
    const result = buildChain(ctx, steps, returnExpr, methods, typeConstructorName);

    return factory.createExpressionStatement(result);
  },
});

// ============================================================================
// Step Extraction
// ============================================================================

/**
 * Extract comprehension steps from a block statement.
 *
 * Handles:
 * - `name << expr` — bind step
 * - `name << expr || alt` — bind with orElse
 * - `name << expr ?? alt` — bind with nullish coalescing fallback
 * - `_ << expr` — discard binding
 * - `name = expr` — pure map step
 * - `if (cond) {}` — guard step
 */
function extractSteps(ctx: MacroContext, block: ts.Block): ComprehensionStep[] | undefined {
  const steps: ComprehensionStep[] = [];

  for (const stmt of block.statements) {
    // Guard: if (condition) {}
    if (ts.isIfStatement(stmt)) {
      steps.push({
        kind: "guard",
        condition: stmt.expression,
        node: stmt,
      });
      continue;
    }

    if (!ts.isExpressionStatement(stmt)) {
      ctx.reportError(
        stmt,
        "let: block statements must be `name << expr`, `name = expr`, or `if (cond) {}`"
      );
      return undefined;
    }

    const expr = stmt.expression;

    if (!ts.isBinaryExpression(expr)) {
      ctx.reportError(stmt, "Expected `name << expression` or `name = expression`");
      return undefined;
    }

    const opKind = expr.operatorToken.kind;

    // Pure map: name = expr
    // Note: EqualsToken (63) === FirstAssignment - they're the same value
    if (opKind === ts.SyntaxKind.FirstAssignment) {
      if (!ts.isIdentifier(expr.left)) {
        ctx.reportError(expr.left, "Left side of = must be an identifier");
        return undefined;
      }
      steps.push({
        kind: "map",
        name: expr.left.text,
        expression: expr.right,
        node: stmt,
      });
      continue;
    }

    // Monadic bind with orElse: name << expr || fallback
    // Due to operator precedence, `name << expr || fallback` parses as
    // (name << expr) || fallback — a BinaryExpression with || at the top.
    if (opKind === ts.SyntaxKind.BarBarToken) {
      const lhs = expr.left;
      if (
        ts.isBinaryExpression(lhs) &&
        lhs.operatorToken.kind === ts.SyntaxKind.LessThanLessThanToken &&
        ts.isIdentifier(lhs.left)
      ) {
        steps.push({
          kind: "bind",
          name: lhs.left.text,
          effect: lhs.right,
          orElse: expr.right,
          node: stmt,
        });
        continue;
      }
    }

    // Monadic bind with nullish coalescing: name << expr ?? fallback
    if (opKind === ts.SyntaxKind.QuestionQuestionToken) {
      const lhs = expr.left;
      if (
        ts.isBinaryExpression(lhs) &&
        lhs.operatorToken.kind === ts.SyntaxKind.LessThanLessThanToken &&
        ts.isIdentifier(lhs.left)
      ) {
        steps.push({
          kind: "bind",
          name: lhs.left.text,
          effect: lhs.right,
          orElse: expr.right,
          node: stmt,
        });
        continue;
      }
    }

    // Plain bind: name << expr
    if (opKind === ts.SyntaxKind.LessThanLessThanToken) {
      if (!ts.isIdentifier(expr.left)) {
        ctx.reportError(expr.left, "Left side of << must be an identifier (variable name or _)");
        return undefined;
      }
      steps.push({
        kind: "bind",
        name: expr.left.text,
        effect: expr.right,
        node: stmt,
      });
      continue;
    }

    ctx.reportError(stmt, "Expected `name << expression`, `name = expression`, or `if (cond) {}`");
    return undefined;
  }

  return steps;
}

// ============================================================================
// Method Name Resolution (now uses unified registry)
// ============================================================================

// Method names are now resolved via getFlatMapMethodNames() from @typesugar/macros
// which looks up the InstanceMeta in the unified typeclass registry.

// ============================================================================
// Chain Building
// ============================================================================

/**
 * Build the comprehension chain from steps and a return expression.
 *
 * Handles:
 * - bind steps → `.flatMap(name => ...)` or `.then(name => ...)` for intermediates,
 *                `.map(name => ...)` for the last bind
 * - map steps → inlined as IIFEs `((name) => inner)(expr)`
 * - guard steps → ternary `cond ? inner : undefined`
 * - orElse → wraps the bind expression with `.orElse(() => fallback)`
 */
function buildChain(
  ctx: MacroContext,
  steps: ComprehensionStep[],
  returnExpr: ts.Expression,
  methods: MethodNames,
  typeConstructor: string
): ts.Expression {
  const { factory } = ctx;

  if (steps.length === 0) {
    return returnExpr;
  }

  // Build from inside out: start with the return expression and wrap
  // each step around it, going from the last step to the first.
  let inner: ts.Expression = returnExpr;

  // Process steps from last to first
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];

    switch (step.kind) {
      case "bind": {
        // Determine method: last bind before return uses map, others use flatMap
        const remainingBinds = steps.slice(i + 1).filter((s) => s.kind === "bind");
        const isLastBind = remainingBinds.length === 0;
        const methodName = isLastBind ? methods.map : methods.bind;

        let effectExpr = step.effect;

        // Wrap with orElse if present
        if (step.orElse && methods.orElse) {
          effectExpr = createMethodCall(
            factory,
            effectExpr,
            methods.orElse,
            createArrowFn(factory, "_", step.orElse)
          );
        }

        // Generate the method call
        inner = generateMethodCall(
          factory,
          effectExpr,
          methodName,
          step.name,
          inner,
          typeConstructor
        );
        break;
      }

      case "map": {
        // Pure map step: wrap inner in an IIFE that binds the computed value.
        // ((name) => inner)(expr)
        inner = createIIFE(factory, step.name, inner, step.expression);
        break;
      }

      case "guard": {
        // Guard step: emit a ternary `cond ? inner : undefined`
        // The short-circuit happens at runtime; undefined propagates as empty/failure
        inner = factory.createConditionalExpression(
          step.condition,
          factory.createToken(ts.SyntaxKind.QuestionToken),
          inner,
          factory.createToken(ts.SyntaxKind.ColonToken),
          factory.createIdentifier("undefined")
        );
        break;
      }
    }
  }

  return inner;
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
    return createMethodCall(factory, expr, methodName, createArrowFn(factory, paramName, body));
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
      [expr, createArrowFn(factory, paramName, body)]
    );
  }

  // For other types with FlatMap instances, use native method calls
  // (most types like Option, Either, IO have .map()/.flatMap() methods)
  return createMethodCall(factory, expr, methodName, createArrowFn(factory, paramName, body));
}

// ============================================================================
// Registration
// ============================================================================

/**
 * Register the let:/yield: macro with the global registry.
 */
export function registerLetYield(): void {
  globalRegistry.register(letYieldMacro);
}

// Auto-register on import
registerLetYield();
