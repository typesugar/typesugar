/**
 * Instance Resolver — Scala 3-style typeclass instance resolution.
 *
 * Given a typeclass name and a target type, finds the best instance in scope
 * by searching local declarations, explicit imports, and imported module exports.
 * Matching is type-based (via TypeChecker.isTypeAssignableTo), not string-based.
 *
 * Resolution precedence (highest first):
 * 1. Local scope — @impl-annotated values in the current file (incl. non-exported)
 * 2. Explicit imports — values imported by name
 * 3. Module-level search — scanning all exports of imported modules
 * 4. The typeclass's own package ({@link resolveFromTypeclassHome}), for
 *    summon/implicit: a typeclass reached through a re-export finds its
 *    instances where it is declared
 *
 * Resolution is purely scope-based — there is no process-global registry
 * fallback (PEP-052): a file's behavior depends only on its own imports and the
 * instances visible in their modules.
 *
 * @packageDocumentation
 */

import * as ts from "typescript";
import type { MacroContext } from "@typesugar/core";
import { getOrCreateWeak, isSyntheticNode } from "@typesugar/core";
import { getDerivedCallCheck } from "./derived-call-check.js";
import {
  InstanceScanner,
  instanceScanner as defaultScanner,
  type ScannedInstance,
  type DoNotationMeta,
} from "./instance-scanner.js";

// ============================================================================
// Types
// ============================================================================

export type ResolutionSource = "local-scope" | "explicit-import" | "module-scan";

export interface ResolvedInstance {
  kind: "resolved";
  typeclassName: string;
  forType: ts.Type;
  forTypeString: string;
  exportName: string;
  sourceModule: string;
  source: ResolutionSource;
  importSpecifier?: string;
  /**
   * The name the instance is bound to in the CURRENT file, when it is
   * explicitly imported (`import { showPoint as sp }` → `"sp"`). Undefined for
   * local-scope and module-scan hits. Use {@link buildInstanceReference} rather
   * than reading `exportName` directly when emitting a reference.
   */
  localName?: string;
  /** True when the explicit import that brings it into scope is `import type`. */
  typeOnlyImport?: boolean;
  /**
   * The instance is declared for the requested type ITSELF (the same symbol,
   * after alias resolution), not only for a type of the same structure. Breaks
   * a tie between structurally identical types (see {@link pickResult}).
   */
  sameTypeIdentity?: boolean;
  /** The declaration the instance comes from ({@link ScannedInstance.origin}). */
  origin?: ts.Node;
}

export interface AmbiguousInstances {
  kind: "ambiguous";
  typeclassName: string;
  forType: ts.Type;
  candidates: ResolvedInstance[];
}

export type ResolutionResult = ResolvedInstance | AmbiguousInstances | undefined;

// ============================================================================
// Import Map
// ============================================================================

interface NamedImportBinding {
  /** The name exported by the module (`showPoint` in `{ showPoint as sp }`). */
  exportName: string;
  /** The local binding name in the importing file (`sp`). */
  localName: string;
  /** `import type { ... }` or `import { type x }` — not usable as a value. */
  typeOnly: boolean;
}

interface ImportMapEntry {
  specifier: string;
  resolvedPath: string;
  namedImports: NamedImportBinding[];
}

// Keyed per program (and per file within a program) so watch/LSP rebuilds — which
// produce a fresh program — invalidate automatically and never serve a stale map
// for an edited file.
const importMapCache = new WeakMap<ts.Program, Map<string, ImportMapEntry[]>>();

function importMapCacheFor(program: ts.Program): Map<string, ImportMapEntry[]> {
  return getOrCreateWeak(importMapCache, program, () => new Map());
}

function getImportMap(
  ctx: Pick<MacroContext, "typeChecker" | "program" | "sourceFile">
): ImportMapEntry[] {
  const cache = importMapCacheFor(ctx.program);
  const key = ctx.sourceFile.fileName;
  const cached = cache.get(key);
  if (cached) return cached;

  const checker = ctx.typeChecker;
  const entries: ImportMapEntry[] = [];
  for (const stmt of ctx.sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;

    const specifier = (stmt.moduleSpecifier as ts.StringLiteral).text;

    // Resolve via the checker (respects the program's module resolution — works
    // for on-disk and virtual/in-memory hosts alike). Fall back to ts.sys-based
    // resolution only if the symbol can't be resolved.
    let resolvedPath: string | undefined;
    const moduleSymbol = checker.getSymbolAtLocation(stmt.moduleSpecifier);
    const moduleFile = moduleSymbol?.declarations?.find((d): d is ts.SourceFile =>
      ts.isSourceFile(d)
    );
    resolvedPath = moduleFile?.fileName;
    if (!resolvedPath) {
      const resolved = ts.resolveModuleName(
        specifier,
        ctx.sourceFile.fileName,
        ctx.program.getCompilerOptions(),
        ts.sys
      );
      resolvedPath = resolved.resolvedModule?.resolvedFileName;
    }
    if (!resolvedPath) continue;

    const namedImports: NamedImportBinding[] = [];
    const clause = stmt.importClause;
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        namedImports.push({
          exportName: (el.propertyName ?? el.name).text,
          localName: el.name.text,
          typeOnly: clause.isTypeOnly || el.isTypeOnly,
        });
      }
    }

    entries.push({ specifier, resolvedPath, namedImports });
  }

  cache.set(key, entries);
  return entries;
}

/**
 * Clear resolver caches. Per-program caches invalidate automatically when their
 * program is collected; this remains for explicit test isolation (it cannot clear
 * a WeakMap, so it is now a no-op kept for API compatibility — still called by
 * transformer/std/macros tests, so not removed).
 */
export function clearResolverCache(): void {
  // No-op: importMapCache is a WeakMap<Program> and self-invalidates per program.
}

// ============================================================================
// Type Matching
// ============================================================================

/**
 * Check if a field type matches a candidate instance's forType using the TypeChecker.
 * Uses bidirectional assignability for exact type matching (handles aliases).
 */
function isTypeMatch(
  typeChecker: ts.TypeChecker,
  fieldType: ts.Type,
  candidateType: ts.Type | undefined
): boolean {
  if (!candidateType) return false;

  // `any` (including the checker's error type for an unresolvable type
  // argument, e.g. a bare generic `Array` in `Functor<Array>`) is assignable
  // both ways to every type, so without this guard it "matches" whichever
  // instance is scanned first — a silently wrong instance (docs review C#6).
  // `any` only matches an instance declared for `any`.
  if ((fieldType.flags & ts.TypeFlags.Any) !== (candidateType.flags & ts.TypeFlags.Any)) {
    return false;
  }

  // Bidirectional assignability = exact match (handles aliases like `type MyNum = number`)
  return (
    sameType(typeChecker, fieldType, candidateType) ||
    isDefaultInstantiation(typeChecker, fieldType, candidateType) ||
    isDefaultInstantiation(typeChecker, candidateType, fieldType)
  );
}

function sameType(checker: ts.TypeChecker, a: ts.Type, b: ts.Type): boolean {
  return checker.isTypeAssignableTo(a, b) && checker.isTypeAssignableTo(b, a);
}

/**
 * Is `candidateType` the requested type itself, by identity: the same type
 * object, or the same declaring symbol (alias, class, interface) after
 * import-alias resolution. Compared by symbol, not by name (CLAUDE.md
 * "Deciding what a type is"): `class UserId` and `class Email` with the same
 * fields are mutually assignable, but they are different symbols.
 */
function isSameTypeIdentity(
  checker: ts.TypeChecker,
  fieldType: ts.Type,
  candidateType: ts.Type | undefined
): boolean {
  if (!candidateType) return false;
  if (fieldType === candidateType) return true;
  const a = typeSymbol(checker, fieldType);
  return a !== undefined && a === typeSymbol(checker, candidateType);
}

function typeSymbol(checker: ts.TypeChecker, t: ts.Type): ts.Symbol | undefined {
  const sym = t.aliasSymbol ?? t.symbol;
  if (!sym) return undefined;
  return sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
}

/**
 * Is `inst` the default instantiation of the generic declared type
 * `declared`? `/** @impl Clone<Feature> *\/` names `interface Feature<G =
 * Geometry, P = Props>` bare, and the scanner resolves a bare name to the
 * declared type `Feature<G, P>` (which HKT instances such as `@impl
 * FlatMap<Box>` rely on), while a value typed `Feature` has
 * `Feature<Geometry, Props>`: TypeScript reads the bare name as its
 * defaults. Only for a generic whose type parameters ALL have defaults, and
 * only when every argument of `inst` is its parameter's default.
 */
function isDefaultInstantiation(
  checker: ts.TypeChecker,
  inst: ts.Type,
  declared: ts.Type
): boolean {
  const sym = declared.aliasSymbol ?? declared.symbol;
  if (!sym || inst === declared) return false;
  const decl = sym.declarations?.find(
    (d): d is ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.ClassDeclaration =>
      (ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d) || ts.isClassDeclaration(d)) &&
      (d.typeParameters?.length ?? 0) > 0
  );
  const params = decl?.typeParameters;
  if (!params || !params.every((tp) => tp.default)) return false;
  try {
    if (checker.getDeclaredTypeOfSymbol(sym) !== declared) return false;
    const args =
      inst.aliasSymbol === sym
        ? inst.aliasTypeArguments
        : !declared.aliasSymbol && inst.symbol === sym && (inst as ts.TypeReference).target
          ? checker.getTypeArguments(inst as ts.TypeReference)
          : undefined;
    // A class/interface reference may carry its `this` type as a last argument.
    if (!args || args.length < params.length) return false;
    return params.every((tp, i) =>
      sameType(checker, args[i], checker.getTypeFromTypeNode(tp.default!))
    );
  } catch {
    return false; // a declaration the checker can't resolve: no match
  }
}

// ============================================================================
// Resolver
// ============================================================================

/**
 * Resolve a typeclass instance for a given type.
 *
 * Searches the scope using Scala 3-style precedence rules:
 * local scope > explicit imports > module-level search.
 *
 * @param ctx - The macro context (provides program, typeChecker, sourceFile)
 * @param tcName - Typeclass name (e.g., "Ord")
 * @param forType - The actual ts.Type to find an instance for
 * @param scanner - Optional scanner instance (defaults to the singleton)
 * @param excludeLocal - A top-level declaration of the current file to leave
 *   out: the instance whose initializer is being expanded (`/** @impl
 *   Clone<Feature> *\/ export const cloneFeature = summon<Clone<Feature>>()`
 *   must not resolve to `cloneFeature` itself, which would be `const x = x`).
 * @param useSite - The expression that will reference the instance (an
 *   operator, a `summon`/`implicit()` call). Given, a `@derive` companion of a
 *   type declared in this file is found from its annotation even before the
 *   derive has expanded (a use above the declaration), unless the use runs
 *   at module top level before the companion is assigned (see
 *   {@link companionAssignedBefore}). Without it, only an already-expanded
 *   companion is found (`getSynthesized`), as before.
 */
export function resolveInstance(
  ctx: MacroContext,
  tcName: string,
  forType: ts.Type,
  scanner: InstanceScanner = defaultScanner,
  excludeLocal?: string,
  useSite?: ts.Node
): ResolutionResult {
  const typeChecker = ctx.typeChecker;

  // An enum, or a member of one (`Color.Green`, a `c: Color` narrowed to
  // `Color.Blue`), is mutually assignable with `number` (or `string`), so the
  // primitive's instance "matches" it too, and for a member it was the ONLY
  // match: `Color.Green.show()` became `showNumber.show(...)` beside an `@impl
  // Show<Color>`. The enum's own instance is looked for first, by symbol
  // identity (CLAUDE.md "by identity"), in every stage; only when there is
  // none does the ordinary (assignability) search below fall back to the
  // primitive's.
  const enumType = enumTypeOf(typeChecker, forType);
  if (enumType) {
    const own = resolveInStages(ctx, tcName, enumType, scanner, excludeLocal, true, useSite);
    if (own) return own;
  }
  return resolveInStages(ctx, tcName, forType, scanner, excludeLocal, false, useSite);
}

function resolveInStages(
  ctx: MacroContext,
  tcName: string,
  forType: ts.Type,
  scanner: InstanceScanner,
  excludeLocal: string | undefined,
  identityOnly: boolean,
  useSite?: ts.Node
): ResolutionResult {
  const forTypeString = ctx.typeChecker.typeToString(forType);

  // Stage 1: Local scope
  const localResult = resolveFromLocalScope(
    ctx,
    tcName,
    forType,
    forTypeString,
    scanner,
    excludeLocal,
    identityOnly,
    useSite
  );
  if (localResult) return localResult;

  // Stage 2 & 3: Imports (explicit and module-level)
  return resolveFromImports(ctx, tcName, forType, forTypeString, scanner, identityOnly);
}

/**
 * The enum `t` is, or whose member(s) it is: the enum type itself, an enum
 * member's literal type, or a union of one enum's members. Decided by the
 * type's flags and the checker's own widening (`getBaseTypeOfLiteralType`
 * maps an enum member to its enum), not by printed text. Undefined for
 * anything else, including a union spanning two enums.
 */
function enumTypeOf(checker: ts.TypeChecker, t: ts.Type): ts.Type | undefined {
  const isEnumLike = (m: ts.Type) => (m.flags & ts.TypeFlags.EnumLike) !== 0;
  if (!(isEnumLike(t) || (t.isUnion() && t.types.every(isEnumLike)))) return undefined;
  const base = checker.getBaseTypeOfLiteralType(t);
  const sym = base.symbol;
  return sym && sym.flags & ts.SymbolFlags.Enum ? base : undefined;
}

/**
 * The scan hits minus `derived<TC<T>>()` consts whose derivation failed: the
 * scanner registers such a const by its call, before (or without) its
 * expansion, and a failed one is the un-expanded stub, not an instance
 * (summon resolved to it and emitted `const s = m`).
 */
function dropFailedDerivations(
  ctx: MacroContext,
  scanned: readonly ScannedInstance[]
): ScannedInstance[] {
  const check = getDerivedCallCheck();
  if (!check || !scanned.some((i) => i.detectedVia === "derived-call")) return [...scanned];
  return scanned.filter(
    (inst) =>
      inst.detectedVia !== "derived-call" ||
      !inst.origin ||
      !ts.isVariableDeclaration(inst.origin) ||
      check(ctx, inst.origin)
  );
}

function resolveFromLocalScope(
  ctx: MacroContext,
  tcName: string,
  forType: ts.Type,
  forTypeString: string,
  scanner: InstanceScanner,
  excludeLocal?: string,
  identityOnly = false,
  useSite?: ts.Node
): ResolutionResult {
  const typeChecker = ctx.typeChecker;
  const sourceFile = ctx.sourceFile;

  // Scan the file's top-level declarations directly (not just module exports), so
  // a `@impl`/`@instance` const that is in local scope but NOT exported is still
  // found — and found independent of declaration order. This is the registry-free
  // replacement for instances the global registry used to provide.
  const allScanned = dropFailedDerivations(
    ctx,
    scanner.scanLocalFile(typeChecker, sourceFile, ctx.program)
  );
  const scanned =
    excludeLocal === undefined
      ? allScanned
      : allScanned.filter((inst) => inst.exportName !== excludeLocal);
  // Also check instances synthesized during THIS transform pass (e.g. a
  // `@derive(Eq)` companion) — invisible to the scan above, since that reads
  // the pre-transform source text and the companion doesn't exist there yet.
  const synthesized = scanner.getSynthesized(ctx.program, sourceFile.fileName);
  // And, for a use site, the companions this file's `@derive` annotations
  // will generate, so a use ABOVE the declaration (visited before the derive
  // expands) finds `P.Eq` as a use below it does. One already synthesized is
  // the same instance: not added twice.
  const annotated = useSite
    ? scanner
        .scanLocalDeriveCompanions(typeChecker, sourceFile, ctx.program, (node, error) =>
          ctx.reportWarning(
            node,
            `typesugar skipped '${node.getText()}'s @derive companions while resolving an ` +
              `instance: the type checker failed (${error}).`
          )
        )
        .filter(
          (inst) =>
            inst.typeclassName === tcName &&
            !synthesized.some(
              (s) => s.typeclassName === inst.typeclassName && s.exportName === inst.exportName
            ) &&
            (!inst.origin || companionAssignedBefore(useSite, inst.origin, typeChecker))
        )
    : [];
  const candidates =
    synthesized.length > 0 || annotated.length > 0
      ? [...scanned, ...synthesized, ...annotated]
      : scanned;
  const matches = filterMatches(
    typeChecker,
    candidates,
    tcName,
    forType,
    forTypeString,
    sourceFile.fileName,
    "local-scope",
    undefined,
    identityOnly
  );

  return pickResult(matches, tcName, forType);
}

/**
 * Whether the `@derive` companion generated right after `typeDecl` (in the
 * same file) holds its value when `useSite` runs.
 *
 * A use below the declaration always does. A use above it does only when it
 * cannot run before the declaration is reached -- conservatively, when some
 * function enclosing it is DEFERRED (see `isDeferredFunction`): bound to a
 * name (a function declaration, a `const f = () => ...`, a class's method,
 * accessor, constructor or instance property initializer -- bound through
 * its class), and that name is not referenced anywhere above the
 * declaration except from inside another deferred function. An immediately
 * invoked function (`(() => a === b)()`), a callback passed to a call at top
 * level (`xs.filter(v => v === q)`) and a function called above the
 * declaration all run before the companion's namespace is assigned (`P` is
 * still undefined there), so a reference to it would throw at run time: those
 * get "not assigned yet" (TS9001) at compile time instead (review 5, item 4).
 * So do a class's definition-time parts -- static initializers and blocks,
 * computed member names, decorators -- and a member a decorator receives (it
 * may call it then); a reference to the class from its own definition-time
 * parts counts as a use above the declaration (review 6).
 *
 * The references are found through the checker, by symbol, not by name. An
 * `export { f }` above the declaration does not count (it doesn't call `f`);
 * a call through a circular import during module evaluation is not modelled.
 */
export function companionAssignedBefore(
  useSite: ts.Node,
  typeDecl: ts.Node,
  checker: ts.TypeChecker
): boolean {
  const site = isSyntheticNode(useSite) ? ts.getOriginalNode(useSite) : useSite;
  const sourceFile = typeDecl.getSourceFile();
  // A generated node with no original has no position to judge: as before.
  if (isSyntheticNode(site) || site.getSourceFile() !== sourceFile) return true;
  if (site.pos >= typeDecl.end) return true;
  return runsOnlyLater(site, { checker, sourceFile, declEnd: typeDecl.end, verdicts: new Map() });
}

interface DeferralCheck {
  checker: ts.TypeChecker;
  sourceFile: ts.SourceFile;
  /** End of the type declaration the companion follows. */
  declEnd: number;
  /** Per function binding: settled, or `"pending"` while being checked (a cycle). */
  verdicts: Map<ts.Symbol, boolean | "pending">;
}

/**
 * Some function enclosing `node` (innermost first) is deferred, with `node`
 * in the part of it that runs when it is called: its body or a parameter (a
 * default value), an instance property's initializer. A member's computed
 * name and its decorators -- and a parameter's decorators -- run when the
 * class is defined, as do static initializers and static blocks (which are
 * not functions here): those are judged by what encloses the class (review 6).
 */
function runsOnlyLater(node: ts.Node, check: DeferralCheck): boolean {
  let prev: ts.Node = node;
  let viaDecorator = false;
  for (let n: ts.Node | undefined = node.parent; n; prev = n, n = n.parent) {
    if (ts.isSourceFile(n)) break;
    if (ts.isDecorator(n)) viaDecorator = true;
    if (ts.isFunctionLike(n) || isInstancePropertyDeclaration(n)) {
      const callTime = ts.isPropertyDeclaration(n)
        ? prev === n.initializer
        : prev === (n as ts.FunctionLikeDeclaration).body ||
          (ts.isParameter(prev) && !viaDecorator);
      viaDecorator = false;
      if (callTime && isDeferredFunction(n, check)) return true;
    }
  }
  return false;
}

/**
 * `member` or its class has decorators, or one of its parameters does: a
 * decorator receives the method (or the class) at definition time and may
 * call it then (TC39 and legacy decorators alike).
 */
function decoratedAtDefinition(member: ts.Node): boolean {
  const decorated = (n: ts.Node) => ts.canHaveDecorators(n) && !!ts.getDecorators(n)?.length;
  if (decorated(member) || (member.parent && decorated(member.parent))) return true;
  return ts.isFunctionLike(member) && member.parameters.some((p) => decorated(p));
}

function isInstancePropertyDeclaration(n: ts.Node): n is ts.PropertyDeclaration {
  return ts.isPropertyDeclaration(n) && !ts.getModifiers(n)?.some(isStaticModifier);
}

/**
 * The function `fn` doesn't run before `check.declEnd`: it has a binding (see
 * `functionBinding`), and every reference to that binding above the
 * declaration is itself inside a deferred function. A reference cycle with
 * nothing else calling into it never starts, so a binding being checked
 * counts as deferred where it recurs.
 */
function isDeferredFunction(fn: ts.Node, check: DeferralCheck): boolean {
  const binding = functionBinding(fn, check.checker);
  if (!binding) return false;
  const { symbol, declaration, name } = binding;
  if (binding.isMember && decoratedAtDefinition(fn)) return false;
  const verdict = check.verdicts.get(symbol);
  if (verdict === "pending") return true;
  if (verdict !== undefined) return verdict;
  check.verdicts.set(symbol, "pending");
  let deferred = true;
  const visit = (node: ts.Node): void => {
    if (!deferred || node.pos >= check.declEnd) return;
    // Its own name doesn't call it. Its own body (recursion) runs only once
    // it is called -- except a class's: a class binding's references from
    // its own static initializers, static blocks, computed names and
    // decorators run at definition time, so the class is visited like any
    // other code (references from its deferred members are judged by
    // `runsOnlyLater`, where this binding is pending).
    if (node === name) return;
    if (node === declaration && !binding.isMember) return;
    // A type annotation (`get self(): Box`) never runs.
    if (isTypeOnly(node)) return;
    if (
      ts.isIdentifier(node) &&
      node.text === symbol.name &&
      referencesSymbol(node, symbol, check)
    ) {
      if (!runsOnlyLater(node, check)) deferred = false;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(check.sourceFile, visit);
  check.verdicts.set(symbol, deferred);
  return deferred;
}

/** A type position (or declaration) -- erased, so nothing in it runs. A class's `extends` expression does. */
function isTypeOnly(node: ts.Node): boolean {
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return true;
  if (!ts.isTypeNode(node)) return false;
  return !(
    ts.isExpressionWithTypeArguments(node) &&
    ts.isHeritageClause(node.parent) &&
    node.parent.token === ts.SyntaxKind.ExtendsKeyword &&
    ts.isClassLike(node.parent.parent)
  );
}

function referencesSymbol(id: ts.Identifier, symbol: ts.Symbol, check: DeferralCheck): boolean {
  if (ts.isExportSpecifier(id.parent)) return false;
  const sym = ts.isShorthandPropertyAssignment(id.parent)
    ? check.checker.getShorthandAssignmentValueSymbol(id.parent)
    : check.checker.getSymbolAtLocation(id);
  return sym === symbol;
}

/**
 * The name a function runs through, and the declaration that binds it: a
 * named function declaration; a function or arrow that initializes a
 * variable (`const f = () => ...`); or a member (method, accessor,
 * constructor, instance property) of a class that is declared, or bound to a
 * variable, by name -- it runs once the class is used. Anything else (an
 * argument, an IIFE, an object literal's method) has none: it may run at once.
 */
function functionBinding(
  fn: ts.Node,
  checker: ts.TypeChecker
): { symbol: ts.Symbol; declaration: ts.Node; name: ts.Identifier; isMember: boolean } | undefined {
  const named = (name: ts.Node | undefined, declaration: ts.Node, isMember = false) => {
    const symbol = name && ts.isIdentifier(name) ? checker.getSymbolAtLocation(name) : undefined;
    return symbol && name && ts.isIdentifier(name)
      ? { symbol, declaration, name, isMember }
      : undefined;
  };
  if (ts.isFunctionDeclaration(fn)) return named(fn.name, fn);
  if (ts.isFunctionExpression(fn) || ts.isArrowFunction(fn)) {
    let p: ts.Node = fn.parent;
    while (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p)) {
      p = p.parent;
    }
    return ts.isVariableDeclaration(p) && p.initializer && skipParens(p.initializer) === fn
      ? named(p.name, p)
      : undefined;
  }
  const isMember =
    ts.isMethodDeclaration(fn) ||
    ts.isGetAccessorDeclaration(fn) ||
    ts.isSetAccessorDeclaration(fn) ||
    ts.isConstructorDeclaration(fn) ||
    isInstancePropertyDeclaration(fn);
  if (!isMember) return undefined;
  const cls = fn.parent;
  if (ts.isClassDeclaration(cls)) return named(cls.name, cls, true);
  if (ts.isClassExpression(cls) && ts.isVariableDeclaration(cls.parent)) {
    return named(cls.parent.name, cls.parent, true);
  }
  return undefined;
}

function skipParens(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) {
    e = e.expression;
  }
  return e;
}

function isStaticModifier(m: ts.ModifierLike): boolean {
  return m.kind === ts.SyntaxKind.StaticKeyword;
}

function resolveFromImports(
  ctx: MacroContext,
  tcName: string,
  forType: ts.Type,
  forTypeString: string,
  scanner: InstanceScanner,
  identityOnly = false
): ResolutionResult {
  const typeChecker = ctx.typeChecker;
  const importMap = getImportMap(ctx);

  // Stage 2: Explicit imports — instances imported by name
  const explicitMatches: ResolvedInstance[] = [];
  // Stage 3: Module-level scan — instances found in imported modules
  const moduleMatches: ResolvedInstance[] = [];

  for (const entry of importMap) {
    const moduleSourceFile = ctx.program.getSourceFile(entry.resolvedPath);
    if (!moduleSourceFile) continue;

    const moduleSymbol = typeChecker.getSymbolAtLocation(moduleSourceFile);
    if (!moduleSymbol) continue;

    const scanned = dropFailedDerivations(
      ctx,
      scanner.scanModule(typeChecker, moduleSymbol, entry.resolvedPath, ctx.program)
    );
    const allMatches = filterMatches(
      typeChecker,
      scanned,
      tcName,
      forType,
      forTypeString,
      entry.resolvedPath,
      "module-scan",
      entry.specifier,
      identityOnly
    );

    for (const match of allMatches) {
      // A companion (`Point.Eq`) is imported through its type's binding
      // (`import { Point as P }` → `P.Eq`).
      const dot = match.exportName.indexOf(".");
      const importedName = dot === -1 ? match.exportName : match.exportName.slice(0, dot);
      const binding = entry.namedImports.find((b) => b.exportName === importedName);
      if (binding) {
        explicitMatches.push({
          ...match,
          source: "explicit-import",
          localName: binding.localName + (dot === -1 ? "" : match.exportName.slice(dot)),
          typeOnlyImport: binding.typeOnly,
        });
      } else {
        moduleMatches.push(match);
      }
    }
  }

  // Stage 2 result
  const explicitResult = pickResult(explicitMatches, tcName, forType);
  if (explicitResult) return explicitResult;

  // Stage 3 result
  return pickResult(moduleMatches, tcName, forType);
}

// ============================================================================
// The typeclass's own package (implicit scope of the typeclass)
// ============================================================================

/**
 * The typeclass a type reference's name denotes, by identity: the checker
 * follows imports, renames (`Eq as Equal`) and type aliases that forward to
 * another type (`typesugar`'s `type Ord<A> = import("@typesugar/std").Ord<A>`)
 * to the typeclass's own declaration. Undefined when the name is not a type
 * here. Throws when the checker does (callers warn and degrade); the caller
 * skips synthetic nodes (CLAUDE.md).
 */
export function resolveTypeclassSymbol(
  checker: ts.TypeChecker,
  typeName: ts.EntityName
): ts.Symbol | undefined {
  return followTypeclassSymbol(checker, checker.getSymbolAtLocation(typeName));
}

/** {@link resolveTypeclassSymbol} from a symbol already looked up (import aliases followed). */
export function followTypeclassSymbol(
  checker: ts.TypeChecker,
  symbol: ts.Symbol | undefined
): ts.Symbol | undefined {
  let sym = symbol;
  if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
  if (!sym || !(sym.flags & ts.SymbolFlags.Type)) return undefined;
  // `type Clone<A> = std.Clone<A>` → std's `Clone` (bounded: aliases of aliases).
  for (let i = 0; i < 8 && sym.flags & ts.SymbolFlags.TypeAlias; i++) {
    const t = checker.getDeclaredTypeOfSymbol(sym);
    const next: ts.Symbol | undefined =
      t.aliasSymbol && t.aliasSymbol !== sym ? t.aliasSymbol : t.symbol;
    const named = ts.SymbolFlags.Interface | ts.SymbolFlags.Class | ts.SymbolFlags.TypeAlias;
    if (!next || next === sym || !(next.flags & named)) break;
    sym = next;
  }
  return sym;
}

/**
 * The name a typeclass is keyed by (instances, derivations and `@impl` tags
 * name it), for the typeclass {@link followTypeclassSymbol} resolved from
 * `start`: its declaration's own name, except when a `.d.ts` bundler renamed
 * the declaration to avoid a clash and re-exported it under the real name.
 * @typesugar/sql's dist declares `interface Read$1<A>` and exports
 * `Read$1 as Read` (its legacy `meta.ts` also declares a `Read`), so
 * `summon<Read<User>>()` looked for `Read$1` instances and found none for
 * every consumer of the published package. The renamed name is recognised
 * only through the export specifier on the alias chain from `start` that
 * really is this declaration (`Read$1 as Read`, in a declaration file), not
 * by the spelling alone. Instances are still keyed by name (module-qualified
 * identity is PEP-060 item 13).
 */
export function typeclassKeyName(
  checker: ts.TypeChecker,
  start: ts.Symbol | undefined,
  resolved: ts.Symbol
): string {
  const own = resolved.name;
  const renamed = /^(.+)\$\d+$/.exec(own);
  if (!renamed) return own;
  if (!resolved.declarations?.length) return own;
  if (!resolved.declarations.every((d) => d.getSourceFile().isDeclarationFile)) return own;
  let sym = start;
  for (let i = 0; i < 16 && sym && sym.flags & ts.SymbolFlags.Alias; i++) {
    for (const d of sym.declarations ?? []) {
      if (
        ts.isExportSpecifier(d) &&
        d.getSourceFile().isDeclarationFile &&
        d.propertyName &&
        ts.isIdentifier(d.propertyName) &&
        d.propertyName.text === own &&
        ts.isIdentifier(d.name) &&
        d.name.text === renamed[1]
      ) {
        return renamed[1];
      }
    }
    sym = checker.getImmediateAliasedSymbol(sym);
  }
  return own;
}

const packageNameCache = new Map<string, string | null>();

/** The `name` of the nearest package.json at or above `dir`, if any. */
function packageNameAt(dir: string): string | undefined {
  const seen: string[] = [];
  let d = dir;
  for (;;) {
    const cached = packageNameCache.get(d);
    if (cached !== undefined) {
      for (const s of seen) packageNameCache.set(s, cached);
      return cached ?? undefined;
    }
    seen.push(d);
    const pj = `${d}/package.json`;
    if (ts.sys.fileExists(pj)) {
      let name: string | null = null;
      try {
        const parsed = JSON.parse(ts.sys.readFile(pj) ?? "{}") as { name?: unknown };
        if (typeof parsed.name === "string") name = parsed.name;
      } catch {
        name = null; // an unreadable package.json names no package
      }
      for (const s of seen) packageNameCache.set(s, name);
      return name ?? undefined;
    }
    const parent = d.replace(/\/[^/]*$/, "");
    if (!parent || parent === d) {
      for (const s of seen) packageNameCache.set(s, null);
      return undefined;
    }
    d = parent;
  }
}

/**
 * Where a typeclass's own instances are, when the file reaches the typeclass
 * through another module: `import type { Ord } from "typesugar"` names
 * `@typesugar/std`'s `Ord`, whose instances (`ordNumber`, ...) are exported
 * by `@typesugar/std`, which the file doesn't import, so the import scan
 * never sees them. Like Scala's implicit scope, which includes the
 * typeclass's companion, the package that declares the typeclass is searched
 * as if the file imported it: its entry, resolved FROM THIS FILE (so an
 * emitted import of it resolves the same way), scanned like an imported
 * module. Tried after the file's own scope and imports.
 *
 * `homePackage` names that package even when it can't be searched from here
 * (not resolvable from this file, or not in the program), for the help text.
 */
export function resolveFromTypeclassHome(
  ctx: MacroContext,
  typeclass: ts.Symbol,
  tcName: string,
  forType: ts.Type,
  scanner: InstanceScanner = defaultScanner
): { result: ResolutionResult; homePackage?: string } {
  const decl = typeclass.declarations?.[0];
  if (!decl) return { result: undefined };
  const declFile = decl.getSourceFile();
  if (declFile === ctx.sourceFile) return { result: undefined };
  const fileName = declFile.fileName.replace(/\\/g, "/");
  const homePackage = packageNameAt(fileName.slice(0, fileName.lastIndexOf("/")));
  if (!homePackage) return { result: undefined };
  const resolved = ts.resolveModuleName(
    homePackage,
    ctx.sourceFile.fileName,
    ctx.program.getCompilerOptions(),
    ts.sys
  ).resolvedModule?.resolvedFileName;
  const entry = resolved ? ctx.program.getSourceFile(resolved) : undefined;
  if (!entry || entry === ctx.sourceFile) return { result: undefined, homePackage };
  // Already searched: the file imports the package itself.
  if (getImportMap(ctx).some((e) => e.resolvedPath === entry.fileName)) {
    return { result: undefined, homePackage };
  }
  const checker = ctx.typeChecker;
  const moduleSymbol = checker.getSymbolAtLocation(entry);
  if (!moduleSymbol) return { result: undefined, homePackage };
  // The entry's exports, then (only if none matches) the instances it exports
  // inside a namespace re-export: @typesugar/fp's root exports its instances
  // as `TC.showNumber` (`export * as TC from "./typeclasses"`).
  let scanned = scanner.scanModule(checker, moduleSymbol, entry.fileName, ctx.program);
  if (
    !scanned.some((i) => i.typeclassName === tcName && isTypeMatch(checker, forType, i.forType))
  ) {
    try {
      scanned = scanner.scanNamespaceReexports(checker, moduleSymbol, entry.fileName, ctx.program);
    } catch (e) {
      ctx.reportWarning(
        ctx.sourceFile,
        `typesugar could not search ${homePackage}'s namespace exports for a ${tcName} ` +
          `instance (${e instanceof Error ? e.message : String(e)}); they were skipped.`
      );
    }
  }
  const matches = filterMatches(
    checker,
    scanned,
    tcName,
    forType,
    checker.typeToString(forType),
    entry.fileName,
    "module-scan",
    homePackage
  );
  return { result: pickResult(matches, tcName, forType), homePackage };
}

// ============================================================================
// Helpers
// ============================================================================

function filterMatches(
  typeChecker: ts.TypeChecker,
  scanned: ScannedInstance[],
  tcName: string,
  forType: ts.Type,
  forTypeString: string,
  sourceModule: string,
  source: ResolutionSource,
  importSpecifier?: string,
  identityOnly = false
): ResolvedInstance[] {
  const results: ResolvedInstance[] = [];

  for (const inst of scanned) {
    if (inst.typeclassName !== tcName) continue;

    // Type-based matching: use ts.Type directly from scanner
    if (!isTypeMatch(typeChecker, forType, inst.forType)) continue;

    // `identityOnly`: only an instance declared for this very type (by
    // symbol), not one that merely matches by assignability.
    const sameTypeIdentity = isSameTypeIdentity(typeChecker, forType, inst.forType);
    if (identityOnly && !sameTypeIdentity) continue;

    results.push({
      kind: "resolved",
      typeclassName: tcName,
      forType,
      forTypeString,
      exportName: inst.exportName,
      sourceModule,
      source,
      importSpecifier,
      sameTypeIdentity,
      origin: inst.origin,
    });
  }

  return results;
}

/**
 * Name-based scope membership: does a type *named* `typeName` have an instance of
 * `tcName` visible in `ctx.sourceFile`'s scope — either a local `@impl`/`@instance`
 * declaration or an export of an imported module?
 *
 * The `@derive` transitive-derivation planner walks type *names* (not resolved
 * `ts.Type`s, since a field type may not be resolvable in isolation) and must skip
 * types that already have an instance. This is the registry-free replacement for the
 * old `instanceRegistry.some(...)` membership check (PEP-052 Phase C): scope, not a
 * process-global registry, so it can't leak instances across files.
 */
export function resolveInstanceInScopeByName(
  ctx: MacroContext,
  tcName: string,
  typeName: string,
  scanner: InstanceScanner = defaultScanner
): string | undefined {
  return findInstanceInScopeByName(ctx, tcName, typeName, scanner)?.exportName;
}

/**
 * Name-based lookup for code that will EMIT a reference to the instance
 * (implicits' fallback when no concrete `ts.Type` is available). Unlike
 * {@link findInstanceInScopeByName}, an imported module's NON-exported
 * declarations are never returned — a bare reference to one from another
 * file is a ReferenceError at runtime — and the module specifier is returned
 * so the caller can import a module-scan hit.
 *
 * Registry shape (CLAUDE.md "Resolving things a macro just generated"): this
 * goes through {@link findScannedInScope}, which reads the live same-pass
 * `getSynthesized` side-table for the local file in addition to the
 * pass-start scan, so a `@derive` companion generated earlier in the same
 * pass is visible.
 */
export function findEmittableInstanceByName(
  ctx: MacroContext,
  tcName: string,
  typeName: string,
  scanner: InstanceScanner = defaultScanner
): { exportName: string; modulePath?: string; specifier?: string } | undefined {
  const match = (inst: ScannedInstance): boolean =>
    inst.typeclassName === tcName && baseTypeName(inst.forTypeString) === typeName;
  const hit = findScannedInScope(ctx, match, scanner, /* includeNonExportedImports */ false);
  return hit
    ? { exportName: hit.instance.exportName, modulePath: hit.modulePath, specifier: hit.specifier }
    : undefined;
}

/**
 * Build the expression a macro should emit to reference a resolved instance
 * from `ctx.sourceFile`:
 *
 * - local-scope hit → the declaration's own name (dotted companion paths such
 *   as a synthesized `Point.Eq` become a property-access chain);
 * - explicit value import → the LOCAL binding name (`import { showPoint as sp }`
 *   → `sp`), never the module's export name, which isn't bound in this file;
 * - module-scan hit (instance found in an imported module but not imported
 *   by name), or an `import type`-only binding → `ctx.ensureImport(exportName,
 *   importSpecifier)`, which injects the import (aliased if the name clashes).
 */
export function buildInstanceReference(
  ctx: Pick<MacroContext, "factory" | "ensureImport">,
  resolved: ResolvedInstance
): ts.Expression {
  const f = ctx.factory;
  if (resolved.source === "explicit-import" && resolved.localName && !resolved.typeOnlyImport) {
    return buildDottedReference(f, resolved.localName);
  }
  if (resolved.source !== "local-scope" && resolved.importSpecifier) {
    return buildImportedReference(ctx, resolved.exportName, resolved.importSpecifier);
  }
  return buildDottedReference(f, resolved.exportName);
}

/**
 * A reference to `exportName` of the module `specifier`, importing it (via
 * `ctx.ensureImport`, aliased if the name is taken). A companion path
 * (`"Point.Eq"`) imports its first segment and reads the rest from it.
 */
export function buildImportedReference(
  ctx: Pick<MacroContext, "factory" | "ensureImport">,
  exportName: string,
  specifier: string
): ts.Expression {
  const [base, ...rest] = exportName.split(".");
  let expr: ts.Expression = ctx.ensureImport(base, specifier);
  for (const part of rest) expr = ctx.factory.createPropertyAccessExpression(expr, part);
  return expr;
}

/** `"Point.Eq"` → `Point.Eq` property access; a plain name → identifier. */
export function buildDottedReference(factory: ts.NodeFactory, name: string): ts.Expression {
  const parts = name.split(".");
  let expr: ts.Expression = factory.createIdentifier(parts[0]);
  for (let i = 1; i < parts.length; i++) {
    expr = factory.createPropertyAccessExpression(expr, parts[i]);
  }
  return expr;
}

/**
 * Like {@link resolveInstanceInScopeByName}, but also reports WHERE the instance
 * lives: `modulePath` is the resolved file path for an imported instance, or
 * undefined when it was found in the local file. Source-based specialization
 * uses this to walk from a companion path (`Point.Numeric`) back to the
 * generating instance declaration (PEP-053 Wave 2 gap 6) — the underlying
 * instance need not itself be exported for the companion path to be valid,
 * ordinary TypeScript, and {@link findScannedInScope} treats non-exported
 * imported-module instances as in scope unconditionally.
 */
export function findInstanceInScopeByName(
  ctx: MacroContext,
  tcName: string,
  typeName: string,
  scanner: InstanceScanner = defaultScanner
): { exportName: string; modulePath?: string } | undefined {
  const match = (inst: ScannedInstance): boolean =>
    inst.typeclassName === tcName && baseTypeName(inst.forTypeString) === typeName;
  const hit = findScannedInScope(ctx, match, scanner);
  return hit ? { exportName: hit.instance.exportName, modulePath: hit.modulePath } : undefined;
}

/** First identifier of a type string: `"Ord<number>"`-style args → `Ord`. */
function baseTypeName(s: string): string {
  const m = /^[A-Za-z_$][\w$]*/.exec(s.trim());
  return m ? m[0] : s.trim();
}

/**
 * Shared scope walk: local file (incl. non-exported `@impl` values) first,
 * then every imported module (re-exports followed by the scanner, PLUS each
 * module's own non-exported top-level declarations). Returns the first
 * scanned instance satisfying `match`.
 *
 * Non-exported visibility is unconditional for imported modules, matching
 * the local file's own treatment just above (which has never gated
 * non-exported instances behind a flag): a value need not be exported for a
 * reference to it to be ordinary, valid TypeScript — `export const Point = {
 * Numeric: numericPoint }` makes `Point.Numeric` reachable from any importer
 * regardless of whether `numericPoint` itself carries the `export` keyword,
 * exactly as a same-file non-exported `@impl` const is already in scope for
 * its own file. All three callers of this shared walk (companion-path
 * resolution, the `@derive` transitive-derivation "does this type already
 * have an instance" check, and do-notation resolution) get the same
 * consistent scope-visibility semantics rather than two different ones
 * selected by a flag only one of them knew to set (PEP-053 Wave 2 gap 6,
 * widened in PEP-056 Wave 5 cleanup).
 */
function findScannedInScope(
  ctx: MacroContext,
  match: (inst: ScannedInstance) => boolean,
  scanner: InstanceScanner = defaultScanner,
  includeNonExportedImports = true
): { instance: ScannedInstance; modulePath?: string; specifier?: string } | undefined {
  // A `derived<TC<T>>()` const whose derivation failed is the un-expanded
  // stub, not an instance: dropped here exactly as resolveInstance drops it
  // (dropFailedDerivations, which reads the live per-program outcome
  // registry the `derived` macro writes), so every consumer of this walk
  // (implicit()'s by-name fallback, companion-path extraction, do-notation)
  // agrees with the type-based resolver.
  const live = (scanned: readonly ScannedInstance[]): ScannedInstance[] =>
    dropFailedDerivations(ctx, scanned.filter(match));
  // Local file (includes non-exported @impl/@instance values). Also check
  // instances synthesized during THIS transform pass (e.g. a `@derive(Eq)`
  // companion) — invisible to the scan above, since that reads the
  // pre-transform source text and the companion doesn't exist there yet.
  // See "same-pass state visibility" in CLAUDE.md: a scan of
  // sourceFile.statements is fixed at pass start and can never see what the
  // pass itself is in the middle of generating.
  const local = scanner.scanLocalFile(ctx.typeChecker, ctx.sourceFile, ctx.program);
  const synthesized = scanner.getSynthesized(ctx.program, ctx.sourceFile.fileName);
  const localHit = live(local)[0] ?? live(synthesized)[0];
  if (localHit) return { instance: localHit };

  // Imported modules.
  for (const entry of getImportMap(ctx)) {
    const moduleSourceFile = ctx.program.getSourceFile(entry.resolvedPath);
    if (!moduleSourceFile) continue;
    const moduleSymbol = ctx.typeChecker.getSymbolAtLocation(moduleSourceFile);
    if (!moduleSymbol) continue;
    const scanned = scanner.scanModule(
      ctx.typeChecker,
      moduleSymbol,
      entry.resolvedPath,
      ctx.program
    );
    const hit =
      live(scanned)[0] ??
      (includeNonExportedImports
        ? live(scanner.scanLocalFile(ctx.typeChecker, moduleSourceFile, ctx.program))[0]
        : undefined);
    if (hit) return { instance: hit, modulePath: entry.resolvedPath, specifier: entry.specifier };
  }

  return undefined;
}

/**
 * Whether an instance's declared type-constructor name serves an inferred
 * do-notation brand. Three spellings match brand `B`:
 *
 * - `B` itself (`@impl FlatMap<Effect>`);
 * - the HKT-tag convention `BF` (`@impl FlatMap<OptionF>` — the same
 *   `OptionF → Option` convention as the HKT expansion table), so existing
 *   fp tags keep working without retagging;
 * - the phantom-tag convention `_BTag` (std's
 *   `flatMapArray: FlatMap<_ArrayTag>` type annotations), so std's builtin
 *   instances are discoverable from their existing annotations WITHOUT
 *   adding `@impl` JSDoc — which would not be build-neutral: std compiles
 *   with the typesugar plugin, and the `@impl` attribute macro rewrites the
 *   annotation and emits a `namespace Array { ... }` companion merge that
 *   shadows the global.
 */
export function brandMatchesForType(forTypeName: string, brand: string): boolean {
  return forTypeName === brand || forTypeName === `${brand}F` || forTypeName === `_${brand}Tag`;
}

/**
 * Result of {@link resolveDoNotationInstance}: where the instance lives plus
 * its do-notation emission metadata (PEP-052 Wave 3).
 */
export interface ResolvedDoNotationInstance {
  exportName: string;
  /** Resolved file path for an imported instance; undefined for local-file hits. */
  modulePath?: string;
  /** `@do-methods` metadata, when the instance declares any. */
  doMeta?: DoNotationMeta;
}

/**
 * Scope-based (registry-free) do-notation instance lookup: find a
 * `FlatMap`/`ParCombine` instance for an inferred type-constructor brand
 * (e.g. `"Option"`, `"Effect"`) visible from `ctx.sourceFile` — a local
 * `@impl`/`@instance` declaration or an export of any imported module
 * (side-effect imports and re-exports included).
 *
 * This is the "HKT-aware" variant PEP-052 calls for: brand-keyed by NAME,
 * deliberately not `resolveInstance`'s `ts.Type`-assignability matching —
 * `FlatMap<F>`'s type parameter is a phantom tag (`_ArrayTag`), so
 * type-based matching is impossible for these instances.
 */
// Memoized per (program, file, typeclass, brand): a do-notation-heavy file
// resolves the same brand once per comprehension (and once per nested
// parallel group), but the answer cannot change within a program. WeakMap
// keying invalidates automatically across watch/LSP rebuilds. Misses are
// cached too (null) — the miss path is the expensive one (full import walk).
const doNotationResolutionCache = new WeakMap<
  ts.Program,
  Map<string, ResolvedDoNotationInstance | null>
>();

export function resolveDoNotationInstance(
  ctx: MacroContext,
  tcName: string,
  brand: string,
  scanner: InstanceScanner = defaultScanner
): ResolvedDoNotationInstance | undefined {
  // The cache key does not include the scanner — bypass it entirely for
  // custom scanners (test isolation) so a fresh scanner never receives a
  // stale default-scanner result.
  if (scanner !== defaultScanner) {
    return resolveDoNotationInstanceUncached(ctx, tcName, brand, scanner);
  }
  let cache = doNotationResolutionCache.get(ctx.program);
  if (!cache) {
    cache = new Map();
    doNotationResolutionCache.set(ctx.program, cache);
  }
  const cacheKey = `${ctx.sourceFile.fileName}::${tcName}:${brand}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached ?? undefined;
  const result = resolveDoNotationInstanceUncached(ctx, tcName, brand, scanner);
  cache.set(cacheKey, result ?? null);
  return result;
}

function resolveDoNotationInstanceUncached(
  ctx: MacroContext,
  tcName: string,
  brand: string,
  scanner: InstanceScanner
): ResolvedDoNotationInstance | undefined {
  // Exact brand spelling wins over the `BF`/`_BTag` conventions, so a
  // genuine type named e.g. `RateF` can never shadow a `Rate` instance (or
  // vice versa) just by scan order.
  const exactMatch = (inst: ScannedInstance): boolean =>
    inst.typeclassName === tcName && baseTypeName(inst.forTypeString) === brand;
  const conventionMatch = (inst: ScannedInstance): boolean =>
    inst.typeclassName === tcName && brandMatchesForType(baseTypeName(inst.forTypeString), brand);
  const hit =
    findScannedInScope(ctx, exactMatch, scanner) ??
    findScannedInScope(ctx, conventionMatch, scanner);
  if (!hit) return undefined;
  return {
    exportName: hit.instance.exportName,
    modulePath: hit.modulePath,
    doMeta: hit.instance.doMeta,
  };
}

/**
 * Boolean form of {@link resolveInstanceInScopeByName} — does a type *named*
 * `typeName` have an instance of `tcName` visible in scope? Used by the `@derive`
 * transitive-derivation planner.
 */
export function hasInstanceInScopeByName(
  ctx: MacroContext,
  tcName: string,
  typeName: string,
  scanner: InstanceScanner = defaultScanner
): boolean {
  return resolveInstanceInScopeByName(ctx, tcName, typeName, scanner) !== undefined;
}

function pickResult(
  matches: ResolvedInstance[],
  tcName: string,
  forType: ts.Type
): ResolutionResult {
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0];

  // Deduplicate: the same instance reached through different paths is one
  // instance. By identity (CLAUDE.md "Deciding what a type is"): the
  // declaration it comes from, after re-exports are followed (`import { Vec }`
  // from one module and `import { Vec as V2 }` from another are both vec.ts's
  // `Vec.Eq`). Without an origin, by (module, exportName): keyed by module
  // too, since two DIFFERENT modules exporting a same-named instance are
  // genuinely ambiguous, not one instance.
  const seen = new Map<unknown, ResolvedInstance>();
  const originKeys = new Map<ts.Node, Map<string, object>>();
  const keyOf = (m: ResolvedInstance): unknown => {
    if (!m.origin) return `${m.sourceModule}\0${m.exportName}`;
    let byTc = originKeys.get(m.origin);
    if (!byTc) originKeys.set(m.origin, (byTc = new Map()));
    let key = byTc.get(m.typeclassName);
    if (!key) byTc.set(m.typeclassName, (key = {}));
    return key;
  };
  for (const m of matches) {
    const key = keyOf(m);
    if (!seen.has(key)) {
      seen.set(key, m);
    }
  }
  if (seen.size === 1) return seen.values().next().value;

  // Several instances match structurally, but exactly one is declared for the
  // requested type itself (`UserId.Eq` for a `UserId`, beside an `Email.Eq`
  // for a class of the same shape): that one is meant.
  const exact = [...seen.values()].filter((m) => m.sameTypeIdentity);
  if (exact.length === 1) return exact[0];

  return {
    kind: "ambiguous",
    typeclassName: tcName,
    forType,
    candidates: [...seen.values()],
  };
}
