/**
 * Config-file discovery and loading for `config.ts`.
 *
 * Kept separate from `config.ts` so the (Node-only) file-system side is in
 * one place. Everything here is synchronous: `config.get()` is called from
 * inside macro expansion, which has no async boundary.
 *
 * Deep review 2026-10 fixes collected here (core findings):
 *
 * - #19: `cosmiconfig` is a real `dependencies` entry of `@typesugar/core`
 *   (it used to resolve only through the private workspace root).
 * - #20/#53: a config file that was FOUND but failed to load, and "file
 *   config cannot be loaded at all" (no `process.getBuiltinModule`, or no
 *   cosmiconfig), are reported as distinct results instead of both looking
 *   like "no config file". `config.ts` warns and exposes them through
 *   `config.getLoadError()`.
 * - #34: `.ts` (and `.js`) config files are transpiled with
 *   `ts.transpileModule` and evaluated IN MEMORY (`Module#_compile`), not via
 *   cosmiconfig's default sync TS loader, which writes `<config>.cjs` next to
 *   the source and deletes it afterwards. That raced between concurrent
 *   processes, failed on read-only trees, and could leave a stale `.cjs`
 *   behind that shadowed later edits. In-memory evaluation also never goes
 *   through `require`'s module cache, so a reload sees the edited file.
 * - #35: the search walks UP from the start directory (nearest config wins),
 *   stopping after a directory that contains `.git` (the repository root)
 *   or at the filesystem root. cosmiconfig's own `searchStrategy` isn't used
 *   for the walk: its default (`"none"`) looks only in the start directory,
 *   and in 9.0.0 the `"project"` strategy's package.json stop check is a
 *   `break` out of the inner loop only, so it actually walks to `/`.
 * - #36: an ESM `export default {...}` `.js` config (natural in a
 *   `"type": "module"` project) is unwrapped to its default export instead
 *   of the module namespace object being used as the config.
 * - #37: within a directory, `typesugar.config.*` and `.typesugarrc*` win
 *   over package.json, and a package.json `"typesugar"` field that is only
 *   the PEP-055 macro manifest (`{ "macros": ... }`) is not project config.
 */

import type * as TS from "typescript";

const MODULE_NAME = "typesugar";

/**
 * Search order WITHIN one directory. package.json is last (#37).
 *
 * NOTE: no `.mjs` entries. `cosmiconfigSync`'s ExplorerSync validates every
 * searchPlaces entry has a sync-compatible loader AT CONSTRUCTION TIME — a
 * `.mjs` (ESM) file has none — so including it throws immediately and
 * discards ALL file-based config for every project.
 */
export const CONFIG_SEARCH_PLACES = [
  `${MODULE_NAME}.config.ts`,
  `${MODULE_NAME}.config.js`,
  `${MODULE_NAME}.config.cjs`,
  `.${MODULE_NAME}rc`,
  `.${MODULE_NAME}rc.json`,
  `.${MODULE_NAME}rc.yaml`,
  `.${MODULE_NAME}rc.yml`,
  `.${MODULE_NAME}rc.js`,
  `.${MODULE_NAME}rc.cjs`,
  `.${MODULE_NAME}rc.ts`,
  "package.json",
];

export type ConfigFileSearchResult =
  /** A config file was found and loaded. */
  | { kind: "found"; filepath: string; config: Record<string, unknown> }
  /** No config file anywhere on the search path. */
  | { kind: "none" }
  /** A config file was found but evaluating/parsing it threw. */
  | { kind: "failed"; filepath: string | undefined; error: Error }
  /** File-based config can't be loaded in this runtime at all. */
  | { kind: "unavailable"; reason: string };

/**
 * Get a working `require()` for loading `cosmiconfig`, or `undefined` if
 * none is available (browser, or a Node older than 20.16 / 22.3, which lack
 * `process.getBuiltinModule`).
 *
 * `@typesugar/core` builds to (and is consumed as) BOTH a browser bundle
 * (via `packages/playground`, which bundles this package's ESM output
 * directly with `platform: 'browser'`) and Node CJS/ESM — so this can NOT
 * be a static `import { createRequire } from "module"` at the top of the
 * file: esbuild resolves static import specifiers at BUNDLE time
 * regardless of whether the code path ever runs, and "module" doesn't
 * exist for a browser target, hard-failing the playground build. A plain
 * `require("module")` doesn't work either — tsup rewrites bare `require()`
 * calls in ESM output through a runtime shim that itself depends on an
 * ambient `require` existing, which real Node ESM (`dist/index.js`) doesn't
 * have.
 *
 * `process.getBuiltinModule(id)` sidesteps both problems: it's a plain
 * runtime property access on `process`, invisible to bundler static
 * analysis, and works in real Node ESM without an ambient `require`.
 */
function getNodeRequire(): NodeRequire | undefined {
  const proc = globalThis as unknown as {
    process?: { getBuiltinModule?: (id: string) => unknown };
  };
  const moduleBuiltin = proc.process?.getBuiltinModule?.("module") as
    | typeof import("module")
    | undefined;
  if (!moduleBuiltin) return undefined;
  return moduleBuiltin.createRequire(import.meta.url);
}

/** True when running under Node (as opposed to a browser bundle). */
export function isNodeRuntime(): boolean {
  const proc = (globalThis as { process?: { versions?: { node?: string } } }).process;
  return typeof proc?.versions?.node === "string";
}

type CosmiconfigSync = (
  name: string,
  options: {
    searchPlaces: string[];
    searchStrategy: "none";
    cache: boolean;
    ignoreEmptySearchPlaces: boolean;
    loaders: Record<string, (filepath: string, content: string) => unknown>;
  }
) => {
  search: (from: string) => { filepath: string; config?: unknown; isEmpty?: boolean } | null;
};

interface NodeModuleCtor {
  new (
    id: string,
    parent?: unknown
  ): {
    filename: string;
    paths: string[];
    exports: unknown;
    _compile(code: string, filename: string): void;
  };
  _nodeModulePaths(dir: string): string[];
}

/** `export default x` compiled to CJS (or `require(esm)`) → `x`. */
function unwrapDefault(value: unknown): unknown {
  if (value && typeof value === "object") {
    const v = value as { __esModule?: unknown; [Symbol.toStringTag]?: unknown; default?: unknown };
    if (v.__esModule || v[Symbol.toStringTag] === "Module") {
      // An ES module with no default export has no config in it.
      return "default" in v ? v.default : {};
    }
  }
  return value;
}

function makeInMemoryLoaders(nodeRequire: NodeRequire) {
  const path = nodeRequire("path") as typeof import("path");
  const Module = nodeRequire("module") as unknown as NodeModuleCtor;
  let ts: typeof TS | undefined;

  const compile = (filepath: string, code: string): unknown => {
    const m = new Module(filepath);
    m.filename = filepath;
    m.paths = Module._nodeModulePaths(path.dirname(filepath));
    m._compile(code, filepath);
    return unwrapDefault(m.exports);
  };

  const transpile = (filepath: string, content: string): string => {
    if (!ts) {
      try {
        ts = nodeRequire("typescript") as typeof TS;
      } catch (e) {
        throw new Error(
          `Cannot load ${filepath}: the "typescript" package (a peer dependency of ` +
            `@typesugar/core) is required to evaluate .ts/.js config files: ${String(e)}`
        );
      }
    }
    return ts.transpileModule(content, {
      fileName: filepath,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        allowJs: true,
        sourceMap: false,
        inlineSourceMap: false,
      },
    }).outputText;
  };

  const loadTranspiled = (filepath: string, content: string) =>
    compile(filepath, transpile(filepath, content));
  const loadCjs = (filepath: string, content: string) => compile(filepath, content);

  return { ".ts": loadTranspiled, ".js": loadTranspiled, ".cjs": loadCjs };
}

/** A package.json `typesugar` field that only holds the PEP-055 macro manifest. */
function isMacroManifestOnly(filepath: string, cfg: unknown): boolean {
  if (!filepath.endsWith("package.json")) return false;
  if (!cfg || typeof cfg !== "object") return false;
  const keys = Object.keys(cfg);
  return keys.length > 0 && keys.every((k) => k === "macros");
}

/**
 * Find and load the nearest config file, walking up from `searchFrom`.
 * Never throws; every outcome is a distinct result kind.
 */
export function searchConfigFile(searchFrom: string): ConfigFileSearchResult {
  const nodeRequire = getNodeRequire();
  if (!nodeRequire) {
    return {
      kind: "unavailable",
      reason:
        "this runtime has no process.getBuiltinModule (Node >= 20.16 / 22.3 is " +
        "required for config-file loading)",
    };
  }

  let cosmiconfigSync: CosmiconfigSync;
  try {
    ({ cosmiconfigSync } = nodeRequire("cosmiconfig") as { cosmiconfigSync: CosmiconfigSync });
  } catch (e) {
    return {
      kind: "unavailable",
      reason: `the "cosmiconfig" package could not be loaded: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const path = nodeRequire("path") as typeof import("path");
  const fs = nodeRequire("fs") as typeof import("fs");

  let explorer: ReturnType<CosmiconfigSync>;
  try {
    explorer = cosmiconfigSync(MODULE_NAME, {
      searchPlaces: CONFIG_SEARCH_PLACES,
      searchStrategy: "none",
      cache: false,
      // An empty `typesugar.config.ts` is still "the config file" — don't
      // skip past it to a parent directory's config.
      ignoreEmptySearchPlaces: false,
      loaders: makeInMemoryLoaders(nodeRequire),
    });
  } catch (e) {
    return { kind: "failed", filepath: undefined, error: toError(e) };
  }

  let dir = path.resolve(searchFrom);
  for (;;) {
    let result: ReturnType<ReturnType<CosmiconfigSync>["search"]>;
    try {
      result = explorer.search(dir);
    } catch (e) {
      const err = toError(e);
      return { kind: "failed", filepath: (err as { filepath?: string }).filepath, error: err };
    }
    if (result && !isMacroManifestOnly(result.filepath, result.config)) {
      const cfg = unwrapDefault(result.config);
      if (cfg !== undefined && cfg !== null && typeof cfg !== "object") {
        return {
          kind: "failed",
          filepath: result.filepath,
          error: new Error(`config must be an object, got ${typeof cfg}`),
        };
      }
      return {
        kind: "found",
        filepath: result.filepath,
        config: (cfg ?? {}) as Record<string, unknown>,
      };
    }
    if (fs.existsSync(path.join(dir, ".git"))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { kind: "none" };
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}
