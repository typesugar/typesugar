/**
 * Instance Resolver — Scala 3-style typeclass instance resolution.
 *
 * Given a typeclass name and a target type, finds the best instance in scope
 * by searching local declarations, explicit imports, and imported module exports.
 * Matching is type-based (via TypeChecker.isTypeAssignableTo), not string-based.
 *
 * Resolution precedence (highest first):
 * 1. Local scope — @impl-annotated values in the current file
 * 2. Explicit imports — values imported by name
 * 3. Module-level search — scanning all exports of imported modules
 * 4. Registry fallback — the legacy instanceRegistry
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
import { findInstance } from "./typeclass.js";

// ============================================================================
// Types
// ============================================================================

export type ResolutionSource = "local-scope" | "explicit-import" | "module-scan" | "registry";

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

const importMapCache = new Map<string, ImportMapEntry[]>();

function getImportMap(ctx: MacroContext): ImportMapEntry[] {
  const key = ctx.sourceFile.fileName;
  const cached = importMapCache.get(key);
  if (cached) return cached;

  const entries: ImportMapEntry[] = [];
  for (const stmt of ctx.sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;

    const specifier = (stmt.moduleSpecifier as ts.StringLiteral).text;
    const resolved = ts.resolveModuleName(
      specifier,
      ctx.sourceFile.fileName,
      ctx.program.getCompilerOptions(),
      ts.sys
    );
    const resolvedPath = resolved.resolvedModule?.resolvedFileName;
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

  importMapCache.set(key, entries);
  return entries;
}

/** Clear resolver caches. Call on pipeline invalidation. */
export function clearResolverCache(): void {
  importMapCache.clear();
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
 * local scope > explicit imports > module-level search > registry fallback.
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
  const importResult = resolveFromImports(ctx, tcName, forType, forTypeString, scanner);
  if (importResult) return importResult;

  // Stage 4: Registry fallback
  return resolveFromRegistry(ctx, tcName, forType, forTypeString);
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

  const moduleSymbol = typeChecker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) return undefined;

  const scanned = scanner.scanModule(typeChecker, moduleSymbol, sourceFile.fileName);
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

    const scanned = scanner.scanModule(typeChecker, moduleSymbol, entry.resolvedPath);
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

function resolveFromRegistry(
  _ctx: MacroContext,
  tcName: string,
  forType: ts.Type,
  forTypeString: string
): ResolutionResult {
  // Registry fallback: skip scope check — if we got here, scanner-based
  // resolution didn't find anything, so fall back unconditionally
  const info = findInstance(tcName, forTypeString);
  if (!info) return undefined;

  return {
    kind: "resolved",
    typeclassName: tcName,
    forType,
    forTypeString,
    exportName: info.instanceName,
    sourceModule: info.sourceModule || "",
    source: "registry",
  };
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
