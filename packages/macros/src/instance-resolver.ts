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
 *
 * Resolution is purely scope-based — there is no process-global registry
 * fallback (PEP-052): a file's behavior depends only on its own imports and the
 * instances visible in their modules.
 *
 * @packageDocumentation
 */

import * as ts from "typescript";
import type { MacroContext } from "@typesugar/core";
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

interface ImportMapEntry {
  specifier: string;
  resolvedPath: string;
  namedImports: string[];
}

// Keyed per program (and per file within a program) so watch/LSP rebuilds — which
// produce a fresh program — invalidate automatically and never serve a stale map
// for an edited file.
const importMapCache = new WeakMap<ts.Program, Map<string, ImportMapEntry[]>>();

function importMapCacheFor(program: ts.Program): Map<string, ImportMapEntry[]> {
  let m = importMapCache.get(program);
  if (!m) {
    m = new Map();
    importMapCache.set(program, m);
  }
  return m;
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

    const namedImports: string[] = [];
    const clause = stmt.importClause;
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        namedImports.push(el.name.text);
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
 * a WeakMap, so it is now a no-op kept for API compatibility).
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

  // Bidirectional assignability = exact match (handles aliases like `type MyNum = number`)
  return (
    typeChecker.isTypeAssignableTo(fieldType, candidateType) &&
    typeChecker.isTypeAssignableTo(candidateType, fieldType)
  );
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
 */
export function resolveInstance(
  ctx: MacroContext,
  tcName: string,
  forType: ts.Type,
  scanner: InstanceScanner = defaultScanner
): ResolutionResult {
  const typeChecker = ctx.typeChecker;
  const forTypeString = typeChecker.typeToString(forType);

  // Stage 1: Local scope
  const localResult = resolveFromLocalScope(ctx, tcName, forType, forTypeString, scanner);
  if (localResult) return localResult;

  // Stage 2 & 3: Imports (explicit and module-level)
  return resolveFromImports(ctx, tcName, forType, forTypeString, scanner);
}

function resolveFromLocalScope(
  ctx: MacroContext,
  tcName: string,
  forType: ts.Type,
  forTypeString: string,
  scanner: InstanceScanner
): ResolutionResult {
  const typeChecker = ctx.typeChecker;
  const sourceFile = ctx.sourceFile;

  // Scan the file's top-level declarations directly (not just module exports), so
  // a `@impl`/`@instance` const that is in local scope but NOT exported is still
  // found — and found independent of declaration order. This is the registry-free
  // replacement for instances the global registry used to provide.
  const scanned = scanner.scanLocalFile(typeChecker, sourceFile, ctx.program);
  // Also check instances synthesized during THIS transform pass (e.g. a
  // `@derive(Eq)` companion) — invisible to the scan above, since that reads
  // the pre-transform source text and the companion doesn't exist there yet.
  const synthesized = scanner.getSynthesized(ctx.program, sourceFile.fileName);
  const matches = filterMatches(
    typeChecker,
    synthesized.length > 0 ? [...scanned, ...synthesized] : scanned,
    tcName,
    forType,
    forTypeString,
    sourceFile.fileName,
    "local-scope"
  );

  return pickResult(matches, tcName, forType);
}

function resolveFromImports(
  ctx: MacroContext,
  tcName: string,
  forType: ts.Type,
  forTypeString: string,
  scanner: InstanceScanner
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

    const scanned = scanner.scanModule(typeChecker, moduleSymbol, entry.resolvedPath, ctx.program);
    const allMatches = filterMatches(
      typeChecker,
      scanned,
      tcName,
      forType,
      forTypeString,
      entry.resolvedPath,
      "module-scan",
      entry.specifier
    );

    for (const match of allMatches) {
      if (entry.namedImports.includes(match.exportName)) {
        explicitMatches.push({ ...match, source: "explicit-import" });
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
  importSpecifier?: string
): ResolvedInstance[] {
  const results: ResolvedInstance[] = [];

  for (const inst of scanned) {
    if (inst.typeclassName !== tcName) continue;

    // Type-based matching: use ts.Type directly from scanner
    if (!isTypeMatch(typeChecker, forType, inst.forType)) continue;

    results.push({
      kind: "resolved",
      typeclassName: tcName,
      forType,
      forTypeString,
      exportName: inst.exportName,
      sourceModule,
      source,
      importSpecifier,
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
 * Like {@link resolveInstanceInScopeByName}, but also reports WHERE the instance
 * lives: `modulePath` is the resolved file path for an imported instance, or
 * undefined when it was found in the local file. Source-based specialization
 * uses this to walk from a companion path (`Point.Numeric`) back to the
 * generating instance declaration (PEP-053 Wave 2 gap 6) — passing
 * `includeNonExportedImports: true`, since the underlying instance need not
 * itself be exported for the companion path to be valid, ordinary TypeScript.
 */
export function findInstanceInScopeByName(
  ctx: Pick<MacroContext, "typeChecker" | "program" | "sourceFile">,
  tcName: string,
  typeName: string,
  scanner: InstanceScanner = defaultScanner,
  includeNonExportedImports = false
): { exportName: string; modulePath?: string } | undefined {
  const match = (inst: ScannedInstance): boolean =>
    inst.typeclassName === tcName && baseTypeName(inst.forTypeString) === typeName;
  const hit = findScannedInScope(ctx, match, scanner, includeNonExportedImports);
  return hit ? { exportName: hit.instance.exportName, modulePath: hit.modulePath } : undefined;
}

/** First identifier of a type string: `"Ord<number>"`-style args → `Ord`. */
function baseTypeName(s: string): string {
  const m = /^[A-Za-z_$][\w$]*/.exec(s.trim());
  return m ? m[0] : s.trim();
}

/**
 * Shared scope walk: local file (incl. non-exported `@impl` values) first,
 * then every imported module (re-exports followed by the scanner). Returns
 * the first scanned instance satisfying `match`.
 *
 * `includeNonExportedImports` additionally scans each imported module's
 * non-exported top-level declarations (via `scanLocalFile`, which is already
 * sourceFile-agnostic) when the exports-only scan misses. Opt-in and off by
 * default: `resolveInstanceInScopeByName` (the `@derive` transitive-derivation
 * "does this type already have an instance" check) and do-notation resolution
 * both rely on the existing exports-only semantics for imported modules, so
 * widening visibility there would be an unrelated behavior change. Only
 * `findInstanceInScopeByName`'s companion-path caller
 * (`resolveCompanionInstanceExpression`) opts in: `Point.Numeric` is ordinary,
 * valid TypeScript reachable from any importer regardless of whether the
 * underlying `numericPoint` const is itself exported, so the value it
 * resolves to must be discoverable the same way a same-file non-exported
 * instance already is (PEP-053 Wave 2 gap 6).
 */
function findScannedInScope(
  ctx: Pick<MacroContext, "typeChecker" | "program" | "sourceFile">,
  match: (inst: ScannedInstance) => boolean,
  scanner: InstanceScanner = defaultScanner,
  includeNonExportedImports = false
): { instance: ScannedInstance; modulePath?: string } | undefined {
  // Local file (includes non-exported @impl/@instance values). Also check
  // instances synthesized during THIS transform pass (e.g. a `@derive(Eq)`
  // companion) — invisible to the scan above, since that reads the
  // pre-transform source text and the companion doesn't exist there yet.
  // See "same-pass state visibility" in CLAUDE.md: a scan of
  // sourceFile.statements is fixed at pass start and can never see what the
  // pass itself is in the middle of generating.
  const local = scanner.scanLocalFile(ctx.typeChecker, ctx.sourceFile, ctx.program);
  const synthesized = scanner.getSynthesized(ctx.program, ctx.sourceFile.fileName);
  const localHit = local.find(match) ?? synthesized.find(match);
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
    let hit = scanned.find(match);
    if (!hit && includeNonExportedImports) {
      hit = scanner
        .scanLocalFile(ctx.typeChecker, moduleSourceFile, ctx.program)
        .find(match);
    }
    if (hit) return { instance: hit, modulePath: entry.resolvedPath };
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
  ctx: Pick<MacroContext, "typeChecker" | "program" | "sourceFile">,
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
  ctx: Pick<MacroContext, "typeChecker" | "program" | "sourceFile">,
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

  // Deduplicate by exportName — same instance from different paths
  const seen = new Map<string, ResolvedInstance>();
  for (const m of matches) {
    if (!seen.has(m.exportName)) {
      seen.set(m.exportName, m);
    }
  }
  if (seen.size === 1) return seen.values().next().value;

  return {
    kind: "ambiguous",
    typeclassName: tcName,
    forType,
    candidates: matches,
  };
}
