/**
 * Instance Scanner — Scala 3-style typeclass instance discovery.
 *
 * Scans a module's exports for typeclass instances by detecting:
 * 1. `@impl("TC<Type>")` JSDoc tags (primary)
 * 2. Explicit type annotations matching `TC<Type>` (secondary fallback)
 * 3. Call-form initializers: `impl("TC<Type>", {...})`, and
 *    `derived<TC<Type>>()` (a derived instance, declared once)
 * 4. `@derive(TC)` companions (`Type.TC`) of an exported type: from the
 *    type's `@derive` annotation, or, in a `.d.ts`, from the `@impl` tag the
 *    derive puts on each companion member
 *
 * This enables @derive and summon to resolve instances by searching imports
 * rather than relying on a central registry — any package can provide
 * instances that are discovered automatically if imported.
 *
 * @packageDocumentation
 */

import * as ts from "typescript";
import {
  parseTypeInstantiation,
  getOrCreateWeak,
  globalRegistry,
  isJSDocTagAtLineStart,
} from "@typesugar/core";
import { hasGenericDerivation } from "./auto-derive.js";

/**
 * Result of scanning a module export for typeclass instance information.
 */
export interface ScannedInstance {
  /** Typeclass name, e.g. "Ord" */
  typeclassName: string;
  /** The type this instance is for, e.g. "number" — display/diagnostic string */
  forTypeString: string;
  /** The resolved ts.Type for the instance's type parameter, if available */
  forType?: ts.Type;
  /** Export name of the instance variable */
  exportName: string;
  /** Resolved file path of the source module */
  sourceModule: string;
  /** How this instance was detected */
  detectedVia: "impl-tag" | "type-annotation" | "derived" | "derived-call";
  /** Do-notation emission metadata from a `@do-methods` JSDoc tag, if present */
  doMeta?: DoNotationMeta;
}

/**
 * Do-notation emission metadata, declared per instance via a `@do-methods`
 * JSDoc tag next to `@impl`/`@instance` (PEP-052 Wave 3). Replaces the old
 * hardcoded Promise/Effect special cases in the comprehension macros:
 *
 * ```
 * // @impl FlatMap<Promise>
 * // @do-methods bind=then map=then orElse=catch
 *
 * // @impl FlatMap<Effect>
 * // @do-methods bind=flatMap map=map orElse=catchAll style=static receiver=Effect
 * ```
 * (shown as line comments so this doc's own JSDoc is not parsed as tags)
 *
 * Absent tag ⇒ the defaults ({@link DEFAULT_DO_METHODS}): receiver-method
 * calls `.flatMap(...)` / `.map(...)`, which cover Array/Iterable/Option and
 * ordinary user monads.
 */
export interface DoNotationMeta {
  /** Method emitted for a monadic bind step (`x << e`). Default "flatMap". */
  bind: string;
  /** Method emitted for the final mapping step. Default "map". */
  map: string;
  /** Method for error recovery, when the comprehension form uses one. */
  orElse?: string;
  /**
   * Static combinator that joins independent effects for `par:` (e.g. "all"
   * for `Promise.all` / `Effect.all`). Called on {@link receiver}, so setting
   * it requires `receiver=` even for method-style instances (Promise binds
   * via `.then` but joins via static `Promise.all`). When absent, `par:`
   * falls back to a registered AST builder or the generic applicative chain.
   */
  all?: string;
  /**
   * "method" (default): emit receiver calls `fa.bind(f)`.
   * "static": emit `Receiver.bind(fa, f)` — requires {@link receiver}.
   */
  style: "method" | "static";
  /** Static-call receiver identifier (e.g. "Effect") when style is "static". */
  receiver?: string;
  /**
   * Entries the parser did not recognize (unknown keys, malformed pairs,
   * invalid `style=` values). Never affects emission — carried so the
   * consuming macro can WARN at the use site instead of silently defaulting
   * a typo like `style=statik` to method-style emission.
   */
  unrecognized?: string[];
}

/** Defaults applied when an instance carries no `@do-methods` tag. */
export const DEFAULT_DO_METHODS: DoNotationMeta = {
  bind: "flatMap",
  map: "map",
  style: "method",
};

/**
 * Parse a `@do-methods` JSDoc tag's whitespace-separated `key=value` pairs.
 * Unknown keys are ignored (forward-compatible). Returns undefined when the
 * node carries no such tag.
 */
export function parseDoMethodsTag(node: ts.Node): DoNotationMeta | undefined {
  for (const tag of ts.getJSDocTags(node)) {
    if (tag.tagName.text !== "do-methods") continue;
    const comment =
      typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);
    if (!comment) return { ...DEFAULT_DO_METHODS };
    const meta: DoNotationMeta = { ...DEFAULT_DO_METHODS };
    const unrecognized: string[] = [];
    for (const pair of comment.trim().split(/\s+/)) {
      const eq = pair.indexOf("=");
      if (eq <= 0) {
        unrecognized.push(pair);
        continue;
      }
      const key = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (!value) {
        unrecognized.push(pair);
        continue;
      }
      switch (key) {
        case "bind":
          meta.bind = value;
          break;
        case "map":
          meta.map = value;
          break;
        case "orElse":
          meta.orElse = value;
          break;
        case "all":
          meta.all = value;
          break;
        case "style":
          if (value === "method" || value === "static") meta.style = value;
          else unrecognized.push(pair);
          break;
        case "receiver":
          meta.receiver = value;
          break;
        default:
          unrecognized.push(pair);
      }
    }
    if (unrecognized.length > 0) meta.unrecognized = unrecognized;
    return meta;
  }
  return undefined;
}

/**
 * Scans module exports for typeclass instances.
 *
 * Results are cached **per `ts.Program`** (and per resolved module path within a
 * program). Keying by program is essential for correctness, not just perf:
 *   - watch/LSP rebuilds produce a fresh `ts.Program`, so the cache invalidates
 *     automatically when source changes (no stale instances);
 *   - cached `ScannedInstance.forType` holds `ts.Type` objects owned by a specific
 *     program's checker. Partitioning by program guarantees those types are only
 *     ever compared against types from the *same* program — mixing checkers is
 *     unsupported by the TS API and can throw.
 *
 * A program-less fallback partition exists for unit tests that build their own
 * one-off programs; `clearCache()` clears only that fallback.
 */
export class InstanceScanner {
  private cacheByProgram = new WeakMap<ts.Program, Map<string, ScannedInstance[]>>();
  private fallbackCache = new Map<string, ScannedInstance[]>();

  private cacheFor(program?: ts.Program): Map<string, ScannedInstance[]> {
    if (!program) return this.fallbackCache;
    return getOrCreateWeak(this.cacheByProgram, program, () => new Map());
  }

  // ---------------------------------------------------------------------------
  // Synthesized instances (e.g. @derive companions) — PEP-052 same-pass fix
  // ---------------------------------------------------------------------------
  //
  // `scanLocalFile`/`scanModule` read `sourceFile.statements` — the pristine,
  // pre-transform parse tree — and cache the result. A `@derive(Eq)` companion
  // is synthesized by the SAME transform pass and spliced only into the
  // transformer's *output* tree, never into `sourceFile.statements`, so the
  // scan-based path can never see it. Kept as a SEPARATE, un-cached side-table
  // (not merged into `scanLocalFile`'s cached result) because that cache is
  // populated lazily on first query — if a second `@derive`'d class further
  // down the same file registered AFTER the first query already cached a
  // snapshot, a merge-on-scan approach would silently miss it. Querying this
  // table fresh on every resolve call avoids that staleness at negligible cost
  // (a small array lookup, no re-scanning).

  private synthesizedByProgram = new WeakMap<ts.Program, Map<string, ScannedInstance[]>>();

  private synthesizedFor(program: ts.Program): Map<string, ScannedInstance[]> {
    return getOrCreateWeak(this.synthesizedByProgram, program, () => new Map());
  }

  /**
   * Record an instance synthesized during the current transform pass (e.g. a
   * `@derive(Eq)` companion), so same-file operator/method-sugar resolution
   * for a LATER use site can find it. Must be called at the point the
   * companion is generated — before any use site in the same file is visited
   * (true for the common case: a class cannot be referenced before its own
   * declaration in the same scope).
   */
  registerSynthesized(program: ts.Program, fileName: string, instance: ScannedInstance): void {
    const cache = this.synthesizedFor(program);
    const existing = cache.get(fileName);
    if (existing) {
      existing.push(instance);
    } else {
      cache.set(fileName, [instance]);
    }
  }

  /** Instances registered via {@link registerSynthesized} for this file. */
  getSynthesized(program: ts.Program, fileName: string): readonly ScannedInstance[] {
    return this.synthesizedFor(program).get(fileName) ?? [];
  }

  /**
   * Scan a module's exports for typeclass instances.
   *
   * @param typeChecker - The TypeScript type checker
   * @param moduleSymbol - The module's symbol (from typeChecker.getSymbolAtLocation on the module)
   * @param resolvedPath - Resolved file path of the module (used as cache key)
   * @param program - The owning program (cache partition key — pass it in production)
   * @returns Array of discovered instances
   */
  scanModule(
    typeChecker: ts.TypeChecker,
    moduleSymbol: ts.Symbol,
    resolvedPath: string,
    program?: ts.Program
  ): ScannedInstance[] {
    const cache = this.cacheFor(program);
    const cached = cache.get(resolvedPath);
    if (cached) return cached;

    const results: ScannedInstance[] = [];

    let exports: ts.Symbol[];
    try {
      exports = typeChecker.getExportsOfModule(moduleSymbol);
    } catch {
      cache.set(resolvedPath, []);
      return [];
    }

    for (const sym of exports) {
      const instances = this.scanExport(typeChecker, sym, resolvedPath);
      results.push(...instances);
    }

    cache.set(resolvedPath, results);
    return results;
  }

  /**
   * Clear the program-less fallback cache (used by unit tests). Per-program caches
   * are invalidated automatically when their program is collected.
   */
  clearCache(): void {
    this.fallbackCache.clear();
  }

  /**
   * Scan a single exported symbol for instance annotations.
   * Follows re-exports to find the original declaration with JSDoc tags.
   */
  private scanExport(
    typeChecker: ts.TypeChecker,
    sym: ts.Symbol,
    resolvedPath: string
  ): ScannedInstance[] {
    const results: ScannedInstance[] = [];
    const exportName = sym.getName();

    // Follow aliased symbols (re-exports) to their original declarations
    let resolvedSym = sym;
    if (resolvedSym.flags & ts.SymbolFlags.Alias) {
      try {
        resolvedSym = typeChecker.getAliasedSymbol(resolvedSym);
      } catch {
        // Can't resolve alias — use original symbol
      }
    }

    const declarations = resolvedSym.getDeclarations();
    if (!declarations || declarations.length === 0) return results;

    for (const decl of declarations) {
      if (ts.isModuleDeclaration(decl)) {
        results.push(...this.scanNamespaceMembers(typeChecker, decl, exportName, resolvedPath));
      } else if (
        ts.isInterfaceDeclaration(decl) ||
        ts.isClassDeclaration(decl) ||
        ts.isTypeAliasDeclaration(decl)
      ) {
        results.push(
          ...deriveCompanionInstances(typeChecker, resolvedSym, decl, exportName, resolvedPath)
        );
      } else {
        results.push(...this.scanDeclaration(typeChecker, decl, exportName, resolvedPath));
      }
    }

    // A derive companion is found twice in a `.d.ts`: from the type's
    // `@derive` tag and from the companion member's own `@impl` tag.
    const seen = new Set<string>();
    return results.filter((r) => {
      const key = `${r.typeclassName}\0${r.exportName}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Instances declared as members of an exported namespace, reachable as
   * `Ns.member`: chiefly the companions `@derive` generates (`namespace Point
   * { export const Eq = ... }`), which carry an `@impl Eq<Point>` tag so that
   * a library's `.d.ts` says what they are. Only members a consumer can
   * reach: exported ones, or every member of an ambient (`declare`)
   * namespace, as in a `.d.ts`.
   */
  private scanNamespaceMembers(
    typeChecker: ts.TypeChecker,
    decl: ts.ModuleDeclaration,
    exportName: string,
    resolvedPath: string
  ): ScannedInstance[] {
    const body = decl.body;
    if (!body || !ts.isModuleBlock(body)) return [];
    const ambient =
      decl.getSourceFile().isDeclarationFile ||
      (ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Ambient) !== 0;
    const results: ScannedInstance[] = [];
    for (const stmt of body.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      const exported =
        ambient || (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false);
      if (!exported) continue;
      for (const member of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(member.name)) continue;
        results.push(
          ...this.scanDeclaration(
            typeChecker,
            member,
            `${exportName}.${member.name.text}`,
            resolvedPath
          )
        );
      }
    }
    return results;
  }

  /**
   * Extract instance info from a single declaration node (a variable declaration
   * or statement). Shared by the export-based scan ({@link scanExport}) and the
   * local-file scan ({@link scanLocalFile}), so non-exported instances are found
   * identically to exported ones.
   */
  private scanDeclaration(
    typeChecker: ts.TypeChecker,
    decl: ts.Node,
    exportName: string,
    resolvedPath: string
  ): ScannedInstance[] {
    const results: ScannedInstance[] = [];

    // An instance is a value: a variable. A function or class that happens to
    // carry an `@impl` tag is not one — typesugar's own `impl()` declaration
    // has a fenced `/** @impl Eq<Point> */` example in its JSDoc, which
    // `ts.getJSDocTags` reports as a tag, and the name-based fallback in
    // implicit() used to emit a reference to `impl` as an `Eq<Point>`.
    if (!ts.isVariableDeclaration(decl) && !ts.isVariableStatement(decl)) return results;

    // JSDoc attaches to the VariableStatement, not the VariableDeclaration.
    // Walk up if needed.
    const stmtNode =
      ts.isVariableDeclaration(decl) && decl.parent?.parent ? decl.parent.parent : decl;

    const varDecl = ts.isVariableDeclaration(decl)
      ? decl
      : ts.isVariableStatement(decl)
        ? decl.declarationList.declarations[0]
        : undefined;
    const typeResult = varDecl
      ? this.extractFromTypeAnnotation(typeChecker, varDecl, exportName, resolvedPath)
      : null;

    // Strategy 1: @impl/@instance JSDoc tag (takes precedence for the typeclass
    // name). When the tag's type string is a non-primitive whose forType can't be
    // resolved from the string alone (R2), borrow forType from the value's own
    // type annotation (`: Eq<Point>`), which the checker resolves reliably.
    const implResult = this.extractFromImplTag(typeChecker, stmtNode, exportName, resolvedPath);
    const doMeta = parseDoMethodsTag(stmtNode);
    if (implResult) {
      if (doMeta) implResult.doMeta = doMeta;
      // Only borrow forType from the annotation when it describes the SAME
      // typeclass — otherwise `@impl Foo<X>` on `const v: Bar<Y>` would fabricate
      // a `Foo<Y>` instance that was never declared. `forTypeString` is NOT
      // borrowed: it's the tag's own declared type name (e.g. "Point" in
      // `@impl Numeric<Point>`), which name-based scope lookups
      // (`findScannedInScope`'s `baseTypeName(inst.forTypeString) === typeName`
      // match) key on directly — overwriting it with the annotation's often
      // *wider* bound (e.g. `Numeric<any>`) would silently break that match
      // even though the tag unambiguously names "Point".
      if (
        !implResult.forType &&
        typeResult?.forType &&
        typeResult.typeclassName === implResult.typeclassName
      ) {
        implResult.forType = typeResult.forType;
      }
      results.push(implResult);
      return results; // @impl tag takes precedence
    }

    // Strategy 2: Type annotation on variable declaration
    if (typeResult) {
      if (doMeta) typeResult.doMeta = doMeta;
      results.push(typeResult);
      return results;
    }

    // Strategy 3: call-form initializer `const x = impl("TC<T>", {...})` /
    // `instance("TC<T>", ...)`. Before PEP-052 Wave 3 these were made
    // resolvable by the impl() expression macro's registry mirror; the mirror
    // is gone, so the scanner reads the declaration shape directly. Source
    // files only — in emitted `.d.ts` the call is erased, so PUBLISHED
    // call-form instances remain invisible (the documented authoring form is
    // the `@impl` JSDoc tag, which survives declaration emit).
    if (varDecl?.initializer && ts.isCallExpression(varDecl.initializer)) {
      const call = varDecl.initializer;
      if (
        ts.isIdentifier(call.expression) &&
        (call.expression.text === "impl" || call.expression.text === "instance") &&
        call.arguments.length >= 1 &&
        ts.isStringLiteralLike(call.arguments[0])
      ) {
        const parsed = parseTypeInstantiation(call.arguments[0].text);
        if (parsed) {
          const callResult: ScannedInstance = {
            typeclassName: parsed.base,
            forTypeString: parsed.args,
            forType: resolveTypeString(typeChecker, parsed.args, stmtNode),
            exportName,
            sourceModule: resolvedPath,
            detectedVia: "impl-tag",
          };
          if (doMeta) callResult.doMeta = doMeta;
          results.push(callResult);
        }
      }
    }

    // Strategy 4: `const x = derived<TC<T>>()` declares a derived instance;
    // the initializer says what it is, so no @impl tag is needed. In emitted
    // `.d.ts` it is `x: TC<T>`, which Strategy 2 finds. Shape (CLAUDE.md
    // "Resolving things a macro just generated"): this reads the source as
    // written, and that is enough here — the declaration and its
    // `derived<...>()` initializer are in the source before the pass starts;
    // only the initializer's expansion is generated mid-pass, and nothing
    // here depends on it.
    if (results.length === 0 && varDecl) {
      const derivedResult = this.extractFromDerivedCall(
        typeChecker,
        varDecl,
        exportName,
        resolvedPath
      );
      if (derivedResult) results.push(derivedResult);
    }

    return results;
  }

  /**
   * `const x = derived<TC<T>>()`, where `derived` is imported from typesugar
   * (`typesugar` or an `@typesugar/*` package, possibly renamed).
   */
  private extractFromDerivedCall(
    typeChecker: ts.TypeChecker,
    decl: ts.VariableDeclaration,
    exportName: string,
    resolvedPath: string
  ): ScannedInstance | null {
    let init = decl.initializer;
    while (init && ts.isParenthesizedExpression(init)) init = init.expression;
    if (!init || !ts.isCallExpression(init) || !ts.isIdentifier(init.expression)) return null;
    if (!(decl.parent.flags & ts.NodeFlags.Const)) return null;
    if (!importsDerivedAs(decl.getSourceFile(), init.expression.text)) return null;
    const typeArg = init.typeArguments?.length === 1 ? init.typeArguments[0] : undefined;
    if (
      !typeArg ||
      !ts.isTypeReferenceNode(typeArg) ||
      !ts.isIdentifier(typeArg.typeName) ||
      typeArg.typeArguments?.length !== 1
    ) {
      return null;
    }
    let forType: ts.Type | undefined;
    let forTypeString: string;
    try {
      forType = typeChecker.getTypeFromTypeNode(typeArg.typeArguments[0]);
      forTypeString = typeChecker.typeToString(forType);
    } catch {
      forTypeString = typeArg.typeArguments[0].getText();
    }
    return {
      typeclassName: typeArg.typeName.text,
      forTypeString,
      forType,
      exportName,
      sourceModule: resolvedPath,
      detectedVia: "derived-call",
    };
  }

  /**
   * Scan a source file's TOP-LEVEL declarations for typeclass instances,
   * including **non-exported** ones. This is the local-scope path (PEP-052): a
   * `@impl`/`@instance` const declared in the using file is in scope for that
   * file whether or not it is exported, and must be discoverable without the
   * global registry. Order-independent (scans the whole file).
   *
   * Cached per program, under a `::local` cache-key suffix to avoid collisions
   * with the exports-only {@link scanModule} scan of the same path.
   */
  scanLocalFile(
    typeChecker: ts.TypeChecker,
    sourceFile: ts.SourceFile,
    program?: ts.Program
  ): ScannedInstance[] {
    const cache = this.cacheFor(program);
    const cacheKey = sourceFile.fileName + "::local";
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const results: ScannedInstance[] = [];
    for (const stmt of sourceFile.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      for (const declaration of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        results.push(
          ...this.scanDeclaration(
            typeChecker,
            declaration,
            declaration.name.text,
            sourceFile.fileName
          )
        );
      }
    }

    cache.set(cacheKey, results);
    return results;
  }

  /**
   * Extract instance info from an @impl or @instance JSDoc tag.
   */
  private extractFromImplTag(
    typeChecker: ts.TypeChecker,
    node: ts.Node,
    exportName: string,
    resolvedPath: string
  ): ScannedInstance | null {
    const tags = ts.getJSDocTags(node);
    for (const tag of tags) {
      const tagName = tag.tagName.text;
      if (tagName !== "impl" && tagName !== "instance") continue;
      // A tag in prose or a fenced example is not this declaration's tag.
      if (!isJSDocTagAtLineStart(tag)) continue;

      const comment =
        typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);
      if (!comment) continue;

      // Strip surrounding quotes: @impl("Ord<number>") → Ord<number>
      const text = comment.replace(/^["'()\s]+|["'()\s]+$/g, "").trim();
      const parsed = parseTypeInstantiation(text);
      if (!parsed) continue;

      return {
        typeclassName: parsed.base,
        forTypeString: parsed.args,
        forType: resolveTypeString(typeChecker, parsed.args, node),
        exportName,
        sourceModule: resolvedPath,
        detectedVia: "impl-tag",
      };
    }
    return null;
  }

  /**
   * Extract instance info from an explicit type annotation like `: Ord<number>`.
   */
  private extractFromTypeAnnotation(
    typeChecker: ts.TypeChecker,
    decl: ts.VariableDeclaration,
    exportName: string,
    resolvedPath: string
  ): ScannedInstance | null {
    if (!decl.type) return null;

    const typeNode = decl.type;
    if (!ts.isTypeReferenceNode(typeNode)) return null;

    const typeName = typeNode.typeName;
    if (!ts.isIdentifier(typeName)) return null;

    const typeArgs = typeNode.typeArguments;
    if (!typeArgs || typeArgs.length !== 1) return null;

    const tcName = typeName.text;
    // Must look like a typeclass name (PascalCase)
    if (!/^[A-Z][a-zA-Z0-9]*$/.test(tcName)) return null;

    let resolvedType: ts.Type | undefined;
    let forTypeStr: string;
    try {
      resolvedType = typeChecker.getTypeFromTypeNode(typeArgs[0]);
      forTypeStr = typeChecker.typeToString(resolvedType);
    } catch {
      forTypeStr = typeArgs[0].getText();
    }

    return {
      typeclassName: tcName,
      forTypeString: forTypeStr,
      forType: resolvedType,
      exportName,
      sourceModule: resolvedPath,
      detectedVia: "type-annotation",
    };
  }
}

/**
 * The companions `@derive` gives an exported type, as instances:
 * `/** @derive(Eq) *\/ export interface Point` has `Point.Eq`, an `Eq<Point>`.
 *
 * - In a `.d.ts` (a published library), the companion is a member of the
 *   type's merged namespace. Only a member that is really there counts: the
 *   tag says which typeclasses, the declaration file says what exists (a
 *   derive that failed, or one that emits something other than a companion,
 *   has no member). The member's own `@impl` tag finds it too (the decorator
 *   form leaves no `@derive` in a `.d.ts`); {@link InstanceScanner.scanExport}
 *   drops the duplicate.
 * - In source, the companion does not exist yet: it is generated when the
 *   declaring file is transformed, which may be before or after the file
 *   asking. Registry shape (CLAUDE.md "Resolving things a macro just
 *   generated"): this reads the source as written, which is enough, because
 *   the `@derive` annotation is in the source before any pass starts and the
 *   companion's name and type follow from it (`Type.TC`, for the type
 *   itself). Only derives that generate a companion count: a typeclass with
 *   a GenericDerivation and no derive macro of the same name (the order
 *   expandDeriveDecorator tries them in).
 *
 * The instance's type is the declared type of the type's own symbol (by
 * identity, CLAUDE.md "Deciding what a type is"), never a type looked up by
 * the tag's text.
 */
function deriveCompanionInstances(
  typeChecker: ts.TypeChecker,
  typeSymbol: ts.Symbol,
  decl: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
  exportName: string,
  resolvedPath: string
): ScannedInstance[] {
  const names = deriveNamesOf(decl);
  if (names.length === 0) return [];
  const inDeclarationFile = decl.getSourceFile().isDeclarationFile;
  let forType: ts.Type | undefined;
  try {
    forType = typeChecker.getDeclaredTypeOfSymbol(typeSymbol);
  } catch {
    return [];
  }
  const results: ScannedInstance[] = [];
  for (const tc of new Set(names)) {
    if (inDeclarationFile) {
      const member = typeSymbol.exports?.get(ts.escapeLeadingUnderscores(tc));
      if (!member || !(member.flags & ts.SymbolFlags.Value)) continue;
    } else if (!hasGenericDerivation(tc) || globalRegistry.getDerive(tc)) {
      continue;
    }
    results.push({
      typeclassName: tc,
      forTypeString: decl.name?.text ?? exportName,
      forType,
      exportName: `${exportName}.${tc}`,
      sourceModule: resolvedPath,
      detectedVia: "derived",
    });
  }
  return results;
}

/**
 * The typeclass names a type declaration derives, from either form:
 * `@derive(Eq, Clone)` as a decorator, or a `/** @derive(Eq, Clone) *\/` /
 * `@derive Eq, Clone` / `@deriving ...` JSDoc tag. Tags in prose or fenced
 * examples don't count. Reading the names is syntax (which typeclasses the
 * annotation names), not a decision about what a type is.
 */
export function deriveNamesOf(decl: ts.Node): string[] {
  const names: string[] = [];
  if (ts.canHaveDecorators(decl)) {
    for (const dec of ts.getDecorators(decl) ?? []) {
      const e = dec.expression;
      if (
        ts.isCallExpression(e) &&
        ts.isIdentifier(e.expression) &&
        (e.expression.text === "derive" || e.expression.text === "deriving")
      ) {
        for (const arg of e.arguments) if (ts.isIdentifier(arg)) names.push(arg.text);
      }
    }
  }
  for (const tag of ts.getJSDocTags(decl)) {
    const tagName = tag.tagName.text;
    if (tagName !== "derive" && tagName !== "deriving") continue;
    if (!isJSDocTagAtLineStart(tag)) continue;
    const comment =
      typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);
    const trimmed = comment?.trim() ?? "";
    const close = trimmed.indexOf(")");
    const inner = trimmed.startsWith("(")
      ? trimmed.slice(1, close === -1 ? undefined : close)
      : trimmed;
    for (const part of inner.split(",")) {
      const name = part.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
    }
  }
  return names;
}

/** Does `sf` import typesugar's `derived` under the local name `local`? */
function importsDerivedAs(sf: ts.SourceFile, local: string): boolean {
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const spec = stmt.moduleSpecifier.text;
    if (spec !== "typesugar" && !spec.startsWith("@typesugar/")) continue;
    const nb = stmt.importClause?.namedBindings;
    if (!nb || !ts.isNamedImports(nb) || stmt.importClause!.isTypeOnly) continue;
    for (const el of nb.elements) {
      if (el.name.text === local && (el.propertyName ?? el.name).text === "derived") return true;
    }
  }
  return false;
}

// ============================================================================
// Type Resolution Helper
// ============================================================================

/**
 * Every primitive keyword type string this scanner resolves, with the
 * `SyntaxKind` for the synthetic-node fallback AND the `ts.TypeChecker`
 * internal getter name for the fast/safe path — one row per keyword, so a
 * keyword lacking a getter (an omission, not a deliberate gap: every keyword
 * below has one) is visible at a glance rather than split across two tables
 * that must be kept in sync by hand (PEP-052 Wave 5 review fix — the first
 * cut's split `KEYWORD_MAP`/`intrinsicGetters` tables let `object` silently
 * fall through to the unsafe fallback for a full review round before being
 * noticed).
 */
const KEYWORD_TYPES: Record<string, { kind: ts.SyntaxKind; getter: string }> = {
  number: { kind: ts.SyntaxKind.NumberKeyword, getter: "getNumberType" },
  string: { kind: ts.SyntaxKind.StringKeyword, getter: "getStringType" },
  boolean: { kind: ts.SyntaxKind.BooleanKeyword, getter: "getBooleanType" },
  bigint: { kind: ts.SyntaxKind.BigIntKeyword, getter: "getBigIntType" },
  symbol: { kind: ts.SyntaxKind.SymbolKeyword, getter: "getESSymbolType" },
  undefined: { kind: ts.SyntaxKind.UndefinedKeyword, getter: "getUndefinedType" },
  null: { kind: ts.SyntaxKind.NullKeyword, getter: "getNullType" },
  void: { kind: ts.SyntaxKind.VoidKeyword, getter: "getVoidType" },
  never: { kind: ts.SyntaxKind.NeverKeyword, getter: "getNeverType" },
  any: { kind: ts.SyntaxKind.AnyKeyword, getter: "getAnyType" },
  unknown: { kind: ts.SyntaxKind.UnknownKeyword, getter: "getUnknownType" },
  object: { kind: ts.SyntaxKind.ObjectKeyword, getter: "getNonPrimitiveType" },
};

/**
 * Resolve a type name string (e.g., "number", "Point") into a ts.Type.
 *
 * Keywords resolve directly. A plain identifier (`Point` in
 * `/** @impl Show<Point> *\/`) is resolved in the scope of `location` — the
 * instance's own declaration — so an `@impl`-tagged value WITHOUT a
 * `: Show<Point>` annotation is still matchable by type (previously its
 * `forType` stayed undefined and summon/implicits/operators/method sugar
 * could never find it). Anything more complex (`Pair<number, string>`,
 * `number[]`, unions) returns undefined; the scanner then borrows the
 * value's type annotation when it names the same typeclass.
 */
function resolveTypeString(
  typeChecker: ts.TypeChecker,
  typeString: string,
  location?: ts.Node
): ts.Type | undefined {
  const trimmed = typeString.trim();
  if (!KEYWORD_TYPES[trimmed] && location && /^[A-Za-z_$][\w$]*$/.test(trimmed)) {
    return resolveTypeNameInScope(typeChecker, trimmed, location);
  }
  const entry = KEYWORD_TYPES[trimmed];
  if (entry) {
    // Prefer the TypeChecker's internal intrinsic type getter: synthetic
    // keyword nodes created via ts.factory aren't bound to a source file and
    // may resolve to `any` with some TypeChecker instances (see the guard
    // below).
    const tc = typeChecker as any;
    if (typeof tc[entry.getter] === "function") {
      try {
        return tc[entry.getter]();
      } catch {
        /* fall through */
      }
    }
    // Fallback: try synthetic node (works in some TS host configurations).
    // GUARD (found via `symbol`/`unknown`/`object` all silently resolving to
    // `any` on an unbound synthetic node before the intrinsic getters above
    // were added): `any` is bidirectionally assignable to/from every type, so
    // a keyword that isn't itself `any` resolving to `any` here would make
    // `isTypeMatch` treat this instance as matching ANY other instance's
    // type — a false "ambiguous instance" report between unrelated types
    // (e.g. `Show<symbol>` masquerading as a second `Show<number>`). Prefer
    // "can't resolve this type string" (undefined) over a silently-wrong
    // match.
    try {
      const node = ts.factory.createKeywordTypeNode(entry.kind as ts.KeywordTypeSyntaxKind);
      const resolved = typeChecker.getTypeFromTypeNode(node);
      if (entry.kind !== ts.SyntaxKind.AnyKeyword && resolved.flags & ts.TypeFlags.Any) {
        return undefined;
      }
      return resolved;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Resolve a plain type name as seen from `location`'s file: a top-level
 * interface/type alias/class/enum declared there, a named/default import
 * bound to that name, or (last) any type symbol in scope (globals). Uses only
 * real source nodes — the scanner only ever runs over pre-transform source.
 */
function resolveTypeNameInScope(
  typeChecker: ts.TypeChecker,
  name: string,
  location: ts.Node
): ts.Type | undefined {
  const sourceFile = location.getSourceFile();
  if (!sourceFile) return undefined;
  const declaredTypeOf = (nameNode: ts.Identifier): ts.Type | undefined => {
    try {
      let sym = typeChecker.getSymbolAtLocation(nameNode);
      if (sym && sym.flags & ts.SymbolFlags.Alias) sym = typeChecker.getAliasedSymbol(sym);
      if (!sym || !(sym.flags & ts.SymbolFlags.Type)) return undefined;
      return typeChecker.getDeclaredTypeOfSymbol(sym);
    } catch {
      return undefined;
    }
  };
  for (const stmt of sourceFile.statements) {
    if (
      (ts.isInterfaceDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt)) &&
      stmt.name?.text === name
    ) {
      return declaredTypeOf(stmt.name);
    }
    if (ts.isImportDeclaration(stmt) && stmt.importClause) {
      const clause = stmt.importClause;
      if (clause.name?.text === name) return declaredTypeOf(clause.name);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          if (el.name.text === name) return declaredTypeOf(el.name);
        }
      }
    }
  }
  try {
    const sym = typeChecker
      .getSymbolsInScope(location, ts.SymbolFlags.Type)
      .find((s) => s.name === name);
    return sym ? typeChecker.getDeclaredTypeOfSymbol(sym) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Default scanner instance for use across the pipeline.
 *
 * Stored on globalThis (like `globalRegistry` in @typesugar/core) so the ESM
 * and CJS copies of @typesugar/macros share ONE scanner. The transformer
 * (ESM) registers same-pass `@derive` companions via `registerSynthesized`,
 * while macro packages loaded through the CJS macro loader (e.g.
 * @typesugar/erased) resolve through their own copy of this module; with a
 * per-copy scanner they never saw those companions (docs review 2026-10:
 * `erased<[Show, Eq]>(p)` after `@derive(Show, Eq)` reported both missing).
 */
const INSTANCE_SCANNER_KEY = "__typesugar_instanceScanner__";
export const instanceScanner: InstanceScanner =
  ((globalThis as Record<string, unknown>)[INSTANCE_SCANNER_KEY] as InstanceScanner | undefined) ??
  ((globalThis as Record<string, unknown>)[INSTANCE_SCANNER_KEY] = new InstanceScanner());
