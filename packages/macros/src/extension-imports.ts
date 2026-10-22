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
 * An import is a provider when it is a function named after the method, or
 * an object/namespace with a callable member of that name, whose first
 * parameter accepts the receiver (`receiverMatchesFirstParam`), except:
 * - a named/default import binding a whole module namespace that has not
 *   opted in (`"use extension"`, `@extension`): an ordinary library value;
 * - a member every value has from the standard library (`bind`, `call`);
 * - a `declare global` stub seen through the value's apparent type;
 * - a member of a typeclass INSTANCE whose type is not the receiver's
 *   (by identity: {@link instanceServesReceiver});
 * - a member provider when the receiver has a native method of that name.
 *
 * Reads declarations as written (pass-start source and `.d.ts`): an import
 * and what it provides exist before any pass starts, so no same-pass state
 * is involved (CLAUDE.md "Resolving things a macro just generated").
 */

import * as ts from "typescript";
import {
  receiverMatchesFirstParam,
  scanImportsForScope,
  type ResolutionScopeTracker,
  type StandaloneExtensionInfo,
} from "@typesugar/core";
import { instanceScanner, type ScannedInstance } from "./instance-scanner.js";
import { isHktTypeclass, isTypeclassDeclared } from "./typeclass-index.js";

/** What the decision needs from its caller. */
export interface ExtensionImportEnv {
  checker: ts.TypeChecker;
  /**
   * The program (typeclass index). The transformer always has it; a
   * diagnostic filter called without one gets the stricter answer: a
   * `TC<T>`-annotated value counts as an instance, and no typeclass is HKT.
   */
  program: ts.Program | undefined;
  /** The file whose imports are read. */
  sourceFile: ts.SourceFile;
  /** `"use extension"` modules: the transformer's scope, or the rule's own scan. */
  scope: ResolutionScopeTracker;
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

  const consider = (ident: ts.Identifier, importSource: string, namespaceImport: boolean) => {
    if (!namespaceImport && isUnoptedModuleNamespaceBinding(env, ident)) return;
    let ext: StandaloneExtensionInfo | undefined;
    let target: ts.Symbol | undefined;
    try {
      ext = checkImportedSymbolForExtension(checker, ident, methodName, receiverType, env.program);
      if (!ext) return;
      if (hasNativeMethod && ext.qualifier !== undefined) return;
      if (ext.qualifier !== undefined && !instanceServesReceiver(env, ident, receiverType)) return;
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
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const spec of clause.namedBindings.elements) consider(spec.name, importSource, false);
    }
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      // `import * as X` is the explicit opt-in form: always a candidate.
      consider(clause.namedBindings.name, importSource, true);
    }
    if (clause.name) consider(clause.name, importSource, false);
  }
  return matches;
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

/**
 * Is `symbol` (an import's target) extension-enabled: declared with
 * `@extension`, or in a `"use extension"` module (scanned into `env.scope`
 * on demand)?
 */
export function isExtensionEnabledIn(env: ExtensionImportEnv, symbol: ts.Symbol): boolean {
  const declarations = symbol.getDeclarations();
  if (!declarations || declarations.length === 0) return false;
  for (const decl of declarations) {
    const sourceFile = decl.getSourceFile();
    const fileName = sourceFile.fileName;
    if (sourceFile.isDeclarationFile) {
      if (hasExtensionDecorator(decl)) return true;
      continue;
    }
    if (fileName !== env.sourceFile.fileName) {
      scanImportsForScope(sourceFile, env.scope, env.program);
    }
    if (env.scope.hasUseExtension(fileName)) return true;
    if (hasExtensionDecorator(decl)) return true;
  }
  return false;
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

/**
 * Is `ident` a NAMED (or default) import binding a whole MODULE namespace --
 * `import { Effect } from "effect"`, where the package does
 * `export * as Effect from "./Effect.js"` -- that has not opted in to being an
 * extension provider (a `"use extension"` module / `@extension`)?
 *
 * Such a namespace is an ordinary library value, not an extension object: its
 * `map(self, f)` matched every Effect receiver and made `eff.map(f)` ambiguous
 * with the `EffectExt` the user imported for exactly that (docs start #2).
 * `import * as X` stays an explicit provider (that is the opt-in form), and a
 * named import of a declared object/`namespace` (`EffectExt`) is unaffected.
 */
function isUnoptedModuleNamespaceBinding(env: ExtensionImportEnv, ident: ts.Identifier): boolean {
  const checker = env.checker;
  let target: ts.Symbol | undefined;
  try {
    target = checker.getSymbolAtLocation(ident);
    if (target && target.flags & ts.SymbolFlags.Alias) target = checker.getAliasedSymbol(target);
  } catch (error) {
    env.warn(
      ident,
      `typesugar could not resolve the import '${ident.text}' while looking for extension methods (${error}); ignoring it as an extension provider.`
    );
    return true;
  }
  const decls = target?.getDeclarations();
  if (!target || !decls || decls.length === 0) return false;
  const isModule = decls.every(
    (d) => ts.isSourceFile(d) || (ts.isModuleDeclaration(d) && ts.isStringLiteral(d.name))
  );
  if (!isModule) return false;
  return !isExtensionEnabledIn(env, target);
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

/**
 * May the imported value `ident` serve `receiver.method()` as an object
 * extension provider (`ident.method(receiver)`), as far as being a typeclass
 * instance goes?
 *
 * Any imported object whose member's first parameter accepts the receiver
 * is a provider, which is right for an extension object (`EffectExt`) but
 * not for a typeclass instance: an instance is FOR one type. With
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
 * any other value is not affected. An instance of a higher-kinded typeclass
 * (`@impl Functor<OptionF>`) is for a type constructor, not a type, so this
 * check does not apply to it and it keeps the plain first-parameter match.
 * An instance whose type the scanner could not resolve serves nothing here.
 */
export function instanceServesReceiver(
  env: ExtensionImportEnv,
  ident: ts.Identifier,
  receiverType: ts.Type
): boolean {
  const checker = env.checker;
  let instances: ScannedInstance[];
  try {
    let sym = checker.getSymbolAtLocation(ident);
    if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    const decl = sym?.valueDeclaration;
    if (!decl || !ts.isVariableDeclaration(decl)) return true;
    instances = instanceScanner
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
      `typesugar could not check whether the import '${ident.text}' is a typeclass instance (${error}); treating it as an ordinary extension object.`
    );
    return true;
  }
  if (instances.length === 0) return true;
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
