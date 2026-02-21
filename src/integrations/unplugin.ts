/**
 * typemacro unplugin integration
 *
 * Universal plugin that works with Vite, Rollup, Webpack, esbuild, and Rspack.
 * Uses the TypeScript compiler API to create a Program, then runs the macro
 * transformer on each .ts/.tsx file during the build.
 */

import * as ts from "typescript";
import * as path from "path";
import { createUnplugin, type UnpluginFactory } from "unplugin";
import macroTransformerFactory, {
  type MacroTransformerConfig,
} from "../transforms/macro-transformer.js";

export interface TypeMacroPluginOptions {
  /** Path to tsconfig.json (default: auto-detected) */
  tsconfig?: string;

  /** File patterns to include (default: /\.[jt]sx?$/) */
  include?: RegExp | string[];

  /** File patterns to exclude (default: /node_modules/) */
  exclude?: RegExp | string[];

  /** Enable verbose logging */
  verbose?: boolean;
}

interface ProgramCache {
  program: ts.Program;
  host: ts.CompilerHost;
  config: ts.ParsedCommandLine;
}

function findTsConfig(cwd: string, explicit?: string): string {
  if (explicit) {
    return path.resolve(cwd, explicit);
  }

  const found = ts.findConfigFile(cwd, ts.sys.fileExists, "tsconfig.json");
  if (!found) {
    throw new Error(
      `[typemacro] Could not find tsconfig.json from ${cwd}. ` +
        `Pass the tsconfig option to specify the path explicitly.`
    );
  }
  return found;
}

function createProgram(configPath: string): ProgramCache {
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(
      `[typemacro] Error reading ${configPath}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`
    );
  }

  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));

  const host = ts.createCompilerHost(config.options);
  const program = ts.createProgram(config.fileNames, config.options, host);

  return { program, host, config };
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

export const unpluginFactory: UnpluginFactory<TypeMacroPluginOptions | undefined> = (
  options = {}
) => {
  let cache: ProgramCache | undefined;
  const verbose = options?.verbose ?? false;

  return {
    name: "typemacro",
    enforce: "pre",

    buildStart() {
      try {
        const configPath = findTsConfig(process.cwd(), options?.tsconfig);
        cache = createProgram(configPath);
        if (verbose) {
          console.log(`[typemacro] Loaded config from ${configPath}`);
          console.log(`[typemacro] Program has ${cache.config.fileNames.length} files`);
        }
      } catch (error) {
        console.error(String(error));
      }
    },

    transformInclude(id) {
      return shouldTransform(id, options?.include, options?.exclude);
    },

    transform(code, id) {
      if (!cache) return null;

      const sourceFile = cache.program.getSourceFile(id);
      if (!sourceFile) {
        // File not in the TS program -- skip
        if (verbose) {
          console.log(`[typemacro] Skipping ${id} (not in program)`);
        }
        return null;
      }

      const transformerConfig: MacroTransformerConfig = { verbose };

      // Run the macro transformer
      const result = ts.transform(sourceFile, [
        macroTransformerFactory(cache.program, transformerConfig),
      ]);

      if (result.transformed.length === 0) {
        result.dispose();
        return null;
      }

      const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
      const transformed = printer.printFile(result.transformed[0]);
      result.dispose();

      // Only return if the code actually changed
      if (transformed === code) return null;

      return {
        code: transformed,
        // TODO: generate proper source map from the transformation
        map: null,
      };
    },
  };
};

export const unplugin = /*#__PURE__*/ createUnplugin(unpluginFactory);
