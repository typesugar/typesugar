/**
 * The type an operator expression has once the typeclass-operator rewrite
 * has replaced it, shared by the rewrite itself (transformer-core
 * `tryRewriteTypeclassOperator`) and the diagnostic suppression rules that
 * must agree with it (`OperatorOverload`, `RewrittenOperatorResult`).
 *
 * TypeScript types `a * b` on two objects as `number` (and `a + b` as an
 * error), whatever the operands. After the rewrite it is `mul(a, b)`, a value
 * of the instance type when the method returns the typeclass's own type
 * parameter (`resultIsSelf`). Operators of a chain (`a + b * c`) dispatch on
 * that type, and a use of the result (`rationalToString(a * b)`) is typed by
 * it once expanded.
 *
 * Resolution is the rewrite's: candidates from the activated typeclasses'
 * `@op` index, one instance from scope for the left operand's type
 * (`resolveInstance`, by the checker), and a right operand that fits.
 */

import * as ts from "typescript";
import { isSyntheticNode, type MacroContext } from "@typesugar/core";
import { getOperatorCandidates } from "./typeclass-index.js";
import { getOperatorString } from "./operators.js";
import { resolveInstance } from "./instance-resolver.js";

/**
 * What the caller decides outside the type question: whether the rewrite is
 * opted out at a node (a `"use no typesugar operators"` scope), and how a
 * checker failure we degrade on is made visible (CLAUDE.md: a caught checker
 * failure must leave a trace).
 */
export interface OperatorChainHooks {
  optedOut(node: ts.Node): boolean;
  warn(node: ts.Node, message: string): void;
}

/**
 * Binary operators whose result TypeScript types as number, bigint, string,
 * boolean or any whatever the operands (arithmetic, bitwise, comparison,
 * `in`, `instanceof`): never a type with an instance.
 */
export const PRIMITIVE_RESULT_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.AsteriskAsteriskToken,
  ts.SyntaxKind.LessThanLessThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
  ts.SyntaxKind.AmpersandToken,
  ts.SyntaxKind.BarToken,
  ts.SyntaxKind.CaretToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.InKeyword,
  ts.SyntaxKind.InstanceOfKeyword,
]);

/** `e` without parentheses, when it is an operator expression TypeScript types as a primitive. */
export function chainBinary(e: ts.Expression): ts.BinaryExpression | undefined {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return ts.isBinaryExpression(e) && PRIMITIVE_RESULT_OPERATORS.has(e.operatorToken.kind)
    ? e
    : undefined;
}

/** `e` (parentheses aside) is a binary expression whose TypeScript type is primitive or any. */
export function isPrimitiveTypedBinary(e: ts.Expression): boolean {
  return chainBinary(e) !== undefined;
}

export function isNullOrUndefinedExpr(node: ts.Expression): boolean {
  if (node.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isIdentifier(node) && node.text === "undefined") return true;
  if (ts.isVoidExpression(node)) return true;
  return false;
}

/**
 * `t` is a primitive, a literal of one, an enum, or a union of those (or
 * any/unknown/never/null/undefined): by its flags, so the literal type `1`
 * counts, which the printed-name check (`"1"`) missed.
 */
export function isPrimitiveByFlags(t: ts.Type): boolean {
  const primitive =
    ts.TypeFlags.NumberLike |
    ts.TypeFlags.StringLike |
    ts.TypeFlags.BooleanLike |
    ts.TypeFlags.BigIntLike |
    ts.TypeFlags.ESSymbolLike |
    ts.TypeFlags.EnumLike |
    ts.TypeFlags.Null |
    ts.TypeFlags.Undefined |
    ts.TypeFlags.Void |
    ts.TypeFlags.Any |
    ts.TypeFlags.Unknown |
    ts.TypeFlags.Never;
  return t.isUnion()
    ? t.types.every((m) => (m.flags & primitive) !== 0)
    : (t.flags & primitive) !== 0;
}

/** `t` is, or is a union with, `null`/`undefined`/`void` (only visible under strictNullChecks). */
export function admitsNullish(t: ts.Type): boolean {
  const nullish = ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void;
  return t.isUnion() ? t.types.some((m) => (m.flags & nullish) !== 0) : (t.flags & nullish) !== 0;
}

/**
 * Per checker, per operator expression: the instance type its rewrite
 * produces, or null when it isn't rewritten to a method returning the
 * instance type. Keyed by checker too: the rewrite and the diagnostic
 * filter may type the same nodes with different checkers. Weak on both.
 */
const chainTypeCache = new WeakMap<ts.TypeChecker, WeakMap<ts.Node, ts.Type | null>>();

function cacheFor(checker: ts.TypeChecker): WeakMap<ts.Node, ts.Type | null> {
  let c = chainTypeCache.get(checker);
  if (!c) chainTypeCache.set(checker, (c = new WeakMap()));
  return c;
}

/**
 * The type the operator expression `expr` has once rewritten, when that is
 * an instance type: `a + b` with an activated `/** @op + *\/ add(a: A, b: A):
 * A` and an instance for `a`'s type becomes `add(a, b)`, a value of that
 * type. TypeScript types `a + b` on objects by its own rules (an error, so
 * any), so the outer operator of `a + b + c` couldn't dispatch and stayed
 * JavaScript's own (`add(a, b) + c`, string concatenation) (PEP-052 deferred
 * item 6). Undefined when it isn't such an expression.
 *
 * Decided as the rewrite decides it, bottom-up: a leaf operand's type (by
 * the checker, see {@link chainLeafType}), then at each operator an activated
 * candidate whose method returns the type parameter (`resultIsSelf`, from the
 * typeclass declaration), exactly one instance for the left operand's type
 * from scope (resolveInstance), and a right operand that fits -- itself
 * possibly a rewritten operator (`a + b * 2`, `a - (b - c)`), so both
 * operands of every operator in the tree are typed this way. Walked
 * iteratively (an explicit post-order stack, so neither a long left-nested
 * chain nor a deep right-nested one recurses) and memoized per node, so
 * `1 + 1 + ... + 1` costs one walk and no checker call on a binary
 * expression (whose type TypeScript doesn't cache).
 */
export function rewrittenChainType(
  ctx: MacroContext,
  expr: ts.Expression,
  activated: ReadonlySet<string>,
  hooks: OperatorChainHooks
): ts.Type | undefined {
  const cache = cacheFor(ctx.typeChecker);
  const stack: Array<{ node: ts.BinaryExpression; expanded: boolean }> = [];
  const push = (e: ts.Expression) => {
    const b = chainBinary(e);
    if (b && !cache.has(b)) stack.push({ node: b, expanded: false });
  };
  push(expr);
  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    if (!top.expanded) {
      top.expanded = true;
      push(top.node.right);
      push(top.node.left);
      continue;
    }
    stack.pop();
    if (cache.has(top.node)) continue;
    const left = chainOperandType(ctx, top.node.left, activated, hooks);
    cache.set(top.node, left ? chainStepType(ctx, top.node, left, activated, hooks) : null);
  }
  return chainOperandType(ctx, expr, activated, hooks) ?? undefined;
}

/**
 * The type a rewritten operand has, when the rewrite gives it one TypeScript
 * doesn't: an operator expression (`b * 2`), or a same-file `const` with no
 * type annotation whose initializer is one (`const product = a * b`, which
 * TypeScript types `number`; a const's type IS its initializer's). Undefined
 * for anything else -- the checker's type is the right one there.
 */
export function rewrittenOperandType(
  ctx: MacroContext,
  expr: ts.Expression,
  activated: ReadonlySet<string>,
  hooks: OperatorChainHooks
): ts.Type | undefined {
  if (activated.size === 0) return undefined;
  if (chainBinary(expr)) return rewrittenChainType(ctx, expr, activated, hooks);
  const init = rewrittenConstInitializer(ctx, expr);
  return init ? rewrittenChainType(ctx, init, activated, hooks) : undefined;
}

/**
 * `expr` (parentheses aside) names a `const` declared in this file without a
 * type annotation, whose initializer is an operator expression: that
 * initializer (following const-to-const aliases a few steps). By symbol.
 */
function rewrittenConstInitializer(
  ctx: MacroContext,
  expr: ts.Expression
): ts.Expression | undefined {
  let e = expr;
  for (let depth = 0; depth < 8; depth++) {
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    if (chainBinary(e)) return e;
    if (!ts.isIdentifier(e) || isSyntheticNode(e)) return undefined;
    const sym = ctx.typeChecker.getSymbolAtLocation(e);
    const decl = sym?.valueDeclaration;
    if (
      !decl ||
      !ts.isVariableDeclaration(decl) ||
      decl.type ||
      !decl.initializer ||
      decl.getSourceFile() !== ctx.sourceFile ||
      !ts.isVariableDeclarationList(decl.parent) ||
      !(decl.parent.flags & ts.NodeFlags.Const)
    ) {
      return undefined;
    }
    e = decl.initializer;
  }
  return undefined;
}

/** An operand's type in a chain: computed (and cached) for an operator, else {@link chainLeafType}. */
function chainOperandType(
  ctx: MacroContext,
  e: ts.Expression,
  activated: ReadonlySet<string>,
  hooks: OperatorChainHooks
): ts.Type | null {
  const b = chainBinary(e);
  if (b) return cacheFor(ctx.typeChecker).get(b) ?? null;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return chainLeafType(ctx, e, activated, hooks);
}

/**
 * A leaf operand's type, when it is an object type that could have an
 * instance: the checker's, or, for a const bound to a rewritten operator
 * (`const p = a * b`), that operator's rewritten type.
 */
function chainLeafType(
  ctx: MacroContext,
  leaf: ts.Expression,
  activated: ReadonlySet<string>,
  hooks: OperatorChainHooks
): ts.Type | null {
  // A synthetic node is outside the checker's contract (CLAUDE.md).
  if (isSyntheticNode(leaf) || isNullOrUndefinedExpr(leaf)) return null;
  try {
    const init = rewrittenConstInitializer(ctx, leaf);
    if (init) return rewrittenChainType(ctx, init, activated, hooks) ?? null;
    const t = ctx.typeChecker.getTypeAtLocation(leaf);
    return isPrimitiveByFlags(t) || admitsNullish(t) ? null : t;
  } catch (error) {
    hooks.warn(
      leaf,
      `typesugar could not resolve the type of '${leaf.getText()}' at the start of an ` +
        `operator chain (${error}); the chain's operators stay native.`
    );
    return null;
  }
}

/** `node`'s type once rewritten, given its left operand's type `left`; null if it isn't rewritten to one. */
function chainStepType(
  ctx: MacroContext,
  node: ts.BinaryExpression,
  left: ts.Type,
  activated: ReadonlySet<string>,
  hooks: OperatorChainHooks
): ts.Type | null {
  const step = operatorRewriteStep(ctx, node, left, activated, hooks);
  return step?.resultIsSelf ? step.dispatchType : null;
}

/**
 * The type the rewrite gives the right operand of `node`: its rewritten type
 * (an operator, or a const bound to one), else the checker's, without
 * null/undefined. Undefined for a synthetic node (outside the checker's
 * contract, CLAUDE.md).
 */
function rightOperandType(
  ctx: MacroContext,
  node: ts.BinaryExpression,
  activated: ReadonlySet<string>,
  hooks: OperatorChainHooks
): ts.Type | undefined {
  if (isSyntheticNode(node.right)) return undefined;
  const t =
    rewrittenOperandType(ctx, node.right, activated, hooks) ??
    ctx.typeChecker.getTypeAtLocation(node.right);
  return admitsNullish(t) ? ctx.typeChecker.getNonNullableType(t) : t;
}

/**
 * The declared (un-narrowed) type of an operand that names a variable,
 * parameter or property, without null/undefined, or undefined. Read from the
 * symbol, not the expression, so assignment narrowing doesn't apply. A
 * synthetic node is outside the checker's contract (CLAUDE.md): undefined.
 */
export function declaredOperandType(
  ctx: MacroContext,
  operand: ts.Expression,
  hooks: OperatorChainHooks
): ts.Type | undefined {
  let e = operand;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  const named = ts.isIdentifier(e) ? e : ts.isPropertyAccessExpression(e) ? e.name : undefined;
  if (!named || isSyntheticNode(named)) return undefined;
  const checker = ctx.typeChecker;
  try {
    let sym = checker.getSymbolAtLocation(named);
    if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    if (!sym || !(sym.flags & (ts.SymbolFlags.Variable | ts.SymbolFlags.Property))) {
      return undefined;
    }
    const declared = checker.getTypeOfSymbol(sym);
    return checker.getNonNullableType(declared);
  } catch (error) {
    hooks.warn(
      operand,
      `typesugar could not read the declared type of '${e.getText()}' for an operator ` +
        `rewrite (${error}); its narrowed type is used.`
    );
    return undefined;
  }
}

/**
 * The operand's type at the operator may be NARROWED: `const s: Shape =
 * { kind: "c", r: 1 }` makes `s` the "c" variant there, and the instance is
 * `Shape`'s. When the narrowed type has none, the operands' declared types
 * (the variable's or property's, by symbol: {@link declaredOperandType}) are
 * tried, left then right. A declared type is only tried when BOTH operands
 * are assignable to it (checker assignability): `a === b` with `a: Foo` and
 * `b: Bar` must not borrow `b`'s type and call Bar's instance with a Foo.
 * Only an object type: a primitive one (`n: number` in `1 / n`) would
 * dispatch a literal operand to the primitive's instances. Shared by the
 * rewrite and the diagnostic filter, so both try the same types.
 */
export function declaredDispatchTypes(
  ctx: MacroContext,
  node: ts.BinaryExpression,
  leftType: ts.Type,
  rightType: ts.Type,
  hooks: OperatorChainHooks
): ts.Type[] {
  const types: ts.Type[] = [];
  for (const operand of [node.left, node.right]) {
    const declared = declaredOperandType(ctx, operand, hooks);
    if (
      !declared ||
      declared === leftType ||
      isPrimitiveByFlags(declared) ||
      types.includes(declared)
    ) {
      continue;
    }
    let bothFit = false;
    try {
      bothFit =
        ctx.typeChecker.isTypeAssignableTo(leftType, declared) &&
        ctx.typeChecker.isTypeAssignableTo(rightType, declared);
    } catch (error) {
      hooks.warn(
        node,
        `typesugar could not check whether the operands of '${node.operatorToken.getText()}' fit ` +
          `'${ctx.typeChecker.typeToString(declared)}' (${error}); its instance was not tried.`
      );
    }
    if (bothFit) types.push(declared);
  }
  return types;
}

/**
 * Whether the operator `node`, with left operand type `left` (non-nullable,
 * not primitive), is rewritten: exactly one activated candidate with an
 * instance for `left` (or, when it is narrowed, for an operand's declared
 * type: {@link declaredDispatchTypes}) in scope, and, when the method's right
 * parameter is the type parameter, a right operand that fits (an operator
 * operand typed as rewritten). Its method's `resultIsSelf` and the type the
 * instance is for, or undefined when it stays native. The rewrite's own
 * decision, without its diagnostics.
 */
function operatorRewriteStep(
  ctx: MacroContext,
  node: ts.BinaryExpression,
  left: ts.Type,
  activated: ReadonlySet<string>,
  hooks: OperatorChainHooks
): { resultIsSelf: boolean; dispatchType: ts.Type } | undefined {
  if (isSyntheticNode(node) || hooks.optedOut(node)) return undefined;
  const op = getOperatorString(node.operatorToken.kind);
  if (!op) return undefined;
  const candidates = getOperatorCandidates(ctx.program, activated, op);
  let found: { rightOperandIsSelf: boolean; resultIsSelf: boolean } | undefined;
  let forType: ts.Type | undefined;
  let dispatchType = left;
  try {
    let right: ts.Type | null | undefined = null;
    const rightType = (): ts.Type | undefined => {
      if (right === null) right = rightOperandType(ctx, node, activated, hooks);
      return right;
    };
    let fallback: ts.Type[] | undefined;
    const fallbackTypes = (): ts.Type[] => {
      if (!fallback) {
        const r = rightType();
        fallback = r ? declaredDispatchTypes(ctx, node, left, r, hooks) : [];
      }
      return fallback;
    };
    for (const candidate of candidates) {
      let r = resolveInstance(ctx, candidate.typeclass, left, undefined, undefined, node);
      let via = left;
      if (!r) {
        for (const t of fallbackTypes()) {
          r = resolveInstance(ctx, candidate.typeclass, t, undefined, undefined, node);
          if (r) {
            via = t;
            break;
          }
        }
      }
      if (!r) continue;
      // Ambiguous, or two typeclasses apply: the rewrite reports it and stays native.
      if (r.kind === "ambiguous" || found) return undefined;
      found = candidate;
      forType = r.forType;
      dispatchType = via;
    }
    if (!found) return undefined;
    if (found.rightOperandIsSelf) {
      // An operator operand: already typed inside rewrittenChainType's
      // post-order walk (a cache hit, no recursion), computed here otherwise.
      const r = isPrimitiveTypedBinary(node.right)
        ? (rewrittenChainType(ctx, node.right, activated, hooks) ?? undefined)
        : rightType();
      if (!r || !ctx.typeChecker.isTypeAssignableTo(r, forType ?? dispatchType)) return undefined;
    }
  } catch (error) {
    hooks.warn(
      node,
      `typesugar could not check the operator chain at '${node.getText()}' (${error}); ` +
        `the operators it is an operand of stay native.`
    );
    return undefined;
  }
  return { resultIsSelf: found.resultIsSelf, dispatchType };
}

/**
 * Is the binary expression `node` rewritten by the typeclass-operator
 * rewrite? For the diagnostic filter, which must suppress TypeScript's
 * operand errors (TS2362/TS2363/TS2365) exactly where the operator goes away.
 * Mirrors `tryRewriteTypeclassOperator`'s decision: both operands typed as
 * rewritten (a chain, a const bound to a rewritten operator), the operand
 * types' nullability removed, a non-primitive left type, one instance from
 * scope (trying the operands' declared types for a narrowed operand, as the
 * rewrite does: {@link declaredDispatchTypes}), and a right operand that
 * fits. Returns the result type when the method returns the instance type,
 * else `true`; `undefined` when the operator stays native.
 */
export function operatorRewriteResult(
  ctx: MacroContext,
  node: ts.BinaryExpression,
  activated: ReadonlySet<string>,
  hooks: OperatorChainHooks
): ts.Type | true | undefined {
  if (activated.size === 0 || isSyntheticNode(node)) return undefined;
  if (isNullOrUndefinedExpr(node.left) || isNullOrUndefinedExpr(node.right)) return undefined;
  const checker = ctx.typeChecker;
  let left: ts.Type | undefined;
  try {
    left =
      rewrittenOperandType(ctx, node.left, activated, hooks) ??
      (isPrimitiveTypedBinary(node.left) ? undefined : checker.getTypeAtLocation(node.left));
    if (!left || (left.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0) {
      return undefined;
    }
    if (admitsNullish(left)) left = checker.getNonNullableType(left);
  } catch (error) {
    hooks.warn(node, `typesugar could not resolve the operand types of an operator (${error}).`);
    return undefined;
  }
  if (isPrimitiveByFlags(left)) return undefined;
  const step = operatorRewriteStep(ctx, node, left, activated, hooks);
  if (!step) return undefined;
  return step.resultIsSelf ? step.dispatchType : true;
}
