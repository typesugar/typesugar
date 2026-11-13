/**
 * Which imports of a file provide `receiver.method()` as an extension: the
 * ONE decision shared by the transformer's rewrite (transformer-core
 * `scanImportsForExtension`, which adds the ambiguity report) and the
 * ExtensionMethodCall diagnostic suppression rule, which hides the
 * pre-transform TS2339 exactly when the rewrite happens. The rule used to
 * keep its own copy of the provider rules without the checks below, and
 * suppressed errors on calls the transformer then left as written (a
 * TypeError at run time).
 *
 * An import is a provider when its first parameter accepts the receiver
 * (`receiverMatchesFirstParam`) and it is one of (PEP-064):
 * - a function named after the method (`import { clamp }` for
 *   `(42).clamp(0, 100)`): its name says it is meant for that call;
 * - a member of an object or namespace imported by a declaration that opts
 *   in: `import * as X`, or an import carrying a line-start JSDoc
 *   `@extension` tag ({@link hasExtensionImportTag}), which covers every
 *   binding of that declaration. An ordinary method is
 *   never an extension (Scala 3): a member taking `unknown`, `any` or an
 *   unconstrained `T` accepts every receiver, so without this an imported
 *   `log.info(msg: unknown)` turned `user.info()` -- a TS2339 mistake -- into
 *   `log.info(user)`, and the shared suppression rule hid the error;
 * - a member of an imported value declared as a typeclass instance by an
 *   `@impl`/`@instance` JSDoc tag or a `@derive` companion (an instance is
 *   meant to supply its methods), for receivers of its own type
 *   ({@link instancesServeReceiver}). Not `impl(...)` or `derived<TC<T>>()`
 *   untagged: a published `.d.ts` shows them as a plain `TC<T>` annotation,
 *   so they would supply methods from source and not from `dist/`.
 *
 * A match is used only at a call where its name is still the import binding
 * ({@link isImportExtensionInScopeAt}, applied per call by each consumer).
 *
 * In every case, never:
 * - a type-only binding (`import type`, `{ type X }`): it is erased from the
 *   emit;
 * - a member every value has from the standard library (`bind`, `call`);
 * - a `declare global` stub seen through the value's apparent type;
 * - a member provider when the receiver has a native method of that name.
 *
 * Declaration-side markers (`"use extension"`, `@extension` on a function)
 * do not qualify an object: they don't survive into a published `.d.ts`,
 * so they would make a package's objects providers in its own repo and not
 * for its users. The import site is the one place that says so.
 *
 * Reads declarations as written (pass-start source and `.d.ts`): an import
 * and what it provides exist before any pass starts, so no same-pass state
 * is involved (CLAUDE.md "Resolving things a macro just generated").
 */

import * as ts from "typescript";
import {
  isJSDocTagAtLineStart,
  isSyntheticNode,
  receiverMatchesFirstParam,
  type StandaloneExtensionInfo,
} from "@typesugar/core";
import { instanceScanner, type ScannedInstance } from "./instance-scanner.js";
import { isHktTypeclass, isTypeclassDeclared } from "./typeclass-index.js";

/** What the decision needs from its caller. */
export interface ExtensionImportEnv {
  checker: ts.TypeChecker;
  /**
   * The program (typeclass index). The transformer always has it. Without
   * one, a `TC<T>`-annotated value of an opted-in import counts as an
   * instance (it then serves only its own type), and no typeclass is HKT.
   */
  program: ts.Program | undefined;
  /** The file whose imports are read. */
  sourceFile: ts.SourceFile;
  /** A degraded checker failure, made visible (CLAUDE.md). */
  warn(node: ts.Node, message: string): void;
}

export interface ImportedExtensionMatch {
  ext: StandaloneExtensionInfo;
  importSource: string;
  ident: ts.Identifier;
  /** The declaration called (aliases resolved), for de-duplication. */
  target: ts.Symbol | undefined;
}

/**
 * Every import of `env.sourceFile` that provides `methodName` for
 * `receiverType`, in import order (see the module comment for the rules).
 */
export function findImportedExtensionMatches(
  env: ExtensionImportEnv,
  methodName: string,
  receiverType: ts.Type
): ImportedExtensionMatch[] {
  const { checker, sourceFile } = env;
  const matches: ImportedExtensionMatch[] = [];
  if (!sourceFile?.statements) return matches;

  // A receiver's OWN method (e.g. Array.prototype.map) must never be
  // redirected to a same-named member of some imported object: an imported
  // typeclass instance like `parCombinePromise` has a `map(fa, f)` whose first
  // parameter accepts an array, and `arr.map(f)` was being rewritten to
  // `parCombinePromise.map(arr, f)`. Only a bare imported function named
  // after the method (the explicit-override form) may shadow a native method.
  // A `declare global` extension stub (std's `interface Number { clamp }`)
  // is not a native method: it exists only so the call type-checks.
  // The check uses the receiver with `null | undefined` removed: for
  // `host.directoryExists?.bind(host)` the receiver is `F | undefined`, and a
  // union only has the properties of ALL its members, so `bind` was "not
  // native" and the call was offered to every import's `.bind`.
  let hasNativeMethod = false;
  try {
    const own = checker.getPropertyOfType(
      checker.getApparentType(checker.getNonNullableType(receiverType)),
      methodName
    );
    hasNativeMethod = own !== undefined && !isGlobalAugmentationStub(own);
  } catch {
    // getApparentType can throw on an unusual receiver; the type's own
    // property table is the same question without it (no degradation).
    const own = receiverType.getProperty(methodName);
    hasNativeMethod = own !== undefined && !isGlobalAugmentationStub(own);
  }

  const consider = (ident: ts.Identifier, importSource: string, optedIn: boolean) => {
    let ext: StandaloneExtensionInfo | undefined;
    let target: ts.Symbol | undefined;
    try {
      ext = checkImportedSymbolForExtension(checker, ident, methodName, receiverType, env.program);
      if (!ext) return;
      if (ext.qualifier !== undefined) {
        if (hasNativeMethod) return;
        const instances = importedInstances(env, ident);
        // Not opted in: only an instance declared in a form that reads the
        // same from source and from a published `.d.ts` supplies its members:
        // an `@impl`/`@instance` JSDoc tag, or a `@derive` companion.
        // `impl(...)` and `derived<TC<T>>()` are erased to a `TC<T>`
        // annotation in the `.d.ts`, and an annotation alone doesn't open the
        // gate: whether `TC` is a typeclass is read by name
        // (isTypeclassDeclared), and without a program not at all.
        if (!optedIn && !instances?.some(isDeclarationVisibleInstance)) return;
        if (instances && !instancesServeReceiver(env, instances, receiverType)) return;
      }
      target = extensionTarget(checker, ident, ext);
    } catch (error) {
      env.warn(
        ident,
        `typesugar could not check whether the import '${ident.text}' provides '.${methodName}()' ` +
          `(${error}); it is not used as an extension provider.`
      );
      return;
    }
    matches.push({ ext, importSource, ident, target });
  };

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const clause = stmt.importClause;
    if (!clause) continue;
    const importSource = ts.isStringLiteral(stmt.moduleSpecifier)
      ? stmt.moduleSpecifier.text
      : "unknown";
    // A type-only binding is erased from the emit, so a call through it
    // would throw at run time: never a provider, tag or not.
    if (clause.isTypeOnly) continue;
    const tagged = hasExtensionImportTag(stmt);
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const spec of clause.namedBindings.elements) {
        if (!spec.isTypeOnly) consider(spec.name, importSource, tagged);
      }
    }
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      // `import * as X` is itself the opt-in.
      consider(clause.namedBindings.name, importSource, true);
    }
    if (clause.name) consider(clause.name, importSource, tagged);
  }
  return matches;
}

/**
 * The match the rewrite uses among `matches` (all the providers of one call,
 * in import order): the only one; the first when they share a qualifier; the
 * bare function when every match is the same export reached two ways
 * (`import { head }` and `import * as std`). Otherwise the call is ambiguous:
 * the rewrite reports an error and uses the first. The one rule for this,
 * shared by the rewrite (`scanImportsForExtension`) and
 * {@link extensionImportUses}.
 */
export function chooseExtensionMatch(matches: readonly ImportedExtensionMatch[]): {
  match: ImportedExtensionMatch | undefined;
  ambiguous: boolean;
} {
  if (matches.length <= 1) return { match: matches[0], ambiguous: false };
  if (new Set(matches.map((m) => m.ext.qualifier ?? "")).size === 1) {
    return { match: matches[0], ambiguous: false };
  }
  const first = matches[0].target;
  if (first && matches.every((m) => m.target === first)) {
    return {
      match: matches.find((m) => m.ext.qualifier === undefined) ?? matches[0],
      ambiguous: false,
    };
  }
  return { match: matches[0], ambiguous: true };
}

/** Which import bindings of a file serve extension calls in it ({@link extensionImportUses}). */
export interface ExtensionImportUses {
  /** Bindings whose MEMBER some call resolves to (`log` for `user.info()` → `log.info(user)`). */
  asMember: ReadonlySet<ts.Identifier>;
  /** Bindings called as a function named after the method (`clamp` for `n.clamp()`). */
  asFunction: ReadonlySet<ts.Identifier>;
}

/**
 * The import bindings of `env.sourceFile` that serve at least one
 * `recv.method()` call in it, for the ExtensionImport suppression rule
 * (TypeScript doesn't count an extension call as a use of its import).
 *
 * Each call is decided by {@link findImportedExtensionMatches} and
 * {@link chooseExtensionMatch}, as the rewrite decides it; only calls whose
 * method name an import could provide (a binding's own name, or a property
 * of its value) are asked. A receiver the checker can't type because it is
 * itself an extension call (`(1).to(5).reversed().toArray()`) gets the
 * provider's return type, as the rewrite recovers it; a receiver still
 * `any` or `never` is skipped, as the rewrite skips it. Calls in a scope opted
 * out of extensions (`isOptedOut`) are skipped: the rewrite leaves them.
 * Not modelled: a same-file `@extension` function the rewrite prefers over
 * an import (the live registry is the transformer's), so an import that
 * loses to one still counts as used.
 *
 * Reads the file as written (pass-start source): the calls and imports exist
 * before any pass starts (CLAUDE.md "Resolving things a macro just
 * generated"). A checker failure on one call is warned and that call skipped.
 */
export function extensionImportUses(
  env: ExtensionImportEnv,
  isOptedOut: (call: ts.CallExpression) => boolean = () => false
): ExtensionImportUses {
  const { checker, sourceFile } = env;
  const asMember = new Set<ts.Identifier>();
  const asFunction = new Set<ts.Identifier>();
  const candidates = new Set<string>();
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    for (const ident of importClauseBindings(stmt.importClause)) {
      candidates.add(ident.text);
      try {
        const sym = checker.getSymbolAtLocation(ident);
        if (!sym) continue;
        for (const prop of checker.getTypeOfSymbolAtLocation(sym, ident).getProperties()) {
          candidates.add(prop.name);
        }
      } catch (error) {
        env.warn(
          ident,
          `typesugar could not read the members of the import '${ident.text}' (${error}); ` +
            `extension calls through them are not counted as uses of it.`
        );
      }
    }
  }
  if (candidates.size === 0) return { asMember, asFunction };

  // Memoized per receiver type and method (as the transformer's
  // importExtensionCache), and per callee: a chain's links are decided once.
  const matchCache = new Map<ts.Type, Map<string, ImportedExtensionMatch[]>>();
  const matchesFor = (methodName: string, receiverType: ts.Type) => {
    let byMethod = matchCache.get(receiverType);
    if (!byMethod) matchCache.set(receiverType, (byMethod = new Map()));
    let found = byMethod.get(methodName);
    if (!found)
      byMethod.set(
        methodName,
        (found = findImportedExtensionMatches(env, methodName, receiverType))
      );
    return found;
  };
  const unreliable = ts.TypeFlags.Any | ts.TypeFlags.Never;
  const decided = new Map<ts.PropertyAccessExpression, ImportedExtensionMatch[]>();
  /**
   * The rewrite's candidates for `callee(...)` (the ambiguous ones, or its
   * one choice), with its receiver's type recovered for a chain. A receiver
   * still `any`/`never` after that is skipped, as the rewrite skips it
   * (`isTypeReliable`): `any` accepts every first parameter.
   */
  const decide = (callee: ts.PropertyAccessExpression, depth: number): ImportedExtensionMatch[] => {
    const cached = decided.get(callee);
    if (cached) return cached;
    const receiverType = receiverTypeOf(callee.expression, depth);
    let used: ImportedExtensionMatch[] = [];
    if (!(receiverType.flags & unreliable)) {
      const matches = matchesFor(callee.name.text, receiverType);
      const { match, ambiguous } = chooseExtensionMatch(matches);
      // Ambiguous: an error is reported on the call; every candidate
      // counts, so the unused report doesn't pile on. A provider shadowed
      // by a local at the call is not used (the rewrite skips it).
      used = (ambiguous ? matches : match ? [match] : []).filter((m) =>
        isImportExtensionInScopeAt(checker, callee, m.ext)
      );
    }
    decided.set(callee, used);
    return used;
  };
  /**
   * The type of a receiver as the rewrite recovers it
   * (transformer-core `inferSugaredExpressionType`): an extension call's
   * provider return type, through parentheses and through an un-annotated
   * variable of this file it initialises (`const r = (1).to(5); r.rev()`).
   * Typeclass method sugar on the way is not modelled (the receiver stays
   * unreliable, and the call is skipped).
   */
  const receiverTypeOf = (expr: ts.Expression, depth: number): ts.Type => {
    const type = checker.getTypeAtLocation(expr);
    if (!(type.flags & unreliable) || depth >= 32) return type;
    if (ts.isParenthesizedExpression(expr)) return receiverTypeOf(expr.expression, depth + 1);
    if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
      // The rewrite's choice is the first (also when ambiguous).
      return returnTypeOf(decide(expr.expression, depth + 1)[0]) ?? type;
    }
    if (ts.isIdentifier(expr)) {
      const decl = checker.getSymbolAtLocation(expr)?.valueDeclaration;
      if (
        decl &&
        ts.isVariableDeclaration(decl) &&
        !decl.type &&
        decl.initializer &&
        ts.isIdentifier(decl.name) &&
        decl.getSourceFile() === sourceFile
      ) {
        return receiverTypeOf(decl.initializer, depth + 1);
      }
    }
    return type;
  };
  const returnTypeOf = (m: ImportedExtensionMatch | undefined): ts.Type | undefined => {
    if (!m) return undefined;
    const sym = checker.getSymbolAtLocation(m.ident);
    if (!sym) return undefined;
    let fnType = checker.getTypeOfSymbolAtLocation(sym, m.ident);
    if (m.ext.qualifier !== undefined) {
      const prop = fnType.getProperty(m.ext.methodName);
      if (!prop) return undefined;
      fnType = checker.getTypeOfSymbolAtLocation(prop, m.ident);
    }
    const sigs = fnType.getCallSignatures();
    return sigs.length === 1 ? sigs[0].getReturnType() : undefined;
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      candidates.has(node.expression.name.text) &&
      !isOptedOut(node)
    ) {
      const callee = node.expression;
      try {
        for (const m of decide(callee, 0))
          (m.ext.qualifier === undefined ? asFunction : asMember).add(m.ident);
      } catch (error) {
        env.warn(
          callee,
          `typesugar could not check whether '.${callee.name.text}()' is an extension call ` +
            `(${error}); it is not counted as a use of any import.`
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { asMember, asFunction };
}

/** Every name an import clause binds (default, namespace and named). */
export function importClauseBindings(clause: ts.ImportClause): ts.Identifier[] {
  const out: ts.Identifier[] = [];
  if (clause.name) out.push(clause.name);
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) out.push(bindings.name);
  if (bindings && ts.isNamedImports(bindings))
    for (const el of bindings.elements) out.push(el.name);
  return out;
}

/**
 * The `@extension` tags on `sourceFile`'s imports that did nothing in this
 * transform: no named or default binding of the tagged declaration was the
 * qualifier of an extension call the rewrite emitted (`usedQualifiers`,
 * recorded by the transformer as it rewrites: live same-pass state, read
 * after the whole file has been visited). The qualifiers are names, which
 * identify the binding: the rewrite records only calls through an import,
 * and uses one only where its name at the call is that import binding
 * ({@link isImportExtensionInScopeAt}). A function named after the method,
 * or an `import * as X` namespace, needs no tag, so their use doesn't count.
 * Reported as a warning, like an inactive `@derive` (audit F23): a tag that
 * silently does nothing is worse than one that says so.
 */
export function inactiveExtensionImportTags(
  sourceFile: ts.SourceFile,
  usedQualifiers: ReadonlySet<string>
): ts.JSDocTag[] {
  const out: ts.JSDocTag[] = [];
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    const tag = extensionImportTag(stmt);
    if (!tag) continue;
    // Named and default bindings: a namespace import needs no tag.
    const named = importClauseBindings(stmt.importClause).filter(
      (b) => !ts.isNamespaceImport(b.parent)
    );
    if (!named.some((b) => usedQualifiers.has(b.text))) out.push(tag);
  }
  return out;
}

/**
 * Does the import extension `ext` (a {@link findImportedExtensionMatches}
 * result) still name the import at `location`? The rewrite emits
 * `log.info(user)` / `shout(s)` at the call site, so a local that shadows
 * the import there (`function f() { const log = {...}; user.info(); }`)
 * would be called instead. The name in scope at `location` must be declared
 * by an import (the binding itself; an import has no other declarations of
 * that name in a module). A synthetic `location` is outside the checker's
 * contract (CLAUDE.md) and answers true: it has no scope of its own and the
 * file's top level has the import. Shared by the rewrite, the
 * ExtensionMethodCall rule and {@link extensionImportUses}. Checker failures
 * propagate to the caller.
 */
export function isImportExtensionInScopeAt(
  checker: ts.TypeChecker,
  location: ts.Node,
  ext: StandaloneExtensionInfo
): boolean {
  if (isSyntheticNode(location)) return true;
  const rootName = ext.qualifier ?? ext.methodName;
  const sym = checker
    .getSymbolsInScope(location, ts.SymbolFlags.Value | ts.SymbolFlags.Alias)
    .find((s) => s.getName() === rootName);
  return (
    sym?.declarations?.some(
      (d) => ts.isImportSpecifier(d) || ts.isImportClause(d) || ts.isNamespaceImport(d)
    ) ?? false
  );
}

/**
 * Can a call at `location` use the standalone-registry entry `ext`
 * (`@extension` functions and namespaces, `registerExtension(s)`)? Its callee,
 * the qualifier or the bare function name, must be a value in scope there
 * that has the member or is callable: the rewrite emits `Q.m(recv)` or
 * `m(recv)` and injects no import. A QUALIFIED entry whose qualifier is an
 * import binding does not count: an imported object supplies members only
 * through {@link findImportedExtensionMatches} (PEP-064), so an
 * `@extension namespace NumOps` registered by another file doesn't make an
 * untagged `import { NumOps }` a provider. Shared by the rewrite and the
 * ExtensionMethodCall suppression rule, so they agree. Checker failures
 * propagate to the caller, which warns.
 */
export function isRegistryExtensionCalleeBound(
  checker: ts.TypeChecker,
  location: ts.Node,
  ext: StandaloneExtensionInfo
): boolean {
  const rootName = ext.qualifier ?? ext.methodName;
  const sym = checker
    .getSymbolsInScope(location, ts.SymbolFlags.Value)
    .find((s) => s.getName() === rootName);
  if (!sym) return false;
  const isAlias = (sym.flags & ts.SymbolFlags.Alias) !== 0;
  if (ext.qualifier !== undefined && isAlias) return false;
  const target = isAlias ? checker.getAliasedSymbol(sym) : sym;
  const type = checker.getTypeOfSymbolAtLocation(target, location);
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Never)) return true;
  return ext.qualifier !== undefined
    ? type.getProperty(ext.methodName) !== undefined
    : type.getCallSignatures().length > 0;
}

/**
 * Does `decl` carry the import-site opt-in, a JSDoc `@extension` tag at a
 * real tag position (PEP-064)?
 *
 * ```ts
 * /** @extension *\/
 * import { log } from "./logger";
 * user.info(); // → log.info(user)
 * ```
 *
 * Reads the import declaration as written: nothing a pass generates adds or
 * removes one (CLAUDE.md "Resolving things a macro just generated").
 */
export function hasExtensionImportTag(decl: ts.ImportDeclaration): boolean {
  return extensionImportTag(decl) !== undefined;
}

/** The import-site `@extension` tag of `decl`, if it has one ({@link hasExtensionImportTag}). */
function extensionImportTag(decl: ts.ImportDeclaration): ts.JSDocTag | undefined {
  return ts
    .getJSDocTags(decl)
    .find((tag) => tag.tagName.text === "extension" && isJSDocTagAtLineStart(tag));
}

/**
 * Check if an imported identifier provides an extension method: a function
 * named `methodName`, or a member of that name (not a default-lib member or
 * a `declare global` stub), whose first parameter accepts the receiver.
 */
export function checkImportedSymbolForExtension(
  typeChecker: ts.TypeChecker,
  ident: ts.Identifier,
  methodName: string,
  receiverType: ts.Type,
  program?: ts.Program
): StandaloneExtensionInfo | undefined {
  const symbol = typeChecker.getSymbolAtLocation(ident);
  if (!symbol) return undefined;

  const identType = typeChecker.getTypeOfSymbolAtLocation(symbol, ident);

  if (ident.text === methodName) {
    for (const sig of identType.getCallSignatures()) {
      if (receiverMatchesFirstParam(typeChecker, receiverType, sig, ident)) {
        return { methodName, forType: "", qualifier: undefined };
      }
    }
  }

  const prop = identType.getProperty(methodName);
  if (!prop) return undefined;
  // A member every value has from the standard library (`Function.prototype.
  // bind/call/apply`, `Object.prototype.toString`, ...) is not an extension
  // provided by the import: `describe.bind` / `head.bind` must never become
  // candidates for `fn.bind(x)`.
  if (isDefaultLibMember(prop, program)) return undefined;
  // Nor is a `declare global` stub seen through the value's apparent type:
  // std's `LT` (a number) has `clamp` only because std augments
  // `interface Number { clamp(...) }` so that `(150).clamp(0, 100)`
  // type-checks, and `LT.clamp` made that call ambiguous with the real
  // `clamp` import.
  if (isGlobalAugmentationStub(prop)) return undefined;

  const propType = typeChecker.getTypeOfSymbolAtLocation(prop, ident);
  for (const sig of propType.getCallSignatures()) {
    if (receiverMatchesFirstParam(typeChecker, receiverType, sig, ident)) {
      return { methodName, forType: "", qualifier: ident.text };
    }
  }

  return undefined;
}

/** Check if a declaration has the @extension decorator. */
export function hasExtensionDecorator(node: ts.Node): boolean {
  if (!ts.canHaveDecorators(node)) return false;
  const decorators = ts.getDecorators(node);
  if (!decorators) return false;
  for (const decorator of decorators) {
    const expr = decorator.expression;
    if (ts.isIdentifier(expr) && expr.text === "extension") return true;
    if (
      ts.isCallExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      expr.expression.text === "extension"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Is every declaration of `prop` in a default lib file (`lib.*.d.ts`)? Asked
 * of the program when there is one: a lib file's `/// <reference
 * no-default-lib="true"/>` (`hasNoDefaultLib`) is not something every
 * TypeScript version's lib files carry.
 */
export function isDefaultLibMember(prop: ts.Symbol, program?: ts.Program): boolean {
  const decls = prop.getDeclarations();
  if (!decls || decls.length === 0) return false;
  return decls.every((d) => {
    const sf = d.getSourceFile();
    return program?.isSourceFileDefaultLibrary(sf) || sf.hasNoDefaultLib;
  });
}

/**
 * Is every declaration of `prop` inside a `declare global { ... }` block?
 *
 * Libraries like @typesugar/std declare their extension methods on the
 * built-in interfaces (`interface Number { clamp(...) }`) purely so
 * `(42).clamp(0, 100)` type-checks; those stubs never exist at runtime, so
 * they must not count as the receiver's "own" method.
 */
export function isGlobalAugmentationStub(prop: ts.Symbol): boolean {
  const decls = prop.getDeclarations();
  if (!decls || decls.length === 0) return false;
  return decls.every((d) => {
    for (let n: ts.Node | undefined = d.parent; n; n = n.parent) {
      if (ts.isModuleDeclaration(n) && (n.flags & ts.NodeFlags.GlobalAugmentation) !== 0)
        return true;
    }
    return false;
  });
}

/** The declaration symbol an extension match calls (aliases resolved), for de-duplication. */
function extensionTarget(
  checker: ts.TypeChecker,
  ident: ts.Identifier,
  ext: StandaloneExtensionInfo
): ts.Symbol | undefined {
  const resolve = (s: ts.Symbol | undefined) =>
    s && s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;
  const sym = checker.getSymbolAtLocation(ident);
  if (!sym) return undefined;
  if (ext.qualifier === undefined) return resolve(sym);
  return resolve(checker.getTypeOfSymbolAtLocation(sym, ident).getProperty(ext.methodName));
}

/** An instance form that a published `.d.ts` keeps: an `@impl` tag or a `@derive` companion. */
function isDeclarationVisibleInstance(inst: ScannedInstance): boolean {
  return inst.detectedVia === "impl-tag" || inst.detectedVia === "derived";
}

/**
 * The typeclass instances the imported value `ident` is, as the instance
 * scanner reads them (empty: not an instance). Undefined when the check
 * failed, after a warning: the value is then not treated as an instance, so
 * an opted-in import stays an ordinary extension object, and an import that
 * is not opted in provides nothing.
 */
function importedInstances(
  env: ExtensionImportEnv,
  ident: ts.Identifier
): ScannedInstance[] | undefined {
  const checker = env.checker;
  try {
    let sym = checker.getSymbolAtLocation(ident);
    if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    const decl = sym?.valueDeclaration;
    if (!decl || !ts.isVariableDeclaration(decl)) return [];
    return instanceScanner
      .scanValueDeclaration(checker, decl, (node, error, what) =>
        env.warn(
          node.getSourceFile?.() === env.sourceFile ? node : ident,
          `typesugar skipped ${what} while checking the import '${ident.text}' as a typeclass ` +
            `instance: the type checker failed (${error}).`
        )
      )
      .filter(
        (inst) =>
          inst.detectedVia !== "type-annotation" ||
          !env.program ||
          isTypeclassDeclared(env.program, inst.typeclassName)
      );
  } catch (error) {
    env.warn(
      ident,
      `typesugar could not check whether the import '${ident.text}' is a typeclass instance (${error}); it is not treated as one.`
    );
    return undefined;
  }
}

/**
 * May an imported value that is the typeclass `instances` (as
 * {@link importedInstances} reads them; empty: not an instance) serve
 * `receiver.method()` as an object extension provider?
 *
 * An opted-in extension object (`EffectExt`) serves any receiver its
 * member's first parameter accepts, but a typeclass instance is FOR one
 * type, whether or not its import is opted in. With
 * `@impl Show<Color>` on a numeric enum, `number` is assignable to `Color`,
 * so `n.show()` on `n: number` became `showColor.show(n)`. An instance
 * serves only receivers of its own instance type, compared by identity
 * (CLAUDE.md "Deciding what a type is"): the same type, or the same symbol
 * after alias resolution with identical type arguments. A literal receiver
 * (`Color.Red`, `3`) is widened by the checker to its base type first.
 * A receiver NARROWED from a union instance type is served too: for
 * `@impl Describe<Shape>` with `type Shape = Circle | Square`, `t.describe()`
 * where `if (t.kind === "circle")` made `t` a `Circle` -- each member of the
 * receiver (one, or a union) is, by identity, a member of the instance's
 * union type. Assignability is not used, so enum and number never match each
 * other. A receiver that only matches the instance's type by shape is left
 * to the typeclass method-sugar path, which applies its own instance policy.
 *
 * What counts as an instance is read by the instance scanner, the same way
 * instance resolution reads it (an `@impl`/`@instance` tag, `impl(...)`,
 * `derived<TC<T>>()`, or a `TC<T>` annotation naming a declared typeclass);
 * any other value (empty `instances`) is not affected. An instance of a higher-kinded typeclass
 * (`@impl Functor<OptionF>`) is for a type constructor, not a type, so this
 * check does not apply to it and it keeps the plain first-parameter match.
 * An instance whose type the scanner could not resolve serves nothing here.
 */
function instancesServeReceiver(
  env: ExtensionImportEnv,
  instances: readonly ScannedInstance[],
  receiverType: ts.Type
): boolean {
  if (instances.length === 0) return true;
  const checker = env.checker;
  const receiver = widenLiteralType(checker, receiverType);
  return instances.some((inst) => {
    if (env.program && isHktTypeclass(env.program, inst.typeclassName)) return true;
    const forType = inst.forType;
    if (forType === undefined) return false;
    if (isSameTypeByIdentity(checker, receiver, forType, 0)) return true;
    // A narrowed union receiver: every member of it is a member of the
    // instance's union type, by identity.
    if (!forType.isUnion()) return false;
    const members = receiver.isUnion() ? receiver.types : [receiver];
    return members.every((m) => forType.types.some((u) => isSameTypeByIdentity(checker, m, u, 0)));
  });
}

/** A literal type (or a union of literals) widened to its base type by the checker. */
function widenLiteralType(checker: ts.TypeChecker, t: ts.Type): ts.Type {
  const isLiteral = (m: ts.Type) => (m.flags & ts.TypeFlags.Literal) !== 0;
  if (!(t.isUnion() ? t.types.every(isLiteral) : isLiteral(t))) return t;
  return checker.getBaseTypeOfLiteralType(t);
}

function isReferenceType(type: ts.Type): type is ts.TypeReference {
  return (
    (type.flags & ts.TypeFlags.Object) !== 0 &&
    ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) !== 0
  );
}

/**
 * Are `a` and `b` the same type by identity: the same type object, or the
 * same declaring symbol (aliases resolved) with pairwise identical type
 * arguments? Never assignability or printed names.
 */
function isSameTypeByIdentity(
  checker: ts.TypeChecker,
  a: ts.Type,
  b: ts.Type,
  depth: number
): boolean {
  if (a === b) return true;
  if (depth > 8) return false;
  const symbolOf = (t: ts.Type) => {
    const s = t.aliasSymbol ?? t.getSymbol();
    return s && s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;
  };
  const sa = symbolOf(a);
  if (!sa || sa !== symbolOf(b)) return false;
  const argsOf = (t: ts.Type): readonly ts.Type[] =>
    t.aliasSymbol
      ? (t.aliasTypeArguments ?? [])
      : isReferenceType(t)
        ? checker.getTypeArguments(t)
        : [];
  const aa = argsOf(a);
  const ba = argsOf(b);
  return (
    aa.length === ba.length &&
    aa.every((t, i) => isSameTypeByIdentity(checker, t, ba[i], depth + 1))
  );
}
