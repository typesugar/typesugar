/**
 * Node.js module hooks for running TypeScript through typesugar
 * (`node --import typesugar/register`).
 *
 * This module is the hook plumbing only. It imports nothing but Node
 * builtins, because `register` runs in every Node process the flag reaches
 * (including tsx's own CLI process, and every child of `NODE_OPTIONS`), and
 * most of those never load a TypeScript file. The compiler -- TypeScript, the
 * macro registry, the pipeline -- is required lazily, on the first
 * TypeScript module, from `node-loader-compile`.
 *
 * Contract, per TypeScript module (`.ts`/`.mts`/`.cts`/`.tsx`, not `.d.ts`,
 * not under node_modules):
 *
 * - typesugar expands the file from disk. If the expansion changes nothing,
 *   the hook returns exactly what the rest of the chain returns (Node's own
 *   type stripping, or tsx), so a project with no macros runs as if typesugar
 *   were not installed.
 * - If the expansion changes the file, the hook returns the compiled
 *   JavaScript and short-circuits the chain.
 * - A macro error throws, so the import fails instead of running raw macro
 *   calls.
 *
 * Because the source is read from disk rather than from the next loader,
 * this works whether typesugar is registered before or after tsx: neither
 * loader ever sees the other's output as its input.
 *
 * The resolve hook adds one rule, TypeScript's own: a relative `./x.js`
 * imported from a TypeScript file that does not exist resolves to `./x.ts`
 * (`.mjs` -> `.mts`, `.cjs` -> `.cts`, `.jsx` -> `.tsx`). tsx does this too;
 * Node's type stripping does not.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** The module systems the loader emits. */
export type LoaderModuleFormat = "module" | "commonjs";

/** Output of compiling one file for the loader. */
export type LoaderCompileOutput =
  | { changed: false }
  | { changed: true; source: string; format: LoaderModuleFormat };

/** The heavy half of the loader: expands and compiles one file. */
export interface LoaderCompiler {
  /**
   * Expand `fileName` and, if that changed it, compile it to JavaScript in
   * `format` (`undefined`: decide from the file's syntax, as Node does for a
   * package without a `type`). Throws on macro errors.
   */
  compile(fileName: string, format: LoaderModuleFormat | undefined): LoaderCompileOutput;
}

export interface NodeLoaderHooksOptions {
  /**
   * Creates the compiler on the first TypeScript module. Default: the
   * built `node-loader-compile` module next to this one.
   */
  createCompiler?: () => LoaderCompiler;
}

/** The subset of Node's hook context/result types the loader reads (Node's own types vary by @types/node version). */
export interface ResolveContext {
  parentURL?: string;
  conditions?: string[];
  [key: string]: unknown;
}
export interface ResolveResult {
  url: string;
  format?: string | null;
  shortCircuit?: boolean;
  [key: string]: unknown;
}
export interface LoadContext {
  format?: string | null;
  conditions?: string[];
  [key: string]: unknown;
}
export interface LoadResult {
  format?: string | null;
  source?: string | ArrayBuffer | Uint8Array | null;
  shortCircuit?: boolean;
  [key: string]: unknown;
}

export type NextResolve = (specifier: string, context?: ResolveContext) => ResolveResult;
export type NextLoad = (url: string, context?: LoadContext) => LoadResult;
export type NextResolveAsync = (
  specifier: string,
  context?: ResolveContext
) => ResolveResult | Promise<ResolveResult>;
export type NextLoadAsync = (
  url: string,
  context?: LoadContext
) => LoadResult | Promise<LoadResult>;

export interface NodeLoaderHooks {
  /** For `module.registerHooks()` (synchronous, in-thread). */
  resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve): ResolveResult;
  load(url: string, context: LoadContext, nextLoad: NextLoad): LoadResult;
  /** For `module.register()` (asynchronous, off-thread), on Node without `registerHooks`. */
  resolveAsync(
    specifier: string,
    context: ResolveContext,
    nextResolve: NextResolveAsync
  ): Promise<ResolveResult>;
  loadAsync(url: string, context: LoadContext, nextLoad: NextLoadAsync): Promise<LoadResult>;
}

const TS_SOURCE = /\.(?:[cm]?ts|tsx)$/i;
const DECLARATION = /\.d\.[cm]?ts$/i;
const NODE_MODULES = /(?:^|[\\/])node_modules[\\/]/;

/** Whether the loader expands this file: TypeScript source outside node_modules. */
export function isLoaderCandidate(fileName: string): boolean {
  return TS_SOURCE.test(fileName) && !DECLARATION.test(fileName) && !NODE_MODULES.test(fileName);
}

/** `file:` URL -> path (query and hash dropped), or undefined for other schemes. */
function filePathOf(url: string): string | undefined {
  if (!url.startsWith("file:")) return undefined;
  try {
    return fileURLToPath(new URL(url));
  } catch {
    return undefined;
  }
}

/** Nearest package.json `type`, cached per directory. */
const packageTypeCache = new Map<string, string | undefined>();
function nearestPackageType(dir: string): string | undefined {
  if (packageTypeCache.has(dir)) return packageTypeCache.get(dir);
  let type: string | undefined;
  const pkgPath = path.join(dir, "package.json");
  let found = false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { type?: unknown };
    found = true;
    type = typeof pkg.type === "string" ? pkg.type : undefined;
  } catch {
    // No (readable) package.json here.
  }
  if (!found) {
    const parent = path.dirname(dir);
    type = parent === dir ? undefined : nearestPackageType(parent);
  }
  packageTypeCache.set(dir, type);
  return type;
}

/**
 * The module system Node will run `fileName` as: the resolver's choice when
 * it made one, else the extension, else the nearest package.json `type`.
 * `undefined` when only the syntax can tell (no `type` field).
 */
function moduleFormatFor(
  fileName: string,
  contextFormat: string | null | undefined
): LoaderModuleFormat | undefined {
  switch (contextFormat) {
    case "module":
    case "module-typescript":
      return "module";
    case "commonjs":
    case "commonjs-typescript":
      return "commonjs";
  }
  if (/\.mts$/i.test(fileName)) return "module";
  if (/\.cts$/i.test(fileName)) return "commonjs";
  const type = nearestPackageType(path.dirname(fileName));
  if (type === "module") return "module";
  if (type === "commonjs") return "commonjs";
  return undefined;
}

/** TypeScript-source spellings to try for a missing relative JS specifier. */
function typeScriptAlternative(
  specifier: string,
  parentURL: string | undefined
): string | undefined {
  if (!parentURL) return undefined;
  const parent = filePathOf(parentURL);
  if (!parent || !TS_SOURCE.test(parent)) return undefined;
  const relativeOrAbsolute =
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("/") ||
    specifier.startsWith("file:");
  if (!relativeOrAbsolute) return undefined;
  const m = /\.(m|c)?js(x)?$/.exec(specifier);
  if (!m) return undefined;
  const ext = m[2] ? ".tsx" : `.${m[1] ?? ""}ts`;
  return specifier.slice(0, -m[0].length) + ext;
}

function isNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
}

/** Default compiler factory: the built compile module beside this file. */
function defaultCreateCompiler(): LoaderCompiler {
  // CommonJS on purpose: it loads synchronously on every Node the loader
  // supports (a sync `registerHooks` load hook cannot `await import()`), and
  // the macro loader already loads macro packages with require().
  const require = createRequire(import.meta.url);
  const mod = require("./node-loader-compile.cjs") as {
    createLoaderCompiler: () => LoaderCompiler;
  };
  return mod.createLoaderCompiler();
}

export function createNodeLoaderHooks(options: NodeLoaderHooksOptions = {}): NodeLoaderHooks {
  let compiler: LoaderCompiler | undefined;
  const getCompiler = (): LoaderCompiler =>
    (compiler ??= (options.createCompiler ?? defaultCreateCompiler)());

  /** The short-circuit result for a file typesugar changed, else undefined. */
  function compiled(url: string, context: LoadContext): LoadResult | undefined {
    const fileName = filePathOf(url);
    if (!fileName || !isLoaderCandidate(fileName)) return undefined;
    const out = getCompiler().compile(fileName, moduleFormatFor(fileName, context.format));
    if (!out.changed) return undefined;
    return { format: out.format, source: out.source, shortCircuit: true };
  }

  return {
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        const alternative = isNotFound(error)
          ? typeScriptAlternative(specifier, context.parentURL)
          : undefined;
        if (alternative === undefined) throw error;
        try {
          return nextResolve(alternative, context);
        } catch {
          throw error;
        }
      }
    },

    load(url, context, nextLoad) {
      return compiled(url, context) ?? nextLoad(url, context);
    },

    async resolveAsync(specifier, context, nextResolve) {
      try {
        return await nextResolve(specifier, context);
      } catch (error) {
        const alternative = isNotFound(error)
          ? typeScriptAlternative(specifier, context.parentURL)
          : undefined;
        if (alternative === undefined) throw error;
        try {
          return await nextResolve(alternative, context);
        } catch {
          throw error;
        }
      }
    },

    async loadAsync(url, context, nextLoad) {
      return compiled(url, context) ?? (await nextLoad(url, context));
    },
  };
}
