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

function getImportMap(ctx: MacroContext): ImportMapEntry[] {
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
  const matches = filterMatches(
    typeChecker,
    scanned,
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
  const baseName = (s: string): string => {
    const m = /^[A-Za-z_$][\w$]*/.exec(s.trim());
    return m ? m[0] : s.trim();
  };
  const match = (inst: ScannedInstance): boolean =>
    inst.typeclassName === tcName && baseName(inst.forTypeString) === typeName;

  // Local file (includes non-exported @impl/@instance values).
  const local = scanner.scanLocalFile(ctx.typeChecker, ctx.sourceFile, ctx.program);
  const localHit = local.find(match);
  if (localHit) return localHit.exportName;

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
    const hit = scanned.find(match);
    if (hit) return hit.exportName;
  }

  return undefined;
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
