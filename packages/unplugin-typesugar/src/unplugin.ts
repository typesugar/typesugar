/**
 * typesugar unplugin integration
 *
 * Universal plugin that works with Vite, Rollup, Webpack, esbuild, and Rspack.
 * Uses the unified TransformationPipeline from @typesugar/transformer for all
 * transformation logic.
 */

import * as ts from "typescript";
import * as fs from "fs";
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

  /** Syntax extensions to enable (default: all) */
  extensions?: ("hkt" | "pipeline" | "cons")[];
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

export const unpluginFactory: UnpluginFactory<TypesugarPluginOptions | undefined> = (
  options = {}
) => {
  let pipeline: TransformationPipeline | undefined;
  const verbose = options?.verbose ?? false;

  return {
    name: "typesugar",
    enforce: "pre",

    buildStart() {
      try {
        const configPath = findTsConfig(process.cwd(), options?.tsconfig);
        pipeline = createPipeline(configPath, {
          verbose,
          extensions: options?.extensions,
        });
        if (verbose) {
          console.log(`[typesugar] Loaded config from ${configPath}`);
          console.log(`[typesugar] Program has ${pipeline.getFileNames().length} files`);
        }
      } catch (error) {
        console.error(String(error));
      }
    },

    transformInclude(id) {
      return shouldTransform(id, options?.include, options?.exclude);
    },

    transform(code, id) {
      if (!pipeline) return null;

      try {
        // Use the unified pipeline for transformation
        const result = pipeline.transform(id);

        // Only return if the code actually changed
        if (!result.changed) {
          return null;
        }

        // LOG TRANSFORMED CODE FOR DEBUGGING
        if (verbose) {
          fs.writeFileSync(id + ".transformed.js", result.code);
        }

        return {
          code: result.code,
          map: result.sourceMap,
        };
      } catch (error) {
        // If transformation fails, return null to skip this file
        if (verbose) {
          console.error(`[typesugar] Transform error for ${id}:`);
          console.error(error);
        }
        return null;
      }
    },

    // File watcher integration for cache invalidation
    watchChange(id) {
      if (pipeline) {
        pipeline.invalidate(id);
        if (verbose) {
          console.log(`[typesugar] Invalidated cache for ${id}`);
        }
      }
    },
  };
};

export const unplugin = /*#__PURE__*/ createUnplugin(unpluginFactory);
