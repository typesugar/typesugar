/**
 * par:/yield: Labeled Block Macro
 *
 * Applicative (parallel) comprehension syntax. Unlike monadic `let:/yield:`,
 * all bindings in `par:` must be independent — no binding may reference a
 * previous binding's value.
 *
 * ## Syntax
 *
 * ```typescript
 * par: {
 *   a << expr1
 *   b << expr2
 *   c << expr3
 * }
 * yield: { f(a, b, c) }
 * ```
 *
 * ## Why use par: instead of let:?
 *
 * 1. **Parallel execution**: For Promises, `par:` emits `Promise.all([...])`,
 *    executing all effects concurrently. `let:` chains them sequentially.
 *
 * 2. **Error accumulation**: For Validation types, `par:` accumulates ALL errors
 *    from all bindings. `let:` short-circuits on the first error.
 *
 * 3. **Static independence check**: The macro validates at compile time that
 *    no binding depends on a previous binding, catching bugs early.
 *
 * ## Examples
 *
 * ```typescript
 * // Parallel Promises with Promise.all
 * par: {
 *   user   << fetchUser(id)
 *   config << loadConfig()
 *   posts  << fetchPosts(postId)
 * }
 * yield: ({ user, config, posts })
 * // Compiles to: Promise.all([fetchUser(id), loadConfig(), fetchPosts(postId)])
 * //                .then(([user, config, posts]) => ({ user, config, posts }))
 *
 * // Applicative combination with .map()/.ap()
 * par: {
 *   name << validateName(input.name)
 *   age  << validateAge(input.age)
 * }
 * yield: ({ name, age })
 * // Compiles to: validateName(input.name)
 * //                .map(name => age => ({ name, age }))
 * //                .ap(validateAge(input.age))
 *
 * // With pure map steps (IIFEs)
 * par: {
 *   a << Some(10)
 *   b << Some(20)
 *   c = 100  // pure computation
 * }
 * yield: (a + b + c)
 * // c is inlined as an IIFE around the yield expression
 * ```
 *
 * ## Restrictions
 *
 * - **No guards**: `if (cond) {}` is not allowed — applicative context
 *   doesn't support short-circuiting.
 * - **No orElse**: `<< expr || alt` is not allowed — use `let:` for fallbacks.
 * - **Independence required**: Bindings cannot reference previous bindings.
 *
 * ## How it works
 *
 * 1. The macro parses bind and map steps from the `par:` block
 * 2. It validates that no step references a previous step's binding
 * 3. It infers the type constructor from the first bind's expression
 * 4. For Promises, it emits `Promise.all([...]).then(([a, b, c]) => expr)`
 * 5. For other types, it emits `fa.map(a => b => c => expr).ap(fb).ap(fc)`
 */

import * as ts from "typescript";
import {
  type LabeledBlockMacro,
  type MacroContext,
  defineLabeledBlockMacro,
  globalRegistry,
} from "@typesugar/core";
import { resolveDoNotationInstance, type DoNotationMeta } from "@typesugar/macros";
import { getStdParCombineBuilder } from "../typeclasses/par-combine.js";
import {
  type BindStep,
  type MapStep,
  extractReturnExpr,
  inferTypeConstructor,
  collectReferencedIdentifiers,
  createArrowFn,
  createMethodCall,
  createIIFE,
  createStyleAwareCall,
  createMetadataJoin,
  resolveStdDoFallback,
} from "./comprehension-utils.js";

// ============================================================================
// par:/yield: Labeled Block Macro
// ============================================================================

/**
 * The par:/yield: macro transforms labeled block syntax into applicative chains.
 *
 * For Promises, emits Promise.all for parallel execution.
 * For other types, emits .map().ap().ap() chains.
 */
export const parYieldMacro: LabeledBlockMacro = defineLabeledBlockMacro({
  name: "parYield",
  label: ["par", "all"],
  continuationLabels: ["yield", "pure"],
  valueProducing: true,
  syntaxModule: "@typesugar/std/syntax/do",
  expand(
    ctx: MacroContext,
    mainBlock: ts.LabeledStatement,
    continuation: ts.LabeledStatement | undefined
  ): ts.Statement | ts.Statement[] {
    const { factory, typeChecker } = ctx;
    const label = mainBlock.label.text;

    if (!ts.isBlock(mainBlock.statement)) {
      ctx.reportError(mainBlock, `${label}: must be followed by a block { ... }`);
      return mainBlock;
    }

    // Extract steps (only bind and map — no guards or orElse)
    const steps = extractParSteps(ctx, mainBlock.statement, label);
    if (!steps || steps.length === 0) {
      ctx.reportError(mainBlock, `${label}: block must contain at least one binding`);
      return mainBlock;
    }

    // Must have at least one bind step
    const hasBindStep = steps.some((s): s is BindStep => s.kind === "bind");
    if (!hasBindStep) {
      ctx.reportError(
        mainBlock,
        `${label}: block must contain at least one \`name << expression\` binding`
      );
      return mainBlock;
    }

    // Validate independence — no step may reference a previous step's binding
    if (!validateIndependence(ctx, steps, label)) {
      return mainBlock;
    }

    // Extract return expression from continuation
    if (!continuation) {
      ctx.reportError(
        mainBlock,
        `${label}: requires a yield: or pure: block (applicative must have an explicit combining expression)`
      );
      return mainBlock;
    }

    if (!ts.isBlock(continuation.statement)) {
      ctx.reportError(
        continuation,
        `${continuation.label.text}: must be followed by a block { ... }`
      );
      return mainBlock;
    }

    const returnExpr = extractReturnExpr(ctx, continuation.statement);
    if (!returnExpr) {
      return mainBlock;
    }

    // Infer the type constructor from the first bind step
    const firstBind = steps.find((s): s is BindStep => s.kind === "bind")!;
    const typeConstructorName = inferTypeConstructor(firstBind.effect, typeChecker, ctx.sourceFile);

    if (!typeConstructorName) {
      ctx.reportError(
        firstBind.effect,
        "Could not infer type constructor from expression. " +
          "Make sure the expression has a known type (Array, Promise, Option, etc.)"
      );
      return mainBlock;
    }

    // PEP-052 Wave 3: instance resolution is scope-based — an instance
    // declared in this file or exported by any imported module (the std
    // builtins come in through the `@typesugar/std/syntax/do` marker). No
    // global registry; the static fallback serves the std builtins in hosts
    // that cannot resolve modules. A brand with no ParCombine instance falls
    // through to the generic applicative chain (same as before the flip).
    const scoped =
      resolveDoNotationInstance(ctx, "ParCombine", typeConstructorName) ??
      resolveStdDoFallback(ctx.sourceFile, "ParCombine", typeConstructorName);
    if (!scoped) {
      // Fall back to applicative chain if no ParCombine instance
      const result = buildApplicativeChain(ctx, steps, returnExpr);
      return factory.createExpressionStatement(result);
    }
    if (scoped.doMeta?.unrecognized?.length) {
      ctx.reportWarning(
        mainBlock,
        `@do-methods on the ${typeConstructorName} ParCombine instance (${scoped.exportName}) has ` +
          `unrecognized entries: ${scoped.doMeta.unrecognized.join(" ")} — valid keys are ` +
          `bind= map= orElse= all= receiver= style=method|static.`
      );
    }

    // Emission strategy, in precedence order:
    // 1. `@do-methods all=… receiver=…` metadata on the scoped instance — the
    //    generic static-join emission (`Receiver.all([...])` + style-aware
    //    continuation). Covers Promise and Effect without per-brand builders.
    // 2. A std-local AST builder (Array/Iterable cartesian products etc.).
    // 3. The generic applicative chain.
    if (scoped?.doMeta?.all && scoped.doMeta.receiver) {
      const result = buildStaticAllParCombine(ctx, steps, returnExpr, scoped.doMeta);
      return factory.createExpressionStatement(result);
    }
    const parCombineBuilder = getStdParCombineBuilder(typeConstructorName);
    const result = parCombineBuilder
      ? parCombineBuilder(ctx, steps, returnExpr)
      : buildApplicativeChain(ctx, steps, returnExpr);

    return factory.createExpressionStatement(result);
  },
});

// ============================================================================
// Step Extraction (par:-specific)
// ============================================================================

/**
 * Extract only bind and map steps from a `par:` / `all:` block.
 * Guards and orElse are not supported in applicative context.
 *
 * Exported so `let-yield.ts` can reuse it for nested parallel groups.
 */
export function extractParSteps(
  ctx: MacroContext,
  block: ts.Block,
  label: string = "par"
): (BindStep | MapStep)[] | undefined {
  const seqLabel = label === "all" ? "let" : "seq";
  const steps: (BindStep | MapStep)[] = [];

  for (const stmt of block.statements) {
    // Reject guards
    if (ts.isIfStatement(stmt)) {
      ctx.reportError(
        stmt,
        `${label}: blocks do not support guards (if). ` +
          `Use ${seqLabel}: for monadic comprehensions with guards.`
      );
      return undefined;
    }

    if (!ts.isExpressionStatement(stmt)) {
      ctx.reportError(
        stmt,
        `${label}: block statements must be \`name << expr\` or \`name = expr\``
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

    // Reject orElse (||, ??) in par:/all: blocks
    if (opKind === ts.SyntaxKind.BarBarToken || opKind === ts.SyntaxKind.QuestionQuestionToken) {
      const lhs = expr.left;
      if (
        ts.isBinaryExpression(lhs) &&
        lhs.operatorToken.kind === ts.SyntaxKind.LessThanLessThanToken
      ) {
        ctx.reportError(
          stmt,
          `${label}: blocks do not support orElse (||/??). ` +
            `Use ${seqLabel}: for monadic comprehensions with fallbacks.`
        );
        return undefined;
      }
    }

    // Plain bind: name << expr
    if (opKind === ts.SyntaxKind.LessThanLessThanToken) {
      if (!ts.isIdentifier(expr.left)) {
        ctx.reportError(expr.left, "Left side of << must be an identifier (variable name)");
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

    ctx.reportError(stmt, "Expected `name << expression` or `name = expression`");
    return undefined;
  }

  return steps;
}

// ============================================================================
// Independence Validation
// ============================================================================

/**
 * Validate that no step in a par:/all: block references a previous step's binding.
 * Returns true if all steps are independent; reports errors and returns false otherwise.
 *
 * Exported so `let-yield.ts` can reuse it for nested parallel groups.
 */
export function validateIndependence(
  ctx: MacroContext,
  steps: (BindStep | MapStep)[],
  label: string = "par"
): boolean {
  const seqLabel = label === "all" ? "let" : "seq";
  const boundNames = new Set<string>();
  let valid = true;

  for (const step of steps) {
    const refs = collectReferencedIdentifiers(step.kind === "bind" ? step.effect : step.expression);
    for (const ref of refs) {
      if (boundNames.has(ref)) {
        ctx.reportError(
          step.node,
          `${label}: bindings must be independent, but '${step.name}' references '${ref}' from a previous binding. ` +
            `Use ${seqLabel}: for sequential/dependent bindings.`
        );
        valid = false;
      }
    }
    boundNames.add(step.name);
  }

  return valid;
}

// ============================================================================
// Applicative Chain Building (non-Promise)
// ============================================================================

/**
 * Metadata-driven parallel join (PEP-052 Wave 3): emit
 * `Receiver.<all>([e1, e2, ...])` + a style-aware mapping continuation from a
 * scoped instance's `@do-methods all=… receiver=…` metadata, via the shared
 * createMetadataJoin (also used by nested parallel groups in let:/seq:).
 * Single-bind comprehensions skip the join; pure map steps wrap the yield in
 * IIFEs — mirroring the hand-written Promise builder, which survives in
 * par-combine.ts only as the safety net when metadata is unavailable.
 */
function buildStaticAllParCombine(
  ctx: MacroContext,
  steps: (BindStep | MapStep)[],
  returnExpr: ts.Expression,
  doMeta: DoNotationMeta
): ts.Expression {
  const { factory } = ctx;
  const bindSteps = steps.filter((s): s is BindStep => s.kind === "bind");
  const mapSteps = steps.filter((s): s is MapStep => s.kind === "map");

  let yieldExpr = returnExpr;
  for (let i = mapSteps.length - 1; i >= 0; i--) {
    const step = mapSteps[i];
    yieldExpr = createIIFE(factory, step.name, yieldExpr, step.expression);
  }

  if (bindSteps.length === 0) return yieldExpr;

  if (bindSteps.length === 1) {
    return createStyleAwareCall(
      factory,
      doMeta,
      doMeta.map,
      bindSteps[0].effect,
      createArrowFn(factory, bindSteps[0].name, yieldExpr)
    );
  }

  return createMetadataJoin(factory, doMeta, bindSteps, yieldExpr);
}

/**
 * Build the applicative combination for standard (non-Promise) types.
 *
 * Given binds [a << fa, b << fb, c << fc] and yield expr:
 *   fa.map(a => b => c => expr).ap(fb).ap(fc)
 *
 * Map steps are inlined as IIFEs in the yield expression.
 */
function buildApplicativeChain(
  ctx: MacroContext,
  steps: (BindStep | MapStep)[],
  returnExpr: ts.Expression
): ts.Expression {
  const { factory } = ctx;

  const bindSteps = steps.filter((s): s is BindStep => s.kind === "bind");
  const mapSteps = steps.filter((s): s is MapStep => s.kind === "map");

  // Wrap the return expression with IIFE bindings for map steps.
  // Map steps in par: are pure computations that don't depend on bindings
  // (independence is already validated), so we wrap them around the yield.
  let yieldExpr = returnExpr;
  for (let i = mapSteps.length - 1; i >= 0; i--) {
    const step = mapSteps[i];
    yieldExpr = createIIFE(factory, step.name, yieldExpr, step.expression);
  }

  if (bindSteps.length === 0) {
    // No bind steps — just pure computation
    return yieldExpr;
  }

  if (bindSteps.length === 1) {
    // Single bind — just .map()
    return createMethodCall(
      factory,
      bindSteps[0].effect,
      "map",
      createArrowFn(factory, bindSteps[0].name, yieldExpr)
    );
  }

  // Multiple binds: first.map(a => b => c => yield).ap(second).ap(third)
  // Build the curried function: a => b => c => yieldExpr
  let curriedBody: ts.Expression = yieldExpr;
  for (let i = bindSteps.length - 1; i >= 1; i--) {
    curriedBody = createArrowFn(factory, bindSteps[i].name, curriedBody);
  }

  // first.map(a => <curried>)
  let chain: ts.Expression = createMethodCall(
    factory,
    bindSteps[0].effect,
    "map",
    createArrowFn(factory, bindSteps[0].name, curriedBody)
  );

  // .ap(second).ap(third)...
  for (let i = 1; i < bindSteps.length; i++) {
    chain = createMethodCall(factory, chain, "ap", bindSteps[i].effect);
  }

  return chain;
}

// ============================================================================
// Registration
// ============================================================================

/**
 * Register the par:/yield: macro with the global registry.
 */
export function registerParYield(): void {
  globalRegistry.register(parYieldMacro);
}

// Auto-register on import
registerParYield();
