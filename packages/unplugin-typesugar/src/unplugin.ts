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

  /** Enable disk-backed transform cache */
  diskCache?: boolean | string;

  /** Enable strict mode - typecheck expanded output at build end */
  strict?: boolean;
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

  // Match TS/TSX/JS/JSX and STS/STSX (sugared TypeScript) files
  return /\.([jt]sx?|stsx?)$/.test(normalizedId);
}

/**
 * Try to resolve a module specifier to a .sts/.stsx file if no .ts/.tsx file exists.
 * Used by the resolveId hook to support implicit .sts extension resolution.
 */
function tryResolveStsExtension(
  specifier: string,
  importer: string | undefined,
  fileExists: (path: string) => boolean = fs.existsSync
): string | null {
  // Only handle relative imports
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    return null;
  }

  // If there's already an extension, don't try to resolve
  if (/\.[a-zA-Z]+$/.test(specifier)) {
    return null;
  }

  if (!importer) {
    return null;
  }

  const baseDir = path.dirname(importer);
  const basePath = path.resolve(baseDir, specifier);

  // Check if .ts or .tsx exists first (they take priority)
  if (fileExists(basePath + ".ts") || fileExists(basePath + ".tsx")) {
    return null; // Let the default resolver handle it
  }

  // Try .sts
  const stsPath = basePath + ".sts";
  if (fileExists(stsPath)) {
    return stsPath;
  }

  // Try .stsx
  const stsxPath = basePath + ".stsx";
  if (fileExists(stsxPath)) {
    return stsxPath;
  }

  // Try index.sts
  const indexStsPath = path.join(basePath, "index.sts");
  if (fileExists(indexStsPath)) {
    return indexStsPath;
  }

  // Try index.stsx
  const indexStsxPath = path.join(basePath, "index.stsx");
  if (fileExists(indexStsxPath)) {
    return indexStsxPath;
  }

  return null;
}

export const unpluginFactory: UnpluginFactory<TypesugarPluginOptions | undefined> = (
  options = {}
) => {
  let pipeline: TransformationPipeline | undefined;
  const verbose = options?.verbose ?? false;

  return {
    name: "typesugar",
    enforce: "pre",

    // Resolve .sts files when .ts doesn't exist
    resolveId(specifier, importer) {
      const resolved = tryResolveStsExtension(specifier, importer);
      if (resolved) {
        if (verbose) {
          console.log(`[typesugar] Resolved ${specifier} -> ${resolved}`);
        }
        return resolved;
      }
      return null; // Let other resolvers handle it
    },

    buildStart() {
      try {
        const configPath = findTsConfig(process.cwd(), options?.tsconfig);
        pipeline = createPipeline(configPath, {
          verbose,
          extensions: options?.extensions,
          diskCache: options?.diskCache,
          strict: options?.strict,
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
