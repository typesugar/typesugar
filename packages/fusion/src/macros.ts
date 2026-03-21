/**
 * Expression macro registrations for @typesugar/fusion
 *
 * **Phase 1:** Pass through to runtime LazyPipeline construction.
 * The LazyPipeline class handles fusion at runtime (single-pass iteration,
 * no intermediate arrays).
 *
 * **Phase 2 (implemented):** Analyze method chains at compile time and emit
 * fused single-pass loops directly — no LazyPipeline object at runtime.
 * Supports map, filter, and take as intermediate steps.
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry } from "@typesugar/core";
import type { MacroContext } from "@typesugar/core";

// ============================================================================
// Chain Parsing
// ============================================================================

interface ChainLink {
  method: string;
  args: readonly ts.Expression[];
}

/**
 * Intermediate step in the parsed pipeline chain.
 */
type FusionStep =
  | { type: "map"; fn: ts.Expression }
  | { type: "filter"; fn: ts.Expression }
  | { type: "reduce"; fn: ts.Expression; init: ts.Expression }
  | { type: "take"; count: ts.Expression }
  | { type: "toArray" }
  | { type: "sum" }
  | { type: "count" }
  | { type: "find"; fn: ts.Expression }
  | { type: "some"; fn: ts.Expression }
  | { type: "every"; fn: ts.Expression }
  | { type: "forEach"; fn: ts.Expression }
  | { type: "first" }
  | { type: "last" };

type TerminalStep =
  | { type: "reduce"; fn: ts.Expression; init: ts.Expression }
  | { type: "toArray" }
  | { type: "sum" }
  | { type: "count" }
  | { type: "find"; fn: ts.Expression }
  | { type: "some"; fn: ts.Expression }
  | { type: "every"; fn: ts.Expression }
  | { type: "forEach"; fn: ts.Expression }
  | { type: "first" }
  | { type: "last" };

const TERMINAL_METHODS = new Set([
  "reduce",
  "toArray",
  "sum",
  "count",
  "find",
  "some",
  "every",
  "forEach",
  "first",
  "last",
]);

/**
 * Parse a method chain from outermost call down to the root `fused(source)` call.
 * Returns the source expression, the intermediate steps, and the terminal step.
 */
function parseChain(
  callExpr: ts.CallExpression
): { source: ts.Expression; intermediates: FusionStep[]; terminal: TerminalStep } | null {
  const links: ChainLink[] = [];
  let current: ts.Expression = callExpr;

  // Walk the chain from outside in: each call is `expr.method(args)`
  while (ts.isCallExpression(current)) {
    const expr = current.expression;
    if (ts.isPropertyAccessExpression(expr)) {
      const method = expr.name.text;
      links.push({ method, args: current.arguments });
      current = expr.expression;
    } else if (ts.isIdentifier(expr) && expr.text === "fused") {
      // We've reached the root fused() call
      if (current.arguments.length < 1) return null;
      const innerExpr = current.arguments[0];
      // The argument to fused() should be the chained expression
      // But actually fused() wraps the whole chain, so the argument is the chain itself.
      // Re-think: fused(arr.map(...).filter(...).reduce(...))
      // In this case, `callExpr` IS the fused() call, and the argument is the chain.
      break;
    } else {
      // Not a recognized chain shape
      return null;
    }
  }

  // If we broke out via the fused() identifier path, the argument to fused() is the chain
  if (
    ts.isCallExpression(current) &&
    ts.isIdentifier(current.expression) &&
    current.expression.text === "fused"
  ) {
    // fused(chainExpr) — parse the chain from the argument
    if (current.arguments.length < 1) return null;
    return parseArrayChain(current.arguments[0]);
  }

  return null;
}

/**
 * Parse a standard array method chain: arr.map(f).filter(g).reduce(h, init)
 */
function parseArrayChain(
  expr: ts.Expression
): { source: ts.Expression; intermediates: FusionStep[]; terminal: TerminalStep } | null {
  const links: ChainLink[] = [];
  let current: ts.Expression = expr;

  // Walk from outside in
  while (ts.isCallExpression(current)) {
    const callExpr = current;
    const inner = callExpr.expression;
    if (ts.isPropertyAccessExpression(inner)) {
      links.push({ method: inner.name.text, args: callExpr.arguments });
      current = inner.expression;
    } else {
      break;
    }
  }

  // `current` is now the source (e.g. `arr`)
  // `links` is in outside-in order, reverse to get inside-out
  links.reverse();

  if (links.length === 0) return null;

  // Last link must be a terminal operation
  const lastLink = links[links.length - 1];
  const terminal = parseTerminalLink(lastLink);
  if (!terminal) return null;

  // Parse intermediate steps (everything before the terminal)
  const intermediates: FusionStep[] = [];
  for (let i = 0; i < links.length - 1; i++) {
    const step = parseIntermediateLink(links[i]);
    if (!step) return null;
    intermediates.push(step);
  }

  return { source: current, intermediates, terminal };
}

function parseTerminalLink(link: ChainLink): TerminalStep | null {
  switch (link.method) {
    case "reduce":
      if (link.args.length < 2) return null;
      return { type: "reduce", fn: link.args[0], init: link.args[1] };
    case "toArray":
      return { type: "toArray" };
    case "sum":
      return { type: "sum" };
    case "count":
      return { type: "count" };
    case "find":
      if (link.args.length < 1) return null;
      return { type: "find", fn: link.args[0] };
    case "some":
      if (link.args.length < 1) return null;
      return { type: "some", fn: link.args[0] };
    case "every":
      if (link.args.length < 1) return null;
      return { type: "every", fn: link.args[0] };
    case "forEach":
      if (link.args.length < 1) return null;
      return { type: "forEach", fn: link.args[0] };
    case "first":
      return { type: "first" };
    case "last":
      return { type: "last" };
    default:
      return null;
  }
}

function parseIntermediateLink(link: ChainLink): FusionStep | null {
  switch (link.method) {
    case "map":
      if (link.args.length < 1) return null;
      return { type: "map", fn: link.args[0] };
    case "filter":
      if (link.args.length < 1) return null;
      return { type: "filter", fn: link.args[0] };
    case "take":
      if (link.args.length < 1) return null;
      return { type: "take", count: link.args[0] };
    default:
      return null;
  }
}

// ============================================================================
// Code Generation — Emit fused for-loop
// ============================================================================

/** Counter for generating unique variable names */
let fusionCounter = 0;

/** Reset counter (for testing) */
export function resetFusionCounter(): void {
  fusionCounter = 0;
}

/**
 * Generate a fused for-of loop from a parsed pipeline.
 *
 * Example: map(x => x * 2).filter(x => x > 5).reduce((a, b) => a + b, 0)
 * Becomes:
 *   (() => {
 *     let __acc = 0;
 *     for (const __el of source) {
 *       const __v0 = (x => x * 2)(__el);
 *       if (!((x => x > 5)(__v0))) continue;
 *       __acc = ((a, b) => a + b)(__acc, __v0);
 *     }
 *     return __acc;
 *   })()
 */
function emitFusedLoop(
  source: ts.Expression,
  intermediates: FusionStep[],
  terminal: TerminalStep
): ts.Expression {
  const f = ts.factory;
  const id = fusionCounter++;
  const elName = `__el${id}`;
  const elIdent = f.createIdentifier(elName);

  const bodyStatements: ts.Statement[] = [];
  let currentValue: ts.Expression = elIdent;

  // Track variable names for intermediate values
  let varCounter = 0;

  // Track take counters for preamble generation
  const takeCounters: { name: string; ident: ts.Identifier; count: ts.Expression }[] = [];

  // Generate intermediate steps (map/filter/take)
  for (const step of intermediates) {
    if (step.type === "map") {
      const varName = `__v${id}_${varCounter++}`;
      const varIdent = f.createIdentifier(varName);
      // const __v0 = fn(__el)
      bodyStatements.push(
        f.createVariableStatement(
          undefined,
          f.createVariableDeclarationList(
            [
              f.createVariableDeclaration(
                varIdent,
                undefined,
                undefined,
                f.createCallExpression(step.fn, undefined, [currentValue])
              ),
            ],
            ts.NodeFlags.Const
          )
        )
      );
      currentValue = varIdent;
    } else if (step.type === "filter") {
      // if (!predicate(current)) continue;
      bodyStatements.push(
        f.createIfStatement(
          f.createPrefixUnaryExpression(
            ts.SyntaxKind.ExclamationToken,
            f.createParenthesizedExpression(
              f.createCallExpression(step.fn, undefined, [currentValue])
            )
          ),
          f.createContinueStatement()
        )
      );
    } else if (step.type === "take") {
      // Intermediate take: if (__take_N <= 0) break; __take_N--;
      const takeName = `__take${id}_${varCounter++}`;
      const takeIdent = f.createIdentifier(takeName);
      takeCounters.push({ name: takeName, ident: takeIdent, count: step.count });
      // if (__take_N <= 0) break;
      bodyStatements.push(
        f.createIfStatement(
          f.createBinaryExpression(
            takeIdent,
            ts.SyntaxKind.LessThanEqualsToken,
            f.createNumericLiteral(0)
          ),
          f.createBreakStatement()
        )
      );
      // __take_N--;
      bodyStatements.push(
        f.createExpressionStatement(
          f.createPostfixUnaryExpression(takeIdent, ts.SyntaxKind.MinusMinusToken)
        )
      );
    }
  }

  // Build preamble statements for take counters
  const takePreamble: ts.Statement[] = takeCounters.map(({ ident, count }) =>
    f.createVariableStatement(
      undefined,
      f.createVariableDeclarationList(
        [f.createVariableDeclaration(ident, undefined, undefined, count)],
        ts.NodeFlags.Let
      )
    )
  );

  // Generate terminal operation
  return emitTerminal(source, bodyStatements, currentValue, terminal, id, elIdent, takePreamble);
}

function emitTerminal(
  source: ts.Expression,
  bodyStatements: ts.Statement[],
  currentValue: ts.Expression,
  terminal: TerminalStep,
  id: number,
  elIdent: ts.Identifier,
  extraPreamble: ts.Statement[] = []
): ts.Expression {
  const f = ts.factory;

  switch (terminal.type) {
    case "reduce": {
      const accName = `__acc${id}`;
      const accIdent = f.createIdentifier(accName);
      // __acc = fn(__acc, currentValue)
      bodyStatements.push(
        f.createExpressionStatement(
          f.createBinaryExpression(
            accIdent,
            ts.SyntaxKind.EqualsToken,
            f.createCallExpression(terminal.fn, undefined, [accIdent, currentValue])
          )
        )
      );
      return wrapInIIFE(
        source,
        elIdent,
        bodyStatements,
        [
          ...extraPreamble,
          // let __acc = init;
          f.createVariableStatement(
            undefined,
            f.createVariableDeclarationList(
              [f.createVariableDeclaration(accIdent, undefined, undefined, terminal.init)],
              ts.NodeFlags.Let
            )
          ),
        ],
        f.createReturnStatement(accIdent)
      );
    }

    case "toArray": {
      const arrName = `__arr${id}`;
      const arrIdent = f.createIdentifier(arrName);
      // __arr.push(currentValue)
      bodyStatements.push(
        f.createExpressionStatement(
          f.createCallExpression(f.createPropertyAccessExpression(arrIdent, "push"), undefined, [
            currentValue,
          ])
        )
      );
      return wrapInIIFE(
        source,
        elIdent,
        bodyStatements,
        [
          ...extraPreamble,
          // const __arr = [];
          f.createVariableStatement(
            undefined,
            f.createVariableDeclarationList(
              [
                f.createVariableDeclaration(
                  arrIdent,
                  undefined,
                  undefined,
                  f.createArrayLiteralExpression([])
                ),
              ],
              ts.NodeFlags.Const
            )
          ),
        ],
        f.createReturnStatement(arrIdent)
      );
    }

    case "sum": {
      const sumName = `__sum${id}`;
      const sumIdent = f.createIdentifier(sumName);
      // __sum += currentValue
      bodyStatements.push(
        f.createExpressionStatement(
          f.createBinaryExpression(sumIdent, ts.SyntaxKind.PlusEqualsToken, currentValue)
        )
      );
      return wrapInIIFE(
        source,
        elIdent,
        bodyStatements,
        [
          ...extraPreamble,
          f.createVariableStatement(
            undefined,
            f.createVariableDeclarationList(
              [
                f.createVariableDeclaration(
                  sumIdent,
                  undefined,
                  undefined,
                  f.createNumericLiteral(0)
                ),
              ],
              ts.NodeFlags.Let
            )
          ),
        ],
        f.createReturnStatement(sumIdent)
      );
    }

    case "count": {
      const countName = `__count${id}`;
      const countIdent = f.createIdentifier(countName);
      // __count++
      bodyStatements.push(
        f.createExpressionStatement(
          f.createPostfixUnaryExpression(countIdent, ts.SyntaxKind.PlusPlusToken)
        )
      );
      return wrapInIIFE(
        source,
        elIdent,
        bodyStatements,
        [
          ...extraPreamble,
          f.createVariableStatement(
            undefined,
            f.createVariableDeclarationList(
              [
                f.createVariableDeclaration(
                  countIdent,
                  undefined,
                  undefined,
                  f.createNumericLiteral(0)
                ),
              ],
              ts.NodeFlags.Let
            )
          ),
        ],
        f.createReturnStatement(countIdent)
      );
    }

    case "find": {
      // if (predicate(currentValue)) return currentValue;
      bodyStatements.push(
        f.createIfStatement(
          f.createCallExpression(terminal.fn, undefined, [currentValue]),
          f.createReturnStatement(currentValue)
        )
      );
      return wrapInIIFE(
        source,
        elIdent,
        bodyStatements,
        [...extraPreamble],
        f.createReturnStatement(f.createNull())
      );
    }

    case "some": {
      // if (predicate(currentValue)) return true;
      bodyStatements.push(
        f.createIfStatement(
          f.createCallExpression(terminal.fn, undefined, [currentValue]),
          f.createReturnStatement(f.createTrue())
        )
      );
      return wrapInIIFE(
        source,
        elIdent,
        bodyStatements,
        [...extraPreamble],
        f.createReturnStatement(f.createFalse())
      );
    }

    case "every": {
      // if (!predicate(currentValue)) return false;
      bodyStatements.push(
        f.createIfStatement(
          f.createPrefixUnaryExpression(
            ts.SyntaxKind.ExclamationToken,
            f.createParenthesizedExpression(
              f.createCallExpression(terminal.fn, undefined, [currentValue])
            )
          ),
          f.createReturnStatement(f.createFalse())
        )
      );
      return wrapInIIFE(
        source,
        elIdent,
        bodyStatements,
        [...extraPreamble],
        f.createReturnStatement(f.createTrue())
      );
    }

    case "forEach": {
      // fn(currentValue)
      bodyStatements.push(
        f.createExpressionStatement(f.createCallExpression(terminal.fn, undefined, [currentValue]))
      );
      return wrapInIIFE(source, elIdent, bodyStatements, [...extraPreamble]);
    }

    case "first": {
      // return currentValue; (immediately, on first element)
      bodyStatements.push(f.createReturnStatement(currentValue));
      return wrapInIIFE(
        source,
        elIdent,
        bodyStatements,
        [...extraPreamble],
        f.createReturnStatement(f.createNull())
      );
    }

    case "last": {
      const lastName = `__last${id}`;
      const lastIdent = f.createIdentifier(lastName);
      // __last = currentValue
      bodyStatements.push(
        f.createExpressionStatement(
          f.createBinaryExpression(lastIdent, ts.SyntaxKind.EqualsToken, currentValue)
        )
      );
      return wrapInIIFE(
        source,
        elIdent,
        bodyStatements,
        [
          ...extraPreamble,
          f.createVariableStatement(
            undefined,
            f.createVariableDeclarationList(
              [f.createVariableDeclaration(lastIdent, undefined, undefined, f.createNull())],
              ts.NodeFlags.Let
            )
          ),
        ],
        f.createReturnStatement(lastIdent)
      );
    }
  }
}

/**
 * Wrap body in: (() => { ...preamble; for (const el of source) { ...body }; ...postamble })()
 */
function wrapInIIFE(
  source: ts.Expression,
  elIdent: ts.Identifier,
  loopBody: ts.Statement[],
  preamble: ts.Statement[],
  postLoop?: ts.Statement
): ts.Expression {
  const f = ts.factory;

  const forOfStmt = f.createForOfStatement(
    undefined,
    f.createVariableDeclarationList([f.createVariableDeclaration(elIdent)], ts.NodeFlags.Const),
    source,
    f.createBlock(loopBody, true)
  );

  const allStatements: ts.Statement[] = [...preamble, forOfStmt];
  if (postLoop) {
    allStatements.push(postLoop);
  }

  const arrowBody = f.createBlock(allStatements, true);
  const arrowFn = f.createArrowFunction(
    undefined,
    undefined,
    [],
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    arrowBody
  );

  return f.createCallExpression(f.createParenthesizedExpression(arrowFn), undefined, []);
}

// ============================================================================
// Macro Definitions
// ============================================================================

/**
 * The `lazy` expression macro.
 *
 * Phase 1 behavior: pass-through (the runtime LazyPipeline handles fusion).
 * Phase 2 will analyze `.filter().map().reduce()` chains at compile time
 * and emit a fused `for` loop with no intermediate allocations.
 */
export const lazyMacro = defineExpressionMacro({
  name: "lazy",
  module: "@typesugar/fusion",
  description: "Create a lazy, fused iterator pipeline",
  expand(_ctx, callExpr, _args) {
    return callExpr;
  },
});

/**
 * The `fused` expression macro — compile-time loop fusion (Phase 2).
 *
 * Analyzes a chain of array operations (map, filter, reduce, etc.)
 * and fuses them into a single for-of loop at compile time.
 *
 * @example
 * ```typescript
 * // Input:
 * const result = fused(arr.map(x => x * 2).filter(x => x > 5).reduce((a, b) => a + b, 0));
 *
 * // Output (fused into single loop):
 * const result = (() => {
 *   let __acc0 = 0;
 *   for (const __el0 of arr) {
 *     const __v0_0 = (x => x * 2)(__el0);
 *     if (!((x => x > 5)(__v0_0))) continue;
 *     __acc0 = ((a, b) => a + b)(__acc0, __v0_0);
 *   }
 *   return __acc0;
 * })();
 * ```
 */
export const fusedMacro = defineExpressionMacro({
  name: "fused",
  module: "@typesugar/fusion",
  description: "Fuse element-wise array/vector operations into a single loop",
  expand(_ctx: MacroContext, callExpr: ts.CallExpression, args: readonly ts.Expression[]) {
    // If no argument, pass through
    if (args.length < 1) return callExpr;

    const chain = parseArrayChain(args[0]);
    if (!chain) {
      // Could not parse the chain — fall back to pass-through
      return callExpr;
    }

    return emitFusedLoop(chain.source, chain.intermediates, chain.terminal);
  },
});

/** Register fusion macros with the global registry. Called on package import. */
export function register(): void {
  globalRegistry.register(lazyMacro);
  globalRegistry.register(fusedMacro);
}
