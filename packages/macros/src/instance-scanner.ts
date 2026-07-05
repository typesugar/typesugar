/**
 * Instance Scanner — Scala 3-style typeclass instance discovery.
 *
 * Scans a module's exports for typeclass instances by detecting:
 * 1. `@impl("TC<Type>")` JSDoc tags (primary)
 * 2. Explicit type annotations matching `TC<Type>` (secondary fallback)
 *
 * This enables @derive and summon to resolve instances by searching imports
 * rather than relying on a central registry — any package can provide
 * instances that are discovered automatically if imported.
 *
 * @packageDocumentation
 */

import * as ts from "typescript";
import { parseTypeInstantiation, getOrCreateWeak } from "@typesugar/core";

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
  detectedVia: "impl-tag" | "type-annotation" | "derived";
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
      results.push(...this.scanDeclaration(typeChecker, decl, exportName, resolvedPath));
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
            forType: resolveTypeString(typeChecker, parsed.args),
            exportName,
            sourceModule: resolvedPath,
            detectedVia: "impl-tag",
          };
          if (doMeta) callResult.doMeta = doMeta;
          results.push(callResult);
        }
      }
    }

    return results;
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
        forType: resolveTypeString(typeChecker, parsed.args),
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
 * Resolve a type name string (e.g., "number") into a ts.Type.
 * Returns undefined for complex types that can't be resolved without context.
 */
function resolveTypeString(typeChecker: ts.TypeChecker, typeString: string): ts.Type | undefined {
  const trimmed = typeString.trim();
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

/** Default scanner instance for use across the pipeline. */
export const instanceScanner = new InstanceScanner();
