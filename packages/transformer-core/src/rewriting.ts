/**
 * Extension method rewriting, operator overloading, HKT transformation,
 * and tagged template / type macro handling.
 *
 * Each function takes explicit parameters instead of relying on class state,
 * so the MacroTransformer methods become thin delegation wrappers.
 */

import * as ts from "typescript";

import {
  getOperatorString,
  isKindAnnotation,
  transformHKTDeclaration,
  getOperatorCandidates,
  resolveInstance,
  type ResolvedInstance,
} from "@typesugar/macros";

import {
  MacroContextImpl,
  globalRegistry,
  type MacroDefinition,
  findStandaloneExtensions,
  getAllStandaloneExtensions,
  buildStandaloneExtensionCall,
  type StandaloneExtensionInfo,
  ExpressionMacro,
  TaggedTemplateMacroDef,
  TypeMacro,
  globalResolutionScope,
  isInOptedOutScope,
  isSyntheticNode,
  preserveSourceMap,
  getAllTypeRewrites,
  typeRewriteEntryCoversFile,
  type TypeRewriteEntry,
  type ConstructorRewrite,
  type MethodInlinePattern,
  extractTypeArgumentsContent,
  stripTypeArguments,
  cloneWithoutComments,
} from "@typesugar/core";

import { createMacroErrorExpression, type VisitFn } from "./transformer-utils.js";
import { receiverMatchesFirstParam } from "./import-resolution.js";
// Circular with method-sugar.ts (which imports buildInstanceReferenceExpression
// from here); both bindings are only used at call time.
import { inferMethodSugarCallType } from "./method-sugar.js";
import {
  emitOperatorSyntaxNotActivatedHint,
  findInactiveOperatorMatch,
  mayNeedOperatorActivationHint,
} from "./operator-activation.js";

// ---------------------------------------------------------------------------
// Callback types for cross-cutting concerns
// ---------------------------------------------------------------------------

export type ResolveMacroFn = (
  node: ts.Node,
  macroName: string,
  kind: MacroDefinition["kind"]
) => MacroDefinition | undefined;

export type ResolveExtensionFn = (
  node: ts.CallExpression,
  methodName: string,
  receiverType: ts.Type
) => StandaloneExtensionInfo | undefined;

// ---------------------------------------------------------------------------
// Tagged template expansion
// ---------------------------------------------------------------------------

export function tryExpandTaggedTemplate(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  resolveMacroFromSymbol: ResolveMacroFn,
  node: ts.TaggedTemplateExpression
): ts.Expression | undefined {
  if (isInOptedOutScope(ctx.sourceFile, node, globalResolutionScope, "macros")) {
    return undefined;
  }

  if (!ts.isIdentifier(node.tag)) return undefined;

  const tagName = node.tag.text;

  const taggedMacro = resolveMacroFromSymbol(node.tag, tagName, "tagged-template") as
    | TaggedTemplateMacroDef
    | undefined;
  if (taggedMacro) {
    if (verbose) {
      console.log(`[typesugar] Expanding tagged template macro: ${tagName}`);
    }

    try {
      if (taggedMacro.validate && !taggedMacro.validate(ctx, node)) {
        ctx.reportError(node, `Tagged template validation failed for '${tagName}'`);
        return createMacroErrorExpression(
          ctx.factory,
          `typesugar: tagged template '${tagName}' validation failed`
        );
      }

      const result = ctx.hygiene.withScope(() => taggedMacro.expand(ctx, node));
      if (result === (node as ts.Node)) {
        return ts.visitEachChild(node, visit, ctx.transformContext) as ts.Expression;
      }
      const visited = ts.visitNode(result, visit) as ts.Expression;
      return preserveSourceMap(visited, node);
    } catch (error) {
      ctx.reportError(node, `Tagged template macro expansion failed: ${error}`);
      return createMacroErrorExpression(
        ctx.factory,
        `typesugar: tagged template '${tagName}' expansion failed: ${error}`
      );
    }
  }

  const exprMacro = resolveMacroFromSymbol(node.tag, tagName, "expression") as
    | ExpressionMacro
    | undefined;
  if (!exprMacro) return undefined;

  if (verbose) {
    console.log(`[typesugar] Expanding tagged template via expression macro: ${tagName}`);
  }

  try {
    const result = ctx.hygiene.withScope(() =>
      exprMacro.expand(ctx, node as unknown as ts.CallExpression, [
        node.template as unknown as ts.Expression,
      ])
    );
    if (result === (node as unknown as ts.Expression)) {
      return ts.visitEachChild(node, visit, ctx.transformContext) as ts.Expression;
    }
    const visited = ts.visitNode(result, visit) as ts.Expression;
    return preserveSourceMap(visited, node);
  } catch (error) {
    ctx.reportError(node, `Tagged template macro expansion failed: ${error}`);
    return createMacroErrorExpression(
      ctx.factory,
      `typesugar: tagged template '${tagName}' expansion failed: ${error}`
    );
  }
}

// ---------------------------------------------------------------------------
// Type macro expansion
// ---------------------------------------------------------------------------

export function tryExpandTypeMacro(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  resolveMacroFromSymbol: ResolveMacroFn,
  node: ts.TypeReferenceNode
): ts.TypeNode | undefined {
  if (isInOptedOutScope(ctx.sourceFile, node, globalResolutionScope, "macros")) {
    return undefined;
  }

  let macroName: string | undefined;
  let identNode: ts.Node | undefined;

  if (ts.isIdentifier(node.typeName)) {
    macroName = node.typeName.text;
    identNode = node.typeName;
  } else if (ts.isQualifiedName(node.typeName)) {
    if (
      ts.isIdentifier(node.typeName.left) &&
      (node.typeName.left.text === "typesugar" || node.typeName.left.text === "typemacro")
    ) {
      macroName = node.typeName.right.text;
      identNode = node.typeName;
    }
  }

  if (!macroName || !identNode) return undefined;

  const macro = resolveMacroFromSymbol(identNode, macroName, "type") as TypeMacro | undefined;
  if (!macro) return undefined;

  if (verbose) {
    console.log(`[typesugar] Expanding type macro: ${macroName}`);
  }

  try {
    const typeArgs = node.typeArguments ? Array.from(node.typeArguments) : [];
    const result = ctx.hygiene.withScope(() => macro.expand(ctx, node, typeArgs));
    if (result === (node as ts.Node)) {
      return ts.visitEachChild(node, visit, ctx.transformContext) as ts.TypeNode;
    }
    const visited = ts.visitNode(result, visit) as ts.TypeNode;
    return preserveSourceMap(visited, node);
  } catch (error) {
    ctx.reportError(node, `Type macro expansion failed: ${error}`);
    return ts.visitEachChild(node, visit, ctx.transformContext) as ts.TypeNode;
  }
}

// ---------------------------------------------------------------------------
// Extension method rewriting
// ---------------------------------------------------------------------------

/**
 * Shared guards for both the type-rewrite-registry path
 * (`tryRewriteOpaqueMethodCall`, checked first) and the standalone-extension
 * path (`tryRewriteExtensionMethod`, checked second): an opted-out file or a
 * macro-producing receiver call must skip both. Legacy's `tryRewriteExtensionMethod`
 * checked these once, internally, before trying its type-rewrite-registry
 * sub-step then its extension fallback in the SAME function body; the split
 * into two top-level dispatch functions here means each must run this guard
 * on its own turn, but factoring it out keeps a change to either guard from
 * silently applying to only one of the two paths.
 */
function checkMethodCallDispatchGuards(
  ctx: MacroContextImpl,
  resolveMacroFromSymbol: ResolveMacroFn,
  node: ts.CallExpression
):
  | { propAccess: ts.PropertyAccessExpression; methodName: string; receiver: ts.Expression }
  | undefined {
  if (isInOptedOutScope(ctx.sourceFile, node, globalResolutionScope, "extensions")) {
    return undefined;
  }

  const propAccess = node.expression as ts.PropertyAccessExpression;
  const methodName = propAccess.name.text;
  const receiver = propAccess.expression;

  if (ts.isCallExpression(receiver) && ts.isIdentifier(receiver.expression)) {
    const calleeName = receiver.expression.text;
    const calleeMacro = resolveMacroFromSymbol(receiver.expression, calleeName, "expression");
    if (calleeMacro) {
      return undefined;
    }
  }

  return { propAccess, methodName, receiver };
}

export function tryRewriteExtensionMethod(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  resolveMacroFromSymbol: ResolveMacroFn,
  resolveExtensionFromImports: ResolveExtensionFn,
  node: ts.CallExpression
): ts.Expression | undefined {
  const guarded = checkMethodCallDispatchGuards(ctx, resolveMacroFromSymbol, node);
  if (!guarded) return undefined;
  const { methodName, receiver } = guarded;

  let receiverType = ctx.typeChecker.getTypeAtLocation(receiver);

  // `(1).to(5).reversed().toArray()`: the receiver `(1).to(5).reversed()` is
  // itself an extension call on a type with no such member (Range is a plain
  // interface, not a global augmentation), so the checker types it as an
  // error. Recover its type from the extension it will be rewritten to --
  // also through a variable it initialises (`const r = ...; r.toArray()`).
  if (!ctx.isTypeReliable(receiverType)) {
    receiverType =
      inferSugaredExpressionType(ctx, resolveExtensionFromImports, receiver, 0) ?? receiverType;
  }

  if (!ctx.isTypeReliable(receiverType)) {
    const couldBeExtension = getAllStandaloneExtensions().some((e) => e.methodName === methodName);
    if (couldBeExtension) {
      ctx.reportWarning(
        node,
        `typesugar skipped extension method '${methodName}' rewrite because the receiver type could not be resolved. Fix upstream type errors first.`
      );
    }
    return undefined;
  }

  const existingProp = receiverType.getProperty(methodName);

  let forceRewrite = false;
  if (existingProp) {
    const potentialExt = resolveExtensionFromImports(node, methodName, receiverType);
    if (potentialExt) {
      const receiverText = ts.isIdentifier(receiver) ? receiver.text : null;
      const isSameObject = receiverText && potentialExt.qualifier === receiverText;
      if (!isSameObject) {
        forceRewrite = true;
      }
    }
  }

  if (existingProp && !forceRewrite) {
    return undefined;
  }

  const typeName = ctx.typeChecker.typeToString(receiverType);

  // Normalize literal types to their base type for extension lookup --
  // otherwise a receiver the checker types as a literal (e.g. `(5).clamp(...)`)
  // would never match a "number" extension, since `typeToString` on it returns
  // the literal text ("5"), not "number". `getBaseTypeOfLiteralType` is a
  // no-op for non-literal types, so this is safe to call unconditionally --
  // the same idiom already used for this exact purpose in
  // `@typesugar/macros`'s sfinae-rules.ts/implicits.ts.
  const normalizedType = ctx.typeChecker.typeToString(
    ctx.typeChecker.getBaseTypeOfLiteralType(receiverType)
  );

  // Registry shape (CLAUDE.md): `standaloneExtensionRegistry` is a live keyed
  // registry, keyed by declaring file, so a same-file `@extension` registered
  // earlier in THIS pass is visible here and is preferred over other files'.
  // It is still process-wide, though: an entry may come from another file, an
  // earlier program (watch mode, LSP) or a compiled dist's self-registration.
  // The rewrite emits a bare `method(recv, ...)` / `Qualifier.method(recv, ...)`
  // and injects no import, so each candidate is only usable when its callee is
  // actually bound, and callable, at this call site. Otherwise fall through to
  // the import-scoped resolver below.
  const fromFile = ctx.sourceFile.fileName;
  const typeNames = [normalizedType, typeName, stripTypeArguments(typeName)].filter(
    (t, i, all) => all.indexOf(t) === i
  );
  let standaloneExt: StandaloneExtensionInfo | undefined;
  for (const t of typeNames) {
    standaloneExt = findStandaloneExtensions(methodName, t, fromFile).find((ext) =>
      isExtensionCalleeBound(ctx, node, ext)
    );
    if (standaloneExt) break;
  }

  if (!standaloneExt) {
    standaloneExt = resolveExtensionFromImports(node, methodName, receiverType);
    if (standaloneExt) {
      const receiverText = ts.isIdentifier(receiver) ? receiver.text : null;
      if (receiverText && standaloneExt.qualifier === receiverText) {
        standaloneExt = undefined;
      }
    }
  }

  if (!standaloneExt) {
    return undefined;
  }

  if (verbose) {
    const qual = standaloneExt.qualifier
      ? `${standaloneExt.qualifier}.${standaloneExt.methodName}`
      : standaloneExt.methodName;
    console.log(
      `[typesugar] Rewriting standalone extension: ${typeName}.${methodName}() → ${qual}(...)`
    );
  }

  const rewritten = buildStandaloneExtensionCall(
    ctx.factory,
    standaloneExt,
    receiver,
    Array.from(node.arguments)
  );

  try {
    const visited = ts.visitNode(rewritten, visit) as ts.Expression;
    return preserveSourceMap(visited, node);
  } catch (error) {
    ctx.reportError(node, `Extension method rewrite failed: ${error}`);
    return undefined;
  }
}

/**
 * The type an expression WILL have once typesugar's sugar is rewritten, for an
 * expression the checker could not type (an error type): an extension call or
 * typeclass method-sugar call (`p.clone()`), a parenthesised one, or an
 * identifier bound by an un-annotated `const`/`let` whose initializer is one
 * (`const r3 = (0).to(100).step(10); r3.toArray()`, docs authoring #1 /
 * start #3). Returns `undefined` when nothing can be inferred.
 *
 * Only ORIGINAL (parsed) nodes are inspected (CLAUDE.md): the receiver and the
 * variable's declaration both come from the program the checker was built
 * from, never from a synthesized rewrite. This reads declarations, not a
 * registry, so it has no same-pass-visibility concern.
 */
export function inferSugaredExpressionType(
  ctx: MacroContextImpl,
  resolveExtensionFromImports: ResolveExtensionFn,
  expr: ts.Expression,
  depth: number
): ts.Type | undefined {
  if (depth > 32 || isSyntheticNode(expr)) return undefined;
  const checker = ctx.typeChecker;
  let type: ts.Type;
  try {
    type = checker.getTypeAtLocation(expr);
  } catch (error) {
    ctx.reportWarning(
      expr,
      `typesugar could not resolve the type of a method-call receiver (${error}).`
    );
    return undefined;
  }
  if (ctx.isTypeReliable(type)) return type;

  if (ts.isParenthesizedExpression(expr)) {
    return inferSugaredExpressionType(ctx, resolveExtensionFromImports, expr.expression, depth + 1);
  }
  if (ts.isCallExpression(expr)) {
    return (
      inferExtensionCallType(ctx, resolveExtensionFromImports, expr, depth + 1) ??
      inferMethodSugarCallType(ctx, resolveExtensionFromImports, expr, depth + 1)
    );
  }
  if (ts.isIdentifier(expr)) {
    let decl: ts.Declaration | undefined;
    try {
      const sym = checker.getSymbolAtLocation(expr);
      decl = sym?.valueDeclaration;
    } catch (error) {
      ctx.reportWarning(expr, `typesugar could not resolve '${expr.text}' (${error}).`);
      return undefined;
    }
    if (
      decl &&
      ts.isVariableDeclaration(decl) &&
      !decl.type &&
      decl.initializer &&
      ts.isIdentifier(decl.name) &&
      !isSyntheticNode(decl.initializer) &&
      decl.getSourceFile() === expr.getSourceFile()
    ) {
      return inferSugaredExpressionType(
        ctx,
        resolveExtensionFromImports,
        decl.initializer,
        depth + 1
      );
    }
  }
  return undefined;
}

/**
 * The result type of `call` (`inner.method(args)`) when `method` is not a
 * member of `inner`'s type but resolves to an imported extension: the
 * extension function's return type. Recurses through a chain of such calls
 * (`(0).to(100).step(10).reversed()`) and through variables they initialise,
 * inside-out from the innermost receiver the checker can type.
 *
 * Only real (parsed) nodes are handed to the checker (CLAUDE.md): this runs
 * on the ORIGINAL receiver before any rewrite, never on a synthesized call.
 * Generic extension signatures are not instantiated (the public checker API
 * cannot infer them): their return type keeps its type parameters, which is
 * enough to resolve the next extension in a chain (see below).
 */
function inferExtensionCallType(
  ctx: MacroContextImpl,
  resolveExtensionFromImports: ResolveExtensionFn,
  call: ts.CallExpression,
  depth: number
): ts.Type | undefined {
  if (depth > 32 || isSyntheticNode(call) || !ts.isPropertyAccessExpression(call.expression)) {
    return undefined;
  }
  const checker = ctx.typeChecker;
  const methodName = call.expression.name.text;
  const inner = call.expression.expression;
  try {
    let innerType = checker.getTypeAtLocation(inner);
    if (!ctx.isTypeReliable(innerType)) {
      const inferred = inferSugaredExpressionType(
        ctx,
        resolveExtensionFromImports,
        inner,
        depth + 1
      );
      if (!inferred) return undefined;
      innerType = inferred;
    }
    // No "is it a real member?" bail-out: the checker already failed to type
    // this call (else we would not be here), and Range's own `step: number`
    // field is exactly such a member. The rewrite path forces an imported
    // extension over an existing member the same way.
    const ext = resolveExtensionFromImports(call, methodName, innerType);
    if (!ext) return undefined;
    const rootName = ext.qualifier ?? ext.methodName;
    // `Alias` too: an import binding is an alias symbol, which a plain
    // `Value` scope query leaves out.
    const sym = checker
      .getSymbolsInScope(call, ts.SymbolFlags.Value | ts.SymbolFlags.Alias)
      .find((s) => s.getName() === rootName);
    if (!sym) return undefined;
    let calleeType = checker.getTypeOfSymbolAtLocation(skipAlias(checker, sym), call);
    if (ext.qualifier) {
      const prop = calleeType.getProperty(ext.methodName);
      if (!prop) return undefined;
      calleeType = checker.getTypeOfSymbolAtLocation(prop, call);
    }
    const sigs = calleeType
      .getCallSignatures()
      .filter((s) => receiverMatchesFirstParam(checker, innerType, s, call));
    // Prefer a non-generic overload. A generic one (`EffectExt.map<A, E, B>
    // (self: Effect<A, E>, ...): Effect<B, E>`) cannot be instantiated through
    // the public checker API, so its return type keeps the signature's own
    // type parameters (`Effect<B, E>`). That is still enough to pick the NEXT
    // extension in a chain (`.flatMap`), whose first-parameter match treats
    // type parameters as wildcards; a bare type-parameter return (`A`) is not.
    const sig = sigs.find((s) => !s.getTypeParameters()?.length) ?? sigs[0];
    if (!sig) return undefined;
    const ret = checker.getReturnTypeOfSignature(sig);
    if (ret.flags & ts.TypeFlags.TypeParameter) return undefined;
    return ctx.isTypeReliable(ret) ? ret : undefined;
  } catch (error) {
    ctx.reportWarning(
      call,
      `typesugar could not infer the type of '${methodName}(...)' for a chained extension call (${error}).`
    );
    return undefined;
  }
}

/**
 * Is the callee a standalone-extension rewrite would emit bound at `node`, to
 * something callable? Bare form: `methodName` must resolve to a value with a
 * call signature; qualified form: `qualifier` must resolve to a value with a
 * `methodName` property.
 */
function isExtensionCalleeBound(
  ctx: MacroContextImpl,
  node: ts.CallExpression,
  ext: StandaloneExtensionInfo
): boolean {
  const rootName = ext.qualifier ?? ext.methodName;
  const checker = ctx.typeChecker;
  try {
    // A synthesized call has no scope of its own; fall back to the file's
    // top-level scope (CLAUDE.md: don't hand a synthetic node to the checker).
    const location: ts.Node = isProgramNode(node) ? node : ctx.sourceFile;
    const sym = checker
      .getSymbolsInScope(location, ts.SymbolFlags.Value)
      .find((s) => s.getName() === rootName);
    if (!sym) return false;
    const type = checker.getTypeOfSymbolAtLocation(skipAlias(checker, sym), location);
    if (ext.qualifier) {
      return type.getProperty(ext.methodName) !== undefined || ctx.isTypeReliable(type) === false;
    }
    return type.getCallSignatures().length > 0 || ctx.isTypeReliable(type) === false;
  } catch (error) {
    ctx.reportWarning(
      node,
      `typesugar skipped extension method '${ext.methodName}' rewrite: could not check that '${rootName}' is in scope (${error}).`
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// HKT transformation
// ---------------------------------------------------------------------------

export function tryTransformHKTDeclaration(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration
): ts.InterfaceDeclaration | ts.TypeAliasDeclaration | undefined {
  const typeParams = node.typeParameters;
  if (!typeParams) return undefined;

  let hasKA = false;
  for (const param of typeParams) {
    if (isKindAnnotation(param)) {
      hasKA = true;
      break;
    }
  }

  if (!hasKA) return undefined;

  if (verbose) {
    const name = node.name?.text ?? "Anonymous";
    console.log(`[typesugar] Transforming HKT declaration: ${name}`);
  }

  try {
    const transformed = transformHKTDeclaration(ctx, node);
    const visited = ts.visitEachChild(transformed, visit, ctx.transformContext) as
      | ts.InterfaceDeclaration
      | ts.TypeAliasDeclaration;
    return preserveSourceMap(visited, node);
  } catch (error) {
    ctx.reportError(node, `HKT transformation failed: ${error}`);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Operator rewriting entry point (PEP-052: import-scoped, registry-free)
// ---------------------------------------------------------------------------

function isNullOrUndefinedExpr(node: ts.Expression): boolean {
  if (node.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isIdentifier(node) && node.text === "undefined") return true;
  if (ts.isVoidExpression(node)) return true;
  return false;
}

/**
 * Whether operator rewriting is opted out at `node`: the whole file
 * (`"use no typesugar"`), the documented `operators` feature
 * (`"use no typesugar operators"`, `// @ts-no-typesugar operators`), or the
 * `extensions` feature, which gated operator rewriting before the `operators`
 * feature was honored here and is kept so existing opt-outs keep working.
 */
function isOperatorRewriteOptedOut(ctx: MacroContextImpl, node: ts.Node): boolean {
  return (
    isInOptedOutScope(ctx.sourceFile, node, globalResolutionScope, "operators") ||
    isInOptedOutScope(ctx.sourceFile, node, globalResolutionScope, "extensions")
  );
}

const OPERATOR_PRIMITIVE_TYPES = new Set([
  "number",
  "string",
  "boolean",
  "bigint",
  "null",
  "undefined",
  "any",
  "unknown",
]);

export function tryRewriteTypeclassOperator(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  node: ts.BinaryExpression
): ts.Expression | undefined {
  // Skip synthetic nodes (from macro-generated code) — the checker can crash.
  if (isSyntheticNode(node)) return undefined;
  if (isOperatorRewriteOptedOut(ctx, node)) return undefined;

  const opString = getOperatorString(node.operatorToken.kind);
  if (!opString) return undefined;

  // PEP-052 activation gate: rewrite only if the file activated a typeclass that
  // maps this operator (imported `@syntax-operators` marker or in-file `@typeclass`).
  const sfn = ctx.sourceFile.fileName;
  const activatedOps = globalResolutionScope.getActivatedOperatorSyntax(sfn);
  const definedTcs = globalResolutionScope.getDefinedTypeclasses(sfn);
  const activatedForOps =
    definedTcs.size === 0 ? activatedOps : new Set([...activatedOps, ...definedTcs]);

  const candidates =
    activatedForOps.size === 0 ? [] : getOperatorCandidates(ctx.program, activatedForOps, opString);
  // TS9804: a typeclass that is NOT activated here may map this operator. Only
  // the program's cached typeclass index is consulted at this point; the
  // instance lookup waits until the operand type is known to be non-primitive.
  const mayHint = mayNeedOperatorActivationHint(ctx, node, opString, "binary", activatedForOps);
  if (candidates.length === 0 && !mayHint) return undefined;

  if (isNullOrUndefinedExpr(node.right) || isNullOrUndefinedExpr(node.left)) return undefined;

  if (isSyntheticNode(node.left) || isSyntheticNode(node.right)) return undefined;
  // An operand that is itself `a + b`, `a < b`, ... is typed number, bigint,
  // string, boolean or any by TypeScript's own rules, never an instance type,
  // so it can't dispatch (nor need a TS9804 hint). Decided without the
  // checker: its type of a binary expression is not cached, so asking for it
  // re-checks the whole subtree, and doing that at every level of
  // `1 + 1 + ... + 1` made a 10,000-term line take tens of minutes.
  if (isPrimitiveTypedBinary(node.left)) return undefined;

  const operandTypeFailed = (error: unknown): undefined => {
    ctx.reportWarning(
      node,
      candidates.length > 0
        ? `typesugar skipped typeclass operator rewrite of '${opString}': ` +
            `the operand types could not be resolved (${error}).`
        : `typesugar could not check whether '${opString}' needs a typeclass ` +
            `operator-syntax import: the operand types could not be resolved (${error}).`
    );
    return undefined;
  };

  // The left operand first: the right one is only needed when the left can
  // dispatch (so a right-nested chain isn't re-checked at each level either).
  let leftType: ts.Type;
  try {
    leftType = ctx.typeChecker.getTypeAtLocation(node.left);
  } catch (error) {
    return operandTypeFailed(error);
  }
  if ((leftType.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0) return undefined;

  // An operand whose type admits null/undefined (`P | undefined`, visible
  // under strictNullChecks): the instance is resolved for the non-null type,
  // and a comparison keeps the native result when that operand is nullish at
  // run time (see buildNullSafeComparison), instead of passing it to the
  // instance, which would throw. Decided by the type's flags, not its text.
  const nullableLeft = admitsNullish(leftType);
  let typeName: string;
  try {
    if (nullableLeft) leftType = ctx.typeChecker.getNonNullableType(leftType);
    typeName = ctx.typeChecker.typeToString(leftType);
  } catch (error) {
    return operandTypeFailed(error);
  }
  if (OPERATOR_PRIMITIVE_TYPES.has(stripTypeArguments(typeName))) return undefined;

  let rightType: ts.Type;
  try {
    rightType = ctx.typeChecker.getTypeAtLocation(node.right);
  } catch (error) {
    return operandTypeFailed(error);
  }
  if ((rightType.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0) return undefined;
  const nullableRight = admitsNullish(rightType);
  try {
    if (nullableRight) rightType = ctx.typeChecker.getNonNullableType(rightType);
  } catch (error) {
    return operandTypeFailed(error);
  }

  // The operand's type at the operator may be NARROWED: `const s: Shape =
  // { kind: "c", r: 1 }` makes `s` the "c" variant there, and the instance is
  // `Shape`'s. When the narrowed type has none, the operands' declared types
  // (the variable's or property's, by symbol) are tried, left then right.
  let dispatchTypes: ts.Type[] | undefined;
  const typesToTry = (): ts.Type[] => {
    if (dispatchTypes) return dispatchTypes;
    dispatchTypes = [];
    for (const operand of [node.left, node.right]) {
      const declared = declaredOperandType(ctx, operand);
      if (declared && declared !== leftType && !dispatchTypes.includes(declared)) {
        dispatchTypes.push(declared);
      }
    }
    return dispatchTypes;
  };
  /** No activated typeclass rewrote this: warn if an inactive one would have. */
  const hintIfInactiveMatch = (): undefined => {
    if (!mayHint) return undefined;
    let inactive: { typeclass: string; method: string } | undefined;
    try {
      for (const operandType of [leftType, ...typesToTry()]) {
        inactive = findInactiveOperatorMatch(ctx, {
          operator: opString,
          arity: "binary",
          activated: activatedForOps,
          operandType,
          rightType,
        });
        if (inactive) break;
      }
    } catch (error) {
      ctx.reportWarning(
        node,
        `typesugar could not check whether '${opString}' on '${typeName}' needs a ` +
          `typeclass operator-syntax import (${error}).`
      );
      return undefined;
    }
    if (inactive) {
      emitOperatorSyntaxNotActivatedHint(ctx, node.operatorToken, opString, typeName, inactive);
    }
    return undefined;
  };

  // Resolve an instance for the operand type from scope (no global registry).
  let matched:
    | { typeclass: string; method: string; rightOperandIsSelf: boolean; resolved: ResolvedInstance }
    | undefined;
  for (const candidate of candidates) {
    let result = resolveInstance(ctx, candidate.typeclass, leftType);
    if (!result) {
      for (const t of typesToTry()) {
        result = resolveInstance(ctx, candidate.typeclass, t);
        if (result) break;
      }
    }
    if (!result) continue;
    if (result.kind === "ambiguous") {
      ctx.reportError(
        node,
        `Ambiguous ${candidate.typeclass} instance for type '${typeName}': ` +
          `${result.candidates.map((c) => c.exportName).join(", ")}. ` +
          `Import exactly one instance to disambiguate.`
      );
      return undefined;
    }
    if (matched) {
      ctx.reportError(
        node,
        `Ambiguous operator '${opString}' for type '${typeName}': both ` +
          `${matched.typeclass}.${matched.method} and ` +
          `${candidate.typeclass}.${candidate.method} apply. ` +
          `Use explicit method calls to disambiguate.`
      );
      return undefined;
    }
    matched = {
      typeclass: candidate.typeclass,
      method: candidate.method,
      rightOperandIsSelf: candidate.rightOperandIsSelf,
      resolved: result,
    };
  }

  if (!matched) return hintIfInactiveMatch();

  // The instance was resolved from the LEFT operand only. For a method whose
  // right parameter is the typeclass's type parameter (`add(a: A, b: A)`), the
  // right operand must be the instance type too: `v + 5` must not become
  // `add(v, 5)` (which inlines to `5..x`). Leave it native and say why.
  if (matched.rightOperandIsSelf) {
    let rightOk = true;
    try {
      rightOk = ctx.typeChecker.isTypeAssignableTo(rightType, matched.resolved.forType);
    } catch (error) {
      ctx.reportWarning(
        node,
        `typesugar skipped typeclass operator rewrite of '${opString}': ` +
          `the right operand's type could not be checked (${error}).`
      );
      return undefined;
    }
    if (!rightOk) {
      const rightName = ctx.typeChecker.typeToString(
        ctx.typeChecker.getBaseTypeOfLiteralType(rightType)
      );
      ctx.reportError(
        node,
        `Operator '${opString}' on '${typeName}' dispatches to ` +
          `${matched.typeclass}.${matched.method}, whose right operand must also be ` +
          `'${matched.resolved.forTypeString || typeName}', but it is '${rightName}'. ` +
          `The expression was left as a native '${opString}'. Convert the right operand, ` +
          `or call the instance method explicitly.`
      );
      return undefined;
    }
  }

  if (verbose) {
    console.log(
      `[typesugar] Rewriting operator: ${typeName} ${opString} → ` +
        `${matched.typeclass}.${matched.method}()`
    );
  }

  const factory = ctx.factory;
  const left = ts.visitNode(node.left, visit) as ts.Expression;
  const right = ts.visitNode(node.right, visit) as ts.Expression;

  // Emit instanceRef.method(left, right). The export name may be a companion path
  // (e.g. "Point.Eq"). If the instance was resolved via a cross-module scan
  // (not local scope), ensure its base name is actually imported -- otherwise
  // the emitted reference can be dangling. Uses the identifier ensureImport
  // returns (which may be a conflict-safe alias) rather than a fresh one.
  const instName = matched.resolved.exportName;
  let importedIdentifier: ts.Identifier | undefined;
  if (matched.resolved.importSpecifier && matched.resolved.source !== "local-scope") {
    const importName = instName.includes(".") ? instName.split(".")[0] : instName;
    importedIdentifier = ctx.ensureImport(importName, matched.resolved.importSpecifier);
  }
  const instanceRef = buildInstanceReferenceExpression(factory, instName, importedIdentifier);
  const methodAccess = factory.createPropertyAccessExpression(instanceRef, matched.method);
  if ((nullableLeft || nullableRight) && COMPARISON_OPERATORS.has(node.operatorToken.kind)) {
    return preserveSourceMap(
      buildNullSafeComparison(
        ctx,
        node.operatorToken.kind as ts.BinaryOperator,
        methodAccess,
        cloneWithoutComments(left),
        cloneWithoutComments(right),
        nullableLeft,
        nullableRight
      ),
      node
    );
  }
  const rewritten = factory.createCallExpression(methodAccess, undefined, [
    cloneWithoutComments(left),
    cloneWithoutComments(right),
  ]);
  return preserveSourceMap(rewritten, node);
}

/**
 * The declared (un-narrowed) type of an operand that names a variable,
 * parameter or property, without null/undefined, or undefined. Read from the
 * symbol, not the expression, so assignment narrowing doesn't apply. A
 * synthetic node is outside the checker's contract (CLAUDE.md): undefined.
 */
function declaredOperandType(ctx: MacroContextImpl, operand: ts.Expression): ts.Type | undefined {
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
    ctx.reportWarning(
      operand,
      `typesugar could not read the declared type of '${e.getText()}' for an operator ` +
        `rewrite (${error}); its narrowed type is used.`
    );
    return undefined;
  }
}

/**
 * Binary operators whose result TypeScript types as number, bigint, string,
 * boolean or any whatever the operands (arithmetic, bitwise, comparison,
 * `in`, `instanceof`): never a type with an instance.
 */
const PRIMITIVE_RESULT_OPERATORS = new Set<ts.SyntaxKind>([
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

/** `e` (parentheses aside) is a binary expression whose TypeScript type is primitive or any. */
function isPrimitiveTypedBinary(e: ts.Expression): boolean {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return ts.isBinaryExpression(e) && PRIMITIVE_RESULT_OPERATORS.has(e.operatorToken.kind);
}

/** Operators whose native result on a nullish operand is a boolean, never a throw. */
const COMPARISON_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
]);

/** `t` is, or is a union with, `null`/`undefined`/`void` (only visible under strictNullChecks). */
function admitsNullish(t: ts.Type): boolean {
  const nullish = ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void;
  return t.isUnion() ? t.types.some((m) => (m.flags & nullish) !== 0) : (t.flags & nullish) !== 0;
}

/** Reading it again has no effect and gives the same value (no getter, no call). */
function isRereadable(e: ts.Expression): boolean {
  return (
    ts.isIdentifier(e) ||
    e.kind === ts.SyntaxKind.ThisKeyword ||
    ts.isStringLiteral(e) ||
    ts.isNumericLiteral(e) ||
    ts.isBigIntLiteral(e) ||
    e.kind === ts.SyntaxKind.TrueKeyword ||
    e.kind === ts.SyntaxKind.FalseKeyword
  );
}

/**
 * `l OP r` dispatched to `method(l, r)`, except when a nullable operand is
 * null or undefined, where it is the native `l OP r`:
 *
 *   c === a   →   c == null ? c === a : P.Eq.equals(c, a)
 *
 * So `===` on two nullish values, or on one, gives exactly what it gave
 * before the rewrite, and the instance is only ever called with non-null
 * values. Operands are evaluated once, in order: anything other than an
 * identifier, `this` or a literal is passed as an argument of an arrow
 * function, `((l, r) => ...)(f(), g())`.
 */
function buildNullSafeComparison(
  ctx: MacroContextImpl,
  op: ts.BinaryOperator,
  method: ts.Expression,
  left: ts.Expression,
  right: ts.Expression,
  nullableLeft: boolean,
  nullableRight: boolean
): ts.Expression {
  const f = ctx.factory;
  const inline = isRereadable(left) && isRereadable(right);
  // The arrow's body references only its parameters and the instance, so a
  // parameter needs only to differ from the instance reference's root name.
  let root: ts.Expression = method;
  while (ts.isPropertyAccessExpression(root)) root = root.expression;
  const taken = ts.isIdentifier(root) ? root.text : "";
  const param = (base: string) => (base === taken ? `${base}_` : base);
  const lName = inline ? undefined : param("l");
  const rName = inline ? undefined : param("r");
  const l = (): ts.Expression => (lName ? f.createIdentifier(lName) : cloneWithoutComments(left));
  const r = (): ts.Expression => (rName ? f.createIdentifier(rName) : cloneWithoutComments(right));
  const isNullish = (e: ts.Expression) =>
    f.createBinaryExpression(e, ts.SyntaxKind.EqualsEqualsToken, f.createNull());
  const tests = [
    ...(nullableLeft ? [isNullish(l())] : []),
    ...(nullableRight ? [isNullish(r())] : []),
  ];
  const anyNullish = tests.reduce((acc, t) =>
    f.createBinaryExpression(acc, ts.SyntaxKind.BarBarToken, t)
  );
  const body = f.createConditionalExpression(
    anyNullish,
    f.createToken(ts.SyntaxKind.QuestionToken),
    f.createBinaryExpression(l(), op, r()),
    f.createToken(ts.SyntaxKind.ColonToken),
    f.createCallExpression(method, undefined, [l(), r()])
  );
  if (inline) return f.createParenthesizedExpression(body);
  const arrow = f.createArrowFunction(
    undefined,
    undefined,
    [
      f.createParameterDeclaration(undefined, undefined, lName!),
      f.createParameterDeclaration(undefined, undefined, rName!),
    ],
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    body
  );
  return f.createCallExpression(f.createParenthesizedExpression(arrow), undefined, [left, right]);
}

/** Prefix-unary operator tokens that `@op` on a one-parameter method can map. */
function getPrefixUnaryOperatorString(kind: ts.SyntaxKind): string | undefined {
  switch (kind) {
    case ts.SyntaxKind.MinusToken:
      return "-";
    case ts.SyntaxKind.PlusToken:
      return "+";
    case ts.SyntaxKind.ExclamationToken:
      return "!";
    case ts.SyntaxKind.TildeToken:
      return "~";
    default:
      return undefined;
  }
}

/**
 * Prefix-unary counterpart of {@link tryRewriteTypeclassOperator}: `-v` →
 * `instance.negate(v)` when an activated typeclass declares `@op -` on a
 * ONE-parameter method (`negate(a: A): A`) and an instance for the operand's
 * type is in scope. Same activation gate, primitive/nullish guards and
 * instance resolution as the binary form; `++`/`--` are never dispatched.
 */
export function tryRewriteTypeclassUnaryOperator(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  node: ts.PrefixUnaryExpression
): ts.Expression | undefined {
  if (isSyntheticNode(node) || isSyntheticNode(node.operand)) return undefined;
  if (isOperatorRewriteOptedOut(ctx, node)) return undefined;

  const opString = getPrefixUnaryOperatorString(node.operator);
  if (!opString) return undefined;

  const sfn = ctx.sourceFile.fileName;
  const activatedOps = globalResolutionScope.getActivatedOperatorSyntax(sfn);
  const definedTcs = globalResolutionScope.getDefinedTypeclasses(sfn);
  const activatedForOps =
    definedTcs.size === 0 ? activatedOps : new Set([...activatedOps, ...definedTcs]);

  const candidates =
    activatedForOps.size === 0
      ? []
      : getOperatorCandidates(ctx.program, activatedForOps, opString, "unary");
  // TS9804 pre-check (index only, no checker call) — see the binary form.
  const mayHint = mayNeedOperatorActivationHint(ctx, node, opString, "unary", activatedForOps);
  if (candidates.length === 0 && !mayHint) return undefined;
  if (isNullOrUndefinedExpr(node.operand)) return undefined;

  let operandType: ts.Type;
  let typeName: string;
  try {
    operandType = ctx.typeChecker.getTypeAtLocation(node.operand);
    typeName = ctx.typeChecker.typeToString(operandType);
  } catch (error) {
    ctx.reportWarning(
      node,
      candidates.length > 0
        ? `typesugar skipped typeclass operator rewrite of unary '${opString}': ` +
            `the operand type could not be resolved (${error}).`
        : `typesugar could not check whether unary '${opString}' needs a typeclass ` +
            `operator-syntax import: the operand type could not be resolved (${error}).`
    );
    return undefined;
  }
  if ((operandType.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0) return undefined;
  if (OPERATOR_PRIMITIVE_TYPES.has(stripTypeArguments(typeName))) return undefined;
  const base = ctx.typeChecker.getBaseTypeOfLiteralType(operandType);
  if (OPERATOR_PRIMITIVE_TYPES.has(ctx.typeChecker.typeToString(base))) return undefined;

  let matched: { typeclass: string; method: string; resolved: ResolvedInstance } | undefined;
  for (const candidate of candidates) {
    const result = resolveInstance(ctx, candidate.typeclass, operandType);
    if (!result) continue;
    if (result.kind === "ambiguous") {
      ctx.reportError(
        node,
        `Ambiguous ${candidate.typeclass} instance for type '${typeName}': ` +
          `${result.candidates.map((c) => c.exportName).join(", ")}. ` +
          `Import exactly one instance to disambiguate.`
      );
      return undefined;
    }
    if (matched) {
      ctx.reportError(
        node,
        `Ambiguous unary operator '${opString}' for type '${typeName}': both ` +
          `${matched.typeclass}.${matched.method} and ` +
          `${candidate.typeclass}.${candidate.method} apply. ` +
          `Use explicit method calls to disambiguate.`
      );
      return undefined;
    }
    matched = { typeclass: candidate.typeclass, method: candidate.method, resolved: result };
  }
  if (!matched) {
    if (!mayHint) return undefined;
    let inactive: { typeclass: string; method: string } | undefined;
    try {
      inactive = findInactiveOperatorMatch(ctx, {
        operator: opString,
        arity: "unary",
        activated: activatedForOps,
        operandType,
      });
    } catch (error) {
      ctx.reportWarning(
        node,
        `typesugar could not check whether unary '${opString}' on '${typeName}' needs a ` +
          `typeclass operator-syntax import (${error}).`
      );
      return undefined;
    }
    if (inactive) emitOperatorSyntaxNotActivatedHint(ctx, node, opString, typeName, inactive);
    return undefined;
  }

  if (verbose) {
    console.log(
      `[typesugar] Rewriting unary operator: ${opString}${typeName} → ` +
        `${matched.typeclass}.${matched.method}()`
    );
  }

  const factory = ctx.factory;
  const operand = ts.visitNode(node.operand, visit) as ts.Expression;
  const instName = matched.resolved.exportName;
  let importedIdentifier: ts.Identifier | undefined;
  if (matched.resolved.importSpecifier && matched.resolved.source !== "local-scope") {
    const importName = instName.includes(".") ? instName.split(".")[0] : instName;
    importedIdentifier = ctx.ensureImport(importName, matched.resolved.importSpecifier);
  }
  const instanceRef = buildInstanceReferenceExpression(factory, instName, importedIdentifier);
  const rewritten = factory.createCallExpression(
    factory.createPropertyAccessExpression(instanceRef, matched.method),
    undefined,
    [cloneWithoutComments(operand)]
  );
  return preserveSourceMap(rewritten, node);
}

/**
 * Build the reference expression for a resolved companion/instance export name --
 * a dotted companion path (`"Point.Eq"`) becomes a property access on its base
 * (`Point.Eq`); a bare name (`"eqPoint"`) becomes a plain identifier.
 *
 * `baseIdentifier`, if provided, is used for the base of a dotted path (or as
 * the whole reference for a bare name) instead of a fresh identifier -- callers
 * that already resolved a hygienic (possibly aliased) identifier via
 * `ctx.ensureImport`/`ctx.safeRef` should pass it here so the emitted reference
 * matches whatever was actually imported.
 */
export function buildInstanceReferenceExpression(
  factory: ts.NodeFactory,
  instName: string,
  baseIdentifier?: ts.Identifier
): ts.Expression {
  const dotIndex = instName.indexOf(".");
  if (dotIndex === -1) {
    return baseIdentifier ?? factory.createIdentifier(instName);
  }
  const base = baseIdentifier ?? factory.createIdentifier(instName.slice(0, dotIndex));
  return factory.createPropertyAccessExpression(base, instName.slice(dotIndex + 1));
}

// ---------------------------------------------------------------------------
// @opaque type rewrite — method, constructor, and accessor erasure (PEP-012)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Declaration identity for @opaque / @adt registry entries
// ---------------------------------------------------------------------------
//
// Registry shape (CLAUDE.md "Resolving things a macro just generated"): the
// type-rewrite registry is a LIVE KEYED REGISTRY read within the same pass --
// same-project `@opaque`/`@adt` entries are registered when the defining file
// is transformed, `.d.ts` entries by `discoverOpaqueTypesFromImports` before a
// consuming file's visitor pass. It is process-global, though, so an entry may
// have been registered by a DIFFERENT file (or program). That is why every
// lookup below first resolves the reference's symbol through the checker
// (following import aliases) and only accepts an entry whose declaring
// file/module is where that symbol is declared -- never a bare-name match. A
// same-named but unrelated `function Some`, `enum { None }`, `const None` or
// `class Option` therefore never matches, regardless of which files were
// transformed earlier in the process.

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Strip a TS/JS (including `.d.ts`) extension from a normalized path. */
function stripScriptExtension(p: string): string {
  return p.replace(/\.d\.[cm]?ts$/, "").replace(/\.[cm]?[jt]sx?$/, "");
}

// `typeRewriteEntryCoversFile` lives in @typesugar/core (type-rewrite-registry.ts)
// so the macros diagnostic-suppression rule uses the exact same membership test.
export { typeRewriteEntryCoversFile };

/** Does any declaration of `sym` live in a file belonging to `entry`? */
function symbolDeclaredByEntry(sym: ts.Symbol, entry: TypeRewriteEntry): boolean {
  for (const decl of sym.declarations ?? []) {
    if (typeRewriteEntryCoversFile(decl.getSourceFile().fileName, entry)) return true;
  }
  return false;
}

/** Is the file being transformed the entry's own defining module (transparent scope)? */
function isInDefiningModule(ctx: MacroContextImpl, entry: TypeRewriteEntry): boolean {
  const fileName = ctx.sourceFile.fileName;
  if (entry.declarationFile) {
    return (
      stripScriptExtension(normalizeSlashes(entry.declarationFile)) ===
      stripScriptExtension(normalizeSlashes(fileName))
    );
  }
  return !!entry.sourceModule && isWithinSourceModule(fileName, entry.sourceModule);
}

function skipAlias(checker: ts.TypeChecker, sym: ts.Symbol): ts.Symbol {
  if (sym.flags & ts.SymbolFlags.Alias) {
    const target = checker.getAliasedSymbol(sym);
    if (target) return target;
  }
  return sym;
}

/** A node that is part of the parsed program (safe to hand to the checker). */
function isProgramNode(node: ts.Node): boolean {
  return !isSyntheticNode(node) && node.parent !== undefined;
}

/**
 * Resolve the symbol an identifier refers to, through import aliases.
 *
 * Real (parsed) nodes go to the checker directly. A macro-synthesized node is
 * outside the checker's contract (CLAUDE.md), so it is resolved by name
 * against the current file's top-level scope instead (imports + top-level
 * declarations) -- what generated code referencing `Some`/`None` binds to.
 * A checker failure is surfaced as a warning and treated as "no match".
 */
function resolveReferencedSymbol(
  ctx: MacroContextImpl,
  node: ts.Identifier,
  meaning: ts.SymbolFlags
): ts.Symbol | undefined {
  const checker = ctx.typeChecker;
  try {
    let sym: ts.Symbol | undefined;
    if (isProgramNode(node)) {
      sym =
        ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
          ? checker.getShorthandAssignmentValueSymbol(node.parent)
          : checker.getSymbolAtLocation(node);
    } else {
      const original = ts.getOriginalNode(node);
      if (original !== node && ts.isIdentifier(original) && isProgramNode(original)) {
        sym = checker.getSymbolAtLocation(original);
      } else {
        sym = checker
          .getSymbolsInScope(ctx.sourceFile, meaning)
          .find((s) => s.getName() === node.text);
      }
    }
    return sym ? skipAlias(checker, sym) : undefined;
  } catch (error) {
    ctx.reportWarning(
      node,
      `typesugar skipped @opaque erasure of '${node.text}': its declaration could not be resolved (${error}).`
    );
    return undefined;
  }
}

/**
 * Find the registry entry describing `type` -- matched by the type's own
 * (alias) symbol AND its declaring file, not by `typeToString` text alone.
 * Two unrelated types that share a name (the user's `class Option` and
 * `@typesugar/fp`'s `Option`) resolve to different entries, or none.
 */
function resolveTypeRewriteEntry(
  type: ts.Type
): { entry: TypeRewriteEntry; typeName: string } | undefined {
  const all = getAllTypeRewrites();
  if (all.length === 0) return undefined;
  for (const sym of [type.aliasSymbol, type.getSymbol()]) {
    if (!sym) continue;
    const name = sym.getName();
    // Latest registration first, matching getTypeRewrite's precedence.
    for (let i = all.length - 1; i >= 0; i--) {
      const entry = all[i];
      if (entry.typeName === name && symbolDeclaredByEntry(sym, entry)) {
        return { entry, typeName: name };
      }
    }
  }
  return undefined;
}

/**
 * Find the entry + rewrite rule for a constructor/constant reference
 * (`Some` in `Some(x)`, `None`). Cheap name pre-filter first (no checker call
 * unless some entry has a constructor of that name), then resolve the
 * identifier's symbol and require it to be declared by that entry.
 */
function resolveConstructorRewrite(
  ctx: MacroContextImpl,
  ident: ts.Identifier
): { entry: TypeRewriteEntry; ctor: ConstructorRewrite } | undefined {
  const name = ident.text;
  const candidates = getAllTypeRewrites().filter((e) => e.constructors?.has(name));
  if (candidates.length === 0) return undefined;

  const sym = resolveReferencedSymbol(ctx, ident, ts.SymbolFlags.Value);
  // Renamed imports (`import { Other as Some }`) resolve to a different name.
  if (!sym || sym.getName() !== name) return undefined;

  for (let i = candidates.length - 1; i >= 0; i--) {
    const entry = candidates[i];
    if (symbolDeclaredByEntry(sym, entry)) {
      return { entry, ctor: entry.constructors!.get(name)! };
    }
  }
  return undefined;
}

/**
 * Is this identifier a value REFERENCE (something `None` -> `null` could
 * replace)? Declaration names, property names/keys, enum members, labels,
 * import/export specifiers, shorthand properties and type positions are not.
 */
function isValueReferencePosition(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return true; // synthetic expression node
  if ((parent as { name?: ts.Node }).name === node) {
    // `x.None`, `{ None: 1 }`, `enum E { None }`, `function None() {}`, `const None`,
    // `class C { None() {} }`, `{ None }` (can't be replaced by a literal), ...
    return false;
  }
  if ((parent as { propertyName?: ts.Node }).propertyName === node) return false;
  if ((parent as { label?: ts.Node }).label === node) return false;
  if (
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isImportEqualsDeclaration(parent) ||
    ts.isQualifiedName(parent) ||
    ts.isTypeReferenceNode(parent) ||
    ts.isTypeQueryNode(parent) ||
    ts.isExpressionWithTypeArguments(parent) ||
    ts.isMetaProperty(parent)
  ) {
    return false;
  }
  return true;
}

function buildConstantExpression(factory: ts.NodeFactory, value: string): ts.Expression {
  switch (value) {
    case "null":
      return factory.createNull();
    case "undefined":
      return factory.createIdentifier("undefined");
    case "true":
      return factory.createTrue();
    case "false":
      return factory.createFalse();
    default: {
      const num = Number(value);
      if (!isNaN(num)) {
        return factory.createNumericLiteral(num);
      }
      if (value.startsWith('"') || value.startsWith("'")) {
        return factory.createStringLiteral(value.slice(1, -1));
      }
      return factory.createIdentifier(value);
    }
  }
}

/** Check if a path is absolute (Unix `/...` or Windows `C:/...` / `C:\...`). Browser-safe. */
function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[/\\]/.test(p);
}

function isWithinSourceModule(filePath: string, sourceModule: string): boolean {
  const normFile = filePath.replace(/\\/g, "/");
  const normModule = sourceModule.replace(/\\/g, "/");
  if (isAbsolutePath(normModule)) {
    return normFile === normModule;
  }
  const modulePath = normModule.replace(/^@/, "");
  const fileNoExt = normFile.replace(/\.[^/.]+$/, "");
  return fileNoExt.endsWith(modulePath) || fileNoExt.endsWith(modulePath + "/index");
}

/**
 * Rewrite a method call on an @opaque type.
 *
 * When a `methodInlines` pattern is registered for the method, the call is
 * inlined to a null-check expression (e.g., `x.map(fn)` → `x != null ? fn(x) : null`).
 * When the receiver is a literal `null`, the expression is constant-folded.
 * Falls back to standalone function call rewriting when no inline pattern exists.
 */
export function tryRewriteOpaqueMethodCall(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  resolveMacroFromSymbol: ResolveMacroFn,
  node: ts.CallExpression
): ts.Expression | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;

  const guarded = checkMethodCallDispatchGuards(ctx, resolveMacroFromSymbol, node);
  if (!guarded) return undefined;
  const { methodName, receiver } = guarded;

  if (getAllTypeRewrites().length === 0) return undefined;
  // The checker can't type a macro-synthesized receiver (CLAUDE.md).
  if (!isProgramNode(receiver)) return undefined;

  let receiverType: ts.Type;
  try {
    receiverType = ctx.typeChecker.getTypeAtLocation(receiver);
  } catch (error) {
    ctx.reportWarning(
      node,
      `typesugar skipped @opaque method erasure of '.${methodName}()': the receiver type could not be resolved (${error}).`
    );
    return undefined;
  }
  if (!ctx.isTypeReliable(receiverType)) return undefined;

  // Matched by the receiver type's declaration, not its name (see
  // resolveTypeRewriteEntry): an unrelated `class Option` is never rewritten.
  const resolvedEntry = resolveTypeRewriteEntry(receiverType);
  if (!resolvedEntry) return undefined;
  const { entry, typeName } = resolvedEntry;

  if (entry.transparent && isInDefiningModule(ctx, entry)) {
    return undefined;
  }

  const methods = entry.methods;
  if (!methods) return undefined;

  const standaloneFnName = methods.get(methodName);
  if (!standaloneFnName) return undefined;

  const inlinePattern = entry.methodInlines?.get(methodName);
  if (inlinePattern) {
    const visitedReceiver = ts.visitNode(receiver, visit) as ts.Expression;
    const visitedArgs = node.arguments.map((a) => ts.visitNode(a, visit) as ts.Expression);
    const result = buildOpaqueInlineExpression(
      ctx.factory,
      (prefix) => ctx.generateUniqueName(prefix),
      inlinePattern,
      visitedReceiver,
      visitedArgs,
      verbose,
      typeName,
      methodName
    );
    if (result) return preserveSourceMap(result, node);
  }

  // Schedule an import if the standalone function comes from another module --
  // uses the shared reference-hygiene mechanism (ctx.ensureImport) and the
  // identifier IT RETURNS (which may be a conflict-safe alias), matching the
  // pattern already used by method-sugar.ts / tryRewriteTypeclassOperator.
  const resolvedFnName = entry.sourceModule
    ? ctx.ensureImport(standaloneFnName, entry.sourceModule).text
    : standaloneFnName;

  if (verbose) {
    console.log(`[typesugar] Type rewrite: ${typeName}.${methodName}() → ${resolvedFnName}(...)`);
  }

  const ext: StandaloneExtensionInfo = {
    methodName: resolvedFnName,
    forType: entry.typeName,
  };

  const rewritten = buildStandaloneExtensionCall(
    ctx.factory,
    ext,
    receiver,
    Array.from(node.arguments)
  );

  try {
    const visited = ts.visitNode(rewritten, visit) as ts.Expression;
    return preserveSourceMap(visited, node);
  } catch (error) {
    ctx.reportError(node, `Type rewrite method erasure failed: ${error}`);
    return undefined;
  }
}

/**
 * Erase a registered @opaque type's accessor property access (e.g. `money.value`)
 * to either the receiver itself (an identity accessor, the common case for a
 * newtype-shaped wrapper) or a custom expression (PEP-056 Wave 4 -- ported from
 * legacy's `tryEraseAccessor`; core previously had no accessor-erasure dispatch
 * at all, only method/constructor/constant-ref erasure).
 *
 * Dispatched on a bare (non-call) PropertyAccessExpression -- distinct from
 * `tryRewriteOpaqueMethodCall`, which requires the property access to be the
 * callee of a CallExpression.
 */
export function tryEraseOpaqueAccessor(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  node: ts.PropertyAccessExpression
): ts.Expression | undefined {
  const propName = node.name.text;
  const receiver = node.expression;

  // Cheap pre-filter: no checker call unless some entry has this accessor.
  if (!getAllTypeRewrites().some((e) => e.accessors?.has(propName))) return undefined;
  if (!isProgramNode(receiver)) return undefined;

  let receiverType: ts.Type;
  try {
    receiverType = ctx.typeChecker.getTypeAtLocation(receiver);
  } catch (error) {
    ctx.reportWarning(
      node,
      `typesugar skipped @opaque accessor erasure of '.${propName}': the receiver type could not be resolved (${error}).`
    );
    return undefined;
  }
  if (!ctx.isTypeReliable(receiverType)) return undefined;

  const resolvedEntry = resolveTypeRewriteEntry(receiverType);
  if (!resolvedEntry) return undefined;
  const { entry, typeName } = resolvedEntry;
  if (!entry.accessors) return undefined;

  const accessor = entry.accessors.get(propName);
  if (!accessor) return undefined;

  // Transparent scope: skip erasure inside the defining module
  if (entry.transparent && isInDefiningModule(ctx, entry)) {
    return undefined;
  }

  if (accessor.kind === "identity") {
    if (verbose) {
      console.log(`[typesugar] Accessor erasure: ${typeName}.${propName} -> receiver`);
    }
    const visited = ts.visitNode(receiver, visit) as ts.Expression;
    return preserveSourceMap(visited, node);
  }

  if (accessor.kind === "custom" && accessor.value) {
    if (verbose) {
      console.log(`[typesugar] Accessor erasure: ${typeName}.${propName} -> ${accessor.value}`);
    }
    const custom = ctx.factory.createIdentifier(accessor.value);
    return preserveSourceMap(custom, node);
  }

  return undefined;
}

function isNullLiteral(node: ts.Expression): boolean {
  return node.kind === ts.SyntaxKind.NullKeyword;
}

function isSimpleExpression(node: ts.Expression): boolean {
  return (
    ts.isIdentifier(node) ||
    ts.isNumericLiteral(node) ||
    ts.isStringLiteral(node) ||
    isNullLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.UndefinedKeyword
  );
}

/**
 * Can this argument be moved into a conditional branch without changing
 * behavior? Evaluating it has no side effects and its value can't change in
 * between: literals, plain identifiers and function expressions (creating a
 * closure is unobservable). Anything else must be evaluated once, eagerly,
 * as in the original method call.
 */
function isTriviallyEvaluable(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node)) return isTriviallyEvaluable(node.expression);
  return (
    isSimpleExpression(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node)
  );
}

/**
 * Build an inlined expression for an @opaque method call.
 * When the receiver is a literal `null`, constant-folds the result.
 *
 * The receiver must be evaluated once, before the arguments, and every
 * argument exactly once (eagerly), as in the original `recv.method(args)`.
 * So when the receiver is complex or any argument is not trivially
 * evaluable, the ternary is wrapped in an IIFE whose parameters -- fresh
 * hygienic names from `uniqueName`, never a fixed `_opt` that a user
 * reference inside an argument could resolve to -- bind the receiver and
 * those arguments, in source order:
 *
 *   `getOpt().map(mk())` -> `((o, a) => o != null ? a(o) : null)(getOpt(), mk())`
 */
function buildOpaqueInlineExpression(
  factory: ts.NodeFactory,
  uniqueName: (prefix: string) => ts.Identifier,
  pattern: MethodInlinePattern,
  receiver: ts.Expression,
  args: ts.Expression[],
  verbose: boolean,
  typeName: string,
  methodName: string
): ts.Expression | undefined {
  const argsTrivial = args.every(isTriviallyEvaluable);

  if (argsTrivial && isNullLiteral(receiver)) {
    if (verbose) {
      console.log(`[typesugar] Opaque inline (constant-folded null): ${typeName}.${methodName}()`);
    }
    return constantFoldNull(factory, pattern, args);
  }

  if (argsTrivial && isKnownNonNullLiteral(receiver)) {
    if (verbose) {
      console.log(
        `[typesugar] Opaque inline (constant-folded non-null): ${typeName}.${methodName}()`
      );
    }
    return constantFoldNonNull(factory, pattern, receiver, args);
  }

  if (verbose) {
    console.log(`[typesugar] Opaque inline (inlined): ${typeName}.${methodName}()`);
  }

  if (argsTrivial && isSimpleExpression(receiver)) {
    return buildInlineTernary(factory, pattern, receiver, args);
  }

  // Bind the receiver (unless it's a literal) and every non-trivial argument.
  const params: ts.ParameterDeclaration[] = [];
  const callArgs: ts.Expression[] = [];
  const bind = (expr: ts.Expression, prefix: string): ts.Expression => {
    const name = uniqueName(prefix);
    params.push(
      factory.createParameterDeclaration(
        undefined,
        undefined,
        name,
        undefined,
        undefined,
        undefined
      )
    );
    callArgs.push(expr);
    return factory.createIdentifier(name.text);
  };

  const receiverRef =
    isNullLiteral(receiver) || isKnownNonNullLiteral(receiver) ? receiver : bind(receiver, "opt");
  const argRefs = args.map((a, i) => (isTriviallyEvaluable(a) ? a : bind(a, `optArg${i}`)));

  const body = buildInlineTernary(factory, pattern, receiverRef, argRefs);
  if (!body) return undefined;

  const arrow = factory.createArrowFunction(
    undefined,
    undefined,
    params,
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    body
  );
  return factory.createCallExpression(
    factory.createParenthesizedExpression(arrow),
    undefined,
    callArgs
  );
}

function isKnownNonNullLiteral(node: ts.Expression): boolean {
  return (
    ts.isNumericLiteral(node) ||
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword
  );
}

/**
 * When the receiver is a known non-null literal (string, number, boolean),
 * the null check can be eliminated entirely.
 */
function constantFoldNonNull(
  factory: ts.NodeFactory,
  pattern: MethodInlinePattern,
  receiver: ts.Expression,
  args: ts.Expression[]
): ts.Expression | undefined {
  switch (pattern.kind) {
    case "null-check-apply": {
      const fn = args[0];
      return fn ? factory.createCallExpression(fn, undefined, [receiver]) : undefined;
    }
    case "null-check-predicate": {
      const pred = args[0];
      if (!pred) return undefined;
      return factory.createConditionalExpression(
        factory.createCallExpression(pred, undefined, [receiver]),
        undefined,
        receiver,
        undefined,
        factory.createNull()
      );
    }
    case "null-coalesce-call":
    case "null-coalesce-value":
      return receiver;
    case "fold": {
      const onSome = args[1];
      return onSome ? factory.createCallExpression(onSome, undefined, [receiver]) : undefined;
    }
  }
}

function constantFoldNull(
  factory: ts.NodeFactory,
  pattern: MethodInlinePattern,
  args: ts.Expression[]
): ts.Expression | undefined {
  switch (pattern.kind) {
    case "null-check-apply":
    case "null-check-predicate":
      return factory.createNull();
    case "null-coalesce-call": {
      const defaultFn = args[0];
      return defaultFn ? factory.createCallExpression(defaultFn, undefined, []) : undefined;
    }
    case "null-coalesce-value":
      return args[0];
    case "fold": {
      const onNone = args[0];
      return onNone ? factory.createCallExpression(onNone, undefined, []) : undefined;
    }
  }
}

function buildInlineTernary(
  factory: ts.NodeFactory,
  pattern: MethodInlinePattern,
  receiver: ts.Expression,
  args: ts.Expression[]
): ts.Expression | undefined {
  const nullExpr = factory.createNull();
  const notNull = factory.createBinaryExpression(
    receiver,
    ts.SyntaxKind.ExclamationEqualsToken,
    nullExpr
  );

  switch (pattern.kind) {
    case "null-check-apply": {
      const fn = args[0];
      if (!fn) return undefined;
      return factory.createConditionalExpression(
        notNull,
        undefined,
        factory.createCallExpression(fn, undefined, [receiver]),
        undefined,
        nullExpr
      );
    }

    case "null-check-predicate": {
      const pred = args[0];
      if (!pred) return undefined;
      return factory.createConditionalExpression(
        factory.createBinaryExpression(
          notNull,
          ts.SyntaxKind.AmpersandAmpersandToken,
          factory.createCallExpression(pred, undefined, [receiver])
        ),
        undefined,
        receiver,
        undefined,
        nullExpr
      );
    }

    case "null-coalesce-call": {
      const defaultFn = args[0];
      if (!defaultFn) return undefined;
      return factory.createConditionalExpression(
        notNull,
        undefined,
        receiver,
        undefined,
        factory.createCallExpression(defaultFn, undefined, [])
      );
    }

    case "null-coalesce-value": {
      const defaultVal = args[0];
      if (!defaultVal) return undefined;
      return factory.createConditionalExpression(
        notNull,
        undefined,
        receiver,
        undefined,
        defaultVal
      );
    }

    case "fold": {
      const onNone = args[0];
      const onSome = args[1];
      if (!onNone || !onSome) return undefined;
      return factory.createConditionalExpression(
        notNull,
        undefined,
        factory.createCallExpression(onSome, undefined, [receiver]),
        undefined,
        factory.createCallExpression(onNone, undefined, [])
      );
    }
  }
}

/**
 * Erase an @opaque constructor call: `Some(x)` → `x`, `Left(e)` → literal.
 */
export function tryEraseOpaqueConstructorCall(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  node: ts.CallExpression
): ts.Expression | undefined {
  if (!ts.isIdentifier(node.expression)) return undefined;

  const ctorName = node.expression.text;

  // Resolved by the callee's symbol, not its name: only a call to the
  // registered entry's own constructor is erased (see resolveConstructorRewrite).
  const resolved = resolveConstructorRewrite(ctx, node.expression);
  if (resolved) {
    const { entry, ctor } = resolved;

    if (entry.transparent && isInDefiningModule(ctx, entry)) {
      return undefined;
    }

    if (ctor.kind === "identity") {
      if (node.arguments.length !== 1) {
        ctx.reportWarning(
          node,
          `Identity constructor '${ctorName}' expects exactly 1 argument, got ${node.arguments.length}`
        );
        return undefined;
      }

      if (verbose) {
        console.log(`[typesugar] Constructor erasure: ${ctorName}(arg) → arg`);
      }

      const arg = node.arguments[0];
      const visited = ts.visitNode(arg, visit) as ts.Expression;
      return preserveSourceMap(visited, node);
    }

    if (ctor.kind === "constant") {
      if (verbose) {
        console.log(`[typesugar] Constructor erasure: ${ctorName}(...) → ${ctor.value}`);
      }
      return preserveSourceMap(
        buildConstantExpression(ctx.factory, ctor.value ?? "undefined"),
        node
      );
    }

    // A "custom" rewrite whose expression is the constructor's own name (what
    // `@adt` registers for object-building variants) would turn `Circle(5)`
    // into the bare function `Circle`, dropping the arguments -- the call
    // already IS the runtime representation, so leave it as-is.
    if (ctor.kind === "custom" && ctor.value && ctor.value !== ctorName) {
      if (verbose) {
        console.log(`[typesugar] Constructor erasure: ${ctorName}(...) → ${ctor.value}`);
      }
      return preserveSourceMap(ctx.factory.createIdentifier(ctor.value), node);
    }
  }

  return undefined;
}

/**
 * Erase a bare constant constructor reference: `None` → `null`.
 */
export function tryEraseOpaqueConstantRef(
  ctx: MacroContextImpl,
  verbose: boolean,
  node: ts.Identifier
): ts.Expression | undefined {
  const name = node.text;

  if (!isValueReferencePosition(node)) return undefined;

  const resolved = resolveConstructorRewrite(ctx, node);
  if (!resolved || resolved.ctor.kind !== "constant") return undefined;
  const { entry, ctor } = resolved;

  if (entry.transparent && isInDefiningModule(ctx, entry)) {
    return undefined;
  }

  if (verbose) {
    console.log(`[typesugar] Constant constructor ref erasure: ${name} → ${ctor.value}`);
  }

  return preserveSourceMap(buildConstantExpression(ctx.factory, ctor.value ?? "undefined"), node);
}
