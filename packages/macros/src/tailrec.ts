/**
 * @tailrec — Compile-time tail-call optimization for TypeScript
 *
 * Inspired by Scala's @tailrec annotation. Detects tail-recursive calls in a
 * function and replaces them with a stack-safe while loop. If the function
 * contains recursive calls that are NOT in tail position, the macro reports a
 * compile-time error — just like Scala.
 *
 * ## Rules (following Scala)
 *
 * 1. Only named `function` declarations are accepted (not arrow functions,
 *    function expressions or methods).
 * 2. The function must contain at least one recursive self-call.
 * 3. Every recursive call must be in tail position (the very last operation).
 * 4. Mutual recursion is NOT supported — only direct self-recursion.
 * 5. Recursive calls inside try/catch/finally or nested functions are NOT in
 *    tail position.
 * 6. Recursive calls wrapped in operations (e.g., `1 + f(n-1)`, `await f(n-1)`)
 *    are rejected.
 *
 * ## Supported tail-position patterns
 *
 * - `return f(x)` anywhere outside try/catch/finally (including inside loops
 *   and switch clauses)
 * - A final `f(x);` statement, when the function returns no value
 * - `return c ? f(a) : b` (nested ternaries too), `return a || f(x)`,
 *   `return a && f(x)`, `return a ?? f(x)`, `return (a, f(x))`
 * - Parentheses, `as`, `satisfies` and `!` around the call
 *
 * Parameters may be optional, defaulted (the default is re-applied when an
 * argument is omitted or `undefined`, exactly as a real call would) or rest.
 * Destructured parameters, `arguments`, `var` declarations and generators are
 * rejected with a diagnostic and the function is left unoptimised. Anything
 * the rewrite can't preserve is reported, never silently changed.
 *
 * ## Transformation
 *
 * ```typescript
 * @tailrec
 * function factorial(n: number, acc: number = 1): number {
 *   if (n <= 1) return acc;
 *   return factorial(n - 1, n * acc);
 * }
 *
 * // Becomes (roughly):
 * function factorial(n: number, acc: number = 1): number {
 *   let _n = n;
 *   let _acc: typeof acc | undefined = acc;
 *   _tailrec: while (true) {
 *     let n = _n;
 *     let acc = _acc === void 0 ? 1 : _acc;
 *     {
 *       if (n <= 1) return acc;
 *       {
 *         const _next_n: typeof _n = n - 1;
 *         const _next_acc: typeof _acc = n * acc;
 *         _n = _next_n;
 *         _acc = _next_acc;
 *         continue _tailrec;
 *       }
 *     }
 *   }
 * }
 * ```
 *
 * @module
 */

import * as ts from "typescript";
import { cloneNodeDeep, defineAttributeMacro, globalRegistry, TS9220 } from "@typesugar/core";
import { MacroContext, AttributeTarget } from "@typesugar/core";

/** Report a user-facing `@tailrec` failure as TS9220 ("@tailrec: {reason}"). */
function tailrecError(ctx: MacroContext, node: ts.Node, reason: string): void {
  ctx.diagnostic(TS9220).at(node).withArgs({ reason }).emit();
}

// ============================================================================
// Self-call detection
// ============================================================================

function isSelfCall(node: ts.Node, fnName: string): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === fnName
  );
}

/** Every self-call anywhere under `root` (including nested functions). */
function collectSelfCalls(root: ts.Node, fnName: string): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (isSelfCall(node, fnName)) out.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return out;
}

function containsSelfCall(node: ts.Node, fnName: string): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (isSelfCall(n, fnName)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function isFunctionBoundary(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node)
  );
}

/**
 * Why a self-call that survived the rewrite is not a tail call. Uses the
 * ORIGINAL node's parent chain (surviving calls are original nodes — the
 * rewriter reuses untouched subtrees).
 */
function nonTailReason(call: ts.CallExpression, fnBody: ts.Block): string {
  for (let p: ts.Node | undefined = call.parent; p && p !== fnBody; p = p.parent) {
    if (ts.isTryStatement(p) || ts.isCatchClause(p)) {
      return "recursive call inside try/catch/finally is not in tail position";
    }
    if (isFunctionBoundary(p)) {
      return "recursive call inside a nested function is not in tail position";
    }
  }
  return "recursive call is not in tail position";
}

// ============================================================================
// Pre-flight checks: shapes the loop rewrite cannot preserve
// ============================================================================

interface Unsupported {
  node: ts.Node;
  message: string;
}

/**
 * Find a construct whose meaning changes when the body becomes a loop
 * iteration. Walks the body without entering nested non-arrow functions
 * (they have their own `arguments`/`var` scope).
 */
function findUnsupportedBodyConstruct(body: ts.Block, fnName: string): Unsupported | undefined {
  let found: Unsupported | undefined;
  const visit = (node: ts.Node, inArrow: boolean): void => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === "arguments") {
      found = {
        node,
        message:
          "the body reads `arguments`, which would still describe the first call after the loop rewrite",
      };
      return;
    }
    if (ts.isVariableDeclarationList(node) && !inArrow) {
      if ((node.flags & ts.NodeFlags.BlockScoped) === 0) {
        found = {
          node,
          message:
            "the body declares `var` bindings, which would be shared across loop iterations — use let/const",
        };
        return;
      }
    }
    // A local binding with the function's own name would make `fnName(...)`
    // refer to something else; the rewrite matches self-calls by name.
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isClassDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === fnName
    ) {
      found = {
        node,
        message: `the body declares a local named '${fnName}' that shadows the function`,
      };
      return;
    }
    if (ts.isArrowFunction(node)) {
      ts.forEachChild(node, (c) => visit(c, true));
      return;
    }
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      // Own `arguments` and `var` scope: only look for shadowing of fnName.
      const shadow = (n: ts.Node): void => {
        if (found) return;
        if (
          (ts.isVariableDeclaration(n) ||
            ts.isFunctionDeclaration(n) ||
            ts.isParameter(n) ||
            ts.isClassDeclaration(n)) &&
          n.name &&
          ts.isIdentifier(n.name) &&
          n.name.text === fnName
        ) {
          found = {
            node: n,
            message: `the body declares a local named '${fnName}' that shadows the function`,
          };
          return;
        }
        ts.forEachChild(n, shadow);
      };
      if (node.name && ts.isIdentifier(node.name) && node.name.text === fnName) {
        shadow(node);
        return;
      }
      ts.forEachChild(node, shadow);
      return;
    }
    ts.forEachChild(node, (c) => visit(c, inArrow));
  };
  visit(body, false);
  return found;
}

/** Whether any `return <expr>` in the body (excluding nested functions) has a value. */
function returnsAValue(body: ts.Block): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || isFunctionBoundary(node)) return;
    if (ts.isReturnStatement(node) && node.expression) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}

// ============================================================================
// Tail-Call Transformation
// ============================================================================

class CannotRewrite extends Error {
  constructor(
    readonly node: ts.Node,
    message: string
  ) {
    super(message);
  }
}

interface ParamSlot {
  /** Parameter name as written. */
  name: string;
  /** The loop-carried variable holding the next iteration's raw argument. */
  carried: ts.Identifier;
  /** Default-value initializer, if any. */
  initializer?: ts.Expression;
  isRest: boolean;
  /** Whether `undefined` is a valid carried value (optional / defaulted). */
  mayBeUndefined: boolean;
  /** Temporary holding the next argument while all arguments are evaluated. */
  next: ts.Identifier;
}

/**
 * Transform a tail-recursive function into a labelled `while (true)` loop.
 *
 * ```
 * function f(a, b = d, ...r) {
 *   let _a = a, _b = b, _r = r;                  // loop-carried raw arguments
 *   _tailrec: while (true) {
 *     let a = _a;                                // per-iteration bindings, so
 *     let b = _b === undefined ? d : _b;         // closures capture this
 *     let r = _r;                                // iteration's values and the
 *     { ...original body... }                    // default is re-applied in
 *     return;                                    // parameter scope
 *   }
 * }
 * ```
 *
 * Each tail call `return f(x, y)` becomes
 * `{ const _next_a = x; const _next_b = y; _a = _next_a; _b = _next_b; _r = []; continue _tailrec; }`.
 * The body is NOT renamed — the per-iteration `let`s shadow the parameters,
 * so every reference (including closures) sees the right binding without a
 * text-based rename pass.
 *
 * Returns undefined after reporting a diagnostic when the function can't be
 * rewritten faithfully; the caller then leaves the function unoptimised.
 */
function transformTailRecursion(
  ctx: MacroContext,
  fn: ts.FunctionDeclaration,
  fnName: string
): ts.FunctionDeclaration | undefined {
  const factory = ctx.factory;
  const body = fn.body!;

  if (fn.asteriskToken) {
    tailrecError(
      ctx,
      fn,
      `could not optimize '${fnName}' — generator functions are not supported (returning the inner generator is not the same as looping)`
    );
    return undefined;
  }

  // --- Parameters ---
  const slots: ParamSlot[] = [];
  for (const param of fn.parameters) {
    if (ts.isIdentifier(param.name) && param.name.text === "this") continue; // TS-only
    if (!ts.isIdentifier(param.name)) {
      tailrecError(
        ctx,
        param,
        `could not optimize '${fnName}' — destructured parameters are not supported; take the object/array as a named parameter and destructure it in the body`
      );
      return undefined;
    }
    const name = param.name.text;
    slots.push({
      name,
      carried: ctx.tryShortName(`_${name}`),
      initializer: param.initializer,
      isRest: !!param.dotDotDotToken,
      mayBeUndefined: !param.dotDotDotToken && (!!param.initializer || !!param.questionToken),
      next: ctx.tryShortName(`_next_${name}`),
    });
  }
  const fixedCount = slots.filter((s) => !s.isRest).length;
  const restSlot = slots.find((s) => s.isRest);

  const unsupported = findUnsupportedBodyConstruct(body, fnName);
  if (unsupported) {
    tailrecError(ctx, unsupported.node, `could not optimize '${fnName}' — ${unsupported.message}`);
    return undefined;
  }

  const loopLabel = ctx.tryShortName("_tailrec");
  const bodyReturnsValue = returnsAValue(body);
  const declaredVoid = fn.type?.kind === ts.SyntaxKind.VoidKeyword;

  /** `{ const _next_a = x; ...; _a = _next_a; ...; continue _tailrec; }` */
  function trampoline(call: ts.CallExpression): ts.Statement {
    const args = call.arguments;
    const stmts: ts.Statement[] = [];
    const assigns: ts.Statement[] = [];
    const assign = (slot: ParamSlot, value: ts.Expression) =>
      assigns.push(
        factory.createExpressionStatement(
          factory.createAssignment(factory.createIdentifier(slot.carried.text), value)
        )
      );

    for (let i = 0; i < fixedCount; i++) {
      const slot = slots[i];
      const arg = args[i];
      if (arg !== undefined && ts.isSpreadElement(arg)) {
        throw new CannotRewrite(
          arg,
          "a spread argument in a non-rest parameter position can't be mapped to parameters at compile time"
        );
      }
      if (arg === undefined) {
        assign(slot, factory.createVoidZero());
        continue;
      }
      const temp = factory.createIdentifier(slot.next.text);
      stmts.push(
        factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList(
            [
              factory.createVariableDeclaration(
                temp,
                undefined,
                // `typeof _a` keeps contextual typing for lambdas/literals.
                factory.createTypeQueryNode(factory.createIdentifier(slot.carried.text)),
                arg
              ),
            ],
            ts.NodeFlags.Const
          )
        )
      );
      assign(slot, factory.createIdentifier(temp.text));
    }

    const extra = args.slice(fixedCount);
    if (restSlot) {
      const temp = factory.createIdentifier(restSlot.next.text);
      stmts.push(
        factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList(
            [
              factory.createVariableDeclaration(
                temp,
                undefined,
                factory.createTypeQueryNode(factory.createIdentifier(restSlot.carried.text)),
                factory.createArrayLiteralExpression([...extra], false)
              ),
            ],
            ts.NodeFlags.Const
          )
        )
      );
      assign(restSlot, factory.createIdentifier(temp.text));
    } else {
      // Arguments beyond the parameter list are still evaluated, in order.
      for (const e of extra) {
        stmts.push(
          factory.createExpressionStatement(
            ts.isSpreadElement(e) ? factory.createArrayLiteralExpression([e]) : e
          )
        );
      }
    }

    return factory.createBlock(
      [
        ...stmts,
        ...assigns,
        factory.createContinueStatement(factory.createIdentifier(loopLabel.text)),
      ],
      true
    );
  }

  /** Strip wrappers that don't change the returned value. */
  function unwrap(e: ts.Expression): ts.Expression {
    while (
      ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isTypeAssertionExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isSatisfiesExpression(e)
    ) {
      e = e.expression;
    }
    return e;
  }

  /**
   * Lower an expression in tail position into statements. `mode` is "value"
   * for `return <expr>` and "void" for a final expression statement (the
   * result is discarded and the function returns undefined).
   *
   * Returns undefined when the expression is not a shape we lower (the
   * caller keeps the original statement; any self-call left inside it is
   * then reported as non-tail).
   */
  function lowerTail(expr: ts.Expression, mode: "value" | "void"): ts.Statement[] | undefined {
    const leaf = (): ts.Statement[] =>
      mode === "value"
        ? [factory.createReturnStatement(expr)]
        : [factory.createExpressionStatement(expr), factory.createReturnStatement()];
    if (!containsSelfCall(expr, fnName)) return leaf();

    const e = unwrap(expr);
    if (isSelfCall(e, fnName)) {
      if (mode === "void" && bodyReturnsValue && !declaredVoid) {
        throw new CannotRewrite(
          e,
          `the call '${fnName}(...)' is used as a statement, so the original discards its result and returns undefined, but other paths return values — write 'return ${fnName}(...)' if the result should be returned`
        );
      }
      return [trampoline(e)];
    }

    if (ts.isConditionalExpression(e)) {
      const whenTrue = lowerTail(e.whenTrue, mode);
      const whenFalse = lowerTail(e.whenFalse, mode);
      if (!whenTrue || !whenFalse) return undefined;
      return [
        factory.createIfStatement(
          e.condition,
          factory.createBlock(whenTrue, true),
          factory.createBlock(whenFalse, true)
        ),
      ];
    }

    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      if (op === ts.SyntaxKind.CommaToken) {
        const rest = lowerTail(e.right, mode);
        if (!rest) return undefined;
        return [factory.createExpressionStatement(e.left), ...rest];
      }
      if (
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken
      ) {
        const rest = lowerTail(e.right, mode);
        if (!rest) return undefined;
        const temp = ctx.generateUniqueName("_tailrec_lhs");
        const tempRef = () => factory.createIdentifier(temp.text);
        // Condition under which the left operand is the result.
        const shortCircuits =
          op === ts.SyntaxKind.AmpersandAmpersandToken
            ? factory.createLogicalNot(tempRef())
            : op === ts.SyntaxKind.BarBarToken
              ? tempRef()
              : factory.createLogicalAnd(
                  factory.createStrictInequality(tempRef(), factory.createNull()),
                  factory.createStrictInequality(tempRef(), factory.createVoidZero())
                );
        return [
          factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList(
              [factory.createVariableDeclaration(temp, undefined, undefined, e.left)],
              ts.NodeFlags.Const
            )
          ),
          factory.createIfStatement(
            shortCircuits,
            factory.createReturnStatement(mode === "value" ? tempRef() : undefined)
          ),
          ...rest,
        ];
      }
    }
    return undefined;
  }

  /**
   * Rewrite tail calls in a statement. `inTail` says whether falling off the
   * end of this statement ends the function (so a final expression
   * statement is a tail position). `return` is a tail position anywhere
   * outside try/catch/finally and nested functions.
   */
  function rewriteStmt(stmt: ts.Statement, inTail: boolean): ts.Statement {
    if (ts.isReturnStatement(stmt)) {
      if (!stmt.expression || !containsSelfCall(stmt.expression, fnName)) return stmt;
      const lowered = lowerTail(stmt.expression, "value");
      return lowered ? asStatement(lowered) : stmt;
    }
    if (ts.isExpressionStatement(stmt)) {
      if (!inTail || !containsSelfCall(stmt.expression, fnName)) return stmt;
      const lowered = lowerTail(stmt.expression, "void");
      return lowered ? asStatement(lowered) : stmt;
    }
    if (ts.isBlock(stmt)) {
      return factory.updateBlock(stmt, rewriteList(stmt.statements, inTail));
    }
    if (ts.isIfStatement(stmt)) {
      return factory.updateIfStatement(
        stmt,
        stmt.expression,
        rewriteStmt(stmt.thenStatement, inTail),
        stmt.elseStatement ? rewriteStmt(stmt.elseStatement, inTail) : undefined
      );
    }
    if (ts.isLabeledStatement(stmt)) {
      // A labelled loop's body is not a tail position; a labelled block is.
      const isLoop = ts.isIterationStatement(stmt.statement, false);
      return factory.updateLabeledStatement(
        stmt,
        stmt.label,
        rewriteStmt(stmt.statement, inTail && !isLoop)
      );
    }
    if (ts.isSwitchStatement(stmt)) {
      const clauses = stmt.caseBlock.clauses;
      const newClauses = clauses.map((clause, ci) => {
        // Only the last clause's last statement can fall off the end of the
        // switch; earlier clauses fall through into the next clause.
        const stmts = rewriteList(clause.statements, inTail && ci === clauses.length - 1);
        return ts.isCaseClause(clause)
          ? factory.updateCaseClause(clause, clause.expression, stmts)
          : factory.updateDefaultClause(clause, stmts);
      });
      return factory.updateSwitchStatement(
        stmt,
        stmt.expression,
        factory.updateCaseBlock(stmt.caseBlock, newClauses)
      );
    }
    if (ts.isForStatement(stmt)) {
      return factory.updateForStatement(
        stmt,
        stmt.initializer,
        stmt.condition,
        stmt.incrementor,
        rewriteStmt(stmt.statement, false)
      );
    }
    if (ts.isForOfStatement(stmt)) {
      return factory.updateForOfStatement(
        stmt,
        stmt.awaitModifier,
        stmt.initializer,
        stmt.expression,
        rewriteStmt(stmt.statement, false)
      );
    }
    if (ts.isForInStatement(stmt)) {
      return factory.updateForInStatement(
        stmt,
        stmt.initializer,
        stmt.expression,
        rewriteStmt(stmt.statement, false)
      );
    }
    if (ts.isWhileStatement(stmt)) {
      return factory.updateWhileStatement(
        stmt,
        stmt.expression,
        rewriteStmt(stmt.statement, false)
      );
    }
    if (ts.isDoStatement(stmt)) {
      return factory.updateDoStatement(stmt, rewriteStmt(stmt.statement, false), stmt.expression);
    }
    // try/catch/finally (a `continue` would run `finally` before the next
    // iteration instead of after the inner call), declarations, nested
    // functions, etc.: left alone. Any self-call inside is reported below.
    return stmt;
  }

  function asStatement(stmts: ts.Statement[]): ts.Statement {
    return stmts.length === 1 && ts.isBlock(stmts[0]) ? stmts[0] : factory.createBlock(stmts, true);
  }

  function rewriteList(stmts: ts.NodeArray<ts.Statement>, inTail: boolean): ts.Statement[] {
    return stmts.map((s, i) => rewriteStmt(s, inTail && i === stmts.length - 1));
  }

  let rewrittenBody: ts.Block;
  try {
    rewrittenBody = factory.updateBlock(body, rewriteList(body.statements, true));
  } catch (e) {
    if (e instanceof CannotRewrite) {
      tailrecError(ctx, e.node, `could not optimize '${fnName}' — ${e.message}`);
      return undefined;
    }
    throw e;
  }

  // --- Assert: no self-call survives. Anything left was not a tail call. ---
  const remaining = collectSelfCalls(rewrittenBody, fnName);
  if (remaining.length > 0) {
    for (const call of remaining) {
      const where =
        call.pos >= 0
          ? ` (line ${ctx.sourceFile.getLineAndCharacterOfPosition(call.getStart(ctx.sourceFile)).line + 1})`
          : "";
      tailrecError(
        ctx,
        call,
        `could not optimize '${fnName}' — ${nonTailReason(call, body)}${where}`
      );
    }
    return undefined;
  }

  // --- Build the loop ---
  const carriedDecls = slots.map((slot) =>
    factory.createVariableStatement(
      undefined,
      factory.createVariableDeclarationList(
        [
          factory.createVariableDeclaration(
            slot.carried,
            undefined,
            slot.mayBeUndefined
              ? factory.createUnionTypeNode([
                  factory.createTypeQueryNode(factory.createIdentifier(slot.name)),
                  factory.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword),
                ])
              : undefined,
            factory.createIdentifier(slot.name)
          ),
        ],
        ts.NodeFlags.Let
      )
    )
  );

  // Per-iteration bindings, declared in parameter order so a default can see
  // earlier parameters (and not later ones), outside the body block so a
  // default can't see the body's own declarations — matching parameter scope.
  const prologue = slots.map((slot) => {
    const carried = factory.createIdentifier(slot.carried.text);
    const init = slot.initializer
      ? factory.createConditionalExpression(
          factory.createStrictEquality(carried, factory.createVoidZero()),
          factory.createToken(ts.SyntaxKind.QuestionToken),
          cloneNodeDeep(slot.initializer),
          factory.createToken(ts.SyntaxKind.ColonToken),
          factory.createIdentifier(slot.carried.text)
        )
      : carried;
    return factory.createVariableStatement(
      undefined,
      factory.createVariableDeclarationList(
        [factory.createVariableDeclaration(slot.name, undefined, undefined, init)],
        ts.NodeFlags.Let
      )
    );
  });

  const last = body.statements[body.statements.length - 1];
  const fallsOff = !last || !(ts.isReturnStatement(last) || ts.isThrowStatement(last));
  const loopBody = factory.createBlock(
    [...prologue, rewrittenBody, ...(fallsOff ? [factory.createReturnStatement()] : [])],
    true
  );
  const loop = factory.createLabeledStatement(
    loopLabel,
    factory.createWhileStatement(factory.createTrue(), loopBody)
  );

  const newModifiers = fn.modifiers?.filter((m) => !ts.isDecorator(m));
  return factory.updateFunctionDeclaration(
    fn,
    newModifiers,
    fn.asteriskToken,
    fn.name,
    fn.typeParameters,
    fn.parameters,
    fn.type,
    factory.createBlock([...carriedDecls, loop], true)
  );
}

// ============================================================================
// @tailrec Attribute Macro
// ============================================================================

export const tailrecAttribute = defineAttributeMacro({
  name: "tailrec",
  module: "typesugar",
  exportName: "tailrec",
  description:
    "Verify and optimize tail-recursive functions into stack-safe while loops (following Scala's @tailrec rules)",
  validTargets: ["function"] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    _args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    if (!ts.isFunctionDeclaration(target)) {
      tailrecError(
        ctx,
        target,
        "can only be applied to function declarations (not arrow functions, function expressions or methods)"
      );
      return target;
    }

    const fn = target;
    const fnName = fn.name?.text;

    if (!fnName) {
      tailrecError(ctx, fn, "function must have a name");
      return target;
    }

    if (!fn.body) {
      tailrecError(ctx, fn, "function must have a body");
      return target;
    }

    if (collectSelfCalls(fn.body, fnName).length === 0) {
      tailrecError(
        ctx,
        fn,
        `function '${fnName}' contains no recursive calls — ` +
          `@tailrec requires at least one self-recursive call in tail position`
      );
      return target;
    }

    return transformTailRecursion(ctx, fn, fnName) ?? target;
  },
});

// ============================================================================
// Registration
// ============================================================================

globalRegistry.register(tailrecAttribute);
