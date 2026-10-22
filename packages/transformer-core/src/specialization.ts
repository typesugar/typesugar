/**
 * Auto-specialization and return-type-driven specialization.
 *
 * Extracts instance dictionaries from @impl-annotated declarations,
 * inlines method bodies for zero-cost typeclass dispatch, and
 * rewrites function calls based on contextual return types.
 */

import * as ts from "typescript";

import {
  isRegisteredInstance,
  getInstanceMethods,
  getInstanceMethodsForDeclaration,
  getPrimitiveIntrinsicMethods,
  SpecializationCache,
  createHoistedSpecialization,
  classifyInlineFailureDetailed,
  getInlineFailureHelp,
  inlineMethod,
  getResultAlgebra,
  analyzeForFlattening,
  flattenReturnsToExpression,
  getInstanceName,
  tryExtractInstanceFromSource as sharedTryExtractInstanceFromSource,
  collectMethodFreeNames,
  collectMethodLocalBindings,
  forEachMethodFreeReference,
  getOpMapForTypeclass,
  isImplicitDefault,
  type DictMethod,
  type DictMethodMap,
  type ResultAlgebra,
} from "@typesugar/macros";

import {
  MacroContextImpl,
  globalResolutionScope,
  isInOptedOutScope,
  isSyntheticNode,
  preserveSourceMap,
  cloneWithoutComments,
  cloneNodeDeep,
  extractTypeArgumentsContent,
  typeToPortableTypeNode,
  TS9602,
} from "@typesugar/core";

// ---------------------------------------------------------------------------
// Void return type detection
// ---------------------------------------------------------------------------

/**
 * Check if a function has a void return type.
 * Used to suppress "no return statement" warnings for void functions,
 * since that's expected behavior.
 */
function isVoidReturnType(
  typeChecker: ts.TypeChecker,
  fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration
): boolean {
  // Check explicit return type annotation
  if (fn.type) {
    if (fn.type.kind === ts.SyntaxKind.VoidKeyword) {
      return true;
    }
  }

  // Infer from type checker
  try {
    const signature = typeChecker.getSignatureFromDeclaration(fn);
    if (signature) {
      const returnType = typeChecker.getReturnTypeOfSignature(signature);
      return !!(returnType.flags & ts.TypeFlags.Void);
    }
  } catch {
    // TypeChecker may throw on getSignatureFromDeclaration — fall through to default
  }

  return false;
}

// ---------------------------------------------------------------------------
// Instance name extraction + source-based instance extraction
//
// PEP-053 Wave 2: the implementation is shared with the legacy transformer and
// lives in @typesugar/macros (instance-extraction.ts). It resolves import
// aliases, identifier-alias consts, zero-arg factories, indirect members, and
// companion paths, and accepts `@impl`-tagged OR typeclass-annotated
// declarations (the unified criteria).
// ---------------------------------------------------------------------------

export {
  getInstanceName,
  hasImplAnnotation,
  hasTypeclassTypeAnnotation,
  extractBrandFromImpl,
} from "@typesugar/macros";

// Re-export for backwards compatibility
export { extractTypeArgumentsContent } from "@typesugar/core";

export function tryExtractInstanceFromSource(
  ctx: MacroContextImpl,
  argExpr: ts.Expression
): DictMethodMap | undefined {
  return sharedTryExtractInstanceFromSource(ctx, argExpr);
}

// ---------------------------------------------------------------------------
// Call-site scope checks (deep review 1.0: tc#8, tc#18, core#4, core#9)
//
// Shape note (CLAUDE.md "Resolving things a macro just generated"): instance
// dictionaries are resolved through the CHECKER — a symbol lookup at the call
// site, then source extraction from that declaration — not through the
// name-keyed registry, which conflates same-named declarations across files.
// The registry is consulted only for references the checker cannot resolve
// at all (nothing exists there that could be shadowed or confused).
// ---------------------------------------------------------------------------

const VALUE_MEANING = ts.SymbolFlags.Value | ts.SymbolFlags.Alias;

/**
 * One-line visible trace for a checker failure we degrade on (CLAUDE.md:
 * a caught checker exception must not vanish silently).
 */
function warnCheckerFailure(
  ctx: MacroContextImpl,
  node: ts.Node | undefined,
  what: string,
  error: unknown
): void {
  const at = node && !isSyntheticNode(node) ? node : ctx.sourceFile;
  ctx.reportWarning(at, `typesugar skipped ${what}: the type checker failed (${error}).`);
}

/** `"error"` means the checker threw; a warning has already been reported. */
function resolveNameAt(
  ctx: MacroContextImpl,
  name: string,
  location: ts.Node
): ts.Symbol | undefined | "error" {
  try {
    return ctx.typeChecker.resolveName(name, location, VALUE_MEANING, false);
  } catch (error) {
    warnCheckerFailure(ctx, location, `resolving '${name}' at the call site`, error);
    return "error";
  }
}

/**
 * Is `symbol` (a name resolved at a call site) bound there only as a TYPE? A
 * `type` import specifier, an `import type` declaration, or an alias chain
 * through a type-only re-export (`export type { Pt } from "./ord.js"`) still
 * resolves under value meaning (the checker reports TS1361 only under
 * `--strict` checking of the output), but emits no binding: a body that uses
 * `Pt` as a value there throws a ReferenceError (review 8). So does a name
 * whose target has no value side at all. Decided on the alias declarations
 * the checker resolves through (`isTypeOnlyImportOrExportDeclaration`), not
 * by name.
 */
function isTypeOnlyBinding(checker: ts.TypeChecker, symbol: ts.Symbol): boolean {
  let current: ts.Symbol | undefined = symbol;
  const seen = new Set<ts.Symbol>();
  while (current && current.flags & ts.SymbolFlags.Alias && !seen.has(current)) {
    seen.add(current);
    if (current.declarations?.some((d) => ts.isTypeOnlyImportOrExportDeclaration(d))) return true;
    current = checker.getImmediateAliasedSymbol(current);
  }
  return !!current && !(current.flags & ts.SymbolFlags.Value);
}

/**
 * {@link resolveNameAt} for a name an inlined body uses as a VALUE: a binding
 * that exists there only as a type (see {@link isTypeOnlyBinding}) counts as
 * no binding — the body would throw a ReferenceError there.
 */
function resolveValueAt(
  ctx: MacroContextImpl,
  name: string,
  location: ts.Node
): ts.Symbol | undefined | "error" {
  const symbol = resolveNameAt(ctx, name, location);
  if (!symbol || symbol === "error") return symbol;
  try {
    return isTypeOnlyBinding(ctx.typeChecker, symbol) ? undefined : symbol;
  } catch (error) {
    warnCheckerFailure(ctx, location, `resolving '${name}' at the call site`, error);
    return "error";
  }
}

function sameSymbol(checker: ts.TypeChecker, a: ts.Symbol, b: ts.Symbol): boolean {
  if (a === b) return true;
  const resolve = (s: ts.Symbol): ts.Symbol => {
    if (!(s.flags & ts.SymbolFlags.Alias)) return s;
    try {
      return checker.getAliasedSymbol(s);
    } catch {
      return s;
    }
  };
  return resolve(a) === resolve(b);
}

function isModuleScopeDecl(decl: ts.Node): boolean {
  let node: ts.Node | undefined = decl.parent;
  while (node && !ts.isSourceFile(node)) {
    if (ts.isFunctionLike(node) || ts.isBlock(node)) return false;
    node = node.parent;
  }
  return true;
}

/** A real (program-attached) node to resolve names at, if any. */
function realLocation(...candidates: (ts.Node | undefined)[]): ts.Node | undefined {
  for (const c of candidates) {
    if (!c) continue;
    if (!isSyntheticNode(c) && c.parent) return c;
    const original = ts.getOriginalNode(c);
    if (original && original !== c && !isSyntheticNode(original) && original.parent) {
      return original;
    }
  }
  return undefined;
}

/** Why a method body can't be inlined at a call site (see {@link methodFreeNameMismatch}). */
interface FreeNameMismatch {
  /** The free name that doesn't resolve the same there (absent: no body). */
  name?: string;
  /** It resolves to nothing there: the body would throw a ReferenceError. */
  notInScope?: boolean;
}

/**
 * Would every free identifier of `method`'s body mean the same thing at
 * `location` as where the method was defined? (A call-site local named like a
 * module-level helper or like `String` would otherwise capture it — tc#18 —
 * and a module-private helper of the instance's own file would be copied
 * where it isn't bound at all: `ordNumber.eqv` in another file became
 * `compareNumber(x, y) === EQ`, a ReferenceError — turf case study, round 2.)
 * Returns the first name that doesn't, or undefined when all do.
 *
 * Comparison by identity: the symbol the name resolves to at `location`
 * against the one recorded where the method is defined (`freeSymbols`).
 *
 * With no real location (a synthetic call produced by another rewrite with no
 * original node) this cannot be checked and returns undefined — the
 * pre-existing behaviour; see the report's "Needs from other owners".
 */
function methodFreeNameMismatch(
  ctx: MacroContextImpl,
  method: DictMethod,
  location: ts.Node | undefined
): FreeNameMismatch | undefined {
  if (!method.node) return {};
  if (!location) return undefined;
  let locals: Set<string> | undefined;
  for (const name of collectMethodFreeNames(method.node)) {
    const actual = resolveValueAt(ctx, name, location);
    if (actual === "error") return { name };
    const expected = method.freeSymbols?.get(name);
    if (expected) {
      if (!actual) return { name, notInScope: true };
      if (!sameSymbol(ctx.typeChecker, actual, expected)) return { name };
      continue;
    }
    // No recorded symbol: a body-local name, or a method registered without
    // checker info (primitive intrinsics, a synthetic member). Accept only a
    // name the body binds itself, a lib/ambient binding, or the call-site
    // file's own module scope.
    if (!actual) {
      // With recorded symbols, an unrecorded name was judged by the checker
      // where the method is defined: bound inside the body (or `undefined`).
      if (method.freeSymbols) continue;
      locals ??= collectMethodLocalBindings(method.node);
      if (locals?.has(name)) continue;
      return { name, notInScope: true };
    }
    const decls = actual.declarations ?? [];
    if (decls.length === 0) continue;
    if (decls.every((d) => d.getSourceFile().isDeclarationFile)) continue;
    if (decls.every((d) => d.getSourceFile() === ctx.sourceFile && isModuleScopeDecl(d))) continue;
    return { name };
  }
  return undefined;
}

function methodFreeNamesResolveSameAt(
  ctx: MacroContextImpl,
  method: DictMethod,
  location: ts.Node | undefined
): boolean {
  return methodFreeNameMismatch(ctx, method, location) === undefined;
}

const TYPE_MEANING = ts.SymbolFlags.Type | ts.SymbolFlags.Namespace | ts.SymbolFlags.Alias;

/** The leading identifier of an entity name or property access (`a` of `a.b.C`). */
function leftmostIdentifier(n: ts.Node): ts.Identifier | undefined {
  while (ts.isQualifiedName(n) || ts.isPropertyAccessExpression(n)) {
    n = ts.isQualifiedName(n) ? n.left : n.expression;
  }
  return ts.isIdentifier(n) ? n : undefined;
}

/**
 * Does every name `typeNode` uses resolve, at `location`, as a type (or is it
 * bound inside `typeNode` itself, or named through a non-relative import
 * type)? The check for a type node built by the checker's node builder, which
 * writes a type it can't name accessibly structurally or by a name that
 * isn't in scope (a module-private interface).
 */
function typeNodeResolvesAt(
  ctx: MacroContextImpl,
  typeNode: ts.TypeNode,
  location: ts.Node,
  inScope: readonly string[] = []
): boolean {
  let ok = true;
  const bound = [...inScope];
  const visit = (n: ts.Node): void => {
    if (!ok) return;
    if (ts.isTypeReferenceNode(n)) {
      const id = leftmostIdentifier(n.typeName);
      if (
        !id ||
        (!bound.includes(id.text) &&
          !ctx.typeChecker.resolveName(id.text, location, TYPE_MEANING, false))
      ) {
        ok = false;
        return;
      }
    }
    if (ts.isTypeQueryNode(n)) {
      const id = leftmostIdentifier(n.exprName);
      if (!id || !ctx.typeChecker.resolveName(id.text, location, VALUE_MEANING, false)) {
        ok = false;
        return;
      }
    }
    const typeParameters = (n as { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> })
      .typeParameters;
    const before = bound.length;
    if (typeParameters) bound.push(...typeParameters.map((p) => p.name.text));
    if (ts.isMappedTypeNode(n)) bound.push(n.typeParameter.name.text);
    // An `infer X` binds X in its conditional type's true branch: allowing it
    // for the rest of the conditional is close enough for a node the checker
    // wrote.
    if (ts.isConditionalTypeNode(n)) {
      const collectInfer = (c: ts.Node): void => {
        if (ts.isInferTypeNode(c)) bound.push(c.typeParameter.name.text);
        ts.forEachChild(c, collectInfer);
      };
      collectInfer(n.extendsType);
    }
    ts.forEachChild(n, visit);
    bound.length = before;
  };
  visit(typeNode);
  return ok;
}

/**
 * `symbol`'s type named for `location` (in the file being transformed), with
 * `typeArguments` in place of its own: `P` where the call site imports it,
 * else `import("./ord.js").P` (core's {@link typeToPortableTypeNode}, which
 * writes a specifier this file can use). Undefined when there is no such name
 * — a type parameter, a type private to its module, a namespace member.
 */
function callSiteTypeName(
  ctx: MacroContextImpl,
  symbol: ts.Symbol,
  typeArguments: ts.NodeArray<ts.TypeNode> | undefined,
  location: ts.Node
): ts.TypeNode | undefined {
  const checker = ctx.typeChecker;
  const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  if (
    target.flags & ts.SymbolFlags.TypeParameter ||
    !(target.flags & (ts.SymbolFlags.Type & ~ts.SymbolFlags.TypeParameter))
  ) {
    return undefined;
  }
  const named = typeToPortableTypeNode(
    ctx.program,
    checker,
    ctx.sourceFile,
    checker.getDeclaredTypeOfSymbol(target),
    location
  );
  if (!named) return undefined;
  const f = ctx.factory;
  // Only a reference to the symbol itself is a name for it; the node
  // builder's structural fallback (`{ x: number }` for a private interface)
  // is not, and would be wrong with the original's type arguments.
  if (ts.isImportTypeNode(named) && named.qualifier && !named.isTypeOf) {
    const result = f.updateImportTypeNode(
      named,
      named.argument,
      named.attributes,
      named.qualifier,
      typeArguments,
      false
    );
    return typeNodeResolvesAt(ctx, result, location) ? result : undefined;
  }
  if (ts.isTypeReferenceNode(named)) {
    const result = f.updateTypeReferenceNode(named, named.typeName, typeArguments);
    return typeNodeResolvesAt(ctx, result, location) ? result : undefined;
  }
  return undefined;
}

/**
 * Re-express the type names an inlined method body carries for the call site
 * it now sits at (turf case study, round 2; review 8): `mkP.make(1)` inlined
 * as `({ x: 1 }) as P` where the call site doesn't import `P`. A type
 * reference (`Opt<A>`, `typeof x`) is kept where its leading name resolves,
 * at `location`, to the same symbol it did where the method is defined
 * (`method.typeSymbols` — identity, never the printed name); else it is
 * named for the call site (`import("./ord.js").P`, see
 * {@link callSiteTypeName}), its type arguments re-expressed the same way.
 * Never as `any`: that leaked into the emitted .d.ts (`p: any`) and hid the
 * expansion from its own type check. Undefined when some type can't be named
 * there — the method's own type parameter (`o as unknown as A`, unbound once
 * the signature is dropped), a type private to the instance's module, an
 * import type with a path relative to the instance's file — and the caller
 * then doesn't inline the call.
 */
function reexpressInlinedTypes(
  ctx: MacroContextImpl,
  expr: ts.Expression,
  method: DictMethod,
  location: ts.Node | undefined
): ts.Expression | undefined {
  const resolvesSame = (id: ts.Identifier | undefined, meaning: ts.SymbolFlags): boolean => {
    if (!id || !location) return false;
    const expected = method.typeSymbols?.get(id.text);
    if (!expected) return false;
    const actual = ctx.typeChecker.resolveName(id.text, location, meaning, false);
    return !!actual && sameSymbol(ctx.typeChecker, actual, expected);
  };
  let failed = false;
  // Type parameters declared INSIDE the inlined expression (a nested generic
  // arrow's `<A, B>`) travel with it and still bind their uses there; only
  // the method's own (dropped with its signature) are unbound.
  const inScope: string[] = [];
  const visit = (n: ts.Node): ts.Node => {
    if (failed) return n;
    if (ts.isImportTypeNode(n)) {
      const arg = n.argument;
      const spec =
        ts.isLiteralTypeNode(arg) && ts.isStringLiteral(arg.literal) ? arg.literal.text : undefined;
      // A path relative to the instance's file means another module here.
      if (spec === undefined || spec.startsWith(".") || spec.startsWith("/")) {
        failed = true;
        return n;
      }
    }
    if (ts.isTypeReferenceNode(n)) {
      const id = leftmostIdentifier(n.typeName);
      const own = ts.isIdentifier(n.typeName) && inScope.includes(n.typeName.text);
      if (!own && !resolvesSame(id, TYPE_MEANING)) {
        const expected = id && method.typeSymbols?.get(id.text);
        const typeArguments =
          n.typeArguments &&
          ctx.factory.createNodeArray(n.typeArguments.map((t) => visit(t) as ts.TypeNode));
        const named =
          expected && location && ts.isIdentifier(n.typeName) && !failed
            ? callSiteTypeName(ctx, expected, typeArguments, location)
            : undefined;
        if (!named) failed = true;
        return named ?? n;
      }
    }
    if (ts.isTypeQueryNode(n) && !resolvesSame(leftmostIdentifier(n.exprName), VALUE_MEANING)) {
      failed = true;
      return n;
    }
    const typeParameters = (n as { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> })
      .typeParameters;
    if (!typeParameters?.length) return ts.visitEachChild(n, visit, ctx.transformContext);
    inScope.push(...typeParameters.map((p) => p.name.text));
    try {
      return ts.visitEachChild(n, visit, ctx.transformContext);
    } finally {
      inScope.length -= typeParameters.length;
    }
  };
  let result: ts.Expression;
  try {
    result = ts.visitNode(expr, visit) as ts.Expression;
  } catch (error) {
    warnCheckerFailure(ctx, location, "naming an inlined method's types at the call site", error);
    return undefined;
  }
  return failed ? undefined : result;
}

/** A reference TypeScript narrows by control flow (`x`, `x.y`, `this.x`). */
function isNarrowableReference(e: ts.Expression): boolean {
  if (ts.isIdentifier(e) || e.kind === ts.SyntaxKind.ThisKeyword) return true;
  return ts.isPropertyAccessExpression(e) && isNarrowableReference(e.expression);
}

/**
 * Can an inlined instance-method call substitute its arguments as they are?
 * `"no-inline"` when one is a narrowable reference whose type is narrower
 * than its parameter's AND the body reads that parameter more than once: the
 * body's own test (`l != null ? [l.head, l.tail] : undefined`) would then
 * narrow the argument further than it could the parameter — `Nil: null`
 * became `never` and `Nil.head` an error in the expansion's type check (turf
 * case study, round 2). An assertion on each substituted use can't fix that
 * (a test on `(Nil as List<unknown>)` doesn't narrow the next one); it held
 * only as `(Nil as any)`, which leaked `any` into the result's type (review
 * 8). A parameter read once can't be narrowed by its own body, so the call is
 * inlined as usual. Decided by the checker at the real call (assignability of
 * the parameter's type to the argument's); with no real call (an operator
 * rewrite's synthetic one) nothing is checked.
 */
function narrowedArgumentsBlockInlining(
  ctx: MacroContextImpl,
  call: ts.CallExpression,
  method: DictMethod
): boolean {
  const real = realLocation(call);
  const fn = method.node as ts.SignatureDeclaration | undefined;
  if (!real || !ts.isCallExpression(real) || !fn?.parameters) return false;
  const checker = ctx.typeChecker;
  try {
    const signature = checker.getResolvedSignature(real);
    if (!signature) return false;
    return real.arguments.some((arg, i) => {
      const param = fn.parameters[i];
      const paramSymbol = signature.parameters[i];
      if (!param || param.dotDotDotToken || !paramSymbol || !isNarrowableReference(arg)) {
        return false;
      }
      if (!ts.isIdentifier(param.name) || referenceCount(fn, param.name.text) < 2) return false;
      const paramType = checker.getTypeOfSymbolAtLocation(paramSymbol, real);
      return !checker.isTypeAssignableTo(paramType, checker.getTypeAtLocation(arg));
    });
  } catch (error) {
    warnCheckerFailure(ctx, real, "typing an inlined call's arguments", error);
    return true;
  }
}

/**
 * How many times `fn`'s parameters' defaults and body read `name` (a
 * syntactic count — property names and keys aside; a shadowing local counts
 * too, which only over-counts).
 */
function referenceCount(fn: ts.SignatureDeclaration, name: string): number {
  let count = 0;
  const visit = (n: ts.Node): void => {
    if (ts.isTypeNode(n)) return;
    if (ts.isPropertyAccessExpression(n)) {
      visit(n.expression);
      return;
    }
    if (ts.isPropertyAssignment(n)) {
      if (ts.isComputedPropertyName(n.name)) visit(n.name);
      visit(n.initializer);
      return;
    }
    if (ts.isIdentifier(n)) {
      if (n.text === name) count++;
      return;
    }
    ts.forEachChild(n, visit);
  };
  const body = (fn as { body?: ts.Node }).body;
  if (body) visit(body);
  for (const p of fn.parameters) if (p.initializer) visit(p.initializer);
  return count;
}

/**
 * TS9602 for an instance-method call left uninlined because its body uses a
 * name that isn't in scope at the call site: the call goes through the
 * instance, as written. Honors `// @no-specialize-warn` (and
 * `// @no-specialize`) on the call's line or the comment line above it.
 */
function warnFreeNameNotInScope(
  ctx: MacroContextImpl,
  location: ts.Node,
  callee: string,
  name: string
): void {
  if (specializeMarker(location) !== undefined) return;
  skippedSpecialization(
    ctx,
    location,
    callee,
    `the method's body uses '${name}', which is not in scope here; the call goes through the instance instead`
  );
}

// Only @typesugar/macros' own primitives.ts instances map to the intrinsics
// (whose bodies are reflected from exactly those values). Other typesugar
// packages declare same-named instances with DIFFERENT semantics (e.g.
// @typesugar/fp's NaN-lawful `ordNumber`) — those must be extracted from
// their own source like any user instance, not replaced by the intrinsic.
const TYPESUGAR_PACKAGE_PATH =
  /[\\/](@typesugar[\\/]macros|typesugar[\\/]packages[\\/]macros)[\\/]/;

/** Does this resolved symbol denote typesugar's own primitive instance of that name? */
function isTypesugarPrimitive(checker: ts.TypeChecker, symbol: ts.Symbol): boolean {
  let target = symbol;
  if (target.flags & ts.SymbolFlags.Alias) {
    try {
      target = checker.getAliasedSymbol(target);
    } catch {
      return false;
    }
  }
  const decls = target.declarations ?? [];
  return (
    decls.length > 0 &&
    decls.every((d) => TYPESUGAR_PACKAGE_PATH.test(d.getSourceFile().fileName.replace(/\\/g, "/")))
  );
}

/**
 * Resolve the dictionary an `ident.method(...)` call refers to.
 *
 * - A real identifier is resolved by the checker; a synthetic one (inside an
 *   already-inlined body, or emitted by another rewrite) is resolved by name
 *   at `location` — the original call site.
 * - A resolved user declaration is extracted from source (acceptance,
 *   const/mutation, safety and free-symbol checks all apply there). A
 *   resolved typesugar primitive (`eqNumber` imported from @typesugar/…) maps
 *   to its intrinsic.
 * - Only a name that resolves to nothing falls back to the name-keyed
 *   registry / intrinsics.
 */
/**
 * The instance registered for exactly the declaration `symbol` resolves to
 * (through an import alias). Registry shape (CLAUDE.md): macros'
 * `getInstanceMethodsForDeclaration` is a LIVE WeakMap keyed by declaration,
 * written by `@impl`/`impl()` in the same pass — never conflates same-named
 * instances, unlike the name-keyed `getInstanceMethods`.
 */
function methodsForResolvedDeclaration(
  ctx: MacroContextImpl,
  symbol: ts.Symbol
): DictMethodMap | undefined {
  let target = symbol;
  if (target.flags & ts.SymbolFlags.Alias) {
    try {
      target = ctx.typeChecker.getAliasedSymbol(target);
    } catch (error) {
      warnCheckerFailure(ctx, undefined, `resolving the alias '${symbol.getName()}'`, error);
      return undefined;
    }
  }
  for (const decl of target.declarations ?? []) {
    const entry = getInstanceMethodsForDeclaration(decl);
    if (entry) return entry;
  }
  return undefined;
}

function resolveDictForIdentifier(
  ctx: MacroContextImpl,
  ident: ts.Identifier,
  location: ts.Node | undefined,
  allowIntrinsics: boolean
): DictMethodMap | undefined {
  const name = ident.text;
  let symbol: ts.Symbol | undefined;
  let extractFrom: ts.Expression | undefined;

  if (!isSyntheticNode(ident) && ident.parent) {
    try {
      symbol = ctx.typeChecker.getSymbolAtLocation(ident);
    } catch (error) {
      // Decline rather than fall through to the name-keyed registry below:
      // we don't know what `name` really binds to here.
      warnCheckerFailure(ctx, ident, `inlining '${name}' (symbol lookup)`, error);
      return undefined;
    }
    extractFrom = ident;
  } else if (location) {
    const r = resolveNameAt(ctx, name, location);
    if (r === "error") return undefined;
    if (r) symbol = r;
    const decl = symbol?.declarations?.[0];
    if (decl) {
      const declName = (decl as { name?: ts.Node }).name;
      if (declName && ts.isIdentifier(declName) && !isSyntheticNode(declName)) {
        extractFrom = declName;
      }
    }
  }

  if (symbol && (symbol.declarations?.length ?? 0) > 0) {
    const primitive = allowIntrinsics ? getPrimitiveIntrinsicMethods(name) : undefined;
    if (primitive && isTypesugarPrimitive(ctx.typeChecker, symbol)) return primitive;
    return (
      (extractFrom ? tryExtractInstanceFromSource(ctx, extractFrom) : undefined) ??
      methodsForResolvedDeclaration(ctx, symbol)
    );
  }

  // Unresolvable at a known location (no user declaration exists that could
  // be confused), or a synthetic receiver with no real location to resolve it
  // at (another rewrite's output, e.g. an operator rewrite that didn't pass
  // `scopeNode`): the name-keyed registry / intrinsics — the pre-existing
  // behaviour for that path, see the report's "Needs from other owners".
  return (
    getInstanceMethods(name, ctx.program) ??
    (allowIntrinsics ? getPrimitiveIntrinsicMethods(name) : undefined)
  );
}

// ---------------------------------------------------------------------------
// Function body resolution
// ---------------------------------------------------------------------------

function resolveBodyFromSymbol(
  typeChecker: ts.TypeChecker,
  node: ts.Node
): ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | undefined {
  try {
    const symbol = typeChecker.getSymbolAtLocation(node);
    if (!symbol) return undefined;
    const declarations = symbol.getDeclarations();
    if (!declarations || declarations.length === 0) return undefined;

    for (const decl of declarations) {
      if (ts.isVariableDeclaration(decl) && decl.initializer) {
        if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
          return decl.initializer;
        }
      }
      if (ts.isFunctionDeclaration(decl) && decl.body) {
        return decl;
      }
    }
  } catch {
    // TypeChecker may throw on unresolvable symbols
    return undefined;
  }
  return undefined;
}

export function resolveAutoSpecFunctionBody(
  typeChecker: ts.TypeChecker,
  fnExpr: ts.Expression
): ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | undefined {
  if (ts.isArrowFunction(fnExpr) || ts.isFunctionExpression(fnExpr)) {
    return fnExpr;
  }
  if (ts.isIdentifier(fnExpr) || ts.isPropertyAccessExpression(fnExpr)) {
    return resolveBodyFromSymbol(typeChecker, fnExpr);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Dictionary call rewriting
// ---------------------------------------------------------------------------

export function rewriteDictCallsForAutoSpec(
  ctx: MacroContextImpl,
  node: ts.Node,
  dictParamMap: Map<string, DictMethodMap>,
  /** The call site the specialization is for: where inlined type names must resolve. */
  location?: ts.Node
): ts.Node {
  function visit(n: ts.Node): ts.Node {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression)
    ) {
      const dictParamName = n.expression.expression.text;
      const dictMethods = dictParamMap.get(dictParamName);

      if (dictMethods) {
        const methodName = n.expression.name.text;
        const method = dictMethods.methods.get(methodName);

        if (method) {
          const inlined = inlineMethod(ctx, method, Array.from(n.arguments));
          // A type the body names that can't be written at the call site:
          // the call stays a dictionary call (and the leftover-use check of
          // inlineAutoSpecializeForHoisting then declines the specialization).
          const reexpressed = inlined && reexpressInlinedTypes(ctx, inlined, method, location);
          if (reexpressed) {
            const mapped = preserveSourceMap(reexpressed, n);
            return ts.visitEachChild(mapped, visit, ctx.transformContext);
          }
        }
      }
    }

    return ts.visitEachChild(n, visit, ctx.transformContext);
  }

  return ts.visitNode(node, visit) as ts.Node;
}

// ---------------------------------------------------------------------------
// Hoisting for auto-specialization
// ---------------------------------------------------------------------------

export function inlineAutoSpecializeForHoisting(
  ctx: MacroContextImpl,
  fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
  instanceArgs: { index: number; name: string; methods: DictMethodMap }[],
  _fnName: string,
  /**
   * The call's types for the annotations that name the function's type
   * parameters (see {@link instantiatedAnnotations}): the hoisted copy has no
   * type parameters, so `a: A` becomes `a: Feature`. Without them such an
   * annotation is dropped, which leaves the parameter implicitly `any`.
   */
  instantiated?: InstantiatedAnnotations,
  /** The call site (see {@link rewriteDictCallsForAutoSpec}). */
  location?: ts.Node
): ts.Expression | undefined {
  const params = Array.from(fn.parameters);
  if (params.length === 0) return undefined;

  const dictParamMap = new Map<string, DictMethodMap>();
  const dictParamIndices = new Set<number>();

  for (const instArg of instanceArgs) {
    if (instArg.index < params.length) {
      const param = params[instArg.index];
      const paramName = ts.isIdentifier(param.name) ? param.name.text : undefined;
      if (paramName) {
        dictParamMap.set(paramName, instArg.methods);
        dictParamIndices.add(instArg.index);
      }
    }
  }

  if (dictParamMap.size === 0) return undefined;

  const body = ts.isFunctionDeclaration(fn) ? fn.body : fn.body;
  if (!body) return undefined;

  // `F.method(...)` is matched by name: a nested binding named like a dict
  // parameter would make that match wrong.
  const bound = new Set<string>();
  collectBindingNames(body, bound);
  for (const p of params) if (p.initializer) collectBindingNames(p.initializer, bound);
  for (const name of dictParamMap.keys()) if (bound.has(name)) return undefined;

  const specializedBody = rewriteDictCallsForAutoSpec(ctx, body, dictParamMap, location);

  // Collect type parameter names that become unresolvable once stripped
  const fnTypeParamNames = new Set<string>();
  const typeParams =
    ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) || ts.isFunctionDeclaration(fn)
      ? fn.typeParameters
      : undefined;
  if (typeParams) {
    for (const tp of typeParams) fnTypeParamNames.add(tp.name.text);
  }

  // An annotation that names a type parameter gets the call's type instead
  // (or, with none known, is dropped).
  const remainingParams = params
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => !dictParamIndices.has(i))
    .map(({ p, i }) => {
      if (p.type && fnTypeParamNames.size > 0 && typeNodeRefsAny(p.type, fnTypeParamNames)) {
        return ctx.factory.createParameterDeclaration(
          undefined,
          p.dotDotDotToken,
          p.name,
          p.questionToken,
          instantiated?.params.get(i),
          p.initializer
        );
      }
      return p;
    });
  // The return type is inferred from the body, unless the declared one names
  // a type parameter (`: A`): then it is the call's (`: Feature`), so the
  // call's type is what it was.
  const returnType = instantiated?.returnType;

  const modifiers = fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
    ? [ctx.factory.createModifier(ts.SyntaxKind.AsyncKeyword)]
    : undefined;
  const specialized = ctx.factory.createArrowFunction(
    modifiers,
    undefined,
    remainingParams,
    returnType,
    ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    specializedBody as ts.ConciseBody
  );

  // Every use of a dictionary parameter must have been rewritten away: one
  // left over (passed to a helper, a method we couldn't inline, …) would be
  // an unbound identifier once the parameter is removed.
  let leftover = false;
  forEachMethodFreeReference(specialized, (id) => {
    if (dictParamMap.has(id.text)) leftover = true;
  });
  if (leftover) return undefined;

  return specialized;
}

/** Type annotations of a hoisted specialization, instantiated at one call. */
export interface InstantiatedAnnotations {
  /** By parameter index: the call's type for a parameter annotated with a type parameter. */
  params: Map<number, ts.TypeNode>;
  /** The call's return type, when the declared one names a type parameter. */
  returnType?: ts.TypeNode;
  /** The instantiated types' text, for the specialization cache key. */
  key: string[];
}

/**
 * The call's types for the annotations of `fn` that name its type parameters:
 * `dup<A>(a: A, C: Clone<A> = implicit()): A` called as `dup(sample)` gives
 * `a: Feature` and `: Feature`; `tag<A, B>(...): [A, B]` gives `[Feature,
 * number]`. Each type parameter's type at this call is read from the
 * checker's resolved signature at the ORIGINAL call (a real node: CLAUDE.md,
 * never the checker on a synthetic one), by matching each parameter's
 * declared type against its type at the call ({@link bindTypeParameters}),
 * and substituted into the annotations.
 *
 * An annotation that names a type parameter whose type isn't known (or can't
 * be written as a type node at the call) is left out of the result, and the
 * copy drops it, as it always did. Undefined when there is nothing to
 * instantiate, or no real call to read the types at.
 */
function instantiatedAnnotations(
  ctx: MacroContextImpl,
  fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
  call: ts.Node | undefined,
  dictParamIndices: ReadonlySet<number>
): InstantiatedAnnotations | undefined {
  const typeParamNames = new Set((fn.typeParameters ?? []).map((tp) => tp.name.text));
  if (typeParamNames.size === 0) return undefined;
  const named = fn.parameters
    .map((p, i) => ({ p, i }))
    .filter(
      ({ p, i }) => !dictParamIndices.has(i) && p.type && typeNodeRefsAny(p.type, typeParamNames)
    );
  const returnNamed = !!fn.type && typeNodeRefsAny(fn.type, typeParamNames);
  if (named.length === 0 && !returnNamed) return undefined;
  if (!call || !ts.isCallExpression(call)) return undefined;

  const checker = ctx.typeChecker;
  try {
    const sig = checker.getResolvedSignature(call);
    if (!sig) return undefined;
    // Each type parameter's type at this call.
    const bound = new Map<string, ts.Type>();
    fn.parameters.forEach((p, i) => {
      if (!p.type || p.dotDotDotToken || !sig.parameters[i]) return;
      const t = checker.getTypeOfSymbolAtLocation(sig.parameters[i], call);
      bindTypeParameters(
        checker,
        p.type,
        p.questionToken ? checker.getNonNullableType(t) : t,
        typeParamNames,
        bound
      );
    });
    const byName = new Map<string, ts.TypeNode>();
    const key: string[] = [];
    const unconstrained = new Set(
      (fn.typeParameters ?? []).filter((tp) => !tp.constraint).map((tp) => tp.name.text)
    );
    for (const [name, inferred] of bound) {
      // `myEq(eq, 1, 2)` infers `T = 1 | 2`; the copy takes `number`, so calls
      // with other numbers share it. A constrained parameter keeps its literal
      // type, which the body may rely on.
      const t = unconstrained.has(name) ? checker.getBaseTypeOfLiteralType(inferred) : inferred;
      const node = typeNodeAt(checker, ctx.factory, t, call);
      if (!node) continue;
      byName.set(name, node);
      key.push(`${name}=${checker.typeToString(t)}`);
    }
    const substitute = (n: ts.TypeNode): ts.TypeNode | undefined => {
      let missing = false;
      const visit = (node: ts.Node): ts.Node => {
        if (
          ts.isTypeReferenceNode(node) &&
          ts.isIdentifier(node.typeName) &&
          !node.typeArguments &&
          typeParamNames.has(node.typeName.text)
        ) {
          const replacement = byName.get(node.typeName.text);
          if (!replacement) missing = true;
          return replacement ?? node;
        }
        return ts.visitEachChild(node, visit, ctx.transformContext);
      };
      const result = ts.visitNode(n, visit) as ts.TypeNode;
      // A copy with no positions: the annotation may come from another file.
      return missing ? undefined : cloneNodeDeep(result);
    };
    const out: InstantiatedAnnotations = { params: new Map(), key };
    for (const { p, i } of named) {
      const node = substitute(p.type!);
      if (node) out.params.set(i, node);
    }
    if (returnNamed) out.returnType = substitute(fn.type!);
    return out;
  } catch (error) {
    warnCheckerFailure(ctx, call, "typing an auto-specialized copy (resolved signature)", error);
    return undefined;
  }
}

/**
 * Learn the type parameters in `declared` (a parameter's annotation) from
 * `actual` (that parameter's type at the call): `A` from `a: A`, from `xs:
 * A[]`, from `x: A | null`, and from a function type's parameters and return
 * type (`parse: (s: string) => A | null`). A shape it doesn't know teaches
 * nothing; the first binding of a name wins.
 */
function bindTypeParameters(
  checker: ts.TypeChecker,
  declared: ts.TypeNode,
  actual: ts.Type,
  names: ReadonlySet<string>,
  out: Map<string, ts.Type>
): void {
  if (ts.isParenthesizedTypeNode(declared)) {
    bindTypeParameters(checker, declared.type, actual, names, out);
  } else if (
    ts.isTypeReferenceNode(declared) &&
    ts.isIdentifier(declared.typeName) &&
    !declared.typeArguments &&
    names.has(declared.typeName.text)
  ) {
    if (!out.has(declared.typeName.text)) out.set(declared.typeName.text, actual);
  } else if (ts.isArrayTypeNode(declared)) {
    const elem = arrayElement(checker, actual);
    if (elem) bindTypeParameters(checker, declared.elementType, elem, names, out);
  } else if (ts.isUnionTypeNode(declared)) {
    // `A | null` / `A | undefined`: the one generic member is the rest of `actual`.
    const generic = declared.types.filter((m) => typeNodeRefsAny(m, names));
    const nullish = declared.types.every(
      (m) =>
        generic.includes(m) ||
        m.kind === ts.SyntaxKind.UndefinedKeyword ||
        (ts.isLiteralTypeNode(m) && m.literal.kind === ts.SyntaxKind.NullKeyword)
    );
    if (generic.length === 1 && nullish) {
      bindTypeParameters(checker, generic[0], checker.getNonNullableType(actual), names, out);
    }
  } else if (ts.isFunctionTypeNode(declared)) {
    const sig = actual.getCallSignatures()[0];
    if (!sig) return;
    declared.parameters.forEach((p, i) => {
      const ps = sig.parameters[i];
      if (p.type && ps && !p.dotDotDotToken) {
        const decl = ps.valueDeclaration;
        bindTypeParameters(
          checker,
          p.type,
          decl ? checker.getTypeOfSymbolAtLocation(ps, decl) : checker.getTypeOfSymbol(ps),
          names,
          out
        );
      }
    });
    bindTypeParameters(checker, declared.type, sig.getReturnType(), names, out);
  }
}

function arrayElement(checker: ts.TypeChecker, t: ts.Type): ts.Type | undefined {
  const name = t.symbol?.name;
  return (name === "Array" || name === "ReadonlyArray") && (t as ts.TypeReference).target
    ? checker.getTypeArguments(t as ts.TypeReference)[0]
    : undefined;
}

/**
 * `t` as a type node that means `t` at `location`, or undefined. A generic
 * instantiated with exactly its defaults is written by its bare name when that
 * name resolves to it here (`Feature`, not `Feature<Geometry, ...>`: TS 5.9's
 * node builder gives up when `Geometry` has no name in scope, and TS 6 writes
 * `import("geojson").Geometry`). Anything else goes through the checker's
 * node builder.
 */
function typeNodeAt(
  checker: ts.TypeChecker,
  f: ts.NodeFactory,
  t: ts.Type,
  location: ts.Node
): ts.TypeNode | undefined {
  return (
    bareDefaultInstantiation(checker, f, t, location) ??
    checker.typeToTypeNode(t, location, ts.NodeBuilderFlags.NoTruncation)
  );
}

function bareDefaultInstantiation(
  checker: ts.TypeChecker,
  f: ts.NodeFactory,
  t: ts.Type,
  location: ts.Node
): ts.TypeNode | undefined {
  const sym = t.aliasSymbol ?? t.symbol;
  const decl = sym?.declarations?.find(
    (d): d is ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.ClassDeclaration =>
      (ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d) || ts.isClassDeclaration(d)) &&
      (d.typeParameters?.length ?? 0) > 0
  );
  const params = decl?.typeParameters;
  if (!sym || !params || !params.every((tp) => tp.default)) return undefined;
  const args = t.aliasSymbol
    ? t.aliasTypeArguments
    : (t as ts.TypeReference).target
      ? checker.getTypeArguments(t as ts.TypeReference)
      : undefined;
  if (!args || args.length < params.length) return undefined;
  const same = (a: ts.Type, b: ts.Type) =>
    checker.isTypeAssignableTo(a, b) && checker.isTypeAssignableTo(b, a);
  if (!params.every((tp, i) => same(args[i], checker.getTypeFromTypeNode(tp.default!)))) {
    return undefined;
  }
  let inScope = checker.resolveName(sym.name, location, ts.SymbolFlags.Type, false);
  if (inScope && inScope.flags & ts.SymbolFlags.Alias) inScope = checker.getAliasedSymbol(inScope);
  return inScope === sym ? f.createTypeReferenceNode(sym.name) : undefined;
}

/** Every binding name (variables, parameters, function/class names, catch vars) declared within `node`. */
function collectBindingNames(node: ts.Node, out: Set<string>): void {
  const addName = (name: ts.BindingName | undefined): void => {
    if (!name) return;
    if (ts.isIdentifier(name)) {
      out.add(name.text);
      return;
    }
    for (const el of name.elements) if (ts.isBindingElement(el)) addName(el.name);
  };
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n)) addName(n.name);
    else if (
      (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassLike(n)) &&
      n.name &&
      ts.isIdentifier(n.name)
    ) {
      out.add(n.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
}

function typeNodeRefsAny(typeNode: ts.TypeNode, names: ReadonlySet<string>): boolean {
  let found = false;
  function visit(node: ts.Node): void {
    if (found) return;
    if (
      ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      names.has(node.typeName.text)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(typeNode);
  return found;
}

// ---------------------------------------------------------------------------
// Auto-specialization entry point
// ---------------------------------------------------------------------------

/**
 * Is `arg` an identifier for a value declared ONLY in .d.ts files (an instance
 * imported from a compiled package) that is a typeclass instance -- its
 * declaration carries `@impl`/`@instance`, or its type is a known typeclass
 * (`Functor<OptionF>`, `Pretty<number>`)? This check keeps ordinary
 * declaration-only values (config objects, lib globals) from producing noise.
 */
function isDeclarationOnlyTypeclassInstance(
  ctx: MacroContextImpl,
  arg: ts.Expression,
  callLocation: ts.Node | undefined
): boolean {
  let e = arg;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) e = e.expression;
  if (!ts.isIdentifier(e) && !ts.isPropertyAccessExpression(e)) return false;
  try {
    const checker = ctx.typeChecker;
    // An argument `= implicit()` filled in is a generated reference with no
    // position: resolve it by name where the call is (its import, or a local
    // binding), then read a companion path's members off that symbol.
    let sym = isSyntheticNode(e)
      ? callLocation && resolveGeneratedReference(ctx, e, callLocation)
      : checker.getSymbolAtLocation(e);
    if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    const decls = sym?.declarations ?? [];
    if (decls.length === 0 || !decls.every((d) => d.getSourceFile().isDeclarationFile)) {
      return false;
    }
    // Marked as an instance in its declaration (`/** @impl Schema<...> */`
    // survives into the emitted .d.ts) ...
    if (
      decls.some((d) =>
        ts.getJSDocTags(d).some((t) => t.tagName.text === "impl" || t.tagName.text === "instance")
      )
    ) {
      return true;
    }
    // ... or typed as a known typeclass (`Functor<OptionF>`).
    const type = isSyntheticNode(e) ? checker.getTypeOfSymbol(sym!) : checker.getTypeAtLocation(e);
    const tcName = (type.aliasSymbol ?? type.getSymbol())?.getName();
    return !!tcName && getOpMapForTypeclass(ctx.program, tcName) !== undefined;
  } catch (error) {
    warnCheckerFailure(ctx, arg, "auto-specialization (declaration-only instance check)", error);
    return false;
  }
}

/**
 * The symbol a generated reference (`ordNumber`, `Point.Eq`) names at
 * `location`: its first segment resolved by name in that scope (as the
 * emitted code will be), the rest read as exported members.
 */
function resolveGeneratedReference(
  ctx: MacroContextImpl,
  e: ts.Identifier | ts.PropertyAccessExpression,
  location: ts.Node
): ts.Symbol | undefined {
  if (ts.isIdentifier(e)) {
    // An import the expansion is adding (`import { ordNumber } from
    // "@typesugar/std"`): the export of that module.
    const pending = ctx.fileBindingCache.getPendingImport(e.text);
    if (pending) return moduleExport(ctx, pending.from, pending.symbol);
    const r = resolveNameAt(ctx, e.text, location);
    return r === "error" ? undefined : r;
  }
  if (!ts.isIdentifier(e.expression) && !ts.isPropertyAccessExpression(e.expression)) {
    return undefined;
  }
  let base = resolveGeneratedReference(ctx, e.expression, location);
  if (base && base.flags & ts.SymbolFlags.Alias) base = ctx.typeChecker.getAliasedSymbol(base);
  return base?.exports?.get(ts.escapeLeadingUnderscores(e.name.text));
}

/** The export `name` of the module `specifier` resolves to from this file. */
function moduleExport(
  ctx: MacroContextImpl,
  specifier: string,
  name: string
): ts.Symbol | undefined {
  // The file's own import of that module, if it has one (it does for the
  // usual `import type { Ord } from "@typesugar/std"`); else module
  // resolution, where there is a file system (not in the browser).
  let moduleSymbol: ts.Symbol | undefined;
  for (const stmt of ctx.sourceFile.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.moduleSpecifier.text === specifier
    ) {
      moduleSymbol = ctx.typeChecker.getSymbolAtLocation(stmt.moduleSpecifier);
      if (moduleSymbol) break;
    }
  }
  if (!moduleSymbol && typeof ts.sys !== "undefined") {
    const resolved = ts.resolveModuleName(
      specifier,
      ctx.sourceFile.fileName,
      ctx.program.getCompilerOptions(),
      ts.sys
    ).resolvedModule;
    const file = resolved && ctx.program.getSourceFile(resolved.resolvedFileName);
    moduleSymbol = file && ctx.typeChecker.getSymbolAtLocation(file);
  }
  if (!moduleSymbol) return undefined;
  return ctx.typeChecker.getExportsOfModule(moduleSymbol).find((s) => s.name === name);
}

function argResolvesToDeclaration(ctx: MacroContextImpl, arg: ts.Expression): boolean {
  if (isSyntheticNode(arg)) return false;
  let e = arg;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) e = e.expression;
  if (ts.isCallExpression(e)) e = e.expression;
  try {
    const sym = ctx.typeChecker.getSymbolAtLocation(e);
    return (sym?.declarations?.length ?? 0) > 0;
  } catch (error) {
    warnCheckerFailure(ctx, arg, "auto-specialization (argument symbol lookup)", error);
    return false;
  }
}

const symbolIds = new WeakMap<ts.Symbol, number>();
let nextSymbolId = 0;

/**
 * A stable, unique-per-symbol id for cache keys. Not the checker's internal
 * `symbol.id`: that is 0 until something asks the checker for it, so two
 * functions not yet given one would share a specialization, and one function
 * would change key once it got one.
 */
function stableSymbolId(sym: ts.Symbol): number {
  let id = symbolIds.get(sym);
  if (id === undefined) {
    id = nextSymbolId++;
    symbolIds.set(sym, id);
  }
  return id;
}

/** A stable identity for the instance an argument denotes (its resolved declaration). */
function instanceIdentity(ctx: MacroContextImpl, arg: ts.Expression, fallback: string): string {
  let e = arg;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) e = e.expression;
  if (ts.isCallExpression(e)) e = e.expression;
  if (!isSyntheticNode(e)) {
    try {
      let sym = ctx.typeChecker.getSymbolAtLocation(e);
      if (sym && sym.flags & ts.SymbolFlags.Alias) sym = ctx.typeChecker.getAliasedSymbol(sym);
      if (sym) return `#${stableSymbolId(sym)}`;
    } catch (error) {
      // Never share a cache entry by bare name when the identity is unknown:
      // two different same-named instances would get one specialization.
      warnCheckerFailure(ctx, e, `sharing a specialization for '${fallback}'`, error);
      return `unresolved:${nextSymbolId++}`;
    }
  }
  return `name:${fallback}`;
}

/**
 * The name of a call in `fn`'s body that leaves an `= implicit()` parameter
 * unfilled (`sortWith(items)` inside a function that itself takes
 * `ord: Ord<T> = implicit()`), if any. The hoisted specialization is a copy of
 * the ORIGINAL body, which is never run through implicit resolution, and it
 * drops the dictionary parameter such calls would receive by propagation, so
 * specializing would leave them calling `implicit()` at runtime.
 */
function findUnfilledImplicitCall(
  ctx: MacroContextImpl,
  fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration
): string | undefined {
  let found: string | undefined;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n) && !isSyntheticNode(n)) {
      try {
        const decl = ctx.typeChecker.getResolvedSignature(n)?.getDeclaration() as
          | ts.SignatureDeclaration
          | undefined;
        const params = decl?.parameters;
        if (params) {
          for (let i = n.arguments.length; i < params.length; i++) {
            if (isImplicitDefault(params[i].initializer)) {
              found = ts.isIdentifier(n.expression)
                ? n.expression.text
                : ts.isPropertyAccessExpression(n.expression)
                  ? n.expression.name.text
                  : "a call";
              return;
            }
          }
        }
      } catch (error) {
        warnCheckerFailure(ctx, n, "auto-specialization (implicit-call check)", error);
      }
    }
    ts.forEachChild(n, visit);
  };
  if (fn.body) visit(fn.body);
  return found;
}

/**
 * Does the callee use its own receiver/activation (`this`, `super`,
 * `arguments`, `new.target`) outside nested non-arrow functions? The hoisted
 * specialization is an arrow at the call site, where those mean something
 * else. (`await` is fine: the specialization keeps `async`.)
 */
function calleeUsesReceiver(
  fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration
): boolean {
  let depends = false;
  const visit = (n: ts.Node): void => {
    if (depends) return;
    if (
      n.kind === ts.SyntaxKind.ThisKeyword ||
      n.kind === ts.SyntaxKind.SuperKeyword ||
      ts.isMetaProperty(n) ||
      (ts.isIdentifier(n) && n.text === "arguments")
    ) {
      depends = true;
      return;
    }
    if (ts.isPropertyAccessExpression(n)) {
      visit(n.expression);
      return;
    }
    if (
      ts.isFunctionExpression(n) ||
      ts.isFunctionDeclaration(n) ||
      ts.isMethodDeclaration(n) ||
      ts.isClassLike(n) ||
      ts.isAccessor(n)
    ) {
      return;
    }
    ts.forEachChild(n, visit);
  };
  for (const p of fn.parameters) visit(p);
  if (fn.body) visit(fn.body);
  return depends;
}

/**
 * Do the callee's free identifiers resolve, at the call site (which is where
 * the specialization gets hoisted), to the same declarations they resolve to
 * inside the callee? A caller-local with the same name would otherwise
 * capture them (core#9).
 */
function calleeFreeNamesResolveSameAt(
  ctx: MacroContextImpl,
  fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
  callNode: ts.Node
): boolean {
  const location = realLocation(callNode);
  if (!location) return false;
  let ok = true;
  forEachMethodFreeReference(fn, (id) => {
    if (!ok) return;
    let expected: ts.Symbol | undefined;
    try {
      expected =
        id.parent && ts.isShorthandPropertyAssignment(id.parent)
          ? ctx.typeChecker.getShorthandAssignmentValueSymbol(id.parent)
          : ctx.typeChecker.getSymbolAtLocation(id);
    } catch {
      ok = false;
      return;
    }
    const decls = expected?.declarations ?? [];
    if (!expected || decls.length === 0) return;
    // Declared inside the callee itself — travels with the body.
    if (
      decls.every(
        (d) => d.getSourceFile() === fn.getSourceFile() && d.pos >= fn.pos && d.end <= fn.end
      )
    ) {
      return;
    }
    const actual = resolveValueAt(ctx, id.text, location);
    if (actual === "error" || !actual || !sameSymbol(ctx.typeChecker, actual, expected)) ok = false;
  });
  return ok;
}

/**
 * The specialization marker on `node`'s line or on a comment line directly
 * above it: `// @no-specialize` ("off") or `// @no-specialize-warn`
 * ("quiet"). Only comment-only lines above count — a marker in a TRAILING
 * comment on the previous line belongs to that line's statement.
 */
function specializeMarker(node: ts.Node): "off" | "quiet" | undefined {
  try {
    const sourceText = node.getSourceFile().text;
    const nodeStart = node.getStart();
    const lineStart = sourceText.lastIndexOf("\n", nodeStart) + 1;
    const lineText = sourceText.slice(lineStart, nodeStart);
    const prevLineEnd = lineStart > 0 ? lineStart - 1 : 0;
    const prevLineStart = sourceText.lastIndexOf("\n", prevLineEnd - 1) + 1;
    const prevLineRaw = lineStart > 0 ? sourceText.slice(prevLineStart, prevLineEnd) : "";
    const prevLineTrimmed = prevLineRaw.trim();
    const prevLineText =
      prevLineTrimmed.startsWith("//") || prevLineTrimmed.startsWith("/*") ? prevLineRaw : "";
    const scanned = lineText + "\n" + prevLineText;
    // `@no-specialize-warn` contains `@no-specialize` as a substring, so it
    // must be checked first.
    if (scanned.includes("@no-specialize-warn")) return "quiet";
    if (scanned.includes("@no-specialize")) return "off";
  } catch {
    // getSourceFile()/getStart() may fail on synthetic nodes: no marker
  }
  return undefined;
}

export function tryAutoSpecialize(
  ctx: MacroContextImpl,
  verbose: boolean,
  specCache: SpecializationCache,
  node: ts.CallExpression
): ts.Expression | undefined {
  // A call rebuilt by the visitor (e.g. one `= implicit()` just completed via
  // factory.update*) keeps its text range but has no parent chain, so the
  // opt-out checks below read the ORIGINAL call it was built from.
  const markerNode = realLocation(node) ?? node;
  if (isInOptedOutScope(ctx.sourceFile, markerNode, globalResolutionScope, "macros")) {
    return undefined;
  }

  const nodeIsSynthetic = isSyntheticNode(node);
  let suppressWarnings = nodeIsSynthetic;

  if (!nodeIsSynthetic) {
    const marker = specializeMarker(markerNode);
    if (marker === "quiet") suppressWarnings = true;
    else if (marker === "off") return undefined;
  }

  const instanceArgs: {
    index: number;
    name: string;
    methods: DictMethodMap;
  }[] = [];
  const declarationOnlyArgs: string[] = [];

  for (let i = 0; i < node.arguments.length; i++) {
    const arg = node.arguments[i];
    const argName = getInstanceName(arg);
    if (!argName) continue;

    let methods = tryExtractInstanceFromSource(ctx, arg);

    // A resolvable argument whose source extraction failed: the
    // declaration-keyed registry (same declaration, never a same-named one).
    if (!methods && !isSyntheticNode(arg)) {
      let e: ts.Expression = arg;
      while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) e = e.expression;
      if (ts.isIdentifier(e)) {
        let sym: ts.Symbol | undefined;
        try {
          sym = ctx.typeChecker.getSymbolAtLocation(e);
        } catch (error) {
          warnCheckerFailure(ctx, e, `auto-specialization (symbol lookup of '${e.text}')`, error);
        }
        if (sym) methods = methodsForResolvedDeclaration(ctx, sym);
      }
    }

    // Name-keyed registry only for an argument the checker can't resolve —
    // a resolvable one that failed extraction is NOT that registry entry
    // (tc#8 / core#4).
    if (
      !methods &&
      !argResolvesToDeclaration(ctx, arg) &&
      isRegisteredInstance(argName, ctx.program)
    ) {
      methods = getInstanceMethods(argName, ctx.program);
    }

    if (methods) {
      instanceArgs.push({ index: i, name: argName, methods });
    } else if (isDeclarationOnlyTypeclassInstance(ctx, arg, realLocation(node))) {
      declarationOnlyArgs.push(argName);
    }
  }

  if (instanceArgs.length === 0) {
    // A typeclass instance imported from a package's compiled dist has no
    // readable method bodies, so it can never be inlined. Say so instead of
    // silently keeping dictionary passing (validate `nativeSchema`, fp
    // `optionFunctor`).
    if (declarationOnlyArgs.length > 0 && !suppressWarnings) {
      const fn = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : "<anonymous>";
      skippedSpecialization(
        ctx,
        markerNode,
        fn,
        `instance ${declarationOnlyArgs.map((n) => `'${n}'`).join(", ")} is only visible as a ` +
          `declaration (from a .d.ts), so its method bodies cannot be inlined; ` +
          `falling back to dictionary passing.`
      );
    }
    return undefined;
  }

  const fnName = ts.isIdentifier(node.expression)
    ? node.expression.text
    : ts.isPropertyAccessExpression(node.expression)
      ? node.expression.name.text
      : "<anonymous>";

  const fnBody = resolveAutoSpecFunctionBody(ctx.typeChecker, node.expression);
  if (!fnBody) {
    if (!suppressWarnings) {
      skippedSpecialization(
        ctx,
        node,
        fnName,
        `function body not resolvable. ` +
          `Declare it as a const arrow function or named function so its body can be resolved.`
      );
    }
    return undefined;
  }

  // The specialization is a hoisted arrow placed at the call site's block:
  // a body that depends on its own receiver/activation, or whose free names
  // resolve differently there (a caller-local `n` shadowing the callee's
  // module-level `n`), would change meaning (core#9). So would inlining an
  // instance method whose free names don't resolve the same at the call site.
  if (
    fnBody.asteriskToken ||
    calleeUsesReceiver(fnBody) ||
    !calleeFreeNamesResolveSameAt(ctx, fnBody, node) ||
    !instanceArgs.every((a) =>
      Array.from(a.methods.methods.values()).every((m) =>
        methodFreeNamesResolveSameAt(ctx, m, realLocation(node))
      )
    )
  ) {
    return undefined;
  }

  const unfilledImplicitCall = findUnfilledImplicitCall(ctx, fnBody);
  if (unfilledImplicitCall) {
    if (!suppressWarnings) {
      skippedSpecialization(
        ctx,
        node,
        fnName,
        `its body calls ${unfilledImplicitCall}() without its = implicit() argument, which the ` +
          `specialized copy could not pass on; falling back to dictionary passing.`
      );
    }
    return undefined;
  }

  const body = ts.isFunctionDeclaration(fnBody) ? fnBody.body : fnBody.body;
  if (body && ts.isBlock(body)) {
    const classification = classifyInlineFailureDetailed(body);
    if (classification.reason && !classification.canFlatten) {
      // Don't warn for void functions - "no return statement" is expected for them
      const isVoidFunction = isVoidReturnType(ctx.typeChecker, fnBody);
      if (
        !suppressWarnings &&
        !(classification.reason === "no return statement" && isVoidFunction)
      ) {
        const help = getInlineFailureHelp(classification.reason);
        skippedSpecialization(ctx, node, fnName, `${classification.reason}. ${help}`);
      }
      return undefined;
    }
  }

  if (verbose) {
    console.log(
      `[typesugar] Auto-specializing call to ${fnName} with instance: ${instanceArgs.map((a) => a.name).join(", ")}`
    );
  }

  let fnSymbolId = fnName;
  try {
    const fnSymbol = ctx.typeChecker.getSymbolAtLocation(node.expression);
    if (fnSymbol) fnSymbolId = `fn#${stableSymbolId(fnSymbol)}`;
  } catch {
    // TypeChecker may throw on unresolvable symbols — use fnName as fallback
  }
  const dictBrands = instanceArgs.map((a) => a.methods.brand);
  // The hoisted copy has no type parameters: its annotations get this call's
  // types (`a: A` → `a: Feature`), so the expanded TypeScript type-checks.
  const instantiated = instantiatedAnnotations(
    ctx,
    fnBody,
    realLocation(node),
    new Set(instanceArgs.map((a) => a.index))
  );
  // Key by WHICH instance sits at WHICH position — two different Show<Point>
  // instances (or the same two swapped) must not share a body (tc#9) — and by
  // the types the copy is annotated with (`tag(x, 1)` and `tag(x, "s")`).
  const dictIdentities = instanceArgs.map(
    (a) => `${a.index}:${instanceIdentity(ctx, node.arguments[a.index], a.name)}`
  );
  if (instantiated) dictIdentities.push(...instantiated.key.map((k) => `type ${k}`));
  const cacheKey = SpecializationCache.computeKey(fnSymbolId, dictIdentities);

  const cachedEntry = specCache.get(cacheKey);
  if (cachedEntry) {
    if (verbose) {
      console.log(`[typesugar] Reusing cached specialization: ${cachedEntry.ident.text}`);
    }
    const dictParamIndices = new Set(instanceArgs.map((a) => a.index));
    const remainingArgs = Array.from(node.arguments).filter((_, i) => !dictParamIndices.has(i));
    return ctx.factory.createCallExpression(cachedEntry.ident, undefined, remainingArgs);
  }

  try {
    const specialized = inlineAutoSpecializeForHoisting(
      ctx,
      fnBody,
      instanceArgs,
      fnName,
      instantiated,
      realLocation(node)
    );

    if (specialized) {
      const hoistedIdent = SpecializationCache.generateHoistedName(fnName, dictBrands, ctx.hygiene);
      const hoistedDecl = createHoistedSpecialization(ctx.factory, hoistedIdent, specialized);

      specCache.set(cacheKey, hoistedIdent, hoistedDecl);

      if (verbose) {
        console.log(`[typesugar] Created hoisted specialization: ${hoistedIdent.text}`);
      }

      const dictParamIndices = new Set(instanceArgs.map((a) => a.index));
      const remainingArgs = Array.from(node.arguments).filter((_, i) => !dictParamIndices.has(i));
      // Type arguments are dropped: the hoisted arrow has no type parameters.
      return ctx.factory.createCallExpression(hoistedIdent, undefined, remainingArgs);
    } else {
      if (!suppressWarnings) {
        skippedSpecialization(
          ctx,
          node,
          fnName,
          `inlining returned no result; falling back to dictionary passing.`
        );
      }
    }
  } catch (error) {
    if (!suppressWarnings) {
      skippedSpecialization(ctx, node, fnName, `${error}. Falling back to dictionary passing.`);
    }
    if (verbose) {
      console.log(`[typesugar] Auto-specialization failed: ${error}`);
    }
  }

  return undefined;
}

/** Warn TS9602 (from the diagnostic catalog): `fn`'s call keeps dictionary passing, because `reason`. */
function skippedSpecialization(
  ctx: MacroContextImpl,
  node: ts.Node,
  fn: string,
  reason: string
): void {
  ctx.diagnostic(TS9602).at(node).withArgs({ fn, reason }).emit();
}

// ---------------------------------------------------------------------------
// Return-type-driven specialization helpers
// ---------------------------------------------------------------------------

export function getTypeName(typeChecker: ts.TypeChecker, type: ts.Type): string | undefined {
  if (type.isUnion()) {
    for (const t of type.types) {
      if (t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) continue;
      const name = getTypeName(typeChecker, t);
      if (name) return name;
    }
  }
  const symbol = type.getSymbol() ?? type.aliasSymbol;
  if (symbol) {
    return symbol.getName();
  }
  const typeStr = typeChecker.typeToString(type);
  const match = typeStr.match(/^(\w+)(?:<|$)/);
  return match ? match[1] : undefined;
}

export function getContextualTypeForCall(
  typeChecker: ts.TypeChecker,
  node: ts.CallExpression
): ts.Type | undefined {
  try {
    const contextual = typeChecker.getContextualType(node);
    if (contextual) return contextual;
  } catch {
    // TypeChecker may throw on getContextualType — fall through to parent-based detection
  }

  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && parent.type) {
    try {
      return typeChecker.getTypeFromTypeNode(parent.type);
    } catch {
      // TypeChecker may throw on unresolvable type nodes
      return undefined;
    }
  }

  if (ts.isReturnStatement(parent)) {
    let current: ts.Node | undefined = parent.parent;
    while (current) {
      if (
        (ts.isFunctionDeclaration(current) ||
          ts.isArrowFunction(current) ||
          ts.isFunctionExpression(current) ||
          ts.isMethodDeclaration(current)) &&
        current.type
      ) {
        try {
          return typeChecker.getTypeFromTypeNode(current.type);
        } catch {
          // TypeChecker may throw on unresolvable return type annotations
          return undefined;
        }
      }
      current = current.parent;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Result algebra specialization
// ---------------------------------------------------------------------------

export function specializeForResultAlgebra(
  ctx: MacroContextImpl,
  fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
  algebra: ResultAlgebra
): ts.Expression | undefined {
  const params = Array.from(fn.parameters);
  const body = ts.isFunctionDeclaration(fn) ? fn.body : fn.body;
  if (!body) return undefined;

  const rewrittenBody = rewriteResultCalls(ctx, body, algebra);

  let finalBody: ts.ConciseBody = rewrittenBody as ts.ConciseBody;

  if (ts.isBlock(rewrittenBody)) {
    const analysis = analyzeForFlattening(rewrittenBody);
    if (analysis.canFlatten) {
      const flattened = flattenReturnsToExpression(ctx, rewrittenBody);
      if (flattened) {
        finalBody = flattened;
      }
    }
  }

  return ctx.factory.createArrowFunction(
    undefined,
    undefined,
    params,
    undefined,
    ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    finalBody
  );
}

export function rewriteResultCalls(
  ctx: MacroContextImpl,
  node: ts.Node,
  algebra: ResultAlgebra
): ts.Node {
  function visit(n: ts.Node): ts.Node {
    if (ts.isCallExpression(n)) {
      if (ts.isIdentifier(n.expression) && n.expression.text === "ok") {
        if (n.arguments.length >= 1) {
          const visitedValue = ts.visitNode(n.arguments[0], visit) as ts.Expression;
          return algebra.rewriteOk(ctx, visitedValue);
        }
        return algebra.rewriteOk(ctx, ctx.factory.createIdentifier("undefined"));
      }

      if (ts.isIdentifier(n.expression) && n.expression.text === "err") {
        if (n.arguments.length >= 1) {
          const visitedError = ts.visitNode(n.arguments[0], visit) as ts.Expression;
          return algebra.rewriteErr(ctx, visitedError);
        }
        return algebra.rewriteErr(ctx, ctx.factory.createIdentifier("undefined"));
      }

      if (ts.isPropertyAccessExpression(n.expression)) {
        const obj = n.expression.expression;
        const method = n.expression.name.text;

        if (ts.isIdentifier(obj) && (obj.text === "Result" || obj.text === "R")) {
          if (method === "ok" && n.arguments.length >= 1) {
            const visitedValue = ts.visitNode(n.arguments[0], visit) as ts.Expression;
            return algebra.rewriteOk(ctx, visitedValue);
          }
          if (method === "err" && n.arguments.length >= 1) {
            const visitedError = ts.visitNode(n.arguments[0], visit) as ts.Expression;
            return algebra.rewriteErr(ctx, visitedError);
          }
        }
      }
    }

    return ts.visitEachChild(n, visit, ctx.transformContext);
  }

  return ts.visitNode(node, visit) as ts.Node;
}

// ---------------------------------------------------------------------------
// Return-type-driven specialization entry point
// ---------------------------------------------------------------------------

export function tryReturnTypeDrivenSpecialize(
  ctx: MacroContextImpl,
  verbose: boolean,
  specCache: SpecializationCache,
  node: ts.CallExpression
): ts.Expression | undefined {
  let fnType: ts.Type;
  try {
    fnType = ctx.typeChecker.getTypeAtLocation(node.expression);
  } catch {
    // TypeChecker may throw on unresolvable expressions — skip return-type specialization
    return undefined;
  }
  const callSigs = fnType.getCallSignatures();
  if (!callSigs.length) return undefined;

  const returnType = callSigs[0].getReturnType();

  const returnTypeName = getTypeName(ctx.typeChecker, returnType);
  if (
    returnTypeName !== "Result" &&
    returnTypeName !== "Either" &&
    returnTypeName !== "Validation"
  ) {
    return undefined;
  }

  const contextualType = getContextualTypeForCall(ctx.typeChecker, node);
  if (!contextualType) {
    return undefined;
  }

  const targetTypeName = getTypeName(ctx.typeChecker, contextualType);
  if (!targetTypeName) {
    return undefined;
  }

  if (returnTypeName === targetTypeName) {
    return undefined;
  }

  const algebra = getResultAlgebra(targetTypeName);
  if (!algebra) {
    return undefined;
  }

  const fnName = ts.isIdentifier(node.expression)
    ? node.expression.text
    : ts.isPropertyAccessExpression(node.expression)
      ? node.expression.name.text
      : "<anonymous>";

  if (verbose) {
    console.log(
      `[typesugar] Return-type-driven specialization: ${fnName} from ${returnTypeName ?? "Result"} to ${targetTypeName}`
    );
  }

  const fnBody = resolveAutoSpecFunctionBody(ctx.typeChecker, node.expression);
  if (!fnBody) {
    return undefined;
  }

  let fnSymbolId = fnName;
  try {
    const fnSymbol = ctx.typeChecker.getSymbolAtLocation(node.expression);
    if (fnSymbol) fnSymbolId = `fn#${stableSymbolId(fnSymbol)}`;
  } catch {
    // TypeChecker may throw on unresolvable symbols — use fnName as fallback
  }
  const cacheKey = SpecializationCache.computeKey(fnSymbolId, [algebra.name]);

  const cachedEntry = specCache.get(cacheKey);
  if (cachedEntry) {
    if (verbose) {
      console.log(
        `[typesugar] Reusing cached result-type specialization: ${cachedEntry.ident.text}`
      );
    }
    return ctx.factory.createCallExpression(
      cachedEntry.ident,
      node.typeArguments,
      Array.from(node.arguments)
    );
  }

  const specialized = specializeForResultAlgebra(ctx, fnBody, algebra);
  if (!specialized) {
    return undefined;
  }

  const hoistedIdent = SpecializationCache.generateHoistedName(fnName, [algebra.name], ctx.hygiene);
  const hoistedDecl = createHoistedSpecialization(ctx.factory, hoistedIdent, specialized);

  specCache.set(cacheKey, hoistedIdent, hoistedDecl);

  if (verbose) {
    console.log(`[typesugar] Created hoisted result-type specialization: ${hoistedIdent.text}`);
  }

  return ctx.factory.createCallExpression(
    hoistedIdent,
    node.typeArguments,
    Array.from(node.arguments)
  );
}

// ---------------------------------------------------------------------------
// Derived instance call inlining (Wave 4 — PEP-019)
// ---------------------------------------------------------------------------

const MAX_RECURSIVE_INLINE_DEPTH = 10;

/**
 * Try to inline a direct method call on a known typeclass instance.
 *
 * Handles patterns like:
 *   eqPoint.eq(p1, p2)  → p1.x === p2.x && p1.y === p2.y
 *   showUser.show(u)     → `User(name = ${u.name}, age = ${u.age})`
 *
 * After initial inlining, recursively resolves nested instance calls
 * (e.g., eqNumber.eq(a.x, b.x) → a.x === b.x).
 *
 * `scopeNode` is the source node the call stands for when `node` itself is
 * synthetic (e.g. the binary expression an operator rewrite replaced); names
 * in the inlined body are resolved there.
 *
 * Declines (returns undefined, keeping the ordinary call) unless the receiver
 * resolves to that instance's own declaration, the method body's free names
 * mean the same thing at the call site, and `inlineMethod`'s semantic checks
 * pass.
 */
export function tryInlineDerivedInstanceCall(
  ctx: MacroContextImpl,
  node: ts.CallExpression,
  scopeNode?: ts.Node,
  temps?: StatementTemps
): ts.Expression | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
  if (!ts.isIdentifier(node.expression.expression)) return undefined;

  const location = realLocation(node, scopeNode);
  const methodName = node.expression.name.text;

  const methodMap = resolveDictForIdentifier(ctx, node.expression.expression, location, true);
  if (!methodMap) return undefined;

  const method = methodMap.methods.get(methodName);
  if (!method) return undefined;
  const mismatch = methodFreeNameMismatch(ctx, method, location);
  if (mismatch) {
    if (mismatch.notInScope && mismatch.name && location) {
      warnFreeNameNotInScope(
        ctx,
        location,
        `${node.expression.expression.text}.${methodName}`,
        mismatch.name
      );
    }
    return undefined;
  }

  // A value the inlined body reads more than once (a rational's `a.d * b.d`
  // in `p + q + r`) is bound to a `const` before the statement when the call
  // is evaluated first and once in it (evaluatedFirstOnceIn), and committed
  // only if the call is inlined. An operand with an effect (`mk() + mk()`)
  // may be hoisted only when nothing in the statement is evaluated before the
  // call at all (nothingEvaluatedBeforeIn): in `pv + (bump() + bump())` the
  // statement reads `pv` first, and hoisting the bumps in front of the
  // statement would read it after them (review 7).
  const pending: ts.Statement[] = [];
  const first = !!temps && !!scopeNode && evaluatedFirstOnceIn(temps.anchor, scopeNode);
  const hoistEffects =
    first && nothingEvaluatedBeforeIn(temps!.anchor, scopeNode!, ctx.typeChecker);
  const hoistConst = first
    ? (name: ts.Identifier, init: ts.Expression): void => {
        pending.push(
          ctx.factory.createVariableStatement(
            undefined,
            ctx.factory.createVariableDeclarationList(
              [ctx.factory.createVariableDeclaration(name, undefined, undefined, init)],
              ts.NodeFlags.Const
            )
          )
        );
      }
    : undefined;
  if (narrowedArgumentsBlockInlining(ctx, node, method)) return undefined;
  const inlined = inlineMethod(
    ctx,
    method,
    Array.from(node.arguments),
    hoistConst ? { hoistConst, hoistEffects } : undefined
  );
  if (!inlined) return undefined;
  const reexpressed = reexpressInlinedTypes(ctx, inlined, method, location);
  if (!reexpressed) return undefined;
  temps?.declarations.push(...pending);

  const result = recursivelyInlineInstanceCalls(ctx, reexpressed, 0, location);

  // Strip comments from the inlined output — the method template can carry
  // trivia from the instance declaration (e.g. JSDoc), which the printer
  // would otherwise emit at the call site. (Behavior unified from the legacy
  // transformer in PEP-053 Wave 3.)
  return preserveSourceMap(cloneWithoutComments(result), node);
}

/**
 * Declarations to place just before one statement of a statement list
 * (source file, block, module block) while it is visited: the transformer
 * opens one per statement (MacroTransformer.visitStatementContainer) and
 * splices what was added before the visited statement.
 */
export interface StatementTemps {
  readonly anchor: ts.Statement;
  readonly declarations: ts.Statement[];
}

/**
 * Is `node` (real source, with parents) evaluated unconditionally, exactly
 * once, and before anything else with an effect, each time `anchor` runs? Then
 * an effect-free value it computes can be bound to a `const` declared just
 * before `anchor` instead. Walks up through parentheses and the operands of
 * non-short-circuit, non-assignment binary operators (a right operand only
 * when its left one has no effect: `a + b + c`, `(a + b) + (c + d)`), to the
 * expression of an expression or `return` statement, or the initializer of
 * the FIRST declaration of a variable statement (a later one would run after
 * the earlier declarators, which may have effects or declare a name it reads).
 * Anything else (a function boundary, `?:`, `&&`, a call argument) is no.
 */
export function evaluatedFirstOnceIn(anchor: ts.Statement, node: ts.Node): boolean {
  if (isSyntheticNode(node)) return false;
  let child: ts.Node = node;
  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isParenthesizedExpression(parent)) continue;
    if (ts.isBinaryExpression(parent)) {
      const op = parent.operatorToken.kind;
      if (
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken ||
        op === ts.SyntaxKind.CommaToken ||
        (op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment)
      ) {
        return false;
      }
      if (child === parent.right && !isEffectFreeSyntax(parent.left)) return false;
      continue;
    }
    if (ts.isExpressionStatement(parent) || ts.isReturnStatement(parent)) {
      return parent === anchor && parent.expression === child;
    }
    if (ts.isVariableDeclaration(parent)) {
      const list = parent.parent;
      return (
        parent.initializer === child &&
        ts.isVariableDeclarationList(list) &&
        list.declarations[0] === parent &&
        list.parent === anchor
      );
    }
    return false;
  }
  return false;
}

/**
 * Given {@link evaluatedFirstOnceIn}, is NOTHING evaluated before `node` each
 * time `anchor` runs, except values no effect can change? The left operands
 * passed on the way up are effect-free; this asks more: that each is
 * constant -- literals, `this`, and names bound by `const` (checker:
 * the symbol's declaration is a `const` variable declaration), combined by
 * operators. A read of a `let`, a parameter, an import (a live binding) or a
 * property (`pv`, `this.pos`, `a.x`) is evaluated before `node`, so an effect
 * `node` has must not be moved in front of the statement: it could change
 * what that read sees. Unresolvable or synthetic names are not constant.
 */
export function nothingEvaluatedBeforeIn(
  anchor: ts.Statement,
  node: ts.Node,
  checker: ts.TypeChecker
): boolean {
  if (!evaluatedFirstOnceIn(anchor, node)) return false;
  let child: ts.Node = node;
  for (
    let parent = node.parent;
    parent && parent !== anchor;
    child = parent, parent = parent.parent
  ) {
    if (ts.isBinaryExpression(parent) && child === parent.right) {
      if (!isConstantSyntax(parent.left, checker)) return false;
    }
  }
  return true;
}

function isConstantSyntax(e: ts.Expression, checker: ts.TypeChecker): boolean {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (
    ts.isNumericLiteral(e) ||
    ts.isStringLiteral(e) ||
    ts.isBigIntLiteral(e) ||
    ts.isNoSubstitutionTemplateLiteral(e) ||
    e.kind === ts.SyntaxKind.ThisKeyword ||
    e.kind === ts.SyntaxKind.TrueKeyword ||
    e.kind === ts.SyntaxKind.FalseKeyword ||
    e.kind === ts.SyntaxKind.NullKeyword
  ) {
    return true;
  }
  if (ts.isIdentifier(e)) {
    // Identity through the checker, not the name (CLAUDE.md); a synthetic
    // node is outside the checker's contract, so it is simply not constant.
    if (isSyntheticNode(e)) return false;
    let symbol: ts.Symbol | undefined;
    try {
      symbol = checker.getSymbolAtLocation(e);
    } catch {
      return false;
    }
    const decl = symbol?.valueDeclaration;
    return (
      !!decl &&
      ts.isVariableDeclaration(decl) &&
      (ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const) !== 0
    );
  }
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (op === ts.SyntaxKind.CommaToken) return false;
    if (op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment) return false;
    return isConstantSyntax(e.left, checker) && isConstantSyntax(e.right, checker);
  }
  if (ts.isPrefixUnaryExpression(e)) {
    return (
      e.operator !== ts.SyntaxKind.PlusPlusToken &&
      e.operator !== ts.SyntaxKind.MinusMinusToken &&
      isConstantSyntax(e.operand, checker)
    );
  }
  return false;
}

/** Literals, names and reads combined by operators: no call, assignment or update. */
function isEffectFreeSyntax(e: ts.Expression): boolean {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (
    ts.isIdentifier(e) ||
    ts.isNumericLiteral(e) ||
    ts.isStringLiteral(e) ||
    ts.isBigIntLiteral(e) ||
    e.kind === ts.SyntaxKind.ThisKeyword ||
    e.kind === ts.SyntaxKind.TrueKeyword ||
    e.kind === ts.SyntaxKind.FalseKeyword ||
    e.kind === ts.SyntaxKind.NullKeyword
  ) {
    return true;
  }
  if (ts.isPropertyAccessExpression(e)) {
    return !e.questionDotToken && isEffectFreeSyntax(e.expression);
  }
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (op === ts.SyntaxKind.CommaToken) return false;
    if (op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment) return false;
    return isEffectFreeSyntax(e.left) && isEffectFreeSyntax(e.right);
  }
  if (ts.isPrefixUnaryExpression(e)) {
    return (
      e.operator !== ts.SyntaxKind.PlusPlusToken &&
      e.operator !== ts.SyntaxKind.MinusMinusToken &&
      isEffectFreeSyntax(e.operand)
    );
  }
  return false;
}

/**
 * Recursively inline nested instance method calls within an expression.
 *
 * After the top-level inline (e.g., eqPoint.eq → body with eqNumber.eq calls),
 * this walks the result and inlines any remaining known instance calls. The
 * nested receivers are synthetic copies; they are resolved by name at the
 * original call site (`location`), which `methodFreeNamesResolveSameAt` has
 * already verified binds them to the same declarations the method body saw.
 */
function recursivelyInlineInstanceCalls(
  ctx: MacroContextImpl,
  node: ts.Expression,
  depth: number,
  location: ts.Node | undefined
): ts.Expression {
  if (depth >= MAX_RECURSIVE_INLINE_DEPTH) return node;

  function visit(n: ts.Node): ts.Node {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression)
    ) {
      const methName = n.expression.name.text;
      const methodMap = resolveDictForIdentifier(ctx, n.expression.expression, location, true);
      const method = methodMap?.methods.get(methName);
      if (method && methodFreeNamesResolveSameAt(ctx, method, location)) {
        const inlined = inlineMethod(ctx, method, Array.from(n.arguments));
        const reexpressed = inlined && reexpressInlinedTypes(ctx, inlined, method, location);
        if (reexpressed) {
          const deeper = recursivelyInlineInstanceCalls(ctx, reexpressed, depth + 1, location);
          return ts.visitEachChild(deeper, visit, ctx.transformContext);
        }
      }
    }

    return ts.visitEachChild(n, visit, ctx.transformContext);
  }

  return ts.visitNode(node, visit) as ts.Expression;
}

// ---------------------------------------------------------------------------
// Post-pass DCE for derived instances
// ---------------------------------------------------------------------------

/**
 * Eliminate derived instance declarations that have no remaining references
 * after all call-site inlining is complete.
 *
 * Scans the transformed statements for:
 * 1. Derived instance declarations: `const eqPoint = { ... }`
 * 2. Registration calls: `Eq.registerInstance("Point", eqPoint)`
 *
 * If an instance variable has no references outside its own declarator and
 * registration call, the declarator (and the registration) are removed.
 *
 * Never removed (core#5): exported declarations (importers may use them),
 * sibling declarators in the same statement (`const a = {...}, VERSION = 3`
 * loses only `a`), and object literals whose evaluation could have side
 * effects (calls, spreads, computed keys …).
 */
export function eliminateDeadDerivedInstances(
  statements: ts.Statement[],
  inlinedInstanceNames: ReadonlySet<string>,
  verbose: boolean
): ts.Statement[] {
  if (inlinedInstanceNames.size === 0) return statements;

  interface Candidate {
    stmtIndex: number;
    decl: ts.VariableDeclaration;
    regIndex?: number;
  }
  const candidates = new Map<string, Candidate>();

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];

    if (
      ts.isVariableStatement(stmt) &&
      !stmt.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DeclareKeyword
      )
    ) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          ts.isObjectLiteralExpression(decl.initializer) &&
          isSideEffectFreeObjectLiteral(decl.initializer) &&
          inlinedInstanceNames.has(decl.name.text)
        ) {
          candidates.set(decl.name.text, { stmtIndex: i, decl });
        }
      }
    }

    if (
      ts.isExpressionStatement(stmt) &&
      ts.isCallExpression(stmt.expression) &&
      ts.isPropertyAccessExpression(stmt.expression.expression) &&
      stmt.expression.expression.name.text === "registerInstance" &&
      stmt.expression.arguments.length >= 2
    ) {
      const lastArg = stmt.expression.arguments[stmt.expression.arguments.length - 1];
      if (ts.isIdentifier(lastArg) && candidates.has(lastArg.text)) {
        candidates.get(lastArg.text)!.regIndex = i;
      }
    }
  }

  if (candidates.size === 0) return statements;

  const deadDecls = new Set<ts.VariableDeclaration>();
  const removeStatements = new Set<number>();

  for (const [name, { stmtIndex, decl, regIndex }] of candidates) {
    let hasExternalRef = false;

    for (let i = 0; i < statements.length && !hasExternalRef; i++) {
      if (i === regIndex) continue;
      if (i === stmtIndex) {
        // Same statement: only OTHER declarators count, plus this one's own
        // initializer (a self-reference keeps it — conservative).
        const stmt = statements[i] as ts.VariableStatement;
        for (const d of stmt.declarationList.declarations) {
          if (d === decl) {
            if (d.initializer && containsIdentifierRef(d.initializer, name)) hasExternalRef = true;
          } else if (containsIdentifierRef(d, name)) {
            hasExternalRef = true;
          }
        }
        continue;
      }
      if (containsIdentifierRef(statements[i], name)) hasExternalRef = true;
    }

    if (!hasExternalRef) {
      deadDecls.add(decl);
      if (regIndex !== undefined) removeStatements.add(regIndex);
      if (verbose) {
        console.log(`[typesugar] DCE: removed fully-inlined instance '${name}'`);
      }
    }
  }

  if (deadDecls.size === 0) return statements;

  const out: ts.Statement[] = [];
  for (let i = 0; i < statements.length; i++) {
    if (removeStatements.has(i)) continue;
    const stmt = statements[i];
    if (
      ts.isVariableStatement(stmt) &&
      stmt.declarationList.declarations.some((d) => deadDecls.has(d))
    ) {
      const kept = stmt.declarationList.declarations.filter((d) => !deadDecls.has(d));
      if (kept.length === 0) continue;
      out.push(
        ts.factory.updateVariableStatement(
          stmt,
          stmt.modifiers,
          ts.factory.updateVariableDeclarationList(stmt.declarationList, kept)
        )
      );
      continue;
    }
    out.push(stmt);
  }
  return out;
}

/** Can evaluating this object literal be dropped without losing a side effect? */
function isSideEffectFreeObjectLiteral(obj: ts.ObjectLiteralExpression): boolean {
  const isPureValue = (e: ts.Expression): boolean => {
    while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) {
      e = e.expression;
    }
    return (
      ts.isArrowFunction(e) ||
      ts.isFunctionExpression(e) ||
      ts.isIdentifier(e) ||
      ts.isStringLiteral(e) ||
      ts.isNumericLiteral(e) ||
      ts.isNoSubstitutionTemplateLiteral(e) ||
      e.kind === ts.SyntaxKind.TrueKeyword ||
      e.kind === ts.SyntaxKind.FalseKeyword ||
      e.kind === ts.SyntaxKind.NullKeyword ||
      (ts.isObjectLiteralExpression(e) && isSideEffectFreeObjectLiteral(e))
    );
  };
  return obj.properties.every((p) => {
    if (p.name && ts.isComputedPropertyName(p.name)) return false;
    if (ts.isPropertyAssignment(p)) return isPureValue(p.initializer);
    if (ts.isShorthandPropertyAssignment(p)) return !p.objectAssignmentInitializer;
    return ts.isMethodDeclaration(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p);
  });
}

function containsIdentifierRef(node: ts.Node, name: string): boolean {
  if (ts.isIdentifier(node) && node.text === name) return true;

  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && containsIdentifierRef(child, name)) {
      found = true;
    }
  });

  return found;
}
