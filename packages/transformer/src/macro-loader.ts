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

// ============================================================================
// What typesugar trusts (SECURITY.md; PEP-055, decision of 2026-10-22)
//
// - The project tree is trusted. A macro package reached by a RELATIVE
//   import (or `export … from`) whose real path is not inside a
//   `node_modules` directory is project code -- a vendored directory, a
//   workspace sibling, a nested project, the package's own `../src` -- and
//   is loaded whatever its package.json calls itself, with no approval and
//   no warning. Someone who can write files into the repository can already
//   edit vite.config.ts, eslint.config.js or package.json scripts, which
//   every build runs; refusing their macros adds friction, not safety.
//   Its macros entry is its own file (`projectEntry`), never a package of
//   the same name found by name; a bare entry naming another package is a
//   dependency of the project package (gated below).
// - A package inside `node_modules` is a dependency, and keeps PEP-055's
//   gate: `@typesugar/*` (and `typesugar`) are trusted, anything else must be
//   in `security.allowedMacroPackages` (`typesugar approve-macros`), or the
//   build fails. Its name is what Node resolution gives from the importing
//   file's location (pnpm and nested installs work as Node does). A
//   relative path into `node_modules` is judged as a bare import of the
//   package its path names (`node_modules/<name>`).
// - Files inside `node_modules` are never scanned (`isScannedFile`), so a
//   dependency's own imports never load macros.
//
// Every host -- check, build, watch, expand, doctor and the declarations
// emit (through `macroTransformerFactory`), the ts-patch entry, the
// TransformationPipeline (language service, unplugin, the Node loader,
// ESLint) and approve-macros (`scanMacroPackages`) -- goes through the
// functions below: `collectCandidates` decides what a file's imports reach,
// `classifyCandidates` applies the gate.
// ============================================================================

/** One `NodeRequire` per directory resolved from. */
const projectRequireCache = new Map<string, NodeRequire>();

/**
 * The `require`s to try, in order, when resolving a macro package by name:
 *
 * 1. from each directory in `dirs` (normally the importing file's own
 *    directory) -- the user's project. A package installed only in the
 *    project (pnpm's strict layout puts it in the project's `node_modules`,
 *    invisible from the transformer's install) must still load (docs review
 *    2026-10);
 * 2. the transformer's own install -- the pre-1.0 behaviour (its own
 *    dependencies), kept as a fallback for hosts whose files have no real
 *    on-disk location.
 *
 * The test override (if set) replaces both.
 */
function requireChain(dirs: readonly string[]): NodeRequire[] {
  if (_requireOverride) return [_requireOverride];
  const chain: NodeRequire[] = [];
  for (const dir of dirs) {
    let req = projectRequireCache.get(dir);
    if (!req) {
      // createRequire needs a FILE path; it need not exist.
      req = createRequire(path.join(dir, "__typesugar_macro_resolver__.js"));
      projectRequireCache.set(dir, req);
    }
    chain.push(req);
  }
  chain.push(_require);
  return chain;
}

/** The directory imports in `fileName` resolve from, if it is a real path. */
function importerDir(fileName: string): string | undefined {
  return path.isAbsolute(fileName) ? path.dirname(fileName) : undefined;
}

/**
 * The directories a program's project-wide loads (the @typesugar/std
 * preload) resolve from: the tsconfig's directory when the host set
 * `configFilePath` (tsserver, tsc/ts-patch; the CLI doesn't, since TypeScript
 * 6 then requires an explicit `rootDir`), the directory holding the program's
 * root files, and its current directory.
 */
function programDirs(program: ts.Program): string[] {
  const dirs: string[] = [];
  const cwd = path.resolve(program.getCurrentDirectory());
  const configFilePath = program.getCompilerOptions().configFilePath;
  if (typeof configFilePath === "string" && configFilePath) {
    dirs.push(path.dirname(path.resolve(cwd, configFilePath)));
  }
  const rootsDir = commonDirectory(program.getRootFileNames().map((f) => path.resolve(cwd, f)));
  if (rootsDir && !dirs.includes(rootsDir)) dirs.push(rootsDir);
  if (!dirs.includes(cwd)) dirs.push(cwd);
  return dirs;
}

/** The deepest directory containing every one of `files`. */
function commonDirectory(files: string[]): string | undefined {
  if (files.length === 0) return undefined;
  let common = path.dirname(files[0]);
  for (const f of files.slice(1)) {
    while (common !== path.dirname(common) && !isInside(f, common)) common = path.dirname(common);
  }
  return common;
}

/**
 * Macro entry modules already require()d in this process, by the REAL path
 * of the resolved entry file. Prevents redundant require() calls across
 * multiple transformer factory invocations (e.g., in watch mode). Keyed by
 * path, not package name: a name is only what a package.json claims, and a
 * project directory claiming `@typesugar/std` must not stand in for the real
 * one.
 */
const loadedEntries = new Set<string>();

/**
 * Package names whose macros are loaded from the package that name resolves
 * to as a dependency (a bare import, or a relative path into node_modules).
 * A later load of the same name is skipped. Project code (see the section
 * comment) is loaded by path and never enters this set.
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
 * immutable for a given install) per (directories, package name) for this
 * process. Deliberately does NOT cache the trust decision — that depends on
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
 * (exact names, or `"@scope/*"` wildcard entries). Applies to dependencies
 * only: project code is not gated (see the section comment).
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
 * Resolve a single package's manifest field, if any, from `dirs` (then
 * typesugar's install; see `requireChain`). Never calls require() — pure
 * discovery, safe to call from `approve-macros`'s dry-run scan as well as the
 * real loader. Result is memoized (see `manifestFieldCache`); trust is
 * deliberately NOT part of what's cached here.
 */
function discoverPackage(pkg: string, dirs: readonly string[]): PackageDiscovery {
  const key = `${dirs.join("\0")}\0\0${pkg}`;
  const cached = manifestFieldCache.get(key);
  if (cached) return cached;

  let result: PackageDiscovery = { kind: "unresolved" };
  for (const req of requireChain(dirs)) {
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
 * discovery mechanism, resolving each from `fromDir` (default: typesugar's
 * own install). Returns packages to load (mapped to their resolved target
 * specifier) and packages that declared the field but aren't
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
    [...candidates].map((pkg) => ({ pkg, importerDir: fromDir }))
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

/**
 * A dependency a file reaches: a bare import of `pkg` in a file in
 * `importerDir`, or a relative path into `<importerDir>/node_modules/<pkg>`
 * (undefined `importerDir`: no real path; typesugar's install only).
 */
interface BareCandidate {
  pkg: string;
  importerDir?: string;
}

function classifyCandidates(candidates: Iterable<BareCandidate>): {
  load: Map<string, ManifestFieldInfo>;
  blocked: string[];
  unresolved: Array<{ pkg: string; fromDir?: string }>;
} {
  const load = new Map<string, ManifestFieldInfo>();
  const blocked: string[] = [];
  const unresolved: Array<{ pkg: string; fromDir?: string }> = [];

  for (const { pkg, importerDir: fromDir } of candidates) {
    const found = discoverPackage(pkg, fromDir ? [fromDir] : []);
    if (found.kind === "unresolved") {
      if (expectsMacros(pkg) && !unresolved.some((u) => u.pkg === pkg)) {
        unresolved.push({ pkg, fromDir });
      }
      continue;
    }
    if (found.kind !== "manifest") continue;
    if (isTrusted(pkg)) {
      if (!load.has(pkg)) load.set(pkg, { target: found.target, req: found.req });
    } else if (!blocked.includes(pkg)) {
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
 * Discover and load macro packages from a set of dependency candidates
 * (drawn from a program's or a single file's imports). Shared by
 * `loadMacroPackages`/`loadMacroPackagesFromFile` so the "always load
 * @typesugar/std first" ordering guarantee and the discovery mechanism
 * itself stay in one place.
 *
 * The std preload is decided from the RAW candidate set, not the (possibly
 * narrower) set of packages that actually declare a `typesugar.macros` field
 * — preserving std's "load first for any @typesugar/* import" guarantee even
 * for @typesugar/* packages that carry no macros of their own (e.g. a pure
 * runtime library), matching the old prefix-fallback's behavior for this
 * specific ordering rule.
 */
function loadDiscoveredPackages(
  candidates: BareCandidate[],
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

  const typesugarImporter = candidates.find(({ pkg }) => expectsMacros(pkg));
  if (typesugarImporter) {
    loadPackage(
      "@typesugar/std",
      verbose,
      typesugarImporter.importerDir ? [typesugarImporter.importerDir] : []
    );
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
  // this is the same set either way. Resolved from the project's
  // directories, then from typesugar's install; when neither has it, the
  // derive is reported as unknown, as before.
  loadPackage("@typesugar/std", verbose, programDirs(program));

  // Load warnings are reported per importing file, as diagnostics, by
  // `loadMacroPackagesFromFile` (the factory calls it for every file).
  const { dependencies, project } = collectProgramCandidates(program);
  const { loaded, blocked } = loadDiscoveredPackages(dependencies, verbose);
  loadProjectMacroPackages(project, verbose);

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
 * What a build of `program` would refuse to load, without loading anything
 * -- `typesugar approve-macros`'s scan. The same discovery as
 * `loadMacroPackages` and `loadMacroPackagesFromFile` (same files, same
 * imports, same resolution): `blocked` is the dependencies that declare
 * macros but are not `@typesugar/*` and not approved (the build fails on
 * these). Project code is never blocked.
 */
export function scanMacroPackages(program: ts.Program): { blocked: string[] } {
  return { blocked: classifyCandidates(collectProgramCandidates(program).dependencies).blocked };
}

/**
 * Force-load a specific macro package by name, resolved from the current
 * directory (then typesugar's own install).
 * Useful for programmatic use or testing.
 */
export function loadMacroPackage(packageName: string, verbose?: boolean): boolean {
  return loadPackage(packageName, verbose, [process.cwd()]);
}

/** An import or re-export declaration with a string module specifier. */
type ModuleDeclaration = ts.ImportDeclaration | ts.ExportDeclaration;

/** A file's import and `export … from` declarations, with their specifiers. */
function moduleDeclarations(
  sourceFile: ts.SourceFile
): Array<{ specifier: string; node: ModuleDeclaration }> {
  const out: Array<{ specifier: string; node: ModuleDeclaration }> = [];
  for (const stmt of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      out.push({ specifier: stmt.moduleSpecifier.text, node: stmt });
    }
  }
  return out;
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("/");
}

/** Is `p` inside a `node_modules` directory (a path segment)? */
function inNodeModules(p: string): boolean {
  return p.split(/[\\/]/).includes("node_modules");
}

/**
 * Files the loader scans: a program's own sources, not declarations, and
 * nothing inside `node_modules` -- a dependency's own imports never load
 * macros.
 */
function isScannedFile(sourceFile: ts.SourceFile): boolean {
  return !inNodeModules(sourceFile.fileName) && !sourceFile.isDeclarationFile;
}

/** What one import or re-export reaches (see `candidateOf`). */
type ImportCandidate =
  | { kind: "dependency"; candidate: BareCandidate }
  | { kind: "project"; rel: ProjectMacroPackage; inside: boolean };

/**
 * What the import of `specifier` in `fileName` reaches: a dependency (a bare
 * specifier, or a relative path whose real path is inside `node_modules`),
 * a project macro package (a relative path to a package outside
 * `node_modules` that declares macros), or nothing.
 */
function candidateOf(fileName: string, specifier: string): ImportCandidate | undefined {
  const fromDir = importerDir(fileName);
  if (!isRelativeSpecifier(specifier)) {
    const pkg = getBasePackageName(specifier);
    return pkg ? { kind: "dependency", candidate: { pkg, importerDir: fromDir } } : undefined;
  }
  if (!fromDir) return undefined;
  const dir = realPath(relativeTargetDir(fromDir, specifier));
  const dep = nodeModulesPackageOf(dir);
  if (dep) return { kind: "dependency", candidate: dep };
  if (inNodeModules(dir)) return undefined; // `node_modules` itself, or `.bin`
  const rel = projectMacroPackageAt(dir);
  if (!rel) return undefined;
  // A bare manifest value (`"@typesugar/macros"`, a facade's) names ANOTHER
  // package: resolved by name from the package's directory, it is a
  // dependency like any other, and keeps the approval gate (review 8).
  if (!rel.field.startsWith(".")) {
    return {
      kind: "dependency",
      candidate: { pkg: getBasePackageName(rel.field), importerDir: rel.dir },
    };
  }
  const from = realPath(fromDir);
  return { kind: "project", rel, inside: from === rel.dir || isInside(from, rel.dir) };
}

/**
 * Load macro packages based on imports (and `export … from` re-exports) in a
 * single source file. Called per-file during transformation to ensure
 * packages are loaded even when the initial program doesn't include all
 * files. Resolution depends only on where the file is.
 */
export function loadMacroPackagesFromFile(
  sourceFile: ts.SourceFile,
  verbose?: boolean
): Array<MacroPackageWarning & { node: ModuleDeclaration }> {
  if (!isScannedFile(sourceFile)) return [];
  const dependencies: BareCandidate[] = [];
  const importOf = new Map<string, ModuleDeclaration>();
  const project = new Map<string, ProjectImport>();
  const projectImportOf = new Map<string, ModuleDeclaration>();

  for (const { specifier, node } of moduleDeclarations(sourceFile)) {
    const found = candidateOf(sourceFile.fileName, specifier);
    if (found?.kind === "dependency") {
      const { pkg } = found.candidate;
      if (!importOf.has(pkg)) {
        dependencies.push(found.candidate);
        importOf.set(pkg, node);
      }
    } else if (found?.kind === "project") {
      addProjectImport(project, found);
      if (!projectImportOf.has(found.rel.dir)) projectImportOf.set(found.rel.dir, node);
    }
  }

  const { blocked, warnings } = loadDiscoveredPackages(dependencies, verbose);

  if (blocked.length > 0) {
    throw new UnapprovedMacroPackagesError(blocked);
  }

  const result = warnings.map((w) => ({ ...w, node: importOf.get(w.pkg)! }));
  for (const { dir, ...w } of loadProjectMacroPackages(project, verbose)) {
    result.push({ ...w, node: projectImportOf.get(dir)! });
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
  projectPackageCache.clear();
}

function loadPackage(pkg: string, verbose: boolean | undefined, dirs: readonly string[]): boolean {
  if (loadedPackageNames.has(pkg)) return true;

  // Prefer the dedicated `./macros` entry (PEP-050 Case-1 isolation): macro
  // definitions import `typescript` and must NOT live in the `.` runtime entry.
  // Packages that haven't split yet have no `./macros` subpath, so we fall back
  // to the package root (the original behavior).
  for (const req of requireChain(dirs)) {
    for (const target of [`${pkg}/macros`, pkg]) {
      if (tryLoadModule(pkg, target, verbose, req) === undefined) return true;
    }
  }
  if (verbose) {
    console.log(`[typesugar] Could not load macro package: ${pkg}`);
  }
  return false;
}

/** Prefix of a load error where only some `__typesugar_macros__` entries conflicted. */
const PARTIAL_LOAD = "some of its macros conflict with registered ones: ";

/**
 * require() `target` and register its macros. Returns `undefined` on
 * success, or the error message when the module could not be loaded.
 */
function tryLoadModule(
  pkg: string,
  target: string,
  verbose: boolean | undefined,
  req: NodeRequire,
  /** False for project code, loaded by path (see `loadedPackageNames`). */
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

// ============================================================================
// Relative imports
// ============================================================================

/**
 * A macro package that is project code: the package a relative import lands
 * in (decided by the imported FILE's nearest package.json, not by the
 * specifier's text), outside `node_modules`, that declares
 * `typesugar.macros`. `packages/mapper/examples/showcase.ts` imports
 * `transformInto` from "../src/index.js" -- the defining module itself; a
 * vendored directory or a workspace sibling may be imported the same way.
 * Loaded under no name check (see the section comment), keyed by real path.
 */
interface ProjectMacroPackage {
  /** The name its package.json gives. */
  pkg: string;
  /** The package's directory (where its package.json is), by real path. */
  dir: string;
  /** Its `typesugar.macros` value: `"."` or `"./…"` (see `projectEntry`), else a bare specifier. */
  field: string;
  /** Its package.json has an `exports` map, so a `${name}/…` self-reference resolves inside it. */
  hasExports: boolean;
  /** `target`: the self-reference (`${name}/macros`); `req`: from its package.json. */
  info: ManifestFieldInfo;
}

/** A project macro package and whether every importing file is inside it. */
interface ProjectImport {
  rel: ProjectMacroPackage;
  /** Every importing file is inside the package (its own build/examples/tests). */
  insideOnly: boolean;
}

/** Nearest-package.json lookups, per directory (null: none, or not a macro package). */
const projectPackageCache = new Map<string, ProjectMacroPackage | null>();

function realPath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** The directory a relative specifier lands in ("../src/index.js" for a .ts file: its directory). */
function relativeTargetDir(fromDir: string, specifier: string): string {
  const target = path.resolve(fromDir, specifier);
  try {
    return fs.statSync(target).isDirectory() ? target : path.dirname(target);
  } catch {
    return path.dirname(target);
  }
}

/**
 * For a directory (real path) inside `node_modules`: the package its path
 * names -- `<base>/node_modules/<name>` or `<base>/node_modules/@scope/<name>`,
 * at the LAST `node_modules` segment (pnpm's `.pnpm/<id>/node_modules/<name>`
 * included) -- as the bare import of `<name>` from `<base>` that Node would
 * resolve to it. Its own package.json's `name` is not consulted: a bare
 * import is judged by the name it uses.
 */
function nodeModulesPackageOf(dir: string): BareCandidate | undefined {
  const segments = dir.split(path.sep);
  const at = segments.lastIndexOf("node_modules");
  if (at < 0) return undefined;
  const first = segments[at + 1];
  if (!first || first.startsWith(".")) return undefined;
  const pkg = first.startsWith("@")
    ? segments[at + 2]
      ? `${first}/${segments[at + 2]}`
      : ""
    : first;
  if (!pkg) return undefined;
  return { pkg, importerDir: segments.slice(0, at).join(path.sep) || path.sep };
}

/** The project macro package containing `dir` (a real path outside node_modules), if any. */
function projectMacroPackageAt(start: string): ProjectMacroPackage | undefined {
  const visited: string[] = [];
  let found: ProjectMacroPackage | null = null;
  for (let dir = start; ; ) {
    const cached = projectPackageCache.get(dir);
    if (cached !== undefined) {
      found = cached;
      break;
    }
    visited.push(dir);
    const pkgJson = path.join(dir, "package.json");
    if (fs.existsSync(pkgJson)) {
      // The nearest package.json decides, macro package or not.
      found = readProjectMacroPackage(dir, pkgJson);
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const d of visited) projectPackageCache.set(d, found);
  return found ?? undefined;
}

function readProjectMacroPackage(dir: string, pkgJson: string): ProjectMacroPackage | null {
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
  return {
    pkg: name,
    dir,
    field,
    hasExports: data.exports !== undefined,
    info: { target, req: createRequire(pkgJson) },
  };
}

/**
 * The file a project macro package's `"."`/`"./…"` manifest value names,
 * inside the package: through its own `exports` map when it has one (Node's
 * self-reference), else as a path in its directory. Never by name from the
 * node_modules above it: without an `exports` map, `${name}/macros` resolved
 * there, so a vendored fork of an npm package ran the npm copy's macros,
 * unapproved (review 8). An entry whose real path is outside the package
 * (a symlink out of it) is refused. Resolved on each load, so a package's
 * own build sees its macros entry once it is built.
 */
function projectEntry(rel: ProjectMacroPackage): { entry: string } | { refused: string } {
  const candidates = rel.hasExports ? [rel.info.target] : [];
  candidates.push(path.join(rel.dir, rel.field));
  let outside: string | undefined;
  for (const candidate of candidates) {
    let resolved: string;
    try {
      resolved = rel.info.req.resolve(candidate);
    } catch {
      continue; // not exported, or not there (yet)
    }
    const real = realPath(resolved);
    if (isInside(real, rel.dir)) return { entry: resolved };
    outside ??= real;
  }
  if (outside !== undefined) {
    return {
      refused:
        `its macros entry '${rel.field}' resolves to ${outside}, outside the package, ` +
        `so it was not loaded`,
    };
  }
  // Not resolvable: loading the path reports why.
  return { entry: path.join(rel.dir, rel.field) };
}

/** Record a project macro package one importing file reaches. */
function addProjectImport(
  found: Map<string, ProjectImport>,
  { rel, inside }: { rel: ProjectMacroPackage; inside: boolean }
): void {
  // Keyed by directory: two directories may give one name.
  const prev = found.get(rel.dir);
  found.set(rel.dir, { rel, insideOnly: (prev?.insideOnly ?? true) && inside });
}

/**
 * Load the project macro packages reached by relative imports. A load
 * failure is a warning, except when every importing file is inside the
 * package itself: that is the package's own build (its macros entry may not
 * be built yet), where its bare-name load is silent too.
 */
function loadProjectMacroPackages(
  found: Map<string, ProjectImport>,
  verbose?: boolean
): Array<MacroPackageWarning & { dir: string }> {
  const warnings: Array<MacroPackageWarning & { dir: string }> = [];
  for (const { rel, insideOnly } of found.values()) {
    const resolved = projectEntry(rel);
    if ("refused" in resolved) {
      warnings.push({
        pkg: rel.pkg,
        dir: rel.dir,
        message:
          `macro package '${rel.pkg}' (imported by a relative path, from ${rel.dir}): ` +
          `${resolved.refused}. Its macros will not be expanded.`,
      });
      continue;
    }
    const error = tryLoadModule(rel.pkg, resolved.entry, verbose, rel.info.req, false);
    if (error === undefined || insideOnly) continue;
    warnings.push({
      pkg: rel.pkg,
      dir: rel.dir,
      message:
        `macro package '${rel.pkg}' (imported by a relative path, from ${rel.dir}) declares ` +
        `macros at '${rel.field}' but loading it failed: ${error}. Its macros will not ` +
        `be expanded.`,
    });
  }
  return warnings;
}

/** Is `file` inside directory `dir`? */
function isInside(file: string, dir: string): boolean {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Every dependency and project macro package the program's scanned files
 * reach -- the same declarations `loadMacroPackagesFromFile` reads, decided
 * by the same `candidateOf`.
 */
function collectProgramCandidates(program: ts.Program): {
  dependencies: BareCandidate[];
  project: Map<string, ProjectImport>;
} {
  const dependencies: BareCandidate[] = [];
  const project = new Map<string, ProjectImport>();
  const seen = new Set<string>();
  for (const sourceFile of program.getSourceFiles()) {
    if (!isScannedFile(sourceFile)) continue;
    for (const { specifier } of moduleDeclarations(sourceFile)) {
      const found = candidateOf(sourceFile.fileName, specifier);
      if (found?.kind === "project") {
        addProjectImport(project, found);
      } else if (found?.kind === "dependency") {
        const key = `${found.candidate.importerDir ?? ""}\0${found.candidate.pkg}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dependencies.push(found.candidate);
      }
    }
  }
  return { dependencies, project };
}

/**
 * The base package names of every dependency the program's scanned files
 * import or re-export (bare specifiers, and relative paths into
 * node_modules).
 */
export function collectImportedModules(program: ts.Program): Set<string> {
  return new Set(collectProgramCandidates(program).dependencies.map((c) => c.pkg));
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
