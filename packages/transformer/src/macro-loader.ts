/**
 * Lazy Macro Package Loader
 *
 * Scans a ts.Program's import graph to discover which macro packages are
 * needed, then loads them on demand via sync require(). This replaces
 * eager side-effect imports that previously caused dependency cycles.
 *
 * Local macros (inside @typesugar/macros) still use eager side-effect
 * registration — they're internal and don't create cross-package cycles.
 * External macro packages (@typesugar/mapper, @typesugar/contracts, and
 * future third-party packages) are loaded here.
 */

import { createRequire } from "module";
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import { globalRegistry, config, type MacroDefinition } from "@typesugar/core";

const _require = createRequire(import.meta.url);

/**
 * Override for `_require`, used only by tests to point resolution at a
 * temp fixture directory instead of the real `node_modules`. See
 * `resetLoadedPackages`.
 */
let _requireOverride: NodeRequire | undefined;

/**
 * Set (or clear, via `undefined`) the `NodeRequire` used for manifest-based
 * package.json/module resolution. For testing only.
 */
export function __setRequireForTesting(req: NodeRequire | undefined): void {
  _requireOverride = req;
}

function getRequire(): NodeRequire {
  return _requireOverride ?? _require;
}

/**
 * Tracks which packages have already been loaded in this process.
 * Prevents redundant require() calls across multiple transformer
 * factory invocations (e.g., in watch mode).
 */
const loadedPackages = new Set<string>();

/**
 * Thrown when the manifest-based discovery scan (PEP-055) finds a package
 * that declares `typesugar.macros` in its package.json but isn't
 * `@typesugar/*`-scoped and isn't listed in `security.allowedMacroPackages`.
 * Callers (the CLI) should catch this and point the user at
 * `typesugar approve-macros` rather than surfacing a raw stack trace.
 */
export class UnapprovedMacroPackagesError extends Error {
  constructor(public readonly packages: string[]) {
    super(
      `The following package(s) declare a "typesugar.macros" entry but are not ` +
        `@typesugar/*-scoped and have not been approved:\n` +
        packages.map((p) => `  - ${p}`).join("\n") +
        `\n\nRun \`typesugar approve-macros\` to review and approve them.`
    );
    this.name = "UnapprovedMacroPackagesError";
  }
}

// ============================================================================
// Manifest-based discovery (PEP-055)
//
// A package is a macro provider if (and only if) it declares a
// `typesugar.macros` field in its own package.json. Replaces the old
// KNOWN_MACRO_PACKAGES/FACADE_TO_PROVIDER hardcoded lists and the
// @typesugar/*-prefix speculative-load fallback (deleted in Phase C/Wave 3
// — see peps/PEP-055-macro-package-discovery.md for the full design and
// migration history). @typesugar/* packages (and the unscoped `typesugar`
// facade — see AUTO_TRUSTED_UNSCOPED_PACKAGES) are auto-trusted; anything
// else must be listed in `security.allowedMacroPackages` (exact name or
// "@scope/*" wildcard) or the scan reports it as blocked and the caller
// fails the build via UnapprovedMacroPackagesError.
// ============================================================================

interface ManifestFieldInfo {
  /** Resolved specifier to require() — may differ from `pkg` itself for
   *  relative (`./macros` → `${pkg}/macros`) and facade cross-package
   *  (`@typesugar/macros/macros`) manifest values. */
  target: string;
}

/**
 * Memoizes package.json reads (I/O-bound, and the field itself is
 * immutable for a given install) per package name for this process.
 * Deliberately does NOT cache the trust decision — that depends on
 * `security.allowedMacroPackages`, which is mutable process-wide config
 * state (`config.set(...)` is a public API), so it's recomputed on every
 * call. Cleared by `resetLoadedPackages` (testing only).
 */
const manifestFieldCache = new Map<string, ManifestFieldInfo | null>();

/**
 * Resolve and parse a package's own package.json, given its base specifier.
 * Tries the direct `${pkg}/package.json` subpath first (works whenever the
 * package's `exports` map exposes it, or has no `exports` map at all); falls
 * back to resolving the package's main entry point and walking up parent
 * directories for the nearest package.json whose own "name" field matches
 * `pkg` (guards against a restrictive `exports` map that hides
 * `package.json` from `require.resolve`).
 */
function resolvePackageJson(
  pkg: string,
  req: NodeRequire
): { data: Record<string, unknown>; dir: string } | undefined {
  try {
    const pkgJsonPath = req.resolve(`${pkg}/package.json`);
    const data = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as Record<string, unknown>;
    return { data, dir: path.dirname(pkgJsonPath) };
  } catch {
    // Package restricts its `exports` map (or has no direct subpath) —
    // fall through to the walk-up strategy below.
  }

  try {
    const entry = req.resolve(pkg);
    let dir = path.dirname(entry);
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(dir, "package.json");
      if (fs.existsSync(candidate)) {
        try {
          const data = JSON.parse(fs.readFileSync(candidate, "utf-8")) as Record<string, unknown>;
          if (data.name === pkg) {
            return { data, dir };
          }
        } catch {
          return undefined;
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // Package itself isn't resolvable — same "silently contributes
    // nothing" behavior as the rest of this loader.
  }

  return undefined;
}

/**
 * Resolve a `typesugar.macros` manifest value to a require()-able specifier.
 * `"."` → `pkg` itself (the package's own root entry — the convention a
 * package whose macros live at its package root, not a dedicated `./macros`
 * subpath, uses; e.g. `@typesugar/macros`, matching Node/npm's own `"."`
 * convention for "package root" in an `exports` map). `"./macros"` →
 * `"${pkg}/macros"` (relative to the declaring package's own root, through
 * its own exports map). A bare specifier with no leading dot is a facade
 * cross-package reference (e.g. `"@typesugar/macros"`, `"@typesugar/macros/macros"`)
 * and is used as-is. Anything starting with `".."` is rejected — there's no
 * legitimate case for a manifest pointing outside its own package.
 */
function resolveManifestTarget(pkg: string, field: string): string | undefined {
  if (field === ".") return pkg;
  if (field.startsWith("..")) return undefined;
  if (field.startsWith("./")) return `${pkg}/${field.slice(2)}`;
  if (field.startsWith(".")) return undefined;
  return field;
}

/**
 * Packages auto-trusted alongside the `@typesugar/*` scope despite not
 * being scoped themselves — today just the bare `typesugar` facade
 * package (published unscoped on npm), which is exactly as first-party as
 * `@typesugar/std` and was already unconditionally trusted under the old
 * `FACADE_TO_PROVIDER` list.
 */
const AUTO_TRUSTED_UNSCOPED_PACKAGES = new Set(["typesugar"]);

/**
 * Check whether `pkg` is allowed to register macros outside the
 * auto-trusted `@typesugar/*` scope, per `security.allowedMacroPackages`
 * (exact names, or `"@scope/*"` wildcard entries).
 */
function isTrusted(pkg: string): boolean {
  if (pkg.startsWith("@typesugar/") || AUTO_TRUSTED_UNSCOPED_PACKAGES.has(pkg)) return true;

  const allowed = config.get<string[]>("security.allowedMacroPackages") ?? [];
  for (const entry of allowed) {
    if (entry === pkg) return true;
    if (entry.endsWith("/*") && pkg.startsWith(entry.slice(0, -1))) return true;
  }
  return false;
}

/**
 * Resolve a single package's manifest field, if any. Never calls require()
 * — pure discovery, safe to call from `approve-macros`'s dry-run scan as
 * well as the real loader. Result is memoized (see `manifestFieldCache`);
 * trust is deliberately NOT part of what's cached here.
 */
function resolveManifestField(pkg: string): ManifestFieldInfo | null {
  if (manifestFieldCache.has(pkg)) {
    return manifestFieldCache.get(pkg) ?? null;
  }

  let result: ManifestFieldInfo | null = null;
  const resolved = resolvePackageJson(pkg, getRequire());
  if (resolved) {
    const typesugarField = resolved.data.typesugar as { macros?: unknown } | undefined;
    const macrosField = typesugarField?.macros;
    if (typeof macrosField === "string") {
      const target = resolveManifestTarget(pkg, macrosField);
      if (target) {
        result = { target };
      }
    }
  }

  manifestFieldCache.set(pkg, result);
  return result;
}

/**
 * Classify a set of candidate base package names against the manifest
 * discovery mechanism. Returns packages to load (mapped to their resolved
 * target specifier) and packages that declared the field but aren't
 * trusted/approved. Trust is re-checked against the CURRENT
 * `security.allowedMacroPackages` on every call.
 */
export function classifyManifestPackages(candidates: Iterable<string>): {
  toLoad: Map<string, string>;
  blocked: string[];
} {
  const toLoad = new Map<string, string>();
  const blocked: string[] = [];

  for (const pkg of candidates) {
    const field = resolveManifestField(pkg);
    if (!field) continue;
    if (isTrusted(pkg)) {
      toLoad.set(pkg, field.target);
    } else {
      blocked.push(pkg);
    }
  }

  return { toLoad, blocked };
}

/**
 * Discover and load macro packages from a set of candidate base package
 * names (drawn from a program's or a single file's imports). Shared by
 * `loadMacroPackages`/`loadMacroPackagesFromFile` so the "always load
 * @typesugar/std first" ordering guarantee and the discovery mechanism
 * itself stay in one place.
 *
 * `hasTypesugarImport` is computed from the RAW candidate set, not the
 * (possibly narrower) set of packages that actually declare a
 * `typesugar.macros` field — preserving std's "load first for any
 * @typesugar/* import" guarantee even for @typesugar/* packages that carry
 * no macros of their own (e.g. a pure runtime library), matching the old
 * prefix-fallback's behavior for this specific ordering rule.
 */
function loadDiscoveredPackages(
  candidates: Set<string>,
  verbose?: boolean
): { loaded: Set<string>; blocked: string[] } {
  const { toLoad, blocked } = classifyManifestPackages(candidates);

  const hasTypesugarImport = [...candidates].some(
    (pkg) => pkg.startsWith("@typesugar/") || AUTO_TRUSTED_UNSCOPED_PACKAGES.has(pkg)
  );
  if (hasTypesugarImport) {
    loadPackage("@typesugar/std", verbose);
  }

  const loaded = new Set<string>();
  for (const [pkg, target] of toLoad) {
    tryLoadModule(pkg, target, verbose);
    loaded.add(pkg);
  }

  return { loaded, blocked };
}

/**
 * Scan a program's source files for imports from macro packages,
 * then lazily load those packages to register their macros.
 *
 * Called once per macroTransformerFactory() invocation (once per program).
 * Must be called before the visitor pass begins.
 */
export function loadMacroPackages(program: ts.Program, verbose?: boolean): void {
  const importedModules = collectImportedModules(program);
  const { loaded, blocked } = loadDiscoveredPackages(importedModules, verbose);

  if (verbose) {
    const all = globalRegistry.getAll();
    console.log(`[typesugar] Total registered macros: ${all.length}`);
    if (all.length === 0 && loaded.size > 0) {
      console.warn(
        `[typesugar] WARNING: ${loaded.size} macro package(s) loaded but 0 macros registered. ` +
          `This may indicate an ESM/CJS dual-instance issue.`
      );
    }
  }

  if (blocked.length > 0) {
    throw new UnapprovedMacroPackagesError(blocked);
  }
}

/**
 * Force-load a specific macro package by name.
 * Useful for programmatic use or testing.
 */
export function loadMacroPackage(packageName: string, verbose?: boolean): boolean {
  return loadPackage(packageName, verbose);
}

/**
 * Load macro packages based on imports in a single source file.
 * Called per-file during transformation to ensure packages are loaded
 * even when the initial program doesn't include all files.
 */
export function loadMacroPackagesFromFile(sourceFile: ts.SourceFile, verbose?: boolean): void {
  const basePkgs = new Set<string>();

  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const mod = stmt.moduleSpecifier.text;
      if (!mod.startsWith(".") && !mod.startsWith("/")) {
        const basePkg = getBasePackageName(mod);
        if (basePkg) basePkgs.add(basePkg);
      }
    }
  }

  const { blocked } = loadDiscoveredPackages(basePkgs, verbose);

  if (blocked.length > 0) {
    throw new UnapprovedMacroPackagesError(blocked);
  }
}

/**
 * Reset the loaded-packages tracker. For testing only.
 */
export function resetLoadedPackages(): void {
  loadedPackages.clear();
  manifestFieldCache.clear();
}

function loadPackage(pkg: string, verbose?: boolean): boolean {
  if (loadedPackages.has(pkg)) return true;

  // Prefer the dedicated `./macros` entry (PEP-050 Case-1 isolation): macro
  // definitions import `typescript` and must NOT live in the `.` runtime entry.
  // Packages that haven't split yet have no `./macros` subpath, so we fall back
  // to the package root (the original behavior).
  for (const target of [`${pkg}/macros`, pkg]) {
    if (tryLoadModule(pkg, target, verbose)) return true;
  }
  if (verbose) {
    console.log(`[typesugar] Could not load macro package: ${pkg}`);
  }
  return false;
}

function tryLoadModule(pkg: string, target: string, verbose?: boolean): boolean {
  try {
    const loaded = getRequire()(target);
    loadedPackages.add(pkg);

    // Convention: __typesugar_macros__ exports an array of MacroDefinition
    // objects that should be registered. This is the preferred pattern for
    // third-party macro packages.
    if (Array.isArray(loaded.__typesugar_macros__)) {
      for (const macro of loaded.__typesugar_macros__) {
        if (isMacroDefinition(macro)) {
          globalRegistry.register(macro);
        }
      }
      if (verbose) {
        console.log(
          `[typesugar] Loaded ${loaded.__typesugar_macros__.length} macros from ${target} (convention)`
        );
      }
      return true;
    }

    // Side-effect registration: many packages register macros as a side
    // effect of being imported (via globalRegistry.register() calls at
    // module scope). The require() above already triggered this.
    if (verbose) {
      console.log(`[typesugar] Loaded macro package: ${target}`);
    }
    return true;
  } catch {
    // Module not resolvable (e.g. no `./macros` subpath) — caller tries the next
    // candidate. Silent: missing `./macros` is the normal not-yet-split case.
    return false;
  }
}

function isMacroDefinition(value: unknown): value is MacroDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    ("name" in value || "label" in value)
  );
}

/**
 * Collect all non-relative module specifiers imported across the program.
 * Only scans user source files (skips node_modules and .d.ts files).
 */
export function collectImportedModules(program: ts.Program): Set<string> {
  const modules = new Set<string>();

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.fileName.includes("node_modules")) continue;
    if (sourceFile.isDeclarationFile) continue;

    for (const stmt of sourceFile.statements) {
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const mod = stmt.moduleSpecifier.text;
        if (!mod.startsWith(".") && !mod.startsWith("/")) {
          const basePkg = getBasePackageName(mod);
          if (basePkg) modules.add(basePkg);
        }
      }

      // Also check re-exports: export { foo } from "pkg"
      if (
        ts.isExportDeclaration(stmt) &&
        stmt.moduleSpecifier &&
        ts.isStringLiteral(stmt.moduleSpecifier)
      ) {
        const mod = stmt.moduleSpecifier.text;
        if (!mod.startsWith(".") && !mod.startsWith("/")) {
          const basePkg = getBasePackageName(mod);
          if (basePkg) modules.add(basePkg);
        }
      }
    }
  }

  return modules;
}

/**
 * Extract the base package name from a module specifier.
 * Strips subpath imports: "@scope/name/sub" → "@scope/name", "name/sub" → "name"
 */
function getBasePackageName(moduleSpecifier: string): string {
  if (moduleSpecifier.startsWith("@")) {
    const parts = moduleSpecifier.split("/");
    return parts.slice(0, 2).join("/");
  }
  return moduleSpecifier.split("/")[0];
}
