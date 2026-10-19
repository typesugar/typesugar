/**
 * typesugar unplugin integration
 *
 * Universal plugin that works with Vite, Rollup, Webpack, esbuild, and Rspack.
 * Uses the unified TransformationPipeline from @typesugar/transformer for all
 * transformation logic.
 */

import * as ts from "typescript";
import * as path from "path";
import { createUnplugin, type UnpluginFactory } from "unplugin";
import { createFilter } from "@rollup/pluginutils";
import { createPipeline, type TransformationPipeline } from "@typesugar/transformer";

export interface TypesugarPluginOptions {
  /** Path to tsconfig.json (default: auto-detected) */
  tsconfig?: string;

  /**
   * Files to transform: a RegExp, a glob, or an array of either (default:
   * `/\.[jt]sx?$/`). Globs use picomatch syntax and are matched against the
   * absolute module path; a relative glob (`"src/**\/*.ts"`) is resolved
   * against the project root (Vite's `root`, else the working directory),
   * and one starting with `**` matches anywhere.
   */
  include?: RegExp | string | Array<RegExp | string>;

  /**
   * Files to skip, in the same forms as `include`. Files under
   * `node_modules` are always skipped too, unless an `include` pattern
   * names `node_modules` explicitly.
   */
  exclude?: RegExp | string | Array<RegExp | string>;

  /** Enable verbose logging */
  verbose?: boolean;

  /** Enable disk-backed transform cache */
  diskCache?: boolean | string;

  /**
   * Enable strict mode — typecheck expanded output at build end.
   *
   * - `true`: Full typecheck of all files on every build
   * - `"incremental"`: Only typecheck files whose macro output changed
   *   (+ their dependents). Falls back to full on first build.
   * - `false` / `undefined`: No strict typecheck
   */
  strict?: boolean | "incremental";

  /**
   * Conditions for `cfg()` / `@cfgAttr` conditional compilation, e.g.
   * `{ debug: true, platform: "node" }`. Same as the `cfgConfig` key of the
   * tsconfig transformer plugin entry.
   */
  cfgConfig?: Record<string, unknown>;
}

function findTsConfig(cwd: string, explicit?: string): string {
  if (explicit) {
    return path.resolve(cwd, explicit);
  }

  const found = ts.findConfigFile(cwd, ts.sys.fileExists, "tsconfig.json");
  if (!found) {
    throw new Error(
      `[typesugar] Could not find tsconfig.json from ${cwd}. ` +
        `Pass the tsconfig option to specify the path explicitly.`
    );
  }
  return found;
}

type FilterPattern = RegExp | string | Array<RegExp | string>;

const DEFAULT_INCLUDE = /\.[jt]sx?$/;

/** Whether any include pattern names node_modules (an explicit opt-in). */
function includesNodeModules(include: FilterPattern | undefined): boolean {
  if (include === undefined) return false;
  const list = Array.isArray(include) ? include : [include];
  return list.some((p) => (p instanceof RegExp ? p.source : p).includes("node_modules"));
}

/**
 * Build the include/exclude predicate: real glob semantics for strings
 * (docs review 2026-10: they used to be substring matches, so documented
 * values like `"**\/*.ts"` matched nothing and silently turned the plugin
 * off), RegExps as before, and node_modules excluded unless explicitly
 * included -- passing an `exclude` no longer drops that default.
 */
function createTransformFilter(
  include: FilterPattern | undefined,
  exclude: FilterPattern | undefined,
  root: string
): (id: string) => boolean {
  // An explicitly empty include list matches nothing (as it did before
  // globs). createFilter alone would read `[]` as "no include filter" and
  // accept every module, CSS and JSON included.
  if (Array.isArray(include) && include.length === 0) return () => false;
  const filter = createFilter(include ?? DEFAULT_INCLUDE, exclude, { resolve: root });
  const keepNodeModules = includesNodeModules(include);
  return (id) => {
    const normalizedId = id.replace(/\\/g, "/");
    // `(^|/)`: a relative id (`node_modules/x.js`) is under node_modules too.
    if (!keepNodeModules && /(^|\/)node_modules\//.test(normalizedId)) return false;
    return filter(normalizedId);
  };
}

/**
 * Determine whether the transpile step (emitJs) is needed for the given bundler.
 *
 * Bundlers that use esbuild/swc for TS→JS need pre-transpiled JavaScript because
 * they don't support namespaces, const enums, or declaration merging.
 * Webpack with ts-loader uses tsc which handles these constructs natively.
 */
function needsEmitJs(framework: string): boolean {
  switch (framework) {
    case "esbuild":
    case "vite": // Vite uses esbuild for TS transpilation
    case "rolldown": // Rolldown uses swc/oxc
    case "farm": // Farm uses swc
      return true;
    case "webpack": // May use ts-loader (tsc) — skip transpile by default
    case "rspack": // Rspack uses swc but has better TS support
      return false;
    case "rollup": // Rollup typically uses @rollup/plugin-typescript (tsc)
    default:
      // For unknown bundlers, emit JS to be safe
      return true;
  }
}

/** Strip a bundler query/hash suffix (`/a.ts?v=123`, `/a.vue?vue&type=script`). */
function fileOf(id: string): string {
  const q = id.search(/[?#]/);
  return q === -1 ? id : id.slice(0, q);
}

/** 1-based line / 0-based column of `pos` in `text` (Rollup/Vite `loc` convention). */
function lineColumn(text: string, pos: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < pos && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: pos - lineStart };
}

export const unpluginFactory: UnpluginFactory<TypesugarPluginOptions | undefined> = (
  options = {},
  meta
) => {
  let pipeline: TransformationPipeline | undefined;
  /** Error from creating the pipeline; reported (fatally) by buildStart/transform. */
  let setupError: unknown;
  const verbose = options?.verbose ?? false;
  const emitJs = needsEmitJs(meta?.framework ?? "unknown");
  /** Project root: Vite's `config.root` when known, else process.cwd(). */
  let root = process.cwd();
  /**
   * The latest `code` the bundler handed us per file. Earlier plugins in the
   * chain may already have rewritten the file, so the pipeline must transform
   * THIS text, not re-read the file from disk (review #20).
   */
  const latestCode = new Map<string, string>();
  /** include/exclude predicate, rebuilt if the root changes. */
  let transformFilter: { root: string; test: (id: string) => boolean } | undefined;

  function ensurePipeline(): TransformationPipeline | undefined {
    if (pipeline || setupError) return pipeline;
    try {
      const configPath = findTsConfig(root, options?.tsconfig);
      pipeline = createPipeline(configPath, {
        verbose,
        diskCache: options?.diskCache,
        strict: options?.strict,
        emitJs,
        transformerConfig: options?.cfgConfig ? { cfgConfig: options.cfgConfig } : undefined,
        readFile: (f) => latestCode.get(path.normalize(f)) ?? ts.sys.readFile(f),
      });
      if (verbose) {
        console.log(`[typesugar] Loaded config from ${configPath}`);
        console.log(`[typesugar] Program has ${pipeline.getFileNames().length} files`);
        console.log(`[typesugar] Framework: ${meta?.framework ?? "unknown"}, emitJs: ${emitJs}`);
      }
    } catch (error) {
      setupError = error;
    }
    return pipeline;
  }

  return {
    name: "typesugar",
    enforce: "pre",

    vite: {
      configResolved(config) {
        if (config.root) root = config.root;
      },
      // HMR: an edit to a file must also re-run macros in the files that
      // depend on it (a derive/reflect macro reads the dependency's types).
      handleHotUpdate(ctx) {
        if (!pipeline) return;
        const file = path.normalize(ctx.file);
        latestCode.delete(file);
        const dependents = pipeline.getDependents(file);
        pipeline.invalidate(file);
        if (dependents.size === 0) return;
        const mods = new Set(ctx.modules);
        for (const dep of dependents) {
          for (const m of ctx.server.moduleGraph.getModulesByFile(dep) ?? []) mods.add(m);
        }
        return [...mods];
      },
    },

    buildStart() {
      ensurePipeline();
      if (setupError) {
        // Fail the build visibly: continuing would ship raw, unexpanded
        // macro source (review #6).
        console.error(
          `[typesugar] failed to initialise: ${setupError instanceof Error ? setupError.message : String(setupError)}`
        );
        throw setupError instanceof Error ? setupError : new Error(String(setupError));
      }
    },

    transformInclude(id) {
      if (transformFilter?.root !== root) {
        transformFilter = {
          root,
          test: createTransformFilter(options?.include, options?.exclude, root),
        };
      }
      return transformFilter.test(fileOf(id));
    },

    transform(code, id) {
      if (typeof code !== "string") return null;
      const p = ensurePipeline();
      if (!p) {
        const msg = `[typesugar] failed to initialise: ${setupError instanceof Error ? setupError.message : String(setupError)}`;
        this?.error?.(msg);
        throw new Error(msg);
      }

      const file = path.normalize(fileOf(id));
      if (latestCode.get(file) !== code) {
        latestCode.set(file, code);
        p.invalidate(file);
      }

      const result = p.transform(file);

      // Re-run when anything this file's expansion depends on changes.
      for (const dep of result.dependencies ?? []) {
        this?.addWatchFile?.(dep);
      }

      // Report macro diagnostics through the bundler (review #6): errors
      // fail the build, warnings are shown. A pipeline crash ("Transform
      // failed", including UnapprovedMacroPackagesError) is an error too --
      // it used to return unchanged code, shipping raw macro source.
      const errors: string[] = [];
      let firstErrorLoc: { line: number; column: number; file: string } | undefined;
      for (const d of result.diagnostics) {
        const loc = { ...lineColumn(result.original || code, d.start), file };
        if (d.severity === "error") {
          firstErrorLoc ??= loc;
          errors.push(`${file}:${loc.line}:${loc.column + 1}: [typesugar] ${d.message}`);
        } else {
          this?.warn?.({ id: file, message: `[typesugar] ${d.message}`, loc, plugin: "typesugar" });
        }
      }
      if (errors.length > 0) {
        const message = errors.join("\n");
        this?.error?.({ id: file, message, loc: firstErrorLoc, plugin: "typesugar" });
        // this.error throws in Rollup/Vite; make sure no bundler continues.
        throw new Error(message);
      }

      // Only return if the code actually changed
      if (!result.changed) {
        return null;
      }

      if (verbose) {
        console.log(`[typesugar] Transformed ${file} (${result.code.length} chars)`);
      }

      return {
        code: result.js ?? result.code,
        map: result.jsSourceMap ?? result.sourceMap,
      };
    },

    // File watcher integration for cache invalidation
    watchChange(id) {
      if (pipeline) {
        const file = path.normalize(fileOf(id));
        latestCode.delete(file);
        pipeline.invalidate(file);
        if (verbose) {
          console.log(`[typesugar] Invalidated cache for ${file}`);
        }
      }
    },

    // Cleanup at end of build: save caches, print profiling report, run strict typecheck
    buildEnd() {
      if (!pipeline) return;
      let strictErrors: string | undefined;
      try {
        // Strict mode: type errors in the expanded output fail the build
        // (docs review 2026-10: they used to be console.error'd only, so a CI
        // gate built on `strict: true` passed with type errors).
        if (options?.strict) {
          const diagnostics = pipeline
            .strictTypecheck()
            .filter((d) => d.category === ts.DiagnosticCategory.Error);
          if (diagnostics.length > 0) {
            const lines = diagnostics.map((diag) => {
              const file = diag.file?.fileName ?? "<unknown>";
              const msg = ts.flattenDiagnosticMessageText(diag.messageText, "\n");
              const pos =
                diag.file && diag.start !== undefined
                  ? diag.file.getLineAndCharacterOfPosition(diag.start)
                  : undefined;
              const loc = pos ? `:${pos.line + 1}:${pos.character + 1}` : "";
              return `  ${file}${loc}: ${msg}`;
            });
            strictErrors =
              `[typesugar] Strict mode found ${diagnostics.length} type error(s) in expanded output:\n` +
              lines.join("\n");
          }
        }
      } finally {
        pipeline.cleanup();
      }
      if (strictErrors) {
        // Rollup/Vite's buildEnd context has error(), which throws; other
        // bundlers fail the build on the thrown error (webpack: emit hook
        // rejection, esbuild: onEnd error).
        (this as { error?: (message: string) => void } | undefined)?.error?.(strictErrors);
        throw new Error(strictErrors);
      }
    },
  };
};

export const unplugin = /*#__PURE__*/ createUnplugin(unpluginFactory);
