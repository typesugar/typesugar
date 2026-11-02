/**
 * @typesugar/fusion — Macro definitions (BUILD-TIME ONLY).
 *
 * This entry imports `typescript` and is loaded by the transformer at build time
 * (via the `./macros` subpath). It must NOT be imported by application runtime
 * code — the runtime values, types, and pipeline live in the package's `.` entry.
 * See PEP-050.
 *
 * `lazy(...)` is a plain runtime function: the `LazyPipeline` class handles
 * fusion at runtime (single-pass iteration, no intermediate arrays).
 *
 * `fused(chain)` analyzes a method chain at compile time and emits a single
 * loop directly. Two receiver shapes are fused, each keeping its OWN callback
 * semantics:
 *
 * - **Arrays / tuples** (checked with the type checker): `map`/`filter`
 *   intermediates and `reduce`(with init)/`find`/`some`/`every`/`forEach`
 *   terminals. Callbacks receive `(value, index, array)` exactly as the
 *   Array methods pass them (each stage has its own index counter), are
 *   evaluated once, and are called without a `this` receiver.
 * - **`lazy(iterable)` roots**: every intermediate/terminal the fused loop
 *   supports (`map`, `filter`, `take` / `toArray`, `reduce`, `sum`, `count`,
 *   `find`, `some`, `every`, `forEach`, `first`, `last`), with LazyPipeline
 *   semantics (callbacks receive the value only; `find`/`first`/`last` return
 *   `null` when empty).
 *
 * Anything else (another receiver type, an unsupported step, an `await` /
 * `yield` that the loop's IIFE would capture) is left unfused: the macro
 * returns the chain expression itself, which has identical semantics.
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry, isSyntheticNode } from "@typesugar/core";
import type { MacroContext } from "@typesugar/core";

// ============================================================================
// Chain Parsing
// ============================================================================

interface ChainLink {
  method: string;
  args: readonly ts.Expression[];
}

type IntermediateStep =
  | { type: "map"; fn: ts.Expression }
  | { type: "filter"; fn: ts.Expression }
  | { type: "take"; count: ts.Expression };

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

/** Steps that exist on `Array.prototype` (the rest exist only on LazyPipeline). */
const ARRAY_INTERMEDIATES = new Set(["map", "filter"]);
const ARRAY_TERMINALS = new Set(["reduce", "find", "some", "every", "forEach"]);

/**
 * Parse a standard method chain: src.map(f).filter(g).reduce(h, init)
 */
function parseArrayChain(
  expr: ts.Expression
): { source: ts.Expression; intermediates: IntermediateStep[]; terminal: TerminalStep } | null {
  const links: ChainLink[] = [];
  let current: ts.Expression = expr;

  // Walk from outside in
  while (ts.isCallExpression(current)) {
    const callExpr = current;
    const inner = callExpr.expression;
    if (ts.isPropertyAccessExpression(inner) && !callExpr.questionDotToken) {
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
  const intermediates: IntermediateStep[] = [];
  for (let i = 0; i < links.length - 1; i++) {
    const step = parseIntermediateLink(links[i]);
    if (!step) return null;
    intermediates.push(step);
  }

  return { source: current, intermediates, terminal };
}

function parseTerminalLink(link: ChainLink): TerminalStep | null {
  const n = link.args.length;
  switch (link.method) {
    case "reduce":
      // reduce without an initial value has different semantics; not fused.
      if (n !== 2) return null;
      return { type: "reduce", fn: link.args[0], init: link.args[1] };
    case "toArray":
    case "sum":
    case "count":
    case "first":
    case "last":
      if (n !== 0) return null;
      return { type: link.method } as TerminalStep;
    case "find":
    case "some":
    case "every":
    case "forEach":
      // A thisArg (2nd argument) changes callback binding; not fused.
      if (n !== 1) return null;
      return { type: link.method, fn: link.args[0] } as TerminalStep;
    default:
      return null;
  }
}

function parseIntermediateLink(link: ChainLink): IntermediateStep | null {
  if (link.args.length !== 1) return null;
  switch (link.method) {
    case "map":
      return { type: "map", fn: link.args[0] };
    case "filter":
      return { type: "filter", fn: link.args[0] };
    case "take":
      return { type: "take", count: link.args[0] };
    default:
      return null;
  }
}

// ============================================================================
// Analysis helpers
// ============================================================================

function skipParens(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return e;
}

function isFunctionLiteral(e: ts.Expression): e is ts.ArrowFunction | ts.FunctionExpression {
  const inner = skipParens(e);
  return ts.isArrowFunction(inner) || ts.isFunctionExpression(inner);
}

/**
 * Find an `await` / `yield` that would end up inside the loop's non-async,
 * non-generator arrow IIFE (i.e. one not nested in its own function).
 */
function findSuspension(node: ts.Node): ts.AwaitExpression | ts.YieldExpression | undefined {
  let found: ts.AwaitExpression | ts.YieldExpression | undefined;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isAwaitExpression(n) || ts.isYieldExpression(n)) {
      found = n;
      return;
    }
    if (ts.isFunctionLike(n) || ts.isClassLike(n)) return;
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/**
 * The most arguments a callback can observe: its declared parameter count
 * (Infinity with a rest parameter or when it cannot be determined).
 */
function maxObservedArgs(ctx: MacroContext, fn: ts.Expression): number {
  const inner = skipParens(fn);
  const countParams = (params: readonly ts.ParameterDeclaration[]) =>
    params.some((p) => p.dotDotDotToken) ? Infinity : params.length;
  if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) {
    return countParams(inner.parameters);
  }
  // A non-literal callback: ask the checker for its call signatures. A node
  // without a source position cannot be given to the checker (CLAUDE.md);
  // assume the worst, which only disables fusion or passes extra arguments.
  if (isSyntheticNode(inner)) return Infinity;
  try {
    const sigs = ctx.typeChecker.getTypeAtLocation(inner).getCallSignatures();
    if (sigs.length === 0) return Infinity;
    let max = 0;
    for (const sig of sigs) {
      const decl = sig.getDeclaration() as ts.SignatureDeclaration | undefined;
      if (!decl || !decl.parameters) return Infinity;
      max = Math.max(max, countParams(decl.parameters));
    }
    return max;
  } catch {
    return Infinity;
  }
}

type ReceiverKind =
  | { kind: "array"; iterable: ts.Expression }
  | { kind: "lazy"; iterable: ts.Expression }
  | { kind: "unknown"; reason?: string };

function classifyReceiver(ctx: MacroContext, source: ts.Expression): ReceiverKind {
  const src = skipParens(source);
  if (isSyntheticNode(src)) {
    return {
      kind: "unknown",
      reason: "the receiver is macro-generated, so its type cannot be checked",
    };
  }
  let type: ts.Type;
  try {
    type = ctx.typeChecker.getTypeAtLocation(src);
  } catch (e) {
    return { kind: "unknown", reason: `type-checking the receiver failed (${String(e)})` };
  }

  // lazy(iterable) root: iterate the iterable directly.
  if (
    ts.isCallExpression(src) &&
    ts.isIdentifier(src.expression) &&
    src.expression.text === "lazy" &&
    src.arguments.length === 1 &&
    !ts.isSpreadElement(src.arguments[0]) &&
    type.getSymbol()?.getName() === "LazyPipeline"
  ) {
    return { kind: "lazy", iterable: src.arguments[0] };
  }

  const checker = ctx.typeChecker;
  const nonNull = checker.getNonNullableType(type);
  if (nonNull === type && (checker.isArrayType(type) || checker.isTupleType(type))) {
    return { kind: "array", iterable: source };
  }
  return { kind: "unknown" };
}

// ============================================================================
// Code Generation — Emit fused loop
// ============================================================================

/**
 * @deprecated Generated names now come from `ctx.generateUniqueName`, which is
 * per-file and reproducible, so there is no module-global counter to reset.
 */
export function resetFusionCounter(): void {}

interface Plan {
  mode: "array" | "lazy";
  iterable: ts.Expression;
  intermediates: IntermediateStep[];
  terminal: TerminalStep;
}

/**
 * Generate a fused loop from a parsed pipeline, or `undefined` if it cannot be
 * fused without changing semantics.
 *
 * Example (array): arr.map((x, i) => x * i).filter(x => x > 5).reduce((a, b) => a + b, 0)
 *   (() => {
 *     let __i0 = 0;
 *     let __acc = 0;
 *     for (const __el of arr) {
 *       const __v = ((x, i) => x * i)(__el, __i0++);
 *       if (!((x => x > 5)(__v))) continue;
 *       __acc = ((a, b) => a + b)(__acc, __v);
 *     }
 *     return __acc;
 *   })()
 */
function emitFusedLoop(ctx: MacroContext, plan: Plan): ts.Expression | undefined {
  const f = ts.factory;
  const { mode, intermediates, terminal } = plan;
  // generateUniqueName is per-file (reproducible); inside a hygiene scope it
  // maps one prefix to one name, so each name in this expansion gets its own
  // local suffix.
  let nameIdx = 0;
  const name = (p: string) => ctx.generateUniqueName(`fusion_${p}${nameIdx++}`);

  const preamble: ts.Statement[] = [];
  const declare = (id: ts.Identifier, init: ts.Expression, flags: ts.NodeFlags) =>
    preamble.push(
      f.createVariableStatement(
        undefined,
        f.createVariableDeclarationList(
          [f.createVariableDeclaration(id, undefined, undefined, init)],
          flags
        )
      )
    );

  // Array mode: callbacks may observe the source array (only meaningful for
  // the first stage — later stages would need an intermediate array that a
  // fused loop never builds, so those refuse to fuse).
  let iterable = plan.iterable;
  let srcIdent: ts.Identifier | undefined;
  const needsSourceArray = (
    stage: number,
    fn: ts.Expression,
    valueArgIdx: number
  ): boolean | "refuse" => {
    if (mode !== "array") return false;
    if (maxObservedArgs(ctx, fn) < valueArgIdx + 3) return false;
    return stage === 0 ? true : "refuse";
  };

  // Pre-scan: decide whether the source array must be named, or refuse.
  const callbackStages: { fn: ts.Expression; stage: number; valueArgIdx: number }[] = [];
  intermediates.forEach((s, i) => {
    if (s.type !== "take") callbackStages.push({ fn: s.fn, stage: i, valueArgIdx: 0 });
  });
  if ("fn" in terminal) {
    callbackStages.push({
      fn: terminal.fn,
      stage: intermediates.length,
      valueArgIdx: terminal.type === "reduce" ? 1 : 0,
    });
  }
  for (const c of callbackStages) {
    const need = needsSourceArray(c.stage, c.fn, c.valueArgIdx);
    if (need === "refuse") return undefined;
    if (need && !srcIdent) {
      srcIdent = name("src");
      declare(srcIdent, iterable, ts.NodeFlags.Const);
      iterable = srcIdent;
    }
  }

  /**
   * Build a call to a stage callback. Function literals are inlined (they are
   * side-effect free to evaluate and have no receiver); any other callback
   * expression is evaluated ONCE into a const, then called without `this`.
   */
  const callStage = (
    fn: ts.Expression,
    leading: ts.Expression[],
    value: ts.Expression,
    stage: number
  ): ts.Expression => {
    let callee: ts.Expression;
    if (isFunctionLiteral(fn)) {
      callee = f.createParenthesizedExpression(skipParens(fn));
    } else {
      const fnIdent = name("fn");
      declare(fnIdent, fn, ts.NodeFlags.Const);
      callee = fnIdent;
    }
    const args: ts.Expression[] = [...leading, value];
    if (mode === "array") {
      const observed = maxObservedArgs(ctx, fn);
      const valueArgIdx = leading.length;
      if (observed > valueArgIdx + 1) {
        const idx = name("i");
        declare(idx, f.createNumericLiteral(0), ts.NodeFlags.Let);
        args.push(f.createPostfixUnaryExpression(idx, ts.SyntaxKind.PlusPlusToken));
      }
      if (observed > valueArgIdx + 2 && stage === 0 && srcIdent) {
        args.push(srcIdent);
      }
    }
    return f.createCallExpression(callee, undefined, args);
  };

  const elIdent = name("el");
  const takeCounters: ts.Identifier[] = [];
  const hasTake = intermediates.some((s) => s.type === "take");
  const bodyLabel = hasTake ? name("body") : undefined;
  // `continue` skips the rest of this element; with a take present we break
  // out of the labeled body instead so the post-element take check still runs.
  const skipElement = (): ts.Statement =>
    bodyLabel ? f.createBreakStatement(bodyLabel) : f.createContinueStatement();

  const body: ts.Statement[] = [];
  let currentValue: ts.Expression = elIdent;

  intermediates.forEach((step, stage) => {
    if (step.type === "map") {
      const v = name("v");
      const call = callStage(step.fn, [], currentValue, stage);
      body.push(
        f.createVariableStatement(
          undefined,
          f.createVariableDeclarationList(
            [f.createVariableDeclaration(v, undefined, undefined, call)],
            ts.NodeFlags.Const
          )
        )
      );
      currentValue = v;
    } else if (step.type === "filter") {
      const call = callStage(step.fn, [], currentValue, stage);
      body.push(
        f.createIfStatement(
          f.createPrefixUnaryExpression(
            ts.SyntaxKind.ExclamationToken,
            f.createParenthesizedExpression(call)
          ),
          skipElement()
        )
      );
    } else {
      // take(n): count is evaluated once up front (LazyPipeline evaluates it
      // when the chain is built). The loop is skipped entirely when a count
      // is already <= 0, and after each element we stop as soon as any count
      // reaches 0 — so no extra source element is pulled.
      const t = name("take");
      declare(t, step.count, ts.NodeFlags.Let);
      takeCounters.push(t);
      body.push(
        f.createExpressionStatement(
          f.createPostfixUnaryExpression(t, ts.SyntaxKind.MinusMinusToken)
        )
      );
    }
  });

  const terminalStage = intermediates.length;
  const emptyResult = (): ts.Expression => (mode === "array" ? f.createVoidZero() : f.createNull());
  let postLoop: ts.Statement | undefined;

  switch (terminal.type) {
    case "reduce": {
      const acc = name("acc");
      // Evaluate the callback (hoisted if needed) before the init, matching
      // left-to-right argument order.
      const call = callStage(terminal.fn, [acc], currentValue, terminalStage);
      declare(acc, terminal.init, ts.NodeFlags.Let);
      body.push(
        f.createExpressionStatement(f.createBinaryExpression(acc, ts.SyntaxKind.EqualsToken, call))
      );
      postLoop = f.createReturnStatement(acc);
      break;
    }
    case "toArray": {
      const arr = name("arr");
      declare(arr, f.createArrayLiteralExpression([]), ts.NodeFlags.Const);
      body.push(
        f.createExpressionStatement(
          f.createCallExpression(f.createPropertyAccessExpression(arr, "push"), undefined, [
            currentValue,
          ])
        )
      );
      postLoop = f.createReturnStatement(arr);
      break;
    }
    case "sum":
    case "count": {
      const total = name(terminal.type);
      declare(total, f.createNumericLiteral(0), ts.NodeFlags.Let);
      body.push(
        f.createExpressionStatement(
          terminal.type === "sum"
            ? f.createBinaryExpression(total, ts.SyntaxKind.PlusEqualsToken, currentValue)
            : f.createPostfixUnaryExpression(total, ts.SyntaxKind.PlusPlusToken)
        )
      );
      postLoop = f.createReturnStatement(total);
      break;
    }
    case "find": {
      const call = callStage(terminal.fn, [], currentValue, terminalStage);
      body.push(f.createIfStatement(call, f.createReturnStatement(currentValue)));
      postLoop = f.createReturnStatement(emptyResult());
      break;
    }
    case "some": {
      const call = callStage(terminal.fn, [], currentValue, terminalStage);
      body.push(f.createIfStatement(call, f.createReturnStatement(f.createTrue())));
      postLoop = f.createReturnStatement(f.createFalse());
      break;
    }
    case "every": {
      const call = callStage(terminal.fn, [], currentValue, terminalStage);
      body.push(
        f.createIfStatement(
          f.createPrefixUnaryExpression(
            ts.SyntaxKind.ExclamationToken,
            f.createParenthesizedExpression(call)
          ),
          f.createReturnStatement(f.createFalse())
        )
      );
      postLoop = f.createReturnStatement(f.createTrue());
      break;
    }
    case "forEach": {
      const call = callStage(terminal.fn, [], currentValue, terminalStage);
      body.push(f.createExpressionStatement(call));
      break;
    }
    case "first": {
      body.push(f.createReturnStatement(currentValue));
      postLoop = f.createReturnStatement(emptyResult());
      break;
    }
    case "last": {
      const last = name("last");
      declare(last, f.createNull(), ts.NodeFlags.Let);
      body.push(
        f.createExpressionStatement(
          f.createBinaryExpression(last, ts.SyntaxKind.EqualsToken, currentValue)
        )
      );
      postLoop = f.createReturnStatement(last);
      break;
    }
  }

  // Loop body, with the take bookkeeping when needed.
  let loopBody: ts.Statement[] = body;
  if (bodyLabel) {
    const anyExhausted = takeCounters
      .map((t) =>
        f.createBinaryExpression(t, ts.SyntaxKind.LessThanEqualsToken, f.createNumericLiteral(0))
      )
      .reduce((a, b) => f.createBinaryExpression(a, ts.SyntaxKind.BarBarToken, b));
    loopBody = [
      f.createLabeledStatement(bodyLabel, f.createBlock(body, true)),
      f.createIfStatement(anyExhausted, f.createBreakStatement()),
    ];
  }

  let loop: ts.Statement = f.createForOfStatement(
    undefined,
    f.createVariableDeclarationList([f.createVariableDeclaration(elIdent)], ts.NodeFlags.Const),
    iterable,
    f.createBlock(loopBody, true)
  );
  if (takeCounters.length > 0) {
    const allPositive = takeCounters
      .map((t) =>
        f.createBinaryExpression(t, ts.SyntaxKind.GreaterThanToken, f.createNumericLiteral(0))
      )
      .reduce((a, b) => f.createBinaryExpression(a, ts.SyntaxKind.AmpersandAmpersandToken, b));
    loop = f.createIfStatement(allPositive, loop);
  }

  const statements: ts.Statement[] = [...preamble, loop];
  if (postLoop) statements.push(postLoop);

  const arrowFn = f.createArrowFunction(
    undefined,
    undefined,
    [],
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    f.createBlock(statements, true)
  );
  return f.createCallExpression(f.createParenthesizedExpression(arrowFn), undefined, []);
}

// ============================================================================
// Macro Definitions
// ============================================================================

/**
 * The `lazy` expression macro.
 *
 * Kept for API compatibility but NOT registered: it was a pass-through, and
 * registering an identity macro made the transformer drop the user's
 * `import { lazy }` (it removes imports that resolve to macros), so every
 * `lazy(...)` call outside `fused()` became a ReferenceError at runtime.
 * `lazy` is an ordinary runtime function.
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
 * The `fused` expression macro — compile-time loop fusion.
 *
 * @example
 * ```typescript
 * // Input:
 * const result = fused(arr.map(x => x * 2).filter(x => x > 5).reduce((a, b) => a + b, 0));
 *
 * // Output (fused into single loop):
 * const result = (() => {
 *   let __acc = 0;
 *   for (const __el of arr) {
 *     const __v = (x => x * 2)(__el);
 *     if (!((x => x > 5)(__v))) continue;
 *     __acc = ((a, b) => a + b)(__acc, __v);
 *   }
 *   return __acc;
 * })();
 * ```
 *
 * When a chain cannot be fused without changing its meaning, the chain is
 * returned unchanged (equivalent to the runtime `fused(x) => x`).
 */
export const fusedMacro = defineExpressionMacro({
  name: "fused",
  module: "@typesugar/fusion",
  description: "Fuse element-wise array/vector operations into a single loop",
  expand(ctx: MacroContext, callExpr: ts.CallExpression, args: readonly ts.Expression[]) {
    // fused() with no / extra arguments: leave the call to the runtime identity.
    if (args.length !== 1) return callExpr;
    const chainExpr = args[0];

    const chain = parseArrayChain(chainExpr);
    if (!chain) return chainExpr;

    // The fused loop runs inside a plain arrow IIFE. An await/yield in the
    // source, a callback expression, a take count or the reduce init would
    // be moved into it and become a SyntaxError — leave such chains unfused.
    const suspension = findSuspension(chainExpr);
    if (suspension) {
      ctx.reportWarning(
        suspension,
        `fused(): chain contains '${ts.isAwaitExpression(suspension) ? "await" : "yield"}' ` +
          `outside a callback, which cannot be moved into the fused loop; left unfused`
      );
      return chainExpr;
    }

    const receiver = classifyReceiver(ctx, chain.source);
    if (receiver.kind === "unknown") {
      if (receiver.reason) {
        ctx.reportWarning(chain.source, `fused(): ${receiver.reason}; left unfused`);
      }
      return chainExpr;
    }
    if (receiver.kind === "array") {
      const ok =
        chain.intermediates.every((s) => ARRAY_INTERMEDIATES.has(s.type)) &&
        ARRAY_TERMINALS.has(chain.terminal.type);
      if (!ok) return chainExpr;
    }

    const fusedLoop = emitFusedLoop(ctx, {
      mode: receiver.kind,
      iterable: receiver.iterable,
      intermediates: chain.intermediates,
      terminal: chain.terminal,
    });
    return fusedLoop ?? chainExpr;
  },
});

/** Register fusion macros with the global registry. Called on package import. */
export function register(): void {
  globalRegistry.register(fusedMacro);
}

// Auto-register on import (the transformer loads this entry for its side effects).
register();
