/**
 * Declaration (`.d.ts`) emit from the EXPANDED program (Turf case study, F5/F20).
 *
 * TypeScript computes declarations with the type checker, from the program it
 * was given. A `before` transformer (what `typesugar build` and ts-patch use)
 * only rewrites the JavaScript emit, so the declarations still came from the
 * unexpanded source: an exported `function area(s: Shape) { return match(s)
 * ... }` was declared `area(s: Shape): any`, and a pattern-bound name made the
 * checker fail. tsup's own `dts` step type-checks the unexpanded source too.
 *
 * Here every file is expanded first and the expanded text is served, as a
 * program of its own, to TypeScript's declaration emitter. The JS program is
 * built with declarations switched off, so it reports no declaration errors
 * about types that only exist before expansion.
 *
 * The expanded text is printed and re-parsed as whole files (as `--strict`
 * does): this is a second Program over generated source, not macro codegen.
 */

import * as ts from "typescript";
import * as path from "path";
import { config, filterDiagnostics, getDiagnosticSuppressionRules } from "@typesugar/core";
import { registerAllDiagnosticSuppressionRules } from "@typesugar/macros";
import type { RawSourceMap } from "@typesugar/core";
import {
  generateASTSourceMap,
  macroTransformerFactory,
  registerTypeRewritesBeforeFiltering,
} from "./pipeline.js";
import { hasHKTPatterns, rewriteHKTTypeReferences } from "./hkt-rewriter.js";
import { annotateInferredOpaqueTypes } from "./declaration-annotations.js";

/** Does the parsed config ask for declarations at all? */
export function wantsDeclarations(options: ts.CompilerOptions): boolean {
  return options.declaration === true || options.composite === true;
}

/**
 * Options for the program the macros run against when declarations come from
 * the expanded program instead: declaration emit (and the options that require
 * it) switched off, so the checker reports nothing about the unexpanded types.
 */
export function withoutDeclarations(
  options: ts.CompilerOptions,
  configDir: string
): ts.CompilerOptions {
  const out: ts.CompilerOptions = {
    ...options,
    declaration: false,
    declarationMap: false,
    emitDeclarationOnly: false,
    isolatedDeclarations: false,
    composite: false,
  };
  // `composite` defaults rootDir to the tsconfig's directory; keep that layout.
  if (options.composite && out.rootDir === undefined) out.rootDir = configDir;
  // Options that are errors without `declaration` (TS5069), and the
  // composite/incremental bookkeeping, belong to the real build only.
  delete out.declarationDir;
  delete out.stripInternal;
  delete out.tsBuildInfoFile;
  out.incremental = false;
  return out;
}

/**
 * A compiler host that serves `expanded` (absolute path → expanded source)
 * and delegates everything else to `base`.
 */
export function createExpandedHost(
  base: ts.CompilerHost,
  expanded: ReadonlyMap<string, string>
): ts.CompilerHost {
  const lookup = (fileName: string) => expanded.get(path.resolve(fileName));
  return {
    ...base,
    fileExists: (f) => lookup(f) !== undefined || base.fileExists(f),
    readFile: (f) => lookup(f) ?? base.readFile(f),
    getSourceFile: (fileName, languageVersionOrOptions, onError, shouldCreate) => {
      const text = lookup(fileName);
      if (text !== undefined) {
        return ts.createSourceFile(fileName, text, languageVersionOrOptions, true);
      }
      return base.getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreate);
    },
  };
}

/**
 * A `before` transformer that records the printed text of every file the
 * macro transformer changed. Put it AFTER the macro transformer, so a JS emit
 * also yields the expanded TypeScript the declarations are emitted from.
 *
 * With `maps`, it also records, for each printed file, how to make its
 * source map back to the program's text (`generateASTSourceMap`, from the
 * transformed tree's source map ranges), which the expanded type check maps
 * its diagnostics through: made on demand, as most are never needed.
 */
export function captureExpandedSource(
  program: ts.Program,
  expanded: Map<string, string>,
  maps?: Map<string, () => RawSourceMap | null>
): ts.TransformerFactory<ts.SourceFile> {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  return () => (sourceFile) => {
    const original = program.getSourceFile(sourceFile.fileName);
    if (sourceFile !== original) {
      // Inferred @opaque types, erased by the expansion, are written as
      // annotations on the printed copy (declaration-annotations.ts); the
      // tree returned to the emit is unchanged.
      const printed = original
        ? annotateInferredOpaqueTypes(program, original, sourceFile)
        : sourceFile;
      const text = printer.printFile(printed);
      const resolved = path.resolve(sourceFile.fileName);
      expanded.set(resolved, text);
      if (maps && original) {
        maps.set(resolved, () =>
          generateASTSourceMap(original.text, printed, text, original.fileName)
        );
      }
    }
    return sourceFile;
  };
}

/**
 * Expand every source file of `program` without emitting JavaScript, and
 * return the printed text of the files the macros changed (none when `print`
 * is false: the expansion then runs only for its diagnostics). Run it only
 * after the program's own diagnostics are collected: the transform attaches
 * synthetic nodes to the program's trees (see cli.ts `check`).
 */
export function expandProgramSources(
  program: ts.Program,
  transformerFactory: ts.TransformerFactory<ts.SourceFile>,
  maps?: Map<string, () => RawSourceMap | null>,
  print = true
): Map<string, string> {
  const expanded = new Map<string, string>();
  const capture = captureExpandedSource(program, expanded, maps);
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile || program.isSourceFileFromExternalLibrary(sourceFile)) {
      continue;
    }
    const result = ts.transform(
      sourceFile,
      print ? [transformerFactory, capture] : [transformerFactory],
      program.getCompilerOptions()
    );
    result.dispose();
  }
  return expanded;
}

/**
 * Emit `.d.ts` files from the expanded program: `rootNames` and `host` as the
 * JS program used them, `options` the project's own options (with its
 * declaration settings), `expanded` from {@link captureExpandedSource} or
 * {@link expandProgramSources}. Diagnostics in the result refer to the
 * expanded files (their positions are in the printed text).
 */
export function emitExpandedDeclarations(params: {
  rootNames: readonly string[];
  options: ts.CompilerOptions;
  host: ts.CompilerHost;
  expanded: ReadonlyMap<string, string>;
  writeFile?: ts.WriteFileCallback;
}): ts.EmitResult {
  const options: ts.CompilerOptions = {
    ...params.options,
    declaration: true,
    emitDeclarationOnly: true,
    noEmit: false,
    // The caller decides about errors (it knows the filtered, original-source
    // diagnostics); the expanded program only emits.
    noEmitOnError: false,
  };
  const program = ts.createProgram(
    params.rootNames,
    options,
    createExpandedHost(params.host, params.expanded)
  );
  return program.emit(undefined, params.writeFile, undefined, true);
}

// ---------------------------------------------------------------------------
// One-call API (the tsup helper, scripts)
// ---------------------------------------------------------------------------

export interface EmitDeclarationsOptions {
  /** Path to tsconfig.json (default: `tsconfig.json` in `cwd`). */
  project?: string;
  /** Working directory the project path resolves against (default: `process.cwd()`). */
  cwd?: string;
  /**
   * Directory for the `.d.ts` files. Defaults to the tsconfig's
   * `declarationDir`, then its `outDir`; with neither, an error (declarations
   * next to the sources are never what a library wants).
   */
  declarationDir?: string;
  verbose?: boolean;
}

export interface EmitDeclarationsResult {
  /** Absolute paths of the `.d.ts` (and `.d.ts.map`) files written. */
  files: string[];
  /** Absolute source path → absolute path of the `.d.ts` written for it. */
  declarationsBySource: Map<string, string>;
  /** Errors and warnings: original-source (suppression-filtered), macro, and declaration emit. */
  diagnostics: ts.Diagnostic[];
  /** Number of error-category diagnostics. Nothing is written when it is > 0. */
  errorCount: number;
}

/** Diagnostics as `file(line,col): error TS1234: message` lines. */
export function formatDiagnosticsForConsole(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics
    .map((d) => {
      const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      const category = d.category === ts.DiagnosticCategory.Error ? "error" : "warning";
      if (d.file && d.start !== undefined) {
        const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
        return `${d.file.fileName}(${line + 1},${character + 1}): ${category} TS${d.code}: ${message}`;
      }
      return `${category} TS${d.code}: ${message}`;
    })
    .join("\n");
}

/**
 * Type-check a project the way `typesugar check` does and write its `.d.ts`
 * files from the expanded program — `typesugar build --emitDeclarationOnly`
 * as a function. Writes nothing if there are errors.
 */
export function emitDeclarations(opts: EmitDeclarationsOptions = {}): EmitDeclarationsResult {
  const cwd = opts.cwd ?? process.cwd();
  const project = path.resolve(cwd, opts.project ?? "tsconfig.json");
  const configDir = path.dirname(project);

  const configFile = ts.readConfigFile(project, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(
      `typesugar: cannot read ${project}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`
    );
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, configDir);
  if (parsed.errors.length > 0) {
    throw new Error(
      `typesugar: errors in ${project}:\n${formatDiagnosticsForConsole(parsed.errors)}`
    );
  }

  config.load({ searchFrom: configDir });
  registerAllDiagnosticSuppressionRules();

  const declarationDir = opts.declarationDir
    ? path.resolve(cwd, opts.declarationDir)
    : (parsed.options.declarationDir ?? parsed.options.outDir);
  if (!declarationDir) {
    throw new Error(
      `typesugar: no directory for declarations. Set "declarationDir" or "outDir" in ${project}, or pass declarationDir.`
    );
  }

  const jsOptions = withoutDeclarations({ ...parsed.options, noEmit: true }, configDir);
  const host = createPreprocessingHost(jsOptions);
  const program = ts.createProgram(parsed.fileNames, jsOptions, host);

  const macroDiagnostics: ts.Diagnostic[] = [];
  const transformerFactory = macroTransformerFactory(program, {
    verbose: opts.verbose,
    onDiagnostic: (d) => macroDiagnostics.push(d),
  });

  let sourceDiagnostics: readonly ts.Diagnostic[] = ts.getPreEmitDiagnostics(program);
  if (getDiagnosticSuppressionRules().length > 0) {
    // Filtered before the expansion below: register the @opaque types first.
    registerTypeRewritesBeforeFiltering(program, opts.verbose);
    sourceDiagnostics = filterDiagnostics(
      sourceDiagnostics,
      program.getTypeChecker(),
      (fn) => program.getSourceFile(fn),
      { program }
    );
  }

  const expanded = expandProgramSources(program, transformerFactory);
  const diagnostics = [...sourceDiagnostics, ...macroDiagnostics];
  const errorsBefore = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errorsBefore.length > 0) {
    return {
      files: [],
      declarationsBySource: new Map(),
      diagnostics,
      errorCount: errorsBefore.length,
    };
  }

  const files: string[] = [];
  const declarationsBySource = new Map<string, string>();
  const result = emitExpandedDeclarations({
    rootNames: parsed.fileNames,
    options: { ...parsed.options, declarationDir },
    host,
    expanded,
    writeFile: (fileName, text, bom, _onError, sourceFiles) => {
      ts.sys.writeFile(fileName, text, bom);
      files.push(path.resolve(fileName));
      if (/\.d\.[cm]?ts$/.test(fileName) && sourceFiles?.length === 1) {
        declarationsBySource.set(path.resolve(sourceFiles[0].fileName), path.resolve(fileName));
      }
    },
  });
  diagnostics.push(...result.diagnostics);
  const errorCount = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error).length;
  return { files, declarationsBySource, diagnostics, errorCount };
}

/** A compiler host that applies the HKT `F<_>` preprocessing, as `typesugar build` does. */
function createPreprocessingHost(options: ts.CompilerOptions): ts.CompilerHost {
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  host.readFile = (fileName) => {
    const text = readFile(fileName);
    if (text === undefined) return text;
    return preprocessHKTForProgram(fileName, text) ?? text;
  };
  return host;
}

/**
 * HKT `F<_>` preprocessing for a file served to a ts.Program (build/watch and
 * the declaration emit). Returns the rewritten text, or `undefined` when the
 * file is left as-is.
 */
export function preprocessHKTForProgram(fileName: string, source: string): string | undefined {
  if (!/\.[jt]sx?$/.test(fileName) || /node_modules/.test(fileName)) return undefined;
  if (!hasHKTPatterns(source)) return undefined;
  const result = rewriteHKTTypeReferences(source, fileName);
  return result.changed ? result.code : undefined;
}
