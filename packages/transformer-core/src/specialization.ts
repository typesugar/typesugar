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

/**
 * Would every free identifier of `method`'s body mean the same thing at
 * `location` as where the method was defined? (A call-site local named like a
 * module-level helper or like `String` would otherwise capture it — tc#18.)
 *
 * With no real location (a synthetic call produced by another rewrite with no
 * original node) this cannot be checked and returns true — the pre-existing
 * behaviour; see the report's "Needs from other owners".
 */
function methodFreeNamesResolveSameAt(
  ctx: MacroContextImpl,
  method: DictMethod,
  location: ts.Node | undefined
): boolean {
  if (!method.node) return false;
  if (!location) return true;
  for (const name of collectMethodFreeNames(method.node)) {
    const actual = resolveNameAt(ctx, name, location);
    if (actual === "error") return false;
    const expected = method.freeSymbols?.get(name);
    if (expected) {
      if (!actual || !sameSymbol(ctx.typeChecker, actual, expected)) return false;
      continue;
    }
    // No recorded symbol: a body-local name, or a method registered without
    // checker info (primitive intrinsics, legacy registrations). Accept only
    // a lib/ambient binding or the call-site file's own module scope.
    if (!actual) continue;
    const decls = actual.declarations ?? [];
    if (decls.length === 0) continue;
    if (decls.every((d) => d.getSourceFile().isDeclarationFile)) continue;
    if (decls.every((d) => d.getSourceFile() === ctx.sourceFile && isModuleScopeDecl(d))) continue;
    return false;
  }
  return true;
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
  dictParamMap: Map<string, DictMethodMap>
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
          if (inlined) {
            const mapped = preserveSourceMap(inlined, n);
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
  instantiated?: InstantiatedAnnotations
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

  const specializedBody = rewriteDictCallsForAutoSpec(ctx, body, dictParamMap);

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
 * `t` as a type node that means `t` at `location`, or undefined. The checker's
 * own node builder first; it gives up on a type argument that has no name in
 * scope at `location` (`Feature<Geometry, ...>` where `Geometry` isn't
 * imported), so a generic instantiated with exactly its defaults is written
 * by its bare name when that name resolves to it here (`Feature`).
 */
function typeNodeAt(
  checker: ts.TypeChecker,
  f: ts.NodeFactory,
  t: ts.Type,
  location: ts.Node
): ts.TypeNode | undefined {
  const built = checker.typeToTypeNode(t, location, ts.NodeBuilderFlags.NoTruncation);
  if (built) return built;
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
function isDeclarationOnlyTypeclassInstance(ctx: MacroContextImpl, arg: ts.Expression): boolean {
  if (isSyntheticNode(arg)) return false;
  let e = arg;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) e = e.expression;
  if (!ts.isIdentifier(e) && !ts.isPropertyAccessExpression(e)) return false;
  try {
    const checker = ctx.typeChecker;
    let sym = checker.getSymbolAtLocation(e);
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
    const type = checker.getTypeAtLocation(e);
    const tcName = (type.aliasSymbol ?? type.getSymbol())?.getName();
    return !!tcName && getOpMapForTypeclass(ctx.program, tcName) !== undefined;
  } catch (error) {
    warnCheckerFailure(ctx, arg, "auto-specialization (declaration-only instance check)", error);
    return false;
  }
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
    const actual = resolveNameAt(ctx, id.text, location);
    if (actual === "error" || !actual || !sameSymbol(ctx.typeChecker, actual, expected)) ok = false;
  });
  return ok;
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
    try {
      const sourceText = markerNode.getSourceFile().text;
      const nodeStart = markerNode.getStart();
      const lineStart = sourceText.lastIndexOf("\n", nodeStart) + 1;
      const lineText = sourceText.slice(lineStart, nodeStart);
      // Also check the immediately preceding line, for `// @no-specialize` on
      // its own comment line above the call (the other documented form). Only
      // comment-only lines count — a marker in a TRAILING comment on the
      // previous line belongs to that line's statement, not this one.
      const prevLineEnd = lineStart > 0 ? lineStart - 1 : 0;
      const prevLineStart = sourceText.lastIndexOf("\n", prevLineEnd - 1) + 1;
      const prevLineRaw = lineStart > 0 ? sourceText.slice(prevLineStart, prevLineEnd) : "";
      const prevLineTrimmed = prevLineRaw.trim();
      const prevLineText =
        prevLineTrimmed.startsWith("//") || prevLineTrimmed.startsWith("/*") ? prevLineRaw : "";
      const scanned = lineText + "\n" + prevLineText;

      // `@no-specialize-warn` contains `@no-specialize` as a substring, so it
      // must be checked first — otherwise it would always hit the bail branch
      // below instead of only suppressing warnings.
      if (scanned.includes("@no-specialize-warn")) {
        suppressWarnings = true;
      } else if (scanned.includes("@no-specialize")) {
        return undefined;
      }
    } catch {
      // getSourceFile()/getStart() may fail on synthetic nodes — proceed with auto-specialization
    }
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
    } else if (isDeclarationOnlyTypeclassInstance(ctx, arg)) {
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
      ctx.reportWarning(
        node,
        `[TS9602] Auto-specialization of ${fn} skipped — instance ` +
          `${declarationOnlyArgs.map((n) => `'${n}'`).join(", ")} is only visible as a ` +
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
      ctx.reportWarning(
        node,
        `[TS9602] Auto-specialization of ${fnName} skipped — ` +
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
      ctx.reportWarning(
        node,
        `[TS9602] Auto-specialization of ${fnName} skipped — its body calls ` +
          `${unfilledImplicitCall}() without its = implicit() argument, which the ` +
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
        ctx.reportWarning(
          node,
          `[TS9602] Auto-specialization of ${fnName} skipped — ` +
            `${classification.reason}. ${help}`
        );
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
      instantiated
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
        ctx.reportWarning(
          node,
          `[TS9602] Auto-specialization of ${fnName} skipped — ` +
            `inlining returned no result; falling back to dictionary passing.`
        );
      }
    }
  } catch (error) {
    if (!suppressWarnings) {
      ctx.reportWarning(
        node,
        `[TS9602] Auto-specialization of ${fnName} skipped — ` +
          `${error}. Falling back to dictionary passing.`
      );
    }
    if (verbose) {
      console.log(`[typesugar] Auto-specialization failed: ${error}`);
    }
  }

  return undefined;
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
  scopeNode?: ts.Node
): ts.Expression | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
  if (!ts.isIdentifier(node.expression.expression)) return undefined;

  const location = realLocation(node, scopeNode);
  const methodName = node.expression.name.text;

  const methodMap = resolveDictForIdentifier(ctx, node.expression.expression, location, true);
  if (!methodMap) return undefined;

  const method = methodMap.methods.get(methodName);
  if (!method) return undefined;
  if (!methodFreeNamesResolveSameAt(ctx, method, location)) return undefined;

  const inlined = inlineMethod(ctx, method, Array.from(node.arguments));
  if (!inlined) return undefined;

  const result = recursivelyInlineInstanceCalls(ctx, inlined, 0, location);

  // Strip comments from the inlined output — the method template can carry
  // trivia from the instance declaration (e.g. JSDoc), which the printer
  // would otherwise emit at the call site. (Behavior unified from the legacy
  // transformer in PEP-053 Wave 3.)
  return preserveSourceMap(cloneWithoutComments(result), node);
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
        if (inlined) {
          const deeper = recursivelyInlineInstanceCalls(ctx, inlined, depth + 1, location);
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
