/**
 * Instance-method sugar: `receiver.method(args)` -> `Companion.method(receiver, ...args)`
 * for a typeclass method (e.g. a derived `p.equals(q)` -> `Point.Eq.equals(p, q)`).
 *
 * Ported from the legacy `@typesugar/transformer` pipeline (PEP-056 Wave 1) --
 * the one capability transformer-core never had, which is why the browser
 * playground could never rewrite `.equals()`-style sugar (PEP-052's own
 * "Implementation status" section names this gap explicitly).
 *
 * @see PEP-056 Wave 1
 */

import * as ts from "typescript";

import {
  resolveInstance,
  getMethodCandidates,
  getOpMapForTypeclass,
  companionPath,
} from "@typesugar/macros";

import {
  KNOWN_GLOBALS,
  MacroContextImpl,
  globalResolutionScope,
  isInOptedOutScope,
  isSyntheticNode,
  preserveSourceMap,
  cloneWithoutComments,
  stripTypeArguments,
} from "@typesugar/core";

import {
  buildInstanceReferenceExpression,
  inferSugaredExpressionType,
  type ResolveMacroFn,
  type ResolveExtensionFn,
} from "./rewriting.js";
import type { VisitFn } from "./transformer-utils.js";

// Built-in container/global types whose native methods (map/filter/then/...) must
// never be hijacked by typeclass instance-method sugar -- rewriting `arr.map(fn)`
// into a typeclass call is always wrong; native usage stays a plain method call.
const BUILTIN_METHOD_RECEIVER_NAMES: ReadonlySet<string> = new Set([
  "Array",
  "ReadonlyArray",
  "Promise",
  "Map",
  "ReadonlyMap",
  "Set",
  "ReadonlySet",
  "WeakMap",
  "WeakSet",
  "String",
  "Number",
  "Boolean",
  "BigInt",
  "Date",
  "RegExp",
  "Iterator",
  "AsyncIterator",
  "Generator",
  "AsyncGenerator",
]);

/**
 * A resolved typeclass instance to emit as the method-sugar rewrite target --
 * either a companion reference (`Point.Eq`) or a bare instance name (`eqPoint`),
 * with the module to import it from (if any) and the base type name for the
 * builtin-receiver guard.
 */
interface MethodSugarInstance {
  companionPath?: string;
  instanceName?: string;
  sourceModule?: string;
  forType: string;
  /**
   * For a derived companion: the file declaring the receiver's type (and so
   * the `<Type>` companion value), when that is not the current file.
   */
  declaringFile?: string;
}

/**
 * Resolve `receiver.method(args)` as a typeclass instance method and rewrite it
 * to the companion call `Companion.method(receiver, ...args)`.
 *
 * Maps the method name to the typeclass(es) declaring it, then looks up an
 * instance for the receiver's type. Ambiguity (two typeclasses with the same
 * method, both with an instance for the type) is an error -- the user should
 * call the companion form to disambiguate.
 *
 * Gated on activation, mirroring `tryRewriteTypeclassOperator`: method sugar
 * only rewrites if the using file activated the declaring typeclass's method
 * syntax -- either by importing a `@syntax-methods <TC>` (or
 * `@syntax-operators <TC>`, tier 3 superset of tier 2) marker module, or by
 * defining the typeclass in this file ("you don't import what you define").
 * No activation -> the call stays a plain, unrewritten method call (a native
 * TS compile error if the type has no such method, same as without typesugar).
 *
 * Called from the same call-expression dispatch site as
 * `tryRewriteExtensionMethod` and `tryRewriteOpaqueMethodCall` (all three
 * rewrite `receiver.method(args)`), as the LAST resort once both have been
 * exhausted -- mirroring the legacy pipeline's precedence, where the type
 * rewrite registry (opaque erasure) and a native/extension method both took
 * priority over typeclass method sugar. Since this function is a sibling
 * dispatcher rather than nested inside `tryRewriteExtensionMethod` the way
 * legacy nested it, it independently re-checks the guards legacy's shared
 * call chain applied before ever reaching method-sugar resolution: an
 * opted-out scope, an expression-macro receiver, an unreliable receiver type,
 * and a receiver that already has a *native* property/method of this name
 * (unless an extension forces the rewrite, e.g. an interface augmentation
 * with no real implementation).
 */
export function tryResolveTypeclassMethod(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  resolveMacroFromSymbol: ResolveMacroFn,
  resolveExtensionFromImports: ResolveExtensionFn,
  node: ts.CallExpression
): ts.Expression | undefined {
  // Skip synthetic nodes (from macro-generated code) -- the type checker can
  // throw on nodes whose symbols lack initialized links.
  if (isSyntheticNode(node)) {
    return undefined;
  }

  if (isInOptedOutScope(ctx.sourceFile, node, globalResolutionScope, "extensions")) {
    return undefined;
  }

  const propAccess = node.expression as ts.PropertyAccessExpression;
  const methodName = propAccess.name.text;
  const receiver = propAccess.expression;

  // A call receiver that is itself an expression-macro invocation
  // (`someMacro(...).method(...)`) is never typeclass method sugar.
  if (ts.isCallExpression(receiver) && ts.isIdentifier(receiver.expression)) {
    const calleeName = receiver.expression.text;
    const calleeMacro = resolveMacroFromSymbol(receiver.expression, calleeName, "expression");
    if (calleeMacro) {
      return undefined;
    }
  }

  let receiverType = ctx.typeChecker.getTypeAtLocation(receiver);
  // `const c = p.clone(); c.equals(p)`: `c` is typed from a call the checker
  // could not type (an error type). Recover it from the sugar it initialises
  // from (docs start #3).
  if (!ctx.isTypeReliable(receiverType)) {
    receiverType =
      inferSugaredExpressionType(ctx, resolveExtensionFromImports, receiver, 0) ?? receiverType;
  }
  if (!ctx.isTypeReliable(receiverType)) {
    return undefined;
  }

  // If the receiver's type NATIVELY declares this method, leave the call alone
  // -- unless an in-scope extension forces the rewrite (e.g. the interface was
  // augmented to satisfy the type checker but has no real implementation).
  // Mirrors the equivalent guard in `tryRewriteExtensionMethod`; recomputed
  // here rather than shared because this function runs as an independent
  // sibling dispatcher, not nested inside that one.
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

  const sfn = ctx.sourceFile.fileName;
  const activatedMethods = globalResolutionScope.getActivatedMethodSyntax(sfn);
  const definedTcs = globalResolutionScope.getDefinedTypeclasses(sfn);
  const activatedForMethods =
    definedTcs.size === 0 ? activatedMethods : new Set([...activatedMethods, ...definedTcs]);
  if (activatedForMethods.size === 0) return undefined;

  const candidates = getMethodCandidates(ctx.program, activatedForMethods, methodName);
  if (candidates.length === 0) return undefined;

  // `User.fromJson(json)`: the receiver is the class (or companion-carrying
  // type) ITSELF, not an instance. Resolve against the instance type and emit
  // `User.Json.fromJson(json)` without passing the class as an argument --
  // resolving against `typeof User` produced `typeof User.Json.fromJson(User,
  // json)` (docs review S#24).
  const staticSym = staticCompanionReceiver(ctx, receiver);
  const instanceSideType = staticSym
    ? ctx.typeChecker.getDeclaredTypeOfSymbol(staticSym)
    : receiverType;

  const typeName = ctx.typeChecker.typeToString(instanceSideType);
  const baseTypeName = stripTypeArguments(typeName);

  let matched: MethodSugarInstance | undefined;
  let matchedTc: string | undefined;
  for (const { typeclass } of candidates) {
    // Resolve the instance purely from scope (PEP-052): an imported/local
    // `@impl`/`@instance` value, or a `@derive(TC)` companion on the receiver's
    // type. No process-global instance registry.
    let inst = resolveMethodSugarInstance(ctx, instanceSideType, typeName, baseTypeName, typeclass);
    // A literal receiver -- `(7).show()`, `const n = 3; n.show()`, `"s".show()`
    // -- is typed as its literal type (`7`), which no `@impl Show<number>`
    // is declared for: retry with its base type (`number`), widened by the
    // checker, never by its printed text ("7").
    const widened = widenLiteralType(ctx.typeChecker, instanceSideType);
    if (!inst && widened !== instanceSideType) {
      const widenedName = ctx.typeChecker.typeToString(widened);
      inst = resolveMethodSugarInstance(
        ctx,
        widened,
        widenedName,
        stripTypeArguments(widenedName),
        typeclass
      );
    }
    // Never apply instance-method sugar for instances on a built-in receiver
    // (Promise/Array/Map/...). Those carry native methods (map, then, ...) that
    // collide with typeclass method names; rewriting `arr.map(fn)` into a
    // typeclass call is always wrong. Native usage stays a plain method call.
    if (inst && BUILTIN_METHOD_RECEIVER_NAMES.has(inst.forType)) {
      continue;
    }
    if (inst) {
      if (matched) {
        ctx.reportError(
          node,
          `Ambiguous method '${methodName}' for type '${typeName}': both ` +
            `${matchedTc} and ${typeclass} provide it. Use the companion form ` +
            `(e.g. ${typeName}.${typeclass}.${methodName}(...)) to disambiguate.`
        );
        return undefined;
      }
      matched = inst;
      matchedTc = typeclass;
    }
  }

  if (!matched) return undefined;

  const factory = ctx.factory;

  // The emitted reference: a companion path ("Point.Eq") or a bare instance name.
  const instName = matched.companionPath ?? matched.instanceName;
  if (!instName) return undefined;

  // Ensure the companion's base type / instance is imported if it comes from
  // another module (e.g. import `Point` for `Point.Eq`). Uses the shared
  // reference-hygiene mechanism (ctx.ensureImport) instead of reimplementing
  // per-transformer pending-import tracking -- and, importantly, uses the
  // identifier IT RETURNS (which may be a conflict-safe alias) rather than a
  // fresh, possibly-wrong bare identifier.
  const importName = instName.split(".")[0];

  // A derived companion lives next to the receiver's type. If that type comes
  // from a module this file doesn't import at all (e.g. only reached through
  // `makePoint()`'s return type), there is no specifier to reuse: emitting a
  // bare `Point.Eq` would be a ReferenceError at runtime, so report it instead.
  if (matched.declaringFile && !matched.sourceModule) {
    ctx.reportError(
      node,
      `typesugar cannot rewrite '.${methodName}()' to '${instName}.${methodName}(...)': ` +
        `'${importName}' is declared in '${matched.declaringFile}', which this file does not import. ` +
        `Import '${importName}' from that module, or call '${instName}.${methodName}(...)' directly.`
    );
    return undefined;
  }

  // `ctx.ensureImport` returns a bare identifier WITHOUT registering an import
  // for any name in KNOWN_GLOBALS (File, Request, Response, Worker, Map, ...),
  // so a user companion with such a name would silently bind to the runtime
  // global. Only proceed when this file itself already binds the name to the
  // right declaration (an import of it, or a local declaration).
  if (matched.sourceModule && KNOWN_GLOBALS.has(importName)) {
    if (!fileBindsName(ctx, node, importName, matched.declaringFile)) {
      ctx.reportError(
        node,
        `typesugar cannot rewrite '.${methodName}()' to '${instName}.${methodName}(...)': ` +
          `'${importName}' would resolve to the global '${importName}', not the one from ` +
          `'${matched.sourceModule}'. Import '${importName}' from '${matched.sourceModule}' explicitly.`
      );
      return undefined;
    }
  }

  let importedIdentifier: ts.Identifier | undefined;
  if (matched.sourceModule) {
    importedIdentifier = ctx.ensureImport(importName, matched.sourceModule);
  }

  const instanceRef = buildInstanceReferenceExpression(factory, instName, importedIdentifier);
  const methodAccess = factory.createPropertyAccessExpression(instanceRef, methodName);

  // The receiver becomes the first argument; existing args follow. A static
  // receiver (the class itself) is not an argument.
  const visitedArgs = node.arguments.map((a) => ts.visitNode(a, visit) as ts.Expression);
  const rewritten = factory.createCallExpression(
    methodAccess,
    undefined,
    staticSym
      ? visitedArgs
      : [cloneWithoutComments(ts.visitNode(receiver, visit) as ts.Expression), ...visitedArgs]
  );

  if (verbose) {
    console.log(
      `[typesugar] Rewriting typeclass method: ${typeName}.${methodName}() -> ${instName}.${methodName}(...)`
    );
  }

  return preserveSourceMap(rewritten, node);
}

/**
 * The type a typeclass method-sugar call (`p.clone()`) will have after its
 * rewrite, for a call the checker typed as an error: when exactly one
 * activated typeclass declaring `method` has an instance (or a `@derive`
 * companion) for the receiver's type, and that method's declared return type
 * is the typeclass's own type parameter (`clone(a: A): A`), the result is the
 * receiver's type. Anything else (other return types, ambiguity, a static
 * companion receiver) is not inferred.
 *
 * Quiet by design: it reports nothing, because the call it inspects is itself
 * rewritten (and diagnosed) on its own visit. Only original nodes reach the
 * checker (via {@link inferSugaredExpressionType}).
 */
export function inferMethodSugarCallType(
  ctx: MacroContextImpl,
  resolveExtensionFromImports: ResolveExtensionFn,
  call: ts.CallExpression,
  depth: number
): ts.Type | undefined {
  if (isSyntheticNode(call) || !ts.isPropertyAccessExpression(call.expression)) return undefined;
  const methodName = call.expression.name.text;
  const receiver = call.expression.expression;
  const receiverType = inferSugaredExpressionType(
    ctx,
    resolveExtensionFromImports,
    receiver,
    depth + 1
  );
  if (!receiverType || !ctx.isTypeReliable(receiverType)) return undefined;
  if (receiverType.getProperty(methodName)) return undefined;

  const sfn = ctx.sourceFile.fileName;
  const activatedMethods = globalResolutionScope.getActivatedMethodSyntax(sfn);
  const definedTcs = globalResolutionScope.getDefinedTypeclasses(sfn);
  const activated =
    definedTcs.size === 0 ? activatedMethods : new Set([...activatedMethods, ...definedTcs]);
  if (activated.size === 0) return undefined;

  let found: string | undefined;
  // A literal receiver is retried with its base type, as in
  // tryResolveTypeclassMethod.
  const widened = widenLiteralType(ctx.typeChecker, receiverType);
  for (const { typeclass } of getMethodCandidates(ctx.program, activated, methodName)) {
    let has = false;
    try {
      const r = resolveInstance(ctx, typeclass, receiverType);
      has = r?.kind === "resolved";
      if (!has && widened !== receiverType) {
        has = resolveInstance(ctx, typeclass, widened)?.kind === "resolved";
      }
    } catch {
      // Quiet: the call's own rewrite reports a resolution failure.
      has = false;
    }
    if (!has) has = typeDerivesTypeclass(ctx, receiverType, typeclass);
    if (!has) continue;
    if (found) return undefined; // ambiguous: reported by the call's own rewrite
    found = typeclass;
  }
  if (!found) return undefined;

  const def = getOpMapForTypeclass(ctx.program, found)?.def;
  const method = def?.methods.find((m) => m.name === methodName);
  if (!def || !method || method.returnType !== def.typeParam) return undefined;
  const typeName = stripTypeArguments(ctx.typeChecker.typeToString(receiverType));
  if (BUILTIN_METHOD_RECEIVER_NAMES.has(typeName)) return undefined;
  return receiverType;
}

/**
 * The base type of a literal type (`7` -> `number`, `"s"` -> `string`,
 * `true` -> `boolean`, an enum member -> its enum), or of a union of literals;
 * any other type is returned unchanged. Decided by the checker
 * (`getBaseTypeOfLiteralType`, keyed on type flags), not by printed text.
 */
function widenLiteralType(checker: ts.TypeChecker, t: ts.Type): ts.Type {
  const isLiteral = (m: ts.Type) => (m.flags & ts.TypeFlags.Literal) !== 0;
  if (!(t.isUnion() ? t.types.every(isLiteral) : isLiteral(t))) return t;
  return checker.getBaseTypeOfLiteralType(t);
}

/**
 * If `receiver` names a type's VALUE side -- a class constructor, or the
 * companion namespace merged with an interface/type alias -- return that
 * symbol: a call on it is a static companion call (`User.fromJson(json)`).
 */
function staticCompanionReceiver(
  ctx: MacroContextImpl,
  receiver: ts.Expression
): ts.Symbol | undefined {
  if (!ts.isIdentifier(receiver) && !ts.isPropertyAccessExpression(receiver)) return undefined;
  if (isSyntheticNode(receiver)) return undefined;
  let sym: ts.Symbol | undefined;
  try {
    sym = ctx.typeChecker.getSymbolAtLocation(receiver);
    if (sym && sym.flags & ts.SymbolFlags.Alias) sym = ctx.typeChecker.getAliasedSymbol(sym);
  } catch (error) {
    ctx.reportWarning(
      receiver,
      `typesugar could not check whether '${receiver.getText()}' is a class (${error}); treating the call as an instance method call.`
    );
    return undefined;
  }
  if (!sym) return undefined;
  if (sym.flags & ts.SymbolFlags.Class) return sym;
  if (
    sym.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias) &&
    sym.flags & ts.SymbolFlags.ValueModule
  ) {
    return sym;
  }
  return undefined;
}

/**
 * Resolve an instance of `typeclass` for `receiverType`, as either a scope-based
 * `@impl`/`@instance` value or a `@derive(TC)` companion. The companion form is
 * emitted by convention as `<TypeName>.<TC>` (e.g. `Point.Eq`).
 */
function resolveMethodSugarInstance(
  ctx: MacroContextImpl,
  receiverType: ts.Type,
  typeName: string,
  baseTypeName: string,
  typeclass: string
): MethodSugarInstance | undefined {
  // Normalize the receiver's name for the builtin-receiver guard: the array
  // shorthand stringifies as `number[]` / `readonly number[]`, which would slip
  // past BUILTIN_METHOD_RECEIVER_NAMES -- collapse it to "Array".
  const guardName = /\[\]$/.test(typeName) ? "Array" : baseTypeName;

  // 1. Scope-based @impl/@instance resolution.
  try {
    const r = resolveInstance(ctx, typeclass, receiverType);
    if (r && r.kind === "resolved") {
      return {
        instanceName: r.exportName,
        sourceModule: r.source !== "local-scope" ? r.importSpecifier : undefined,
        forType: guardName,
      };
    }
    if (r && r.kind === "ambiguous") {
      // Two distinct in-scope instances for the same typeclass/type -- surface it
      // rather than silently falling through to a companion or no-op.
      ctx.reportError(
        ctx.sourceFile,
        `Ambiguous ${typeclass} instance for '${typeName}': ` +
          `${r.candidates.map((c) => c.exportName).join(", ")}. ` +
          `Import exactly one to disambiguate.`
      );
      return undefined;
    }
  } catch (error) {
    // Fall through to companion detection, but leave a visible trace.
    ctx.reportWarning(
      ctx.sourceFile,
      `typesugar could not resolve a ${typeclass} instance for '${typeName}' (${error}); ` +
        `only a @derive(${typeclass}) companion will be considered for method sugar.`
    );
  }

  // 2. Derived companion: the receiver's type is declared with `@derive(TC)`.
  if (typeDerivesTypeclass(ctx, receiverType, typeclass)) {
    const declFile = declaringFileOf(receiverType);
    return {
      companionPath: companionPath(typeclass, baseTypeName),
      sourceModule: moduleSpecifierForType(ctx, receiverType),
      forType: guardName,
      declaringFile:
        declFile && declFile.fileName !== ctx.sourceFile.fileName ? declFile.fileName : undefined,
    };
  }

  return undefined;
}

/**
 * Does the receiver's type declaration carry a `@derive(TC)` / `@deriving(TC)`
 * (decorator or JSDoc tag) -- meaning a `<Type>.<TC>` companion will exist?
 */
function typeDerivesTypeclass(
  ctx: MacroContextImpl,
  receiverType: ts.Type,
  typeclass: string
): boolean {
  const sym = receiverType.getSymbol() ?? receiverType.aliasSymbol;
  const decls = sym?.getDeclarations();
  if (!decls) return false;
  for (const decl of decls) {
    // Decorator form: `@derive(Eq) class P {}`
    if (ts.canHaveDecorators(decl)) {
      for (const dec of ts.getDecorators(decl) ?? []) {
        if (deriveDecoratorNames(ctx, dec.expression, typeclass)) return true;
      }
    }
    // JSDoc form: `/** @derive(Eq) */`
    for (const tag of ts.getJSDocTags(decl)) {
      const name = tag.tagName.text;
      if (name !== "derive" && name !== "deriving") continue;
      const comment =
        typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);
      if (comment && new RegExp(`\\b${typeclass}\\b`).test(comment)) return true;
    }
  }
  return false;
}

/** Does a decorator expression `derive(Eq, ...)` name the given typeclass? */
function deriveDecoratorNames(
  ctx: MacroContextImpl,
  expr: ts.Expression,
  typeclass: string
): boolean {
  if (!ts.isCallExpression(expr)) return false;
  const callee = expr.expression;
  if (!ts.isIdentifier(callee)) return false;
  // Match the local text, but also resolve through an alias import
  // (`import { derive as d }`) to the original `derive`/`deriving` export.
  let calleeName: string | undefined = callee.text;
  if (calleeName !== "derive" && calleeName !== "deriving") {
    if (isSyntheticNode(callee)) return false;
    let sym = ctx.typeChecker.getSymbolAtLocation(callee);
    if (sym && sym.flags & ts.SymbolFlags.Alias) {
      try {
        sym = ctx.typeChecker.getAliasedSymbol(sym);
      } catch (error) {
        ctx.reportWarning(
          expr,
          `typesugar could not resolve the import alias '${callee.text}' (${error}); ` +
            `not treating it as @derive.`
        );
        return false;
      }
    }
    calleeName = sym?.getName();
  }
  if (calleeName !== "derive" && calleeName !== "deriving") return false;
  return expr.arguments.some((a) => ts.isIdentifier(a) && a.text === typeclass);
}

/**
 * The module specifier to import the companion's base type from for a derived
 * companion `<Type>.<TC>`. Returns `undefined` when the type is declared in the
 * current file (no import needed). Otherwise finds an existing import in this
 * file that resolves to the type's declaration module and reuses its specifier --
 * so the companion namespace value (e.g. `Point`) is imported even when only an
 * unrelated binding from that module (or `import type`) was present.
 *
 * Safe to scan `ctx.sourceFile.statements` directly here (unlike a resolution
 * mechanism that must consult same-pass synthesized state): this only reads
 * pre-existing user `import` declarations, which are never synthesized mid-pass.
 */
function moduleSpecifierForType(ctx: MacroContextImpl, receiverType: ts.Type): string | undefined {
  const declFile = declaringFileOf(receiverType);
  if (!declFile || declFile.fileName === ctx.sourceFile.fileName) return undefined;

  const checker = ctx.typeChecker;
  for (const stmt of ctx.sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const modSym = checker.getSymbolAtLocation(stmt.moduleSpecifier);
    const modFile = modSym?.declarations?.find((d): d is ts.SourceFile => ts.isSourceFile(d));
    if (modFile?.fileName === declFile.fileName) {
      return stmt.moduleSpecifier.text;
    }
  }
  return undefined;
}

/** The source file declaring the receiver type's symbol, if any. */
function declaringFileOf(receiverType: ts.Type): ts.SourceFile | undefined {
  const sym = receiverType.getSymbol() ?? receiverType.aliasSymbol;
  return sym?.getDeclarations()?.[0]?.getSourceFile();
}

/**
 * Does the current file itself bind `name` at `location` -- through an import
 * or a local declaration, not a lib/ambient global -- and (when
 * `expectedFile` is given) does that binding resolve to a declaration in
 * `expectedFile`?
 */
function fileBindsName(
  ctx: MacroContextImpl,
  location: ts.Node,
  name: string,
  expectedFile: string | undefined
): boolean {
  const checker = ctx.typeChecker;
  try {
    const at = isSyntheticNode(location) ? ctx.sourceFile : location;
    const sym = checker
      .getSymbolsInScope(at, ts.SymbolFlags.Value | ts.SymbolFlags.Alias)
      .find((s) => s.getName() === name);
    if (!sym) return false;
    const boundHere = (sym.getDeclarations() ?? []).some(
      (d) => d.getSourceFile().fileName === ctx.sourceFile.fileName
    );
    if (!boundHere) return false;
    if (!expectedFile) return true;
    const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    return (target.getDeclarations() ?? []).some(
      (d) => d.getSourceFile().fileName === expectedFile
    );
  } catch (error) {
    ctx.reportWarning(
      location,
      `typesugar could not check which '${name}' is in scope (${error}); skipping method sugar.`
    );
    return false;
  }
}
