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
import { createPipeline, type TransformationPipeline } from "@typesugar/transformer";

export interface TypesugarPluginOptions {
  /** Path to tsconfig.json (default: auto-detected) */
  tsconfig?: string;

  /** File patterns to include (default: /\.[jt]sx?$/) */
  include?: RegExp | string[];

  /** File patterns to exclude (default: /node_modules/) */
  exclude?: RegExp | string[];

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

function shouldTransform(
  id: string,
  include?: RegExp | string[],
  exclude?: RegExp | string[]
): boolean {
  const normalizedId = id.replace(/\\/g, "/");

  // Check exclude first
  if (exclude) {
    if (exclude instanceof RegExp) {
      if (exclude.test(normalizedId)) return false;
    } else {
      if (exclude.some((pattern) => normalizedId.includes(pattern))) return false;
    }
  } else {
    if (/node_modules/.test(normalizedId)) return false;
  }

  // Check include
  if (include) {
    if (include instanceof RegExp) {
      return include.test(normalizedId);
    }
    return include.some((pattern) => normalizedId.includes(pattern));
  }

  return /\.[jt]sx?$/.test(normalizedId);
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

  function ensurePipeline(): TransformationPipeline | undefined {
    if (pipeline || setupError) return pipeline;
    try {
      const configPath = findTsConfig(root, options?.tsconfig);
      pipeline = createPipeline(configPath, {
        verbose,
        diskCache: options?.diskCache,
        strict: options?.strict,
        emitJs,
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
      return shouldTransform(fileOf(id), options?.include, options?.exclude);
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
      if (pipeline) {
        // Run strict mode typecheck if enabled
        if (options?.strict) {
          const diagnostics = pipeline.strictTypecheck();
          if (diagnostics.length > 0) {
            console.error(
              `[typesugar] Strict mode found ${diagnostics.length} type errors in expanded output:`
            );
            for (const diag of diagnostics) {
              const file = diag.file?.fileName ?? "<unknown>";
              const msg = ts.flattenDiagnosticMessageText(diag.messageText, "\n");
              const pos = diag.start
                ? diag.file?.getLineAndCharacterOfPosition(diag.start)
                : undefined;
              const loc = pos ? `:${pos.line + 1}:${pos.character + 1}` : "";
              console.error(`  ${file}${loc}: ${msg}`);
            }
          }
        }
        pipeline.cleanup();
      }
    },
  };
};

export const unplugin = /*#__PURE__*/ createUnplugin(unpluginFactory);
