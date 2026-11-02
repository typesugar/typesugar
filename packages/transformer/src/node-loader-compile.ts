/**
 * The compile half of the Node loader (`typesugar/register`): expand one
 * file through the TransformationPipeline and, when that changed it, compile
 * it to JavaScript Node can run. Loaded lazily by `node-loader.ts`.
 *
 * One pipeline per tsconfig.json (the nearest one above each file), so a
 * macro sees the same Program -- and the same types -- that `tsc` and the
 * bundler plugins give it. Files outside every tsconfig share one pipeline
 * with default options.
 */

import * as ts from "typescript";
import * as path from "path";
import { pathToFileURL } from "url";
import { TransformationPipeline, createPipeline, transpileExpanded } from "./pipeline.js";
import { composeSourceMapChain, type RawSourceMap } from "./source-map-utils.js";
import type { LoaderCompiler, LoaderCompileOutput, LoaderModuleFormat } from "./node-loader.js";

/** Options for a file with no tsconfig.json above it. */
const NO_TSCONFIG_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  esModuleInterop: true,
  skipLibCheck: true,
};

export interface LoaderCompilerOptions {
  /** Log each file's outcome to stderr (default: `TYPESUGAR_VERBOSE=1`). */
  verbose?: boolean;
  /** Where macro warnings go (default: stderr). */
  warn?: (message: string) => void;
}

/** 1-based line and column of `pos` in `text`. */
function lineColumn(text: string, pos: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, pos));
  const line = before.split("\n").length;
  return { line, column: pos - (before.lastIndexOf("\n") + 1) + 1 };
}

/**
 * Class-field semantics follow the tsconfig's target, as `tsc` would emit
 * them, even though the loader does not downlevel anything else: with
 * `target: "es2017"` a field is a constructor assignment, not a define.
 */
function useDefineForClassFields(options: ts.CompilerOptions): boolean | undefined {
  if (options.useDefineForClassFields !== undefined) return options.useDefineForClassFields;
  if (options.target === undefined) return undefined;
  return options.target >= ts.ScriptTarget.ES2022;
}

export function createLoaderCompiler(options: LoaderCompilerOptions = {}): LoaderCompiler {
  const verbose = options.verbose ?? process.env.TYPESUGAR_VERBOSE === "1";
  const warn = options.warn ?? ((message: string) => process.stderr.write(message + "\n"));
  const log = (message: string): void => {
    if (verbose) process.stderr.write(`[typesugar] register: ${message}\n`);
  };

  /** tsconfig path ("" for none) -> pipeline. */
  const pipelines = new Map<string, TransformationPipeline>();

  function pipelineFor(fileName: string): TransformationPipeline {
    const tsconfig = ts.findConfigFile(path.dirname(fileName), ts.sys.fileExists) ?? "";
    let pipeline = pipelines.get(tsconfig);
    if (!pipeline) {
      // cacheDir: false -- no `.typesugar-cache/` written into whatever
      // directory the process happens to run in. A loader process is short
      // lived and never reaches the save point anyway.
      pipeline = tsconfig
        ? createPipeline(tsconfig, { cacheDir: false })
        : new TransformationPipeline(NO_TSCONFIG_OPTIONS, [fileName], { cacheDir: false });
      pipelines.set(tsconfig, pipeline);
      log(`using ${tsconfig || "default compiler options (no tsconfig.json)"}`);
    }
    return pipeline;
  }

  function compile(fileName: string, format: LoaderModuleFormat | undefined): LoaderCompileOutput {
    const pipeline = pipelineFor(fileName);
    const result = pipeline.transform(fileName);

    const errors: string[] = [];
    for (const d of result.diagnostics) {
      const { line, column } = lineColumn(result.original, d.start);
      // Macro diagnostics from the pipeline already carry the prefix.
      const message = d.message.startsWith("[typesugar]") ? d.message : `[typesugar] ${d.message}`;
      const text = `${fileName}:${line}:${column}: ${message}`;
      if (d.severity === "error") errors.push(text);
      else warn(`warning ${text}`);
    }
    if (errors.length > 0) {
      // Fail the import: running the module would run raw macro calls.
      throw new Error(`typesugar: macro expansion failed\n${errors.join("\n")}`);
    }

    if (!result.changed) {
      log(`unchanged ${fileName}`);
      return { changed: false };
    }

    const compilerOptions = pipeline.getCompilerOptions();
    const outFormat: LoaderModuleFormat =
      format ??
      (ts.isExternalModule(ts.createSourceFile(fileName, result.code, ts.ScriptTarget.Latest))
        ? "module"
        : "commonjs");
    const transpiled = transpileExpanded(
      result.code,
      fileName,
      {
        ...compilerOptions,
        // Emit for the running Node: no downlevelling (tsx and Node's own
        // type stripping do not downlevel either) ...
        target: ts.ScriptTarget.ESNext,
        // ... except where the target changes runtime semantics.
        useDefineForClassFields: useDefineForClassFields(compilerOptions),
      },
      {
        module: outFormat === "module" ? ts.ModuleKind.ESNext : ts.ModuleKind.CommonJS,
        jsx: fileName.endsWith(".tsx")
          ? (compilerOptions.jsx ?? ts.JsxEmit.ReactJSX)
          : compilerOptions.jsx,
      }
    );

    let code = transpiled.outputText.replace(/\n?\/\/# sourceMappingURL=.*\s*$/, "");
    if (transpiled.sourceMapText) {
      const transpileMap = JSON.parse(transpiled.sourceMapText) as RawSourceMap;
      const map = composeSourceMapChain([transpileMap, result.sourceMap]) ?? transpileMap;
      const inline: RawSourceMap = {
        ...map,
        file: path.basename(fileName),
        sourceRoot: "",
        sources: [pathToFileURL(fileName).href],
        sourcesContent: [result.original],
      };
      code +=
        "\n//# sourceMappingURL=data:application/json;base64," +
        Buffer.from(JSON.stringify(inline)).toString("base64") +
        "\n";
    }

    log(`expanded ${fileName} (${outFormat})`);
    return { changed: true, source: code, format: outFormat };
  }

  return { compile };
}
