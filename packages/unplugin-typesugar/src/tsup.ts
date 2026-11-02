/**
 * typesugar for tsup, including `dts: true`.
 *
 * tsup's `dts` step type-checks the UNEXPANDED source (Turf case study, F5):
 * a fluent `match()` with binding patterns fails it with TS2304, and an
 * exported function returning a match is declared from the unexpanded types.
 * `withTypesugar` keeps tsup's own `dts` step and naming (`.d.ts`, `.d.cts`,
 * one bundled file per entry) but feeds it declarations typesugar emitted
 * from the expanded program, so the step has nothing unexpanded to check.
 *
 * @example
 * ```ts
 * // tsup.config.ts
 * import { defineConfig } from "tsup";
 * import { withTypesugar } from "unplugin-typesugar/tsup";
 *
 * export default defineConfig(
 *   withTypesugar({ entry: ["src/index.ts"], format: ["esm", "cjs"], dts: true })
 * );
 * ```
 */

import * as fs from "fs";
import * as path from "path";
import type { Options } from "tsup";
import { emitDeclarations, formatDiagnosticsForConsole } from "@typesugar/transformer";
import { unplugin, type TypesugarPluginOptions } from "./unplugin.js";

export type { TypesugarPluginOptions };

type Entry = string | string[] | Record<string, string>;
type EsbuildPlugin = NonNullable<Options["esbuildPlugins"]>[number];
type DtsConfig = Exclude<NonNullable<Options["dts"]>, boolean | string>;

/**
 * Where the expanded declarations are written before tsup bundles them: tsup's
 * own scratch directory (git-ignored, as tsup does for `experimentalDts`).
 * Not under node_modules — tsup's dts step treats anything there as an
 * external package and would not bundle the entry's relative imports.
 */
export const DTS_CACHE_DIR = path.join(".tsup", "typesugar-dts");

/**
 * Add typesugar to a tsup config: its esbuild plugin for the JavaScript, and,
 * when `dts` is set, declarations from the expanded program for tsup's `dts`
 * step. Pass the result to `defineConfig`.
 *
 * `experimentalDts` is not supported (it runs its own TypeScript program over
 * the unexpanded source); use `dts`.
 */
export function withTypesugar(
  options: Options,
  pluginOptions?: TypesugarPluginOptions
): (overrides?: Options) => Promise<Options> {
  return async (overrides = {}) => {
    const merged: Options = { ...options, ...overrides };
    const config: Options = {
      ...options,
      esbuildPlugins: [
        ...(options.esbuildPlugins ?? []),
        // unplugin and tsup may type esbuild's Plugin from different esbuild
        // versions; the runtime contract is the same.
        unplugin.esbuild({
          tsconfig: merged.tsconfig,
          ...pluginOptions,
        }) as unknown as EsbuildPlugin,
      ],
    };
    if (!merged.dts) return config;
    if (merged.experimentalDts) {
      throw new Error("withTypesugar: use `dts`, not `experimentalDts`.");
    }

    const cwd = process.cwd();
    const project = merged.tsconfig ?? "tsconfig.json";
    const cacheDir = path.resolve(cwd, DTS_CACHE_DIR, safeName(merged.name ?? "default"));
    const dts: DtsConfig =
      merged.dts === true
        ? {}
        : typeof merged.dts === "string"
          ? { entry: merged.dts }
          : merged.dts;
    const sourceEntries = toObjectEntry(dts.entry ?? merged.entry ?? merged.entryPoints ?? []);

    const emit = (): Record<string, string> => {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      const gitignore = path.resolve(cwd, ".tsup", ".gitignore");
      if (!fs.existsSync(gitignore)) {
        fs.mkdirSync(path.dirname(gitignore), { recursive: true });
        fs.writeFileSync(gitignore, "**/*\n");
      }
      const result = emitDeclarations({ project, cwd, declarationDir: cacheDir });
      if (result.errorCount > 0) {
        throw new Error(
          `typesugar: declarations not emitted\n${formatDiagnosticsForConsole(result.diagnostics)}`
        );
      }
      const entry: Record<string, string> = {};
      for (const [name, source] of Object.entries(sourceEntries)) {
        const declaration = result.declarationsBySource.get(path.resolve(cwd, source));
        if (!declaration) {
          throw new Error(
            `typesugar: no declarations for the tsup entry ${source}. Is it in ${project}'s "include"?`
          );
        }
        entry[name] = declaration;
      }
      return entry;
    };

    config.dts = { ...dts, entry: emit() };

    // In watch mode tsup's dts step watches the files it bundled; re-emit
    // them after every successful JavaScript rebuild.
    if (merged.watch) {
      const userOnSuccess = merged.onSuccess;
      if (typeof userOnSuccess === "string") {
        throw new Error(
          "withTypesugar: in watch mode, pass onSuccess as a function (it runs after the declarations are re-emitted)."
        );
      }
      config.onSuccess = async () => {
        try {
          emit();
        } catch (e) {
          console.error(e instanceof Error ? e.message : String(e));
        }
        return userOnSuccess?.();
      };
    }
    return config;
  };
}

/**
 * The output names tsup's dts step gives entries, so each keeps its name: a
 * single entry is named by rollup after its file (`src/index.ts` → `index`);
 * several go through tsup's `toObjectEntry` (src/utils.ts): paths relative to
 * the entries' lowest common directory, without the extension. Globs are
 * expanded first, as tsup does.
 */
function toObjectEntry(entry: Entry): Record<string, string> {
  if (typeof entry === "string") entry = [entry];
  if (!Array.isArray(entry)) return entry;
  const files = entry.flatMap(expandGlob).map((e) => e.replace(/\\/g, "/"));
  if (files.length === 1) {
    return { [path.basename(files[0]).replace(/\.[^.]+$/, "")]: files[0] };
  }
  const ancestor = lowestCommonAncestor(files);
  const out: Record<string, string> = {};
  for (const file of files) {
    const key = file
      .replace(ancestor, "")
      .replace(/^\//, "")
      .replace(/\.[a-z]+$/, "");
    out[key] = file;
  }
  return out;
}

function lowestCommonAncestor(files: string[]): string {
  if (files.length <= 1) return "";
  const [first, ...rest] = files;
  let ancestor = first.split("/");
  for (const file of rest) {
    const dirs = file.split("/", ancestor.length);
    let i = 0;
    for (const dir of dirs) {
      if (dir === ancestor[i]) i++;
      else {
        ancestor = ancestor.slice(0, i);
        break;
      }
    }
    ancestor = ancestor.slice(0, i);
  }
  return ancestor.length <= 1 && ancestor[0] === "" ? "/" : ancestor.join("/");
}

function expandGlob(pattern: string): string[] {
  if (!/[*?{[]/.test(pattern)) return [pattern];
  const globSync = (fs as { globSync?: (p: string) => string[] }).globSync;
  if (!globSync) {
    throw new Error(
      `withTypesugar: the entry glob ${pattern} needs Node 22 or later (fs.globSync); list the entries instead.`
    );
  }
  return globSync(pattern).sort();
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_");
}
