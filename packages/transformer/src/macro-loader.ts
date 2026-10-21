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

/**
 * One `NodeRequire` per importing directory, so a project's macro packages
 * resolve the way Node would resolve the project's own imports.
 */
const projectRequireCache = new Map<string, NodeRequire>();

/**
 * The `require`s to try, in order, when resolving a macro package imported
 * from a file in `fromDir`:
 *
 * 1. the importing file's own directory -- the user's project. A package
 *    installed only in the project (pnpm's strict layout puts it in the
 *    project's `node_modules`, invisible from the transformer's install)
 *    must still load (docs review 2026-10, docs-authoring "1.0 gaps");
 * 2. the transformer's own install -- the pre-1.0 behaviour, kept as a
 *    fallback for hosts whose files have no real on-disk location.
 *
 * The test override (if set) replaces both.
 */
function requireChain(fromDir?: string): NodeRequire[] {
  if (_requireOverride) return [_requireOverride];
  if (!fromDir) return [_require];
  let req = projectRequireCache.get(fromDir);
  if (!req) {
    // createRequire needs a FILE path; it need not exist.
    req = createRequire(path.join(fromDir, "__typesugar_macro_resolver__.js"));
    projectRequireCache.set(fromDir, req);
  }
  return [req, _require];
}

/** The directory imports in `fileName` resolve from, if it is a real path. */
function importerDir(fileName: string): string | undefined {
  return path.isAbsolute(fileName) ? path.dirname(fileName) : undefined;
}

/**
 * Macro entry modules already require()d in this process, by the REAL path
 * of the resolved entry file. Prevents redundant require() calls across
 * multiple transformer factory invocations (e.g., in watch mode). Keyed by
 * path, not package name: a name is only what a package.json claims, and a
 * directory claiming `@typesugar/std` must not stand in for the real one.
 */
const loadedEntries = new Set<string>();

/**
 * Package names whose macros are loaded from the package that name resolves
 * to (a bare specifier, or a relative import verified to land in the same
 * directory -- see `relativePackageIdentity`). A later load of the same name
 * is skipped. A package loaded on a claim alone (the cwd case) never enters
 * this set.
 */
const loadedPackageNames = new Set<string>();

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
  /** The `require` that found the package's package.json; the target is
   *  loaded through the same one. */
  req: NodeRequire;
}

/** Outcome of looking a candidate package up (see `discoverPackage`). */
type PackageDiscovery =
  | { kind: "unresolved" }
  | { kind: "no-manifest" }
  | ({ kind: "manifest" } & ManifestFieldInfo);

/**
 * Memoizes package.json reads (I/O-bound, and the field itself is
 * immutable for a given install) per package name for this process.
 * Deliberately does NOT cache the trust decision — that depends on
 * `security.allowedMacroPackages`, which is mutable process-wide config
 * state (`config.set(...)` is a public API), so it's recomputed on every
 * call. Cleared by `resetLoadedPackages` (testing only).
 */
const manifestFieldCache = new Map<string, PackageDiscovery>();

/**
 * Macro targets whose require() threw, with the error message. A failed
 * load is not retried, but every file importing the package still gets the
 * warning (see `loadMacroPackagesFromFile`).
 */
const failedLoads = new Map<NodeRequire, Map<string, string>>();

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
 * and is used as-is. Anything containing a `".."` path segment is rejected —
 * there's no legitimate case for a manifest pointing outside its own package.
 */
function resolveManifestTarget(pkg: string, field: string): string | undefined {
  if (field === ".") return pkg;
  // Reject a `..` path SEGMENT anywhere, not just a leading `..`: `./../x`
  // and `./a/../../x` escape the package root just as `../x` does.
  if (field.split(/[\\/]/).includes("..")) return undefined;
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
function discoverPackage(pkg: string, fromDir?: string): PackageDiscovery {
  const key = `${fromDir ?? ""}\0${pkg}`;
  const cached = manifestFieldCache.get(key);
  if (cached) return cached;

  let result: PackageDiscovery = { kind: "unresolved" };
  for (const req of requireChain(fromDir)) {
    const resolved = resolvePackageJson(pkg, req);
    if (!resolved) continue;
    result = { kind: "no-manifest" };
    const typesugarField = resolved.data.typesugar as { macros?: unknown } | undefined;
    const macrosField = typesugarField?.macros;
    if (typeof macrosField === "string") {
      const target = resolveManifestTarget(pkg, macrosField);
      if (target) {
        result = { kind: "manifest", target, req };
      }
    }
    break;
  }

  manifestFieldCache.set(key, result);
  return result;
}

/**
 * Classify a set of candidate base package names against the manifest
 * discovery mechanism. Returns packages to load (mapped to their resolved
 * target specifier) and packages that declared the field but aren't
 * trusted/approved. Trust is re-checked against the CURRENT
 * `security.allowedMacroPackages` on every call.
 */
export function classifyManifestPackages(
  candidates: Iterable<string>,
  fromDir?: string
): {
  toLoad: Map<string, string>;
  blocked: string[];
} {
  const toLoad = new Map<string, string>();
  const { load, blocked } = classifyCandidates(
    new Map([...candidates].map((pkg) => [pkg, fromDir]))
  );
  for (const [pkg, info] of load) toLoad.set(pkg, info.target);
  return { toLoad, blocked };
}

/**
 * Packages that are expected to provide macros (first-party, auto-trusted)
 * and so warrant a warning when they cannot be resolved at all. A
 * third-party import that cannot be resolved is not necessarily a macro
 * package, so it stays silent here (TypeScript reports the missing module).
 */
function expectsMacros(pkg: string): boolean {
  return pkg.startsWith("@typesugar/") || AUTO_TRUSTED_UNSCOPED_PACKAGES.has(pkg);
}

function classifyCandidates(candidates: Map<string, string | undefined>): {
  load: Map<string, ManifestFieldInfo>;
  blocked: string[];
  unresolved: Array<{ pkg: string; fromDir?: string }>;
} {
  const load = new Map<string, ManifestFieldInfo>();
  const blocked: string[] = [];
  const unresolved: Array<{ pkg: string; fromDir?: string }> = [];

  for (const [pkg, fromDir] of candidates) {
    const found = discoverPackage(pkg, fromDir);
    if (found.kind === "unresolved") {
      if (expectsMacros(pkg)) unresolved.push({ pkg, fromDir });
      continue;
    }
    if (found.kind !== "manifest") continue;
    if (isTrusted(pkg)) {
      load.set(pkg, { target: found.target, req: found.req });
    } else {
      blocked.push(pkg);
    }
  }

  return { load, blocked, unresolved };
}

/** A macro package that is imported but whose macros could not be loaded. */
export interface MacroPackageWarning {
  /** The imported (base) package name. */
  pkg: string;
  /** Human-readable explanation, naming the package. */
  message: string;
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
  candidates: Map<string, string | undefined>,
  verbose?: boolean
): { loaded: Set<string>; blocked: string[]; warnings: MacroPackageWarning[] } {
  const { load, blocked, unresolved } = classifyCandidates(candidates);
  const warnings: MacroPackageWarning[] = [];

  for (const { pkg, fromDir } of unresolved) {
    warnings.push({
      pkg,
      message:
        `macro package '${pkg}' could not be resolved` +
        (fromDir ? ` from ${fromDir}` : "") +
        `; its macros will not be expanded. Install it in this project.`,
    });
  }

  const typesugarImporter = [...candidates].find(([pkg]) => expectsMacros(pkg));
  if (typesugarImporter) {
    loadPackage("@typesugar/std", verbose, typesugarImporter[1]);
  }

  const loaded = new Set<string>();
  for (const [pkg, info] of load) {
    const error = tryLoadModule(pkg, info.target, verbose, info.req);
    if (error === undefined) {
      loaded.add(pkg);
    } else {
      warnings.push({
        pkg,
        message:
          `macro package '${pkg}' declares macros at '${info.target}' but loading it failed: ` +
          `${error}. Its macros will not be expanded` +
          (error.startsWith(PARTIAL_LOAD) ? " (the conflicting ones)." : "."),
      });
    }
  }

  return { loaded, blocked, warnings };
}

/**
 * Scan a program's source files for imports from macro packages,
 * then lazily load those packages to register their macros.
 *
 * Called once per macroTransformerFactory() invocation (once per program).
 * Must be called before the visitor pass begins.
 */
export function loadMacroPackages(program: ts.Program, verbose?: boolean): void {
  // @typesugar/std's macros are part of the built-in set (the derive macro
  // behind `@derive(Destructure)`): `@derive` is a built-in tag, so a file
  // names that derive without importing anything, and a program that imports
  // no typesugar package at all got "Unknown derive: 'Destructure'". A
  // program that imports one loads std anyway (loadDiscoveredPackages), so
  // this is the same set either way. Resolved from the program's own root,
  // then from typesugar's install; when neither has it, the derive is
  // reported as unknown, as before.
  const root = program.getRootFileNames()[0];
  loadPackage("@typesugar/std", verbose, root ? importerDir(path.resolve(root)) : undefined);

  const importedModules = collectImportedModulesWithDirs(program);
  // Load warnings are reported per importing file, as diagnostics, by
  // `loadMacroPackagesFromFile` (the factory calls it for every file).
  const { loaded, blocked } = loadDiscoveredPackages(importedModules, verbose);
  loadRelativeMacroPackages(collectRelativeMacroPackages(program), verbose);

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
  return loadPackage(packageName, verbose, process.cwd());
}

/**
 * Load macro packages based on imports in a single source file.
 * Called per-file during transformation to ensure packages are loaded
 * even when the initial program doesn't include all files.
 */
export function loadMacroPackagesFromFile(
  sourceFile: ts.SourceFile,
  verbose?: boolean
): Array<MacroPackageWarning & { node: ts.ImportDeclaration }> {
  const basePkgs = new Map<string, string | undefined>();
  const importOf = new Map<string, ts.ImportDeclaration>();
  const fromDir = importerDir(sourceFile.fileName);
  const relative = new Map<string, RelativeImport>();
  const relativeImportOf = new Map<string, ts.ImportDeclaration>();

  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const mod = stmt.moduleSpecifier.text;
      if (!mod.startsWith(".") && !mod.startsWith("/")) {
        const basePkg = getBasePackageName(mod);
        if (basePkg) {
          basePkgs.set(basePkg, fromDir);
          if (!importOf.has(basePkg)) importOf.set(basePkg, stmt);
        }
      } else {
        const rel = addRelative(relative, sourceFile.fileName, mod);
        if (rel && !relativeImportOf.has(rel.dir)) relativeImportOf.set(rel.dir, stmt);
      }
    }
  }

  const { blocked, warnings } = loadDiscoveredPackages(basePkgs, verbose);

  if (blocked.length > 0) {
    throw new UnapprovedMacroPackagesError(blocked);
  }

  const result = warnings.map((w) => ({ ...w, node: importOf.get(w.pkg)! }));
  for (const { dir, ...w } of loadRelativeMacroPackages(relative, verbose)) {
    result.push({ ...w, node: relativeImportOf.get(dir)! });
  }
  return result;
}

/**
 * Reset the loaded-packages tracker. For testing only.
 */
export function resetLoadedPackages(): void {
  loadedEntries.clear();
  loadedPackageNames.clear();
  manifestFieldCache.clear();
  failedLoads.clear();
  projectRequireCache.clear();
  relativePackageCache.clear();
  relativeIdentityCache.clear();
}

function loadPackage(pkg: string, verbose?: boolean, fromDir?: string): boolean {
  if (loadedPackageNames.has(pkg)) return true;

  // Prefer the dedicated `./macros` entry (PEP-050 Case-1 isolation): macro
  // definitions import `typescript` and must NOT live in the `.` runtime entry.
  // Packages that haven't split yet have no `./macros` subpath, so we fall back
  // to the package root (the original behavior).
  for (const req of requireChain(fromDir)) {
    for (const target of [`${pkg}/macros`, pkg]) {
      if (tryLoadModule(pkg, target, verbose, req) === undefined) return true;
    }
  }
  if (verbose) {
    console.log(`[typesugar] Could not load macro package: ${pkg}`);
  }
  return false;
}

/**
 * require() `target` and register its macros. Returns `undefined` on
 * success, or the error message when the module could not be loaded.
 */
/** Prefix of a load error where only some `__typesugar_macros__` entries conflicted. */
const PARTIAL_LOAD = "some of its macros conflict with registered ones: ";

function tryLoadModule(
  pkg: string,
  target: string,
  verbose: boolean | undefined,
  req: NodeRequire,
  /** False for a package loaded on its package.json's claim alone (see `loadedPackageNames`). */
  byName = true
): string | undefined {
  if (byName && loadedPackageNames.has(pkg)) return undefined;
  let failedForReq = failedLoads.get(req);
  if (!failedForReq) failedLoads.set(req, (failedForReq = new Map()));
  const failed = failedForReq.get(target);
  if (failed !== undefined) return failed;
  try {
    const entry = realPath(req.resolve(target));
    if (loadedEntries.has(entry)) {
      if (byName) loadedPackageNames.add(pkg);
      return undefined;
    }
    const loaded = req(target);
    loadedEntries.add(entry);
    if (byName) loadedPackageNames.add(pkg);

    // Convention: __typesugar_macros__ exports an array of MacroDefinition
    // objects that should be registered. This is the preferred pattern for
    // third-party macro packages.
    if (Array.isArray(loaded.__typesugar_macros__)) {
      // Register every macro even if one conflicts, so a single clash does
      // not leave the package's later macros unregistered; then report the
      // conflicts as this package's load failure (a warning naming them).
      // Macros from different modules never conflict: identity is
      // (kind, module, exportName ?? name) — see MacroRegistryImpl.
      const conflicts: string[] = [];
      for (const macro of loaded.__typesugar_macros__) {
        if (isMacroDefinition(macro)) {
          try {
            globalRegistry.register(macro);
          } catch (error) {
            conflicts.push(error instanceof Error ? error.message : String(error));
          }
        }
      }
      if (conflicts.length > 0) {
        const message = `${PARTIAL_LOAD}${conflicts.join("; ")}`;
        failedForReq.set(target, message);
        return message;
      }
      if (verbose) {
        console.log(
          `[typesugar] Loaded ${loaded.__typesugar_macros__.length} macros from ${target} (convention)`
        );
      }
      return undefined;
    }

    // Side-effect registration: many packages register macros as a side
    // effect of being imported (via globalRegistry.register() calls at
    // module scope). The require() above already triggered this.
    if (verbose) {
      console.log(`[typesugar] Loaded macro package: ${target}`);
    }
    return undefined;
  } catch (error) {
    // Not resolvable (e.g. no `./macros` subpath, the normal not-yet-split
    // case for `loadPackage`) or the module threw while loading. The caller
    // decides whether that is worth a warning: a manifest-declared target
    // that fails is (see `loadDiscoveredPackages`).
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    failedForReq.set(target, message);
    return message;
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
 * A macro package reached by a RELATIVE import: the package a relative
 * specifier lands in, when that package declares `typesugar.macros`.
 * `packages/mapper/examples/showcase.ts` imports `transformInto` from
 * "../src/index.js" -- the defining module itself -- and a workspace sibling
 * may be imported the same way. Decided by the imported FILE's own package
 * (the nearest package.json above it), not by the specifier's text.
 *
 * Its package.json `name` is only a claim: a relative path reaches any
 * directory, so `@typesugar/*` auto-trust (which rests on npm scope
 * ownership) and `allowedMacroPackages` approval (which names a package)
 * apply to it only once the name is shown to be this package's -- see
 * `relativePackageIdentity`.
 */
interface RelativeMacroPackage {
  /** The name its package.json claims. */
  pkg: string;
  /** The package's directory (where its package.json is), by real path. */
  dir: string;
  info: ManifestFieldInfo;
}

/** A relative macro package and what the importing files established about it. */
interface RelativeImport {
  rel: RelativeMacroPackage;
  /** Every importing file is inside the package (its own build/examples/tests). */
  insideOnly: boolean;
  /** How the claimed name was established, from the most convincing importer. */
  identity: RelativeIdentity;
}

/**
 * - `resolved`: the claimed name, as a bare specifier from the project, resolves
 *   to this very directory (same real path) -- a workspace link, a `file:`
 *   dependency, or the installed package itself. Trusted exactly as a bare
 *   import of that name is.
 * - `cwd`: the build runs inside the package (cwd at or below its directory):
 *   the package's own build, examples and tests, where nothing links its name.
 *   Its name is trusted as the project's own package.
 * - `unverified`: neither. Not loaded, whatever it claims.
 */
type RelativeIdentity =
  | { kind: "resolved" }
  | { kind: "cwd" }
  | { kind: "unverified"; from: string };

const IDENTITY_RANK = { unverified: 0, cwd: 1, resolved: 2 } as const;

/** Nearest-package.json lookups, per directory (null: none, or not a macro package). */
const relativePackageCache = new Map<string, RelativeMacroPackage | null>();

/** `relativePackageIdentity` results, per (resolution base, package dir). */
const relativeIdentityCache = new Map<string, RelativeIdentity>();

function realPath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function macroPackageOfRelativeImport(
  fromDir: string,
  specifier: string
): RelativeMacroPackage | undefined {
  const target = path.resolve(fromDir, specifier);
  let dir: string;
  try {
    dir = fs.statSync(target).isDirectory() ? target : path.dirname(target);
  } catch {
    dir = path.dirname(target); // "../src/index.js" for a .ts file: its directory exists
  }
  const visited: string[] = [];
  let found: RelativeMacroPackage | null = null;
  for (;;) {
    const cached = relativePackageCache.get(dir);
    if (cached !== undefined) {
      found = cached;
      break;
    }
    visited.push(dir);
    const pkgJson = path.join(dir, "package.json");
    if (fs.existsSync(pkgJson)) {
      // The nearest package.json decides, macro package or not.
      found = readRelativeMacroPackage(dir, pkgJson);
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir || path.basename(dir) === "node_modules") break;
    dir = parent;
  }
  for (const d of visited) relativePackageCache.set(d, found);
  return found ?? undefined;
}

function readRelativeMacroPackage(dir: string, pkgJson: string): RelativeMacroPackage | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(fs.readFileSync(pkgJson, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  const name = data.name;
  const field = (data.typesugar as { macros?: unknown } | undefined)?.macros;
  if (typeof name !== "string" || typeof field !== "string") return null;
  const target = resolveManifestTarget(name, field);
  if (!target) return null;
  // Loaded from the package itself: `${name}/macros` resolves through its own
  // `exports` map (a package may import itself by name), else from the
  // node_modules above it.
  return { pkg: name, dir: realPath(dir), info: { target, req: createRequire(pkgJson) } };
}

/**
 * Establish whether a relatively imported package is the package its
 * claimed name stands for (see `RelativeIdentity`), for an import in
 * `importer`.
 *
 * The bare name is resolved from the importing file's directory -- or, for a
 * file inside the package itself, from the package's PARENT directory: from
 * inside, Node's package self-reference would resolve the name to the
 * package whatever it claims, and being inside a package is no evidence of
 * its name (a vendored package's own `.ts` files are pulled into the program
 * by the project's import of it). Only the project's resolution chain is
 * used, not the transformer's own install.
 */
function relativePackageIdentity(rel: RelativeMacroPackage, importer: string): RelativeIdentity {
  const importerDirReal = realPath(path.dirname(importer));
  const from =
    isInside(importerDirReal, rel.dir) || importerDirReal === rel.dir
      ? path.dirname(rel.dir)
      : importerDirReal;
  const key = `${from}\0${rel.dir}`;
  const cached = relativeIdentityCache.get(key);
  if (cached) return cached;

  let identity: RelativeIdentity = { kind: "unverified", from };
  const req = _requireOverride ?? createRequire(path.join(from, "__typesugar_macro_resolver__.js"));
  const resolvedDir = resolvePackageJson(rel.pkg, req)?.dir ?? findInNodeModules(rel.pkg, from);
  const cwd = realPath(process.cwd());
  if (resolvedDir && realPath(resolvedDir) === rel.dir) {
    identity = { kind: "resolved" };
  } else if (cwd === rel.dir || isInside(cwd, rel.dir)) {
    identity = { kind: "cwd" };
  }
  relativeIdentityCache.set(key, identity);
  return identity;
}

/**
 * The directory `node_modules/<pkg>` above `from` (Node's directory lookup,
 * without the package's `exports` map, which may expose neither its
 * package.json nor a built entry yet).
 */
function findInNodeModules(pkg: string, from: string): string | undefined {
  for (let dir = from; ; ) {
    const candidate = path.join(dir, "node_modules", ...pkg.split("/"));
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Load the macro packages reached by relative imports (see
 * {@link macroPackageOfRelativeImport}), when trusted: the claimed name must
 * be established (`relativePackageIdentity`), and then pass the usual
 * trust rules (`isTrusted`). Every package left unloaded is a warning naming
 * its directory and how to allow it. A load failure is a warning, except for
 * a file inside the package itself: that is the package's own build (its
 * macros entry may not be built yet), where its bare-name load is silent too.
 */
function loadRelativeMacroPackages(
  found: Map<string, RelativeImport>,
  verbose?: boolean
): Array<MacroPackageWarning & { dir: string }> {
  const warnings: Array<MacroPackageWarning & { dir: string }> = [];
  for (const { rel, insideOnly, identity } of found.values()) {
    const { pkg, dir } = rel;
    if (identity.kind === "unverified") {
      warnings.push({
        pkg,
        dir,
        message:
          `the package at ${dir} declares macros under the name '${pkg}', but it is imported by ` +
          `a relative path and '${pkg}' does not resolve to that directory from ${identity.from}, ` +
          `so the name is not trusted and its macros were not loaded. To use them, make it the ` +
          `package that name resolves to (a dependency such as "${pkg}": "file:<path>" or a ` +
          `workspace link) and, if it is not @typesugar/*, approve it with ` +
          `\`typesugar approve-macros\`.`,
      });
      continue;
    }
    if (!isTrusted(pkg)) {
      warnings.push({
        pkg,
        dir,
        message:
          `macro package '${pkg}' (imported by a relative path, from ${dir}) is not approved, so ` +
          `its macros were not loaded. Run \`typesugar approve-macros\` to review and approve it.`,
      });
      continue;
    }
    const error = tryLoadModule(
      pkg,
      rel.info.target,
      verbose,
      rel.info.req,
      identity.kind === "resolved"
    );
    if (error === undefined || insideOnly) continue;
    warnings.push({
      pkg,
      dir,
      message:
        `macro package '${pkg}' (imported by a relative path, from ${dir}) declares macros at ` +
        `'${rel.info.target}' but loading it failed: ${error}. Its macros will not be expanded.`,
    });
  }
  return warnings;
}

/** Is `file` inside directory `dir`? */
function isInside(file: string, dir: string): boolean {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Record the macro package a relative import in `fileName` reaches, if any. */
function addRelative(
  found: Map<string, RelativeImport>,
  fileName: string,
  specifier: string
): RelativeMacroPackage | undefined {
  const fromDir = importerDir(fileName);
  if (!fromDir) return undefined;
  const rel = macroPackageOfRelativeImport(fromDir, specifier);
  if (!rel) return undefined;
  const inside = isInside(realPath(fromDir), rel.dir) || realPath(fromDir) === rel.dir;
  const identity = relativePackageIdentity(rel, fileName);
  // Keyed by directory: two directories may claim one name.
  const prev = found.get(rel.dir);
  found.set(rel.dir, {
    rel,
    insideOnly: (prev?.insideOnly ?? true) && inside,
    identity:
      prev && IDENTITY_RANK[prev.identity.kind] >= IDENTITY_RANK[identity.kind]
        ? prev.identity
        : identity,
  });
  return rel;
}

/**
 * The macro packages a program's own files reach by relative imports whose
 * name is established (see `relativePackageIdentity`) but not trusted --
 * what `typesugar approve-macros` lists alongside bare imports -- and those
 * whose name is not established, which approval cannot fix.
 */
export function classifyRelativeMacroPackages(program: ts.Program): {
  blocked: string[];
  unverified: Array<{ pkg: string; dir: string }>;
} {
  const blocked: string[] = [];
  const unverified: Array<{ pkg: string; dir: string }> = [];
  for (const { rel, identity } of collectRelativeMacroPackages(program).values()) {
    if (identity.kind === "unverified") unverified.push({ pkg: rel.pkg, dir: rel.dir });
    else if (!isTrusted(rel.pkg) && !blocked.includes(rel.pkg)) blocked.push(rel.pkg);
  }
  return { blocked, unverified };
}

/**
 * Collect all non-relative module specifiers imported across the program.
 * Only scans user source files (skips node_modules and .d.ts files).
 */
export function collectImportedModules(program: ts.Program): Set<string> {
  return new Set(collectImportedModulesWithDirs(program).keys());
}

/**
 * As `collectImportedModules`, mapping each package to the directory of the
 * first file that imports it (where its resolution starts from).
 */
function collectImportedModulesWithDirs(program: ts.Program): Map<string, string | undefined> {
  const modules = new Map<string, string | undefined>();

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.fileName.includes("node_modules")) continue;
    if (sourceFile.isDeclarationFile) continue;
    const fromDir = importerDir(sourceFile.fileName);
    const add = (basePkg: string) => {
      if (basePkg && !modules.has(basePkg)) modules.set(basePkg, fromDir);
    };

    for (const stmt of sourceFile.statements) {
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const mod = stmt.moduleSpecifier.text;
        if (!mod.startsWith(".") && !mod.startsWith("/")) {
          const basePkg = getBasePackageName(mod);
          add(basePkg);
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
          add(basePkg);
        }
      }
    }
  }

  return modules;
}

/** The macro packages the program's own files reach by relative imports. */
function collectRelativeMacroPackages(program: ts.Program): Map<string, RelativeImport> {
  const found = new Map<string, RelativeImport>();
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.fileName.includes("node_modules") || sourceFile.isDeclarationFile) continue;
    for (const stmt of sourceFile.statements) {
      if (
        (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) &&
        stmt.moduleSpecifier &&
        ts.isStringLiteral(stmt.moduleSpecifier) &&
        stmt.moduleSpecifier.text.startsWith(".")
      ) {
        addRelative(found, sourceFile.fileName, stmt.moduleSpecifier.text);
      }
    }
  }
  return found;
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
