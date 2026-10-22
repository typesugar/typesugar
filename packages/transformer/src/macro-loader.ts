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
import * as os from "os";
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
// Which directories the project owns
//
// A macro package's identity -- the name `@typesugar/*` auto-trust and
// `security.allowedMacroPackages` approval are about -- is established ONLY
// by resolving its bare name from a directory the project owns, and the
// project's `typesugar.config.*` is read only from such a directory.
//
// The project is the OUTERMOST project enclosing the directory a host starts
// from (the tsconfig's directory, the program's root files' directory, the
// cwd): walking up from there, the highest directory that has a
// package.json, tsconfig.json or pnpm-workspace.yaml (see
// `enclosingProjectRoot` for the two bounds, and why `.git` is not one). The directories it owns are
// that root and the workspace packages the root declares (`pnpm-workspace.yaml`
// `packages:`, package.json `workspaces`) -- nothing else inside it. A
// directory never becomes the project's by having its own tsconfig: tsserver
// makes every directory with a tsconfig.json its own project, and
// `typesugar expand <file>` builds a program from one file, so review 7 ran a
// vendored package's macros (and could have run its config file) just by the
// vendored file being opened in the editor (secF) or expanded (secE).
//
// Never from a directory reached by following imports either: a vendored or
// unknown package's own files are in the program because something imported
// them, and everything at or below that package (its package.json `name` and
// `exports`, its own node_modules) is under its author's control. Review 6
// executed macros three ways through that gap: a relatively imported package
// "resolved" its claimed name through its own `exports` self-reference
// (sec1), or through a copy in its own node_modules (secB), and a vendored
// file's bare `@typesugar/x` import resolved from the vendored directory's
// node_modules (secC). A package found any other way is reported, not loaded.
//
// Every host uses this one rule: check/build/watch/expand (`projectRootsOf`
// with the program), the language service (the same, with tsserver's
// program), approve-macros (the same scan), and config discovery
// (`loadProjectConfig`).
// ============================================================================

/** Directories the project owns (real paths); see the section comment. */
interface ProjectRoots {
  /**
   * Where bare names resolve from first: for each starting directory, the
   * owned directory containing it (its workspace package), then its root.
   */
  primary: string[];
  /** Every owned directory: the roots and the workspace packages they declare. */
  all: string[];
}

const programRootsCache = new WeakMap<ts.Program, ProjectRoots>();
const cwdRootsCache = new Map<string, ProjectRoots>();

/** A filesystem root ("/", "C:\\") is never a project (single-file transforms use cwd "/"). */
function isFilesystemRoot(dir: string): boolean {
  return dir === "" || path.parse(dir).root === dir;
}

/**
 * Files whose presence makes a directory a candidate project root. Not
 * `.git`: a repository root with no package.json is not a JavaScript project
 * (a polyglot repository's `web/` is the project), and an inner `.git` cannot
 * end the walk either -- a submodule, or a vendored clone, has one.
 */
const PROJECT_MARKERS = ["package.json", "tsconfig.json", "pnpm-workspace.yaml"];

function homeDirectory(): string | undefined {
  try {
    return realPath(os.homedir());
  } catch {
    return undefined;
  }
}

/**
 * The outermost project enclosing `dir` (a real path): the highest directory
 * at or above it with a project marker (`PROJECT_MARKERS`). Two bounds:
 *
 * - the walk never reaches the user's home directory or above it (a stray
 *   `~/package.json` or a dotfiles `~/.git` is not everyone's project);
 * - a git worktree of the repository at the outermost root, checked out
 *   inside that repository (Claude Code puts agent worktrees under
 *   `.claude/worktrees/`), is its own project: its `.git` file names a
 *   `worktrees/<name>` entry of that repository's `.git` whose `gitdir` file
 *   points back at it. Only `git worktree add` writes that entry, so a
 *   vendored directory cannot claim it; a submodule's `.git` file (pointing
 *   into `.git/modules/`) does not count -- a submodule is vendored code.
 *
 * Without any marker, `dir` itself (nothing encloses it).
 */
function enclosingProjectRoot(dir: string): string {
  const home = homeDirectory();
  let outermost: string | undefined;
  const worktrees: Array<{ dir: string; repo: string }> = [];
  for (let d = dir; !isFilesystemRoot(d); d = path.dirname(d)) {
    if (home && (d === home || isInside(home, d))) break;
    if (PROJECT_MARKERS.some((m) => fs.existsSync(path.join(d, m)))) outermost = d;
    const repo = worktreeRepository(d);
    if (repo) worktrees.push({ dir: d, repo });
  }
  if (!outermost) return dir;
  // The outermost worktree of the root's own repository.
  const own = worktrees.filter((w) => w.repo === outermost);
  return own.length > 0 ? own[own.length - 1].dir : outermost;
}

/**
 * If `dir/.git` is a FILE naming a registered worktree of a repository whose
 * working tree is an ancestor of `dir` (`<repo>/.git/worktrees/<name>`, with a
 * `gitdir` file there pointing back at `dir/.git`), that ancestor.
 */
function worktreeRepository(dir: string): string | undefined {
  const dotGit = path.join(dir, ".git");
  let text: string;
  try {
    if (!fs.statSync(dotGit).isFile()) return undefined;
    text = fs.readFileSync(dotGit, "utf-8");
  } catch {
    return undefined;
  }
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(text);
  if (!m) return undefined;
  const gitdir = realPath(path.resolve(dir, m[1]));
  const worktreesDir = path.dirname(gitdir);
  const repoGit = path.dirname(worktreesDir);
  if (path.basename(worktreesDir) !== "worktrees" || path.basename(repoGit) !== ".git") {
    return undefined;
  }
  const repo = path.dirname(repoGit);
  if (!isInside(dir, repo)) return undefined;
  try {
    const back = fs.readFileSync(path.join(gitdir, "gitdir"), "utf-8").trim();
    if (realPath(path.resolve(gitdir, back)) !== realPath(dotGit)) return undefined;
  } catch {
    return undefined;
  }
  return repo;
}

/** The project roots (see the section comment) for hosts starting from `bases`. */
function rootsFor(bases: readonly string[]): ProjectRoots {
  const primary: string[] = [];
  const all: string[] = [];
  const add = (list: string[], dir: string) => {
    if (!isFilesystemRoot(dir) && !list.includes(dir)) list.push(dir);
  };
  const starts = bases.map((b) => realPath(b)).filter((b) => !isFilesystemRoot(b));
  const rootOf = new Map<string, string>();
  for (const start of starts) {
    const root = enclosingProjectRoot(start);
    rootOf.set(start, root);
    if (all.includes(root)) continue;
    add(all, root);
    for (const ws of declaredWorkspaces(root)) add(all, realPath(ws));
  }
  const partial: ProjectRoots = { primary: [], all };
  for (const start of starts) {
    const own = owningRoot(partial, start);
    if (own) add(primary, own);
    add(primary, rootOf.get(start)!);
  }
  return { primary, all };
}

/**
 * The directories `program`'s project owns (see the section comment),
 * starting from its tsconfig's directory (`compilerOptions.configFilePath`)
 * -- or, when the host doesn't set it (the CLI doesn't: TypeScript 6 then
 * requires an explicit `rootDir`), the directory holding the program's root
 * files -- and from its current directory. Without a program, the process's
 * cwd stands in.
 */
function projectRootsOf(program?: ts.Program): ProjectRoots {
  if (program) {
    const cached = programRootsCache.get(program);
    if (cached) return cached;
  }
  const bases: string[] = [];
  const configFilePath = program?.getCompilerOptions().configFilePath;
  const cwd = path.resolve(program ? program.getCurrentDirectory() : process.cwd());
  if (typeof configFilePath === "string" && configFilePath) {
    bases.push(path.dirname(path.resolve(cwd, configFilePath)));
  } else if (program) {
    const rootsDir = commonDirectory(program.getRootFileNames().map((f) => path.resolve(cwd, f)));
    if (rootsDir) bases.push(rootsDir);
  }
  bases.push(cwd);
  const key = bases.join("\0");
  let roots = program ? undefined : cwdRootsCache.get(key);
  if (!roots) {
    roots = rootsFor(bases);
    if (!program) cwdRootsCache.set(key, roots);
  }
  if (program) programRootsCache.set(program, roots);
  return roots;
}

/**
 * Load the project's typesugar config (`typesugar.config.*`, `.typesugarrc*`,
 * package.json `"typesugar"`) for a host starting from `startDir` (the
 * tsconfig's directory): the nearest config file in a directory the project
 * owns (see the section comment) -- the workspace package containing
 * `startDir`, then the root. A config file in any other directory (a vendored
 * directory with its own tsconfig) is neither read nor run: config files are
 * code, and they approve macro packages.
 */
export function loadProjectConfig(startDir: string): void {
  const roots = rootsFor([startDir]);
  // From `startDir` itself: directories on the way up that are not owned are
  // not read, but a config file in one is reported (core's searchConfigFile).
  config.load({ searchFrom: startDir, onlyIn: roots.all });
}

/**
 * The directory a NEW config file for the project at `startDir` belongs in
 * (`approve-macros`): the owned directory containing `startDir`, the one
 * `loadProjectConfig` searches first.
 */
export function projectConfigDir(
  startDir: string,
  roots: ProjectRoots = rootsFor([startDir])
): string {
  const start = realPath(startDir);
  return owningRoot(roots, start) ?? roots.primary[0] ?? start;
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
 * The workspace package directories `dir` declares: `pnpm-workspace.yaml`'s
 * `packages:` list and package.json's `workspaces` (an array, or
 * `{ packages: [...] }`), as globs relative to `dir` (`*`, `**`, `?`, and
 * `!`-negations). A shape this does not recognize declares nothing, which
 * only makes fewer directories trusted.
 */
function declaredWorkspaces(dir: string): string[] {
  const patterns: string[] = [];
  try {
    const yaml = fs.readFileSync(path.join(dir, "pnpm-workspace.yaml"), "utf-8");
    patterns.push(...pnpmWorkspacePackages(yaml));
  } catch {
    // No pnpm-workspace.yaml.
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8")) as {
      workspaces?: unknown;
    };
    const ws = Array.isArray(pkg.workspaces)
      ? pkg.workspaces
      : (pkg.workspaces as { packages?: unknown } | undefined)?.packages;
    if (Array.isArray(ws)) patterns.push(...ws.filter((p): p is string => typeof p === "string"));
  } catch {
    // No (readable) package.json.
  }
  return expandWorkspacePatterns(dir, patterns);
}

/** The `packages:` entries of a pnpm-workspace.yaml (block or flow list). */
function pnpmWorkspacePackages(yaml: string): string[] {
  const out: string[] = [];
  const unquote = (s: string) => s.trim().replace(/^(['"])(.*)\1$/, "$2");
  let inPackages = false;
  for (const raw of yaml.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, "");
    if (line.trim() === "") continue;
    if (/^\S/.test(line)) {
      const m = /^packages\s*:\s*(.*)$/.exec(line);
      inPackages = !!m && m[1].trim() === "";
      const flow = m && /^\[(.*)\]$/.exec(m[1].trim());
      if (flow) out.push(...flow[1].split(",").map(unquote).filter(Boolean));
      continue;
    }
    const item = inPackages && /^\s*-\s*(.+)$/.exec(line);
    if (item) out.push(unquote(item[1]));
  }
  return out;
}

function globSegmentRegExp(segment: string): RegExp {
  const body = segment
    .split("")
    .map((c) => (c === "*" ? "[^/]*" : c === "?" ? "[^/]" : c.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${body}$`);
}

/** Directories under `base` matching the workspace globs that have a package.json. */
function expandWorkspacePatterns(base: string, patterns: string[]): string[] {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  const includes = patterns.filter((p) => !p.startsWith("!")).map(norm);
  const excludes = patterns
    .filter((p) => p.startsWith("!"))
    .map((p) => norm(p.slice(1)).split("/"));
  const found = new Set<string>();
  const subdirs = (dir: string) => {
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== "node_modules" && !e.name.startsWith("."))
        .map((e) => e.name);
    } catch {
      return [];
    }
  };
  const walk = (dir: string, segs: string[], depth: number): void => {
    if (segs.length === 0) {
      if (fs.existsSync(path.join(dir, "package.json"))) found.add(dir);
      return;
    }
    if (depth > 12) return;
    const [seg, ...rest] = segs;
    if (seg === "**") {
      walk(dir, rest, depth);
      for (const d of subdirs(dir)) walk(path.join(dir, d), segs, depth + 1);
    } else if (/[*?]/.test(seg)) {
      const re = globSegmentRegExp(seg);
      for (const d of subdirs(dir)) if (re.test(d)) walk(path.join(dir, d), rest, depth + 1);
    } else if (seg === "" || seg === ".") {
      walk(dir, rest, depth);
    } else {
      const next = path.join(dir, seg);
      if (fs.existsSync(next)) walk(next, rest, depth + 1);
    }
  };
  for (const p of includes) walk(base, p.split("/"), 0);
  const matches = (rel: string[], pat: string[]): boolean => {
    if (pat.length === 0) return rel.length === 0;
    if (pat[0] === "**")
      return matches(rel, pat.slice(1)) || (rel.length > 0 && matches(rel.slice(1), pat));
    return (
      rel.length > 0 &&
      globSegmentRegExp(pat[0]).test(rel[0]) &&
      matches(rel.slice(1), pat.slice(1))
    );
  };
  return [...found].filter((dir) => {
    const rel = path.relative(base, dir).split(path.sep);
    return !excludes.some((pat) => matches(rel, pat));
  });
}

/** The deepest owned root containing `dir` (real path), if any. */
function owningRoot(roots: ProjectRoots, dir: string): string | undefined {
  let best: string | undefined;
  for (const r of roots.all) {
    if ((dir === r || isInside(dir, r)) && (!best || r.length > best.length)) best = r;
  }
  return best;
}

/**
 * The owned directories a bare import in a file in `importerDir` resolves
 * from, in order: the owned root containing the file (so a pnpm workspace
 * package's own `node_modules` is used for its files), then the project's
 * primary roots. Never the importing file's own directory.
 */
function resolutionDirs(roots: ProjectRoots, importerDir?: string): string[] {
  const dirs: string[] = [];
  const own = importerDir ? owningRoot(roots, realPath(importerDir)) : undefined;
  if (own) dirs.push(own);
  for (const d of roots.primary) if (!dirs.includes(d)) dirs.push(d);
  return dirs;
}

/** One `NodeRequire` per owned directory. */
const projectRequireCache = new Map<string, NodeRequire>();

/**
 * The `require`s to try, in order, when resolving a macro package by name:
 *
 * 1. each owned directory in `dirs` (see `resolutionDirs`) -- the user's
 *    project. A package installed only in the project (pnpm's strict layout
 *    puts it in the project's `node_modules`, invisible from the
 *    transformer's install) must still load (docs review 2026-10);
 * 2. the transformer's own install -- the pre-1.0 behaviour (its own
 *    dependencies), kept as a fallback for hosts with no project directory.
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
 * is skipped. A package loaded on its own package.json's claim (a project
 * directory, see `RelativeIdentity`) never enters
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
  | { kind: "no-manifest"; dir: string }
  | ({ kind: "manifest"; dir: string } & ManifestFieldInfo);

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
 * Resolve a single package's manifest field, if any, from the owned
 * directories `dirs` (see `resolutionDirs`). Never calls require() — pure
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
    const dir = realPath(resolved.dir);
    result = { kind: "no-manifest", dir };
    const typesugarField = resolved.data.typesugar as { macros?: unknown } | undefined;
    const macrosField = typesugarField?.macros;
    if (typeof macrosField === "string") {
      const target = resolveManifestTarget(pkg, macrosField);
      if (target) {
        result = { kind: "manifest", dir, target, req };
      }
    }
    break;
  }

  manifestFieldCache.set(key, result);
  return result;
}

/** `unverifiedCopyOf` results, per (importer dir, package name). */
const unverifiedCopyCache = new Map<string, string | null>();

/**
 * The directory of a macro-declaring package named `pkg` that a bare import
 * in `importerDir` reaches (Node's directory lookup from the importing file,
 * or the importer's own package self-referencing its name) when the project's
 * own resolution (`found`, from `dirs`) did not produce a macro package
 * there: the copy TypeScript compiles against, which is not loaded. Only for
 * the warning. Only the directories between the importing file and the
 * owned root containing it are looked at: from there up, the lookup is the
 * project's own.
 */
function unverifiedCopyOf(
  pkg: string,
  importerDir: string | undefined,
  found: PackageDiscovery,
  dirs: readonly string[],
  roots: ProjectRoots
): string | undefined {
  if (!importerDir || found.kind === "manifest" || pkg.startsWith("node:")) return undefined;
  const key = `${importerDir}\0${pkg}`;
  let copy = unverifiedCopyCache.get(key);
  if (copy === undefined) {
    copy = null;
    const start = realPath(importerDir);
    const stop = owningRoot(roots, start);
    const own = macroPackageOfRelativeImport(start, ".");
    if (own && own.pkg === pkg && own.dir !== stop && !roots.all.includes(own.dir)) {
      copy = own.dir;
    } else {
      for (let d = start; d !== stop; ) {
        const candidate = path.join(d, "node_modules", ...pkg.split("/"));
        if (fs.existsSync(path.join(candidate, "package.json"))) {
          if (declaresMacros(candidate)) copy = realPath(candidate);
          break;
        }
        const parent = path.dirname(d);
        if (parent === d) break;
        d = parent;
      }
    }
    unverifiedCopyCache.set(key, copy);
  }
  if (!copy || (found.kind === "no-manifest" && found.dir === copy)) return undefined;
  // The project's own lookup reaches that same directory (its package.json is
  // just not resolvable through `require`): the project's package, not a copy.
  for (const dir of dirs) {
    const own = findInNodeModules(pkg, dir);
    if (own && realPath(own) === copy) return undefined;
  }
  return copy;
}

/** Does the package.json in `dir` declare a `typesugar.macros` entry? */
function declaresMacros(dir: string): boolean {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8")) as {
      typesugar?: { macros?: unknown };
    };
    return typeof data.typesugar?.macros === "string";
  } catch {
    return false;
  }
}

/**
 * Classify a set of candidate base package names against the manifest
 * discovery mechanism, resolving each from `fromDir` (default: the
 * directories the current directory's project owns). Returns packages to
 * load (mapped to their resolved target specifier) and packages that
 * declared the field but aren't trusted/approved. Trust is re-checked
 * against the CURRENT `security.allowedMacroPackages` on every call.
 */
export function classifyManifestPackages(
  candidates: Iterable<string>,
  fromDir?: string
): {
  toLoad: Map<string, string>;
  blocked: string[];
} {
  const toLoad = new Map<string, string>();
  const dirs = fromDir ? [realPath(fromDir)] : projectRootsOf().primary;
  const { load, blocked } = classifyCandidates(
    [...candidates].map((pkg) => ({ pkg, dirs })),
    projectRootsOf()
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

/** A bare import of `pkg` in a file in `importerDir` (undefined: no real path). */
interface BareCandidate {
  pkg: string;
  importerDir?: string;
  /** Overrides `resolutionDirs` (`classifyManifestPackages`'s explicit `fromDir`). */
  dirs?: readonly string[];
}

/** A macro package found by a bare import outside the project's resolution (see `unverifiedCopyOf`). */
interface UnverifiedBare {
  pkg: string;
  dir: string;
  importerDir: string;
  from: readonly string[];
}

function classifyCandidates(
  candidates: Iterable<BareCandidate>,
  roots: ProjectRoots
): {
  load: Map<string, ManifestFieldInfo>;
  blocked: string[];
  unresolved: Array<{ pkg: string; from: readonly string[] }>;
  unverified: UnverifiedBare[];
} {
  const load = new Map<string, ManifestFieldInfo>();
  const blocked: string[] = [];
  const unresolved: Array<{ pkg: string; from: readonly string[] }> = [];
  const unverified: UnverifiedBare[] = [];

  for (const { pkg, importerDir, dirs: explicitDirs } of candidates) {
    const dirs = explicitDirs ?? resolutionDirs(roots, importerDir);
    const found = discoverPackage(pkg, dirs);
    const copy = unverifiedCopyOf(pkg, importerDir, found, dirs, roots);
    if (copy && importerDir) {
      if (!unverified.some((u) => u.pkg === pkg && u.dir === copy)) {
        unverified.push({ pkg, dir: copy, importerDir, from: dirs });
      }
      continue;
    }
    if (found.kind === "unresolved") {
      if (expectsMacros(pkg) && !unresolved.some((u) => u.pkg === pkg)) {
        unresolved.push({ pkg, from: dirs });
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

  return { load, blocked, unresolved, unverified };
}

/** The warning for a bare import that reaches a macro package the project does not resolve. */
function unverifiedBareMessage(u: UnverifiedBare): string {
  return (
    `'${u.pkg}' imported from ${u.importerDir} is the macro package at ${u.dir}, but '${u.pkg}' ` +
    `does not resolve there from the project (${u.from.join(", ") || "no project directory"}), ` +
    `so it is not verified and its macros were not loaded. Install it as a dependency of the ` +
    `project or of a workspace package the project declares.`
  );
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
  candidates: BareCandidate[],
  roots: ProjectRoots,
  verbose?: boolean
): { loaded: Set<string>; blocked: string[]; warnings: MacroPackageWarning[] } {
  const { load, blocked, unresolved, unverified } = classifyCandidates(candidates, roots);
  const warnings: MacroPackageWarning[] = [];

  for (const u of unverified) warnings.push({ pkg: u.pkg, message: unverifiedBareMessage(u) });
  for (const { pkg, from } of unresolved) {
    warnings.push({
      pkg,
      message:
        `macro package '${pkg}' could not be resolved` +
        (from.length > 0 ? ` from ${from.join(", ")}` : "") +
        `; its macros will not be expanded. Install it in this project.`,
    });
  }

  const typesugarImporter = candidates.find(({ pkg }) => expectsMacros(pkg));
  if (typesugarImporter) {
    loadPackage(
      "@typesugar/std",
      verbose,
      typesugarImporter.dirs ?? resolutionDirs(roots, typesugarImporter.importerDir)
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
  // A new program may declare different workspaces than the last one.
  programRootsCache.delete(program);
  const roots = projectRootsOf(program);
  // @typesugar/std's macros are part of the built-in set (the derive macro
  // behind `@derive(Destructure)`): `@derive` is a built-in tag, so a file
  // names that derive without importing anything, and a program that imports
  // no typesugar package at all got "Unknown derive: 'Destructure'". A
  // program that imports one loads std anyway (loadDiscoveredPackages), so
  // this is the same set either way. Resolved from the project's own
  // directories, then from typesugar's install; when neither has it, the
  // derive is reported as unknown, as before.
  loadPackage("@typesugar/std", verbose, roots.primary);

  // Load warnings are reported per importing file, as diagnostics, by
  // `loadMacroPackagesFromFile` (the factory calls it for every file).
  const { loaded, blocked } = loadDiscoveredPackages(
    collectBareCandidates(program),
    roots,
    verbose
  );
  const relative = collectRelativeMacroPackages(program, roots);
  loadRelativeMacroPackages(relative, verbose);

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
 * imports, same owned directories):
 *
 * - `blocked`: macro packages whose identity is established but that are not
 *   `@typesugar/*` and not approved (the build fails on these);
 * - `unverified`: macro packages reached by a relative import or a bare
 *   import that the project's own directories do not resolve to them (the
 *   build skips these with a warning; approving a name cannot help).
 */
export function scanMacroPackages(program: ts.Program): {
  blocked: string[];
  unverified: Array<{ pkg: string; dir: string }>;
} {
  const roots = projectRootsOf(program);
  const bare = classifyCandidates(collectBareCandidates(program), roots);
  const blocked = [...bare.blocked];
  const unverified = bare.unverified.map(({ pkg, dir }) => ({ pkg, dir }));
  for (const { rel, identity } of collectRelativeMacroPackages(program, roots).values()) {
    if (identity.kind === "unverified") {
      if (!unverified.some((u) => u.dir === rel.dir))
        unverified.push({ pkg: rel.pkg, dir: rel.dir });
    } else if (!isTrusted(rel.pkg) && !blocked.includes(rel.pkg)) {
      blocked.push(rel.pkg);
    }
  }
  return { blocked, unverified };
}

/**
 * Force-load a specific macro package by name, resolved from the current
 * directory's project (then typesugar's own install).
 * Useful for programmatic use or testing.
 */
export function loadMacroPackage(packageName: string, verbose?: boolean): boolean {
  return loadPackage(packageName, verbose, projectRootsOf().primary);
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

/** Files the loader scans: a program's own sources, not node_modules or declarations. */
function isScannedFile(sourceFile: ts.SourceFile): boolean {
  return !sourceFile.fileName.includes("node_modules") && !sourceFile.isDeclarationFile;
}

/**
 * Load macro packages based on imports (and `export … from` re-exports) in a
 * single source file. Called per-file during transformation to ensure
 * packages are loaded even when the initial program doesn't include all
 * files. `program` decides which directories the project owns (see
 * `projectRootsOf`); without one, the current directory's project.
 */
export function loadMacroPackagesFromFile(
  sourceFile: ts.SourceFile,
  verbose?: boolean,
  program?: ts.Program
): Array<MacroPackageWarning & { node: ModuleDeclaration }> {
  if (!isScannedFile(sourceFile)) return [];
  const roots = projectRootsOf(program);
  const fromDir = importerDir(sourceFile.fileName);
  const bare: BareCandidate[] = [];
  const importOf = new Map<string, ModuleDeclaration>();
  const relative = new Map<string, RelativeImport>();
  const relativeImportOf = new Map<string, ModuleDeclaration>();

  for (const { specifier, node } of moduleDeclarations(sourceFile)) {
    if (!isRelativeSpecifier(specifier)) {
      const basePkg = getBasePackageName(specifier);
      if (basePkg && !importOf.has(basePkg)) {
        bare.push({ pkg: basePkg, importerDir: fromDir });
        importOf.set(basePkg, node);
      }
    } else {
      const rel = addRelative(relative, sourceFile.fileName, specifier, roots);
      if (rel && !relativeImportOf.has(rel.dir)) relativeImportOf.set(rel.dir, node);
    }
  }

  const { blocked, warnings } = loadDiscoveredPackages(bare, roots, verbose);

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
  unverifiedCopyCache.clear();
  cwdRootsCache.clear();
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
  /** How the claimed name was established (independent of the importer). */
  identity: RelativeIdentity;
}

/**
 * - `project`: the package is one of the project's own directories (see
 *   `projectRootsOf`): the project's package, or a workspace package it
 *   declares -- its own build, examples and tests importing `../src`.
 * - `resolved`: the claimed name, looked up as a bare name from a directory
 *   the project owns (Node's `node_modules` lookup, not the package's own
 *   `exports`), lands in this very directory (same real path) -- a workspace
 *   link, a `file:` dependency, or the installed package itself. Trusted
 *   exactly as a bare import of that name is.
 * - `unverified`: neither. Not loaded, whatever it claims.
 */
type RelativeIdentity =
  | { kind: "project" }
  | { kind: "resolved" }
  | { kind: "unverified"; from: readonly string[] };

/** Nearest-package.json lookups, per directory (null: none, or not a macro package). */
const relativePackageCache = new Map<string, RelativeMacroPackage | null>();

/** `relativePackageIdentity` results, per (owned roots, package dir). */
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
 * claimed name stands for (see `RelativeIdentity`). Decided by the project's
 * own directories only, never by where the importing file is: a vendored
 * package's own `.ts` files are pulled into the program by the project's
 * import of it, and from there its own `exports` self-reference (sec1) or its
 * own `node_modules` (secB) would "resolve" any name it likes.
 */
function relativePackageIdentity(rel: RelativeMacroPackage, roots: ProjectRoots): RelativeIdentity {
  const key = `${roots.all.join("\0")}\0\0${rel.dir}`;
  const cached = relativeIdentityCache.get(key);
  if (cached) return cached;

  let identity: RelativeIdentity = { kind: "unverified", from: roots.primary };
  if (roots.all.includes(rel.dir)) {
    identity = { kind: "project" };
  } else if (
    roots.all.some((root) => {
      const found = findInNodeModules(rel.pkg, root);
      return found !== undefined && realPath(found) === rel.dir;
    })
  ) {
    identity = { kind: "resolved" };
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
          `a relative path and '${pkg}' does not resolve to that directory from the project ` +
          `(${identity.from.join(", ") || "no project directory"}), so the name is not trusted ` +
          `and its macros were not loaded. To use them, make it the package that name resolves ` +
          `to (a dependency such as "${pkg}": "file:<path>", or a workspace package the project ` +
          `declares) and, if it is not @typesugar/*, approve it with \`typesugar approve-macros\`.`,
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
      // A project directory's name is its own claim (see `loadedPackageNames`).
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
  specifier: string,
  roots: ProjectRoots
): RelativeMacroPackage | undefined {
  const fromDir = importerDir(fileName);
  if (!fromDir) return undefined;
  const rel = macroPackageOfRelativeImport(fromDir, specifier);
  if (!rel) return undefined;
  const inside = isInside(realPath(fromDir), rel.dir) || realPath(fromDir) === rel.dir;
  // Keyed by directory: two directories may claim one name.
  const prev = found.get(rel.dir);
  found.set(rel.dir, {
    rel,
    insideOnly: (prev?.insideOnly ?? true) && inside,
    identity: prev?.identity ?? relativePackageIdentity(rel, roots),
  });
  return rel;
}

/**
 * The macro packages a program's own files reach by relative imports whose
 * name is established (see `relativePackageIdentity`) but not trusted, and
 * those whose name is not established, which approval cannot fix. See
 * `scanMacroPackages`, which `typesugar approve-macros` uses.
 */
export function classifyRelativeMacroPackages(program: ts.Program): {
  blocked: string[];
  unverified: Array<{ pkg: string; dir: string }>;
} {
  const blocked: string[] = [];
  const unverified: Array<{ pkg: string; dir: string }> = [];
  const roots = projectRootsOf(program);
  for (const { rel, identity } of collectRelativeMacroPackages(program, roots).values()) {
    if (identity.kind === "unverified") unverified.push({ pkg: rel.pkg, dir: rel.dir });
    else if (!isTrusted(rel.pkg) && !blocked.includes(rel.pkg)) blocked.push(rel.pkg);
  }
  return { blocked, unverified };
}

/**
 * Collect all non-relative module specifiers imported (or re-exported)
 * across the program. Only scans user source files (skips node_modules and
 * .d.ts files).
 */
export function collectImportedModules(program: ts.Program): Set<string> {
  return new Set(collectBareCandidates(program).map((c) => c.pkg));
}

/**
 * Every (package, importing directory) pair of a bare import or re-export in
 * the program's scanned files -- the same declarations
 * `loadMacroPackagesFromFile` reads.
 */
function collectBareCandidates(program: ts.Program): BareCandidate[] {
  const out: BareCandidate[] = [];
  const seen = new Set<string>();
  for (const sourceFile of program.getSourceFiles()) {
    if (!isScannedFile(sourceFile)) continue;
    const fromDir = importerDir(sourceFile.fileName);
    for (const { specifier } of moduleDeclarations(sourceFile)) {
      if (isRelativeSpecifier(specifier)) continue;
      const pkg = getBasePackageName(specifier);
      const key = `${fromDir ?? ""}\0${pkg}`;
      if (!pkg || seen.has(key)) continue;
      seen.add(key);
      out.push({ pkg, importerDir: fromDir });
    }
  }
  return out;
}

/** The macro packages the program's own files reach by relative imports or re-exports. */
function collectRelativeMacroPackages(
  program: ts.Program,
  roots: ProjectRoots
): Map<string, RelativeImport> {
  const found = new Map<string, RelativeImport>();
  for (const sourceFile of program.getSourceFiles()) {
    if (!isScannedFile(sourceFile)) continue;
    for (const { specifier } of moduleDeclarations(sourceFile)) {
      if (isRelativeSpecifier(specifier)) addRelative(found, sourceFile.fileName, specifier, roots);
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
