#!/usr/bin/env node

/**
 * typesugar CLI -- Compile TypeScript with macro expansion
 *
 * Usage:
 *   typesugar build [--project tsconfig.json] [--verbose]
 *   typesugar watch [--project tsconfig.json] [--verbose]
 *   typesugar check [--project tsconfig.json] [--verbose]
 *   typesugar expand <file> [--diff] [--ast]
 *   typesugar run <file> [--verbose]
 *   typesugar init [--verbose]
 *   typesugar doctor [--verbose]
 *   typesugar create <template> [name]
 *   typesugar approve-macros [--project tsconfig.json] [--yes]
 */

import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { rewriteHKTTypeReferences, hasHKTPatterns } from "./hkt-rewriter.js";
import {
  captureExpandedSource,
  emitExpandedDeclarations,
  expandProgramSources,
  preprocessHKTForProgram as preprocessForProgram,
  wantsDeclarations,
  withoutDeclarations,
} from "./declarations.js";
import { VirtualCompilerHost } from "./virtual-host.js";
import { initHasher, DiskTransformCache, hashContent } from "./cache.js";
import { UnapprovedMacroPackagesError } from "./macro-loader.js";
import { readTsConfig } from "./tsconfig-utils.js";
import {
  TransformationPipeline,
  createPipeline,
  formatExpansions,
  transpileExpanded,
  macroTransformerFactory,
  saveExpansionCache,
  getExpansionCacheStats,
  TransformerState,
} from "./pipeline.js";
import {
  filterDiagnostics,
  getDiagnosticSuppressionRules,
  setDiagnosticSuppressionAuditMode,
  profiler,
  PROFILING_ENABLED,
  config as typesugarConfig,
} from "@typesugar/core";
import { registerAllDiagnosticSuppressionRules } from "@typesugar/macros";

type Command =
  | "build"
  | "watch"
  | "check"
  | "expand"
  | "run"
  | "init"
  | "doctor"
  | "create"
  | "preprocess"
  | "approve-macros";

interface CliOptions {
  command: Command;
  project: string;
  verbose: boolean;
  file?: string;
  diff?: boolean;
  ast?: boolean;
  js?: boolean;
  createArgs?: string[];
  preprocessSources?: string[];
  outDir?: string;
  inPlace?: boolean;
  /** Enable disk-backed transform cache for faster incremental builds */
  cache?: boolean | string;
  /** Enable strict mode — typecheck expanded output */
  strict?: boolean | "incremental";
  /** Show suppressed diagnostics for debugging */
  showSuppressedDiagnostics?: boolean;
  /** build: write only `.d.ts` files (from the expanded program) */
  emitDeclarationOnly?: boolean;
  /** build: directory for `.d.ts` files (overrides the tsconfig) */
  declarationDir?: string;
  /** approve-macros: skip the confirmation prompt (for CI use) */
  yes?: boolean;
  /** init: scaffold AI-assistant context (AGENTS.md). undefined = ask. */
  ai?: boolean;
  /** init: answer the persona question up front. */
  persona?: "end-user" | "app-developer" | "extension-author";
}

function parseArgs(args: string[]): CliOptions {
  const command = (args[0] ?? "build") as Command;
  const validCommands: Command[] = [
    "build",
    "watch",
    "check",
    "expand",
    "run",
    "init",
    "doctor",
    "create",
    "preprocess",
    "approve-macros",
  ];

  if (!validCommands.includes(command)) {
    console.error(
      `Unknown command: ${command}\nUsage: typesugar <build|watch|check|expand|init|doctor|create|preprocess|approve-macros> [options]`
    );
    process.exit(1);
  }

  // For create command, pass remaining args directly
  if (command === "create") {
    const createArgs = args.slice(1);
    return { command, project: "tsconfig.json", verbose: false, createArgs };
  }

  // For preprocess command, collect sources and handle specific flags
  if (command === "preprocess") {
    const sources: string[] = [];
    let outDir: string | undefined;
    let inPlace = false;
    let verbose = false;

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--outDir" || arg === "-o") {
        outDir = args[++i];
      } else if (arg === "--inPlace" || arg === "--in-place") {
        inPlace = true;
      } else if (arg === "--verbose" || arg === "-v") {
        verbose = true;
      } else if (arg === "--help" || arg === "-h") {
        printHelp();
        process.exit(0);
      } else if (!arg.startsWith("-")) {
        sources.push(arg);
      }
    }

    if (inPlace && outDir) {
      console.error("Error: --inPlace and --outDir are mutually exclusive");
      process.exit(1);
    }

    return {
      command,
      project: "tsconfig.json",
      verbose,
      preprocessSources: sources.length > 0 ? sources : undefined,
      outDir,
      inPlace,
    };
  }

  // For approve-macros, only --project/--yes/--verbose are meaningful.
  if (command === "approve-macros") {
    let project = "tsconfig.json";
    let verbose = false;
    let yes = false;

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--project" || arg === "-p") {
        project = args[++i] ?? "tsconfig.json";
      } else if (arg === "--verbose" || arg === "-v") {
        verbose = true;
      } else if (arg === "--yes" || arg === "-y") {
        yes = true;
      } else if (arg === "--help" || arg === "-h") {
        printHelp();
        process.exit(0);
      }
    }

    return { command, project, verbose, yes };
  }

  let project = "tsconfig.json";
  let verbose = false;
  let file: string | undefined;
  let diff = false;
  let ast = false;
  let js = false;
  let cache: boolean | string | undefined;
  let strict: boolean | "incremental" = false;
  let showSuppressedDiagnostics = false;
  let ai: boolean | undefined;
  let yes = false;
  let persona: CliOptions["persona"];
  let emitDeclarationOnly = false;
  let declarationDir: string | undefined;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--project" || arg === "-p") {
      project = args[++i] ?? "tsconfig.json";
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    } else if (arg === "--diff") {
      diff = true;
    } else if (arg === "--ast") {
      ast = true;
    } else if (arg === "--js") {
      js = true;
    } else if (arg === "--cache") {
      // Check if next arg is a path (not another flag)
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        cache = next;
        i++;
      } else {
        cache = true;
      }
    } else if (arg === "--no-cache") {
      cache = false;
    } else if (arg === "--strict=incremental") {
      strict = "incremental";
    } else if (arg === "--strict") {
      strict = true;
    } else if (arg === "--show-suppressed-diagnostics") {
      showSuppressedDiagnostics = true;
    } else if (arg === "--emitDeclarationOnly" || arg === "--emit-declaration-only") {
      emitDeclarationOnly = true;
    } else if (arg === "--declarationDir" || arg === "--declaration-dir") {
      declarationDir = args[++i];
      if (!declarationDir) {
        console.error(`${arg} needs a directory`);
        process.exit(1);
      }
    } else if (arg === "--ai") {
      ai = true;
    } else if (arg === "--no-ai") {
      ai = false;
    } else if (arg === "--yes" || arg === "-y") {
      yes = true;
    } else if (arg === "--persona") {
      const value = args[++i];
      const valid = ["end-user", "app-developer", "extension-author"] as const;
      if (!valid.includes(value as (typeof valid)[number])) {
        console.error(`Invalid --persona: ${value}\nExpected one of: ${valid.join(", ")}`);
        process.exit(1);
      }
      persona = value as CliOptions["persona"];
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith("-") && !file) {
      file = arg;
    }
  }

  return {
    command,
    project,
    verbose,
    file,
    diff,
    ast,
    js,
    cache,
    strict,
    showSuppressedDiagnostics,
    emitDeclarationOnly,
    declarationDir,
    ai,
    yes,
    persona,
  };
}

function printHelp(): void {
  console.log(`
🧊 typesugar — Syntactic sugar for TypeScript with zero calories

USAGE:
  typesugar <command> [options]

COMMANDS:
  build              Compile TypeScript with macro expansion (default).
                     Emits .js/.d.ts and exits non-zero if any diagnostics are found.
  watch              Watch mode -- recompile on file changes
  check              Type-check with macro expansion, but don't emit files.
                     Exits non-zero on diagnostics — use this as your CI gate.
  expand <file>      Show macro-expanded output for a file
  run <file>         Compile and execute a file with macro expansion
  init               Interactive setup wizard for existing projects
  doctor             Diagnose configuration issues
  create [template]  Create a new project from a template
  preprocess <files|dirs>  Preprocess files (HKT syntax only, no macro expansion)
  approve-macros     Review and approve third-party macro packages (PEP-055)

OPTIONS:
  -p, --project <path>   Path to tsconfig.json (default: tsconfig.json)
  -v, --verbose          Enable verbose logging
  --cache [dir]          Enable disk cache for build/run (default: .typesugar-cache/transforms)
  --no-cache             Disable disk cache
  --strict               Also typecheck the expanded output [build/check]. Experimental:
                         the per-file expansion check may report false positives
                         (e.g. spurious TS2304) and is degraded gracefully if the
                         checker hits synthetic node positions. Off by default.
  --strict=incremental   Incremental strict typecheck (only changed files) [build/check]
  --show-suppressed-diagnostics  Show suppressed diagnostics (audit mode)
  --emitDeclarationOnly  Write only .d.ts files, from the expanded program [build]
  --declarationDir <dir> Directory for .d.ts files (overrides tsconfig) [build]
  -h, --help             Show this help message

APPROVE-MACROS OPTIONS:
  -y, --yes              Skip the confirmation prompt (for CI use)

INIT OPTIONS:
  -y, --yes              Non-interactive: accept the default for every question
                         (required in CI, or when an AI assistant runs init)
  --persona <name>       end-user | app-developer | extension-author
                         (default with --yes: app-developer)
  --ai                   Write AI-assistant context (AGENTS.md) without asking,
                         and install the Claude Code skill
  --no-ai                Skip AI-assistant context entirely

EXPAND OPTIONS:
  --diff                 Show unified diff between original and expanded
  --ast                  Show expanded AST as JSON
  --js                   Show transpiled JavaScript (portable output)

PREPROCESS OPTIONS:
  --outDir <dir>         Output directory (default: .typesugar)
  --inPlace              Preprocess files in place (overwrites originals)

CREATE TEMPLATES:
  app                Vite application with comptime, derive, and sql
  library            Publishable library with typeclasses
  macro-plugin       Custom macros package

EXAMPLES:
  typesugar build
  typesugar build --cache                      # Enable disk cache
  typesugar build --project tsconfig.build.json
  typesugar build --strict                     # Typecheck expanded output (full)
  typesugar build --strict=incremental          # Incremental strict typecheck
  typesugar build --emitDeclarationOnly         # .d.ts only (after tsup/esbuild/vite)
  typesugar watch --verbose
  typesugar check --strict
  typesugar expand src/main.ts
  typesugar expand src/main.ts --diff
  typesugar run examples/showcase.ts
  typesugar run examples/showcase.ts --cache   # Cache for repeated runs
  typesugar init
  typesugar init --yes                         # non-interactive (CI / AI agent)
  typesugar init --yes --persona end-user --ai
  typesugar doctor
  typesugar create app my-app
  typesugar create library my-lib
  typesugar create macro-plugin my-macros
  typesugar preprocess src/ --outDir .typesugar
  typesugar preprocess src/index.ts src/types.ts --outDir dist
  typesugar preprocess src/ --inPlace
  typesugar approve-macros
  typesugar approve-macros --yes
`);
}

/**
 * Load the project's `typesugar.config.*` from the tsconfig's directory (not
 * the process cwd), so `typesugar build -p some/dir/tsconfig.json` honours
 * that project's config.
 */
function loadProjectConfig(tsconfigPath: string): void {
  typesugarConfig.load({ searchFrom: path.dirname(path.resolve(tsconfigPath)) });
}

/** Stable identity for de-duplicating a diagnostic reported by two passes. */
function diagnosticKey(d: ts.Diagnostic): string {
  const text = ts.flattenDiagnosticMessageText(d.messageText, "\n");
  return `${d.file?.fileName ?? ""}:${d.start ?? ""}:${d.code}:${text}`;
}

function dedupeDiagnostics(diagnostics: readonly ts.Diagnostic[]): ts.Diagnostic[] {
  const seen = new Set<string>();
  const out: ts.Diagnostic[] = [];
  for (const d of diagnostics) {
    const key = diagnosticKey(d);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

function reportDiagnostics(diagnostics: readonly ts.Diagnostic[]): number {
  let errorCount = 0;
  for (const diagnostic of diagnostics) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");

    if (diagnostic.file && diagnostic.start !== undefined) {
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      const fileName = diagnostic.file.fileName;
      const prefix = diagnostic.category === ts.DiagnosticCategory.Error ? "error" : "warning";
      console.error(
        `${fileName}(${line + 1},${character + 1}): ${prefix} TS${diagnostic.code}: ${message}`
      );
    } else {
      console.error(message);
    }

    if (diagnostic.category === ts.DiagnosticCategory.Error) {
      errorCount++;
    }
  }
  return errorCount;
}

/**
 * Register built-in diagnostic suppression rules for the CLI pipeline.
 *
 * Uses the unified registration function (PEP-034) to ensure consistent
 * diagnostic filtering between `typesugar build` and the editor.
 * No positionMapFn is provided since CLI doesn't need MacroGenerated rule.
 */
function registerCliDiagnosticSuppressionRules(): void {
  registerAllDiagnosticSuppressionRules();
}

function build(options: CliOptions): void {
  // Fire-and-forget hasher init (fallback works if not ready)
  initHasher().catch(() => {
    /* ignore - fallback available */
  });

  // Enable diagnostic suppression audit mode if requested via --show-suppressed-diagnostics flag or env var
  if (options.showSuppressedDiagnostics) {
    setDiagnosticSuppressionAuditMode(true);
  }

  // Register built-in diagnostic suppression rules (same as language service for consistency)
  registerCliDiagnosticSuppressionRules();

  profiler.start("cli.build.total");

  profiler.start("cli.build.readTsConfig");
  const config = readTsConfig(options.project);
  loadProjectConfig(options.project);
  profiler.end("cli.build.readTsConfig");

  if (options.verbose) {
    console.log(`🧊 Using config: ${path.resolve(options.project)}`);
    console.log(`🧊 Compiling ${config.fileNames.length} files...`);
  }

  const noEmit = options.command === "check";
  const configDir = path.dirname(path.resolve(options.project));
  const projectOptions: ts.CompilerOptions = {
    ...config.options,
    ...(options.declarationDir ? { declarationDir: path.resolve(options.declarationDir) } : {}),
  };
  // Declarations come from the EXPANDED program (declarations.ts): the program
  // the macros run against is built with declaration emit switched off.
  const declarationOnly =
    !noEmit &&
    (options.emitDeclarationOnly === true || projectOptions.emitDeclarationOnly === true);
  const emitDeclarations =
    !noEmit &&
    (declarationOnly || (wantsDeclarations(projectOptions) && projectOptions.noEmit !== true));
  if (declarationOnly && !projectOptions.declarationDir && !projectOptions.outDir) {
    console.error(
      `🧊 --emitDeclarationOnly needs somewhere to write: set "declarationDir" or "outDir" in ${options.project}, or pass --declarationDir <dir>.`
    );
    process.exit(1);
  }
  const compilerOptions: ts.CompilerOptions = emitDeclarations
    ? withoutDeclarations(projectOptions, configDir)
    : { ...projectOptions, ...(noEmit ? { noEmit: true } : {}) };

  // Initialize disk cache if enabled
  const diskCache = options.cache
    ? new DiskTransformCache(
        typeof options.cache === "string" ? options.cache : ".typesugar-cache/transforms"
      )
    : null;
  const contentHashes = new Map<string, string>();

  if (diskCache && options.verbose) {
    console.log(`🧊 Disk cache enabled`);
  }

  // Stage 1: Preprocess all files (HKT F<_> type syntax)
  profiler.start("cli.build.preprocess");
  const preprocessedFiles = new Map<string, string>();
  let preprocessCount = 0;

  for (const fileName of config.fileNames) {
    // Include .ts, .tsx, .js, .jsx files
    if (/\.[jt]sx?$/.test(fileName) && !/node_modules/.test(fileName)) {
      try {
        const source = fs.readFileSync(fileName, "utf-8");

        // Track content hashes for disk cache validation
        if (diskCache) {
          const resolvedPath = path.resolve(fileName);
          contentHashes.set(resolvedPath, hashContent(source));
        }

        const rewritten = preprocessForProgram(fileName, source);
        if (rewritten !== undefined) {
          preprocessedFiles.set(path.resolve(fileName), rewritten);
          preprocessCount++;
        }
      } catch {
        // File read error - let TS handle it
      }
    }
  }
  profiler.end("cli.build.preprocess");

  if (options.verbose && preprocessCount > 0) {
    console.log(`🧊 Preprocessed HKT syntax in ${preprocessCount} files`);
  }

  // Create compiler host that serves preprocessed content
  const host = ts.createCompilerHost(compilerOptions);
  const originalReadFile = host.readFile.bind(host);
  host.readFile = (fileName) => {
    const resolved = path.resolve(fileName);
    const preprocessed = preprocessedFiles.get(resolved);
    if (preprocessed !== undefined) {
      return preprocessed;
    }
    return originalReadFile(fileName);
  };

  // Stage 2: Create program with preprocessed content and run macro transformer
  profiler.start("cli.build.createProgram");
  const program = ts.createProgram(config.fileNames, compilerOptions, host);
  profiler.end("cli.build.createProgram");

  // Macro diagnostics side channel. TypeScript drops diagnostics a `before`
  // transformer reports via context.addDiagnostic during program.emit(), so
  // without this a macro error (e.g. a throwing comptime) printed nothing and
  // the build exited 0. `collectMacroDiagnostics` is switched off while the
  // --strict pass runs the transformer over detached re-parsed copies (no
  // type info there, so its macro diagnostics are not authoritative).
  const macroDiagnostics: ts.Diagnostic[] = [];
  let collectMacroDiagnostics = true;

  profiler.start("cli.build.createTransformerFactory");
  const transformerFactory = macroTransformerFactory(program, {
    verbose: options.verbose,
    onDiagnostic: (d) => {
      if (collectMacroDiagnostics) macroDiagnostics.push(d);
    },
  });
  profiler.end("cli.build.createTransformerFactory");

  // Custom write file that caches transformed output
  const customWriteFile = diskCache
    ? (
        filePath: string,
        content: string,
        writeByteOrderMark: boolean,
        onError?: (message: string) => void,
        sourceFiles?: readonly ts.SourceFile[],
        data?: ts.WriteFileCallbackData
      ) => {
        // Cache .js/.ts output files (not .d.ts)
        if (sourceFiles?.length === 1 && /\.(js|jsx|mjs|cjs)$/.test(filePath)) {
          const sourceFile = sourceFiles[0];
          const sourcePath = path.resolve(sourceFile.fileName);
          const contentHash = contentHashes.get(sourcePath);
          if (contentHash) {
            // Get dependencies from imports
            const deps: string[] = [];
            const depHashes: Record<string, string> = {};
            sourceFile.forEachChild((node) => {
              if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
                const specifier = node.moduleSpecifier.text;
                if (!specifier.startsWith(".")) return;
                const resolved = path.resolve(path.dirname(sourcePath), specifier);
                for (const ext of [".ts", ".tsx", ".js", ".jsx", ""]) {
                  const depPath = resolved + ext;
                  const depHash = contentHashes.get(depPath);
                  if (depHash) {
                    deps.push(depPath);
                    depHashes[depPath] = depHash;
                    break;
                  }
                }
              }
            });
            diskCache.set(sourcePath, contentHash, deps, depHashes, content, null);
          }
        }
        ts.sys.writeFile(filePath, content, writeByteOrderMark);
      }
    : undefined;

  // Strict mode: typecheck expanded output before emit
  let strictDiagnostics: ts.Diagnostic[] = [];
  if (options.strict) {
    profiler.start("cli.build.strictTypecheck");
    collectMacroDiagnostics = false;

    // Transform all source files
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    const expandedFiles = new Map<string, string>();

    for (const fileName of config.fileNames) {
      const sourceFile = program.getSourceFile(fileName);
      if (!sourceFile) continue;

      // Transform a FRESH copy of the source, not the program's own SourceFile.
      // ts.transform attaches synthetic nodes (pos = -1) to the tree it walks;
      // running it on `program`'s SourceFile pollutes that program's checker and
      // crashes the subsequent program.emit()/getPreEmitDiagnostics in
      // createTextSpan ("start < 0"). A re-parsed copy isolates the strict pass.
      const scriptKind = /\.tsx$/.test(sourceFile.fileName)
        ? ts.ScriptKind.TSX
        : /\.jsx$/.test(sourceFile.fileName)
          ? ts.ScriptKind.JSX
          : /\.js$/.test(sourceFile.fileName)
            ? ts.ScriptKind.JS
            : ts.ScriptKind.TS;
      const freshSource = ts.createSourceFile(
        sourceFile.fileName,
        sourceFile.text,
        sourceFile.languageVersion,
        true,
        scriptKind
      );

      // Run the transformer
      const transformResult = ts.transform(freshSource, [transformerFactory], compilerOptions);
      const transformedFile = transformResult.transformed[0];

      // Print the transformed source
      const expandedCode = printer.printFile(transformedFile);
      expandedFiles.set(path.resolve(fileName), expandedCode);

      transformResult.dispose();
    }
    collectMacroDiagnostics = true;

    // Create a virtual host serving expanded files
    const expandedHost = ts.createCompilerHost(compilerOptions);
    const origExpandedReadFile = expandedHost.readFile.bind(expandedHost);
    expandedHost.readFile = (fileName) => {
      const resolved = path.resolve(fileName);
      const expanded = expandedFiles.get(resolved);
      if (expanded !== undefined) {
        return expanded;
      }
      return origExpandedReadFile(fileName);
    };

    // Create a new program over the EXPANDED files (served by expandedHost) for
    // type checking. NOTE: do NOT pass `program` as the old program for
    // structural reuse — its source files carry the transformer's synthetic
    // nodes (pos = -1), which TypeScript's checker can reuse and then crash on
    // in createTextSpan ("start < 0") when building diagnostic spans. The
    // expanded files are freshly parsed strings, so there is nothing safe to
    // reuse — but expandedHost MUST be passed so the program reads the expanded
    // output rather than the original on-disk source.
    const expandedProgram = ts.createProgram(
      config.fileNames,
      { ...compilerOptions, noEmit: true },
      expandedHost
    );

    // Get type errors from expanded program. Guard against the synthetic-node
    // "start < 0" crash so --strict degrades gracefully instead of aborting the
    // whole build with an unhandled exception.
    try {
      strictDiagnostics = [...ts.getPreEmitDiagnostics(expandedProgram)];
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes("start < 0")) {
        console.error(
          "🧊 Warning: --strict typecheck skipped — the checker crashed on synthetic node positions in the expanded output."
        );
        strictDiagnostics = [];
      } else {
        throw e;
      }
    }

    const strictElapsed = profiler.end("cli.build.strictTypecheck");
    if (options.verbose) {
      const modeLabel = options.strict === "incremental" ? " (incremental, first run — full)" : "";
      console.log(
        `🧊 Strict typecheck${modeLabel}: ${strictDiagnostics.length} diagnostics (${strictElapsed.toFixed(0)}ms)`
      );
    }
  }

  // Collect pre-emit diagnostics BEFORE emit. After emit, the transformer's
  // synthetic nodes (pos = -1) cause deferred checker callbacks to crash in
  // createTextSpan when getPreEmitDiagnostics triggers getGlobalDiagnostics.
  // The --strict block above already runs the transformer via ts.transform,
  // which can pollute this program's checker with synthetic nodes, so guard
  // the same "start < 0" crash here (in strict mode the expanded-output
  // diagnostics are authoritative anyway).
  profiler.start("cli.build.preEmitDiagnostics");
  let preEmitDiagnostics: readonly ts.Diagnostic[] = [];
  try {
    preEmitDiagnostics = ts.getPreEmitDiagnostics(program);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("start < 0")) {
      console.error(
        "🧊 Warning: pre-emit diagnostics skipped — checker crashed on synthetic node positions."
      );
    } else {
      throw e;
    }
  }
  profiler.end("cli.build.preEmitDiagnostics");

  // TS diagnostics are suppression-filtered BEFORE the transformer touches
  // the program's own SourceFiles (check mode below), so the filter's
  // checker calls never see synthetic nodes there.
  const filterTsDiagnostics = (raw: readonly ts.Diagnostic[]): readonly ts.Diagnostic[] => {
    if (getDiagnosticSuppressionRules().length === 0) return raw;
    // getTypeChecker() after emit may trigger deferred callbacks that crash on
    // synthetic nodes — catch and fall back to unfiltered diagnostics.
    try {
      const checker = program.getTypeChecker();
      return filterDiagnostics(raw, checker, (fn) => program.getSourceFile(fn), { program });
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes("start < 0")) {
        console.error(
          `🧊 Warning: diagnostic suppression filtering skipped — checker crashed on synthetic node positions`
        );
        return raw;
      }
      throw e;
    }
  };

  let tsDiagnostics: readonly ts.Diagnostic[];
  // Expanded text of the files the macros changed, for the declaration emit.
  let expandedSources = new Map<string, string>();
  if (noEmit || declarationOnly) {
    // `check`: program.emit() is a no-op under noEmit, so the macro
    // transformer would never run and macro errors would go unreported.
    // Run it explicitly over every file emit would have transformed.
    tsDiagnostics = filterTsDiagnostics([...preEmitDiagnostics, ...strictDiagnostics]);
    profiler.start("cli.build.checkExpand");
    if (declarationOnly) {
      // No JavaScript: expand every file and keep the printed result.
      expandedSources = expandProgramSources(program, transformerFactory);
    } else {
      for (const sourceFile of program.getSourceFiles()) {
        if (sourceFile.isDeclarationFile || program.isSourceFileFromExternalLibrary(sourceFile)) {
          continue;
        }
        const transformResult = ts.transform(sourceFile, [transformerFactory], compilerOptions);
        transformResult.dispose();
      }
    }
    profiler.end("cli.build.checkExpand");
  } else {
    profiler.start("cli.build.emit");
    const emitResult = program.emit(undefined, customWriteFile, undefined, false, {
      before: emitDeclarations
        ? [transformerFactory, captureExpandedSource(program, expandedSources)]
        : [transformerFactory],
    });
    profiler.end("cli.build.emit");
    tsDiagnostics = filterTsDiagnostics([
      ...preEmitDiagnostics,
      ...emitResult.diagnostics,
      ...strictDiagnostics,
    ]);
  }

  // `.d.ts` from the expanded program. Its diagnostics (declaration-emit
  // errors such as isolatedDeclarations) are about the expanded code, so they
  // bypass the suppression filter too. noEmitOnError is decided here, on the
  // filtered diagnostics: the expanded program itself never blocks its emit.
  const declarationDiagnostics: ts.Diagnostic[] = [];
  if (emitDeclarations) {
    const hasErrors = [...tsDiagnostics, ...macroDiagnostics].some(
      (d) => d.category === ts.DiagnosticCategory.Error
    );
    if (!(projectOptions.noEmitOnError && hasErrors)) {
      profiler.start("cli.build.declarations");
      const result = emitExpandedDeclarations({
        rootNames: config.fileNames,
        options: projectOptions,
        host,
        expanded: expandedSources,
      });
      declarationDiagnostics.push(...result.diagnostics);
      profiler.end("cli.build.declarations");
    }
  }

  // Macro diagnostics are real errors, never phantom ones: they bypass the
  // suppression filter (which exists for TS errors caused by typesugar
  // rewrites — extension methods, newtype assignment, opaque types).
  const allDiagnostics = dedupeDiagnostics([
    ...tsDiagnostics,
    ...macroDiagnostics,
    ...declarationDiagnostics,
  ]);

  const errorCount = reportDiagnostics(allDiagnostics);

  profiler.end("cli.build.total");

  // Save caches to disk
  saveExpansionCache();
  if (diskCache) {
    diskCache.save();
    if (options.verbose) {
      console.log(`🧊 ${diskCache.getStatsString()}`);
    }
  }

  if (options.verbose || errorCount > 0) {
    const fileCount = config.fileNames.length;
    if (errorCount > 0) {
      console.error(
        `\n🧊 Found ${errorCount} error${errorCount === 1 ? "" : "s"} in ${fileCount} files.`
      );
    } else {
      console.log(`✨ Successfully compiled ${fileCount} files.`);
    }
  }

  // Print cache stats if verbose
  if (options.verbose) {
    const stats = getExpansionCacheStats();
    if (stats) {
      console.log(`🧊 ${stats}`);
    }
  }

  // Print profiling report if enabled
  if (PROFILING_ENABLED) {
    profiler.printReport();
  }

  process.exit(errorCount > 0 ? 1 : 0);
}

function watch(options: CliOptions): void {
  if (options.showSuppressedDiagnostics) {
    setDiagnosticSuppressionAuditMode(true);
  }
  registerCliDiagnosticSuppressionRules();

  const configPath = ts.findConfigFile(
    path.dirname(path.resolve(options.project)),
    ts.sys.fileExists,
    path.basename(options.project)
  );

  if (!configPath) {
    console.error(`Could not find ${options.project}`);
    process.exit(1);
  }

  loadProjectConfig(configPath);

  // Create shared transformer state - reused across rebuilds for efficiency
  const transformerState = new TransformerState({
    verbose: options.verbose,
  });

  // Track the current program for diagnostic suppression filtering in watch mode
  let currentProgram: ts.Program | undefined;

  // Serve HKT-preprocessed text to the watch program, exactly as `build`
  // does — with the raw ts.sys, `F<A>` on a type parameter is TS2315 in watch.
  const watchSystem: ts.System = {
    ...ts.sys,
    readFile: (fileName, encoding) => {
      const source = ts.sys.readFile(fileName, encoding);
      if (source === undefined) return undefined;
      return preprocessForProgram(fileName, source) ?? source;
    },
  };

  const host = ts.createWatchCompilerHost(
    configPath,
    {},
    watchSystem,
    ts.createEmitAndSemanticDiagnosticsBuilderProgram,
    (diagnostic) => {
      // Filter through diagnostic suppression rules before reporting. The
      // reporter runs after emit, when the checker may trip over the
      // transformer's synthetic nodes ("start < 0") — degrade to reporting
      // the diagnostic unfiltered, with a visible warning.
      if (currentProgram && getDiagnosticSuppressionRules().length > 0) {
        const program = currentProgram;
        try {
          const checker = program.getTypeChecker();
          const filtered = filterDiagnostics(
            [diagnostic],
            checker,
            (fn) => program.getSourceFile(fn),
            { program }
          );
          if (filtered.length === 0) return;
        } catch (e: unknown) {
          if (e instanceof Error && e.message.includes("start < 0")) {
            console.error(
              "🧊 Warning: diagnostic suppression filtering skipped — checker crashed on synthetic node positions"
            );
          } else {
            throw e;
          }
        }
      }
      reportDiagnostics([diagnostic]);
    },
    (diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      console.log(`🧊 ${message}`);
    }
  );

  const origCreateProgram = host.createProgram;
  host.createProgram = (rootNames, opts, hostObj, oldProgram) => {
    if (options.verbose) {
      console.log("🧊 Recompiling...");
    }
    return origCreateProgram(rootNames, opts, hostObj, oldProgram);
  };

  const origAfterProgramCreate = host.afterProgramCreate;
  host.afterProgramCreate = (builderProgram) => {
    const program = builderProgram.getProgram();
    currentProgram = program;
    // Reuse transformer state across rebuilds for efficiency
    const transformerFactory = macroTransformerFactory(
      program,
      {
        verbose: options.verbose,
      },
      transformerState
    );

    const origEmit = builderProgram.emit;
    builderProgram.emit = (
      targetSourceFile,
      writeFile,
      cancellationToken,
      emitOnlyDtsFiles,
      customTransformers
    ) => {
      const result = origEmit(targetSourceFile, writeFile, cancellationToken, emitOnlyDtsFiles, {
        ...customTransformers,
        before: [transformerFactory, ...(customTransformers?.before ?? [])],
      });
      // Macro diagnostics never reach `result.diagnostics` (TS drops what a
      // `before` transformer adds), so report them from the state's side
      // channel. TS's own "Found N errors" summary does not count these.
      const macroDiagnostics = dedupeDiagnostics(transformerState.takeDiagnostics());
      if (macroDiagnostics.length > 0) {
        const macroErrors = reportDiagnostics(macroDiagnostics);
        if (macroErrors > 0) {
          console.error(
            `🧊 ${macroErrors} macro error${macroErrors === 1 ? "" : "s"} (TypeScript's error count does not include these).`
          );
        }
      }
      return result;
    };

    origAfterProgramCreate?.(builderProgram);
  };

  console.log("🧊 Starting watch mode...");
  ts.createWatchProgram(host);
}

function expand(options: CliOptions): void {
  if (!options.file) {
    console.error("Error: expand command requires a file argument");
    console.error("Usage: typesugar expand <file> [--diff] [--ast] [--js]");
    process.exit(1);
  }

  const filePath = path.resolve(options.file);

  if (!ts.sys.fileExists(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const originalContent = ts.sys.readFile(filePath) ?? "";
  loadProjectConfig(options.project);

  // --ast option requires TypeScript AST output
  if (options.ast) {
    const config = readTsConfig(options.project);
    const compilerOptions: ts.CompilerOptions = {
      ...config.options,
      noEmit: true,
    };

    // VirtualCompilerHost preprocesses all files (including imports)
    const host = new VirtualCompilerHost({ compilerOptions });
    const program = ts.createProgram([filePath], compilerOptions, host);
    const sourceFile = program.getSourceFile(filePath);

    if (!sourceFile) {
      console.error(`Could not load source file: ${filePath}`);
      process.exit(1);
    }

    const transformerFactory = macroTransformerFactory(program, {
      verbose: options.verbose,
    });

    const result = ts.transform(sourceFile, [transformerFactory]);
    const transformedSourceFile = result.transformed[0];

    const ast = JSON.stringify(
      transformedSourceFile,
      (key, value) => {
        if (
          key === "parent" ||
          key === "pos" ||
          key === "end" ||
          key === "flags" ||
          key === "symbol" ||
          key === "emitNode"
        ) {
          return undefined;
        }
        if (typeof value === "object" && value !== null && "kind" in value) {
          return {
            ...value,
            kindName: ts.SyntaxKind[value.kind],
          };
        }
        return value;
      },
      2
    );
    console.log(ast);
    result.dispose();
    return;
  }

  // Use the project's tsconfig for full type resolution (needed for operator
  // rewriting, instance resolution, etc.) instead of minimal hardcoded options.
  const config = readTsConfig(options.project);
  const allFiles = [...config.fileNames];
  if (!allFiles.includes(filePath)) {
    allFiles.push(filePath);
  }

  const pipeline = new TransformationPipeline({ ...config.options, noEmit: true }, allFiles, {
    verbose: options.verbose,
    emitJs: options.js,
  });
  const result = pipeline.transform(filePath);

  // Report diagnostics
  if (result.diagnostics.length > 0) {
    for (const d of result.diagnostics) {
      const prefix = d.severity === "error" ? "error" : "warning";
      console.error(`${d.file}:${d.start}: ${prefix}: ${d.message}`);
    }
  }

  if (options.diff) {
    // Use formatExpansions for a clean focused diff
    const diffOutput = formatExpansions(result);
    console.log(diffOutput);
  } else if (options.js && result.js) {
    console.log(result.js);
  } else {
    console.log(result.code);
  }
}

/**
 * Transform a single file using the unplugin-style two-stage pipeline:
 * 1. Preprocess custom syntax (HKT F<_>, |>, ::, @instance, @typeclass)
 * 2. Run macro transformer
 *
 * Uses VirtualCompilerHost so ALL files in the program (including imports)
 * get preprocessed before the macro transformer sees them.
 */
function transformFile(
  filePath: string,
  config: ts.ParsedCommandLine,
  options: { verbose?: boolean }
): string {
  // VirtualCompilerHost preprocesses all files (including imports) on demand
  const host = new VirtualCompilerHost({
    compilerOptions: config.options,
  });

  const allFiles = [...config.fileNames];
  if (!allFiles.includes(filePath)) {
    allFiles.push(filePath);
  }

  const program = ts.createProgram(allFiles, config.options, host);
  const sourceFile = program.getSourceFile(filePath);

  if (!sourceFile) {
    throw new Error(`Could not load source file: ${filePath}`);
  }

  if (options.verbose) {
    const preprocessed = host.hasPreprocessed(filePath);
    if (preprocessed) {
      console.log(`🧊 Preprocessed custom syntax in ${filePath}`);
    }
  }

  const transformerFactory = macroTransformerFactory(program, {
    verbose: options.verbose,
  });

  const result = ts.transform(sourceFile, [transformerFactory]);
  const transformedSourceFile = result.transformed[0];

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const transformedCode = printer.printFile(transformedSourceFile as ts.SourceFile);

  result.dispose();

  return transformedCode;
}

async function run(options: CliOptions): Promise<void> {
  if (!options.file) {
    console.error("Error: run command requires a file argument");
    console.error("Usage: typesugar run <file>");
    process.exit(1);
  }

  const config = readTsConfig(options.project);
  const filePath = path.resolve(options.file);

  if (!ts.sys.fileExists(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  if (options.verbose) {
    console.log(`🧊 Running ${filePath}...`);
  }

  loadProjectConfig(options.project);
  if (options.cache) {
    // Initialize hasher for faster content hashing
    await initHasher();
  }

  // ONE type-aware pipeline (the project's tsconfig options, the project's
  // files plus the entry) expands the entry AND every user module it imports
  // (see the esbuild onLoad hook below) -- previously only the entry was
  // macro-expanded and imported modules shipped raw macro calls.
  const rootFiles = [...config.fileNames];
  if (!rootFiles.includes(filePath)) {
    rootFiles.push(filePath);
  }
  const pipeline = new TransformationPipeline(config.options, rootFiles, {
    verbose: options.verbose,
    ...(options.cache ? { diskCache: options.cache } : {}),
  });

  let macroErrorCount = 0;
  const expandForRun = (file: string): string => {
    const result = pipeline.transform(file);
    for (const d of result.diagnostics) {
      let loc = `${d.file}`;
      try {
        const text = result.original;
        const before = text.slice(0, d.start);
        const line = before.split("\n").length;
        const col = d.start - before.lastIndexOf("\n");
        loc = `${d.file}(${line},${col})`;
      } catch {
        // Fall back to the bare file name
      }
      const prefix = d.severity === "error" ? "error" : "warning";
      console.error(`${loc}: ${prefix}${d.code ? ` TS${d.code}` : ""}: ${d.message}`);
      if (d.severity === "error") macroErrorCount++;
    }
    return result.code;
  };

  const toJs = (file: string, code: string): string =>
    transpileExpanded(code, file, config.options, {
      sourceMap: false,
      jsx: file.endsWith(".tsx") ? ts.JsxEmit.ReactJSX : undefined,
    }).outputText;

  const jsCode = toJs(filePath, expandForRun(filePath));

  // Bundle with esbuild (handles TS transpilation and dependency resolution)
  const esbuild = await import("esbuild");
  const crypto = await import("crypto");
  const { spawn } = await import("child_process");

  const fileDir = path.dirname(filePath);
  const hash = crypto.createHash("md5").update(filePath).digest("hex").slice(0, 8);
  const tempInputFile = path.join(fileDir, `.typesugar-${hash}-input.mjs`);
  // Write bundled output inside the project tree (not os.tmpdir()) so that
  // Node's ESM resolution can find `typescript` in the project's node_modules.
  const cacheDir = path.join(fileDir, ".typesugar-cache");
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  const tempFile = path.join(cacheDir, `run-${hash}.mjs`);

  // Write transpiled JavaScript to temp file next to original (for import resolution)
  fs.writeFileSync(tempInputFile, jsCode);

  try {
    // Create an esbuild plugin to preprocess TypeScript files
    const preprocessPlugin = {
      name: "typesugar-preprocess",
      setup(build: {
        onLoad: (
          opts: { filter: RegExp },
          cb: (args: { path: string }) => Promise<{ contents: string; loader: "js" | "jsx" }>
        ) => void;
      }) {
        // Match .ts, .tsx files — preprocess HKT syntax then transpile to JS
        // so esbuild doesn't choke on namespaces/const enums
        build.onLoad({ filter: /\.tsx?$/ }, async (args: { path: string }) => {
          const isTsx = args.path.endsWith(".tsx");
          let code: string;
          if (pipeline.shouldTransform(args.path)) {
            // User module: full macro expansion, diagnostics reported.
            code = expandForRun(args.path);
          } else {
            // node_modules / .d.ts: HKT syntax only, as before.
            const source = await fs.promises.readFile(args.path, "utf-8");
            code = hasHKTPatterns(source)
              ? rewriteHKTTypeReferences(source, args.path).code
              : source;
          }
          return {
            contents: toJs(args.path, code),
            loader: isTsx ? ("jsx" as const) : ("js" as const),
          };
        });
      },
    };

    // Bundle with esbuild (resolves all imports relative to source location)
    await esbuild.build({
      entryPoints: [tempInputFile],
      bundle: true,
      format: "esm",
      platform: "node",
      target: "es2020",
      outfile: tempFile,
      logLevel: options.verbose ? "info" : "silent",
      absWorkingDir: fileDir,
      plugins: [preprocessPlugin],
      external: ["typescript"],
    });
  } finally {
    // Clean up input file
    try {
      fs.unlinkSync(tempInputFile);
    } catch {
      // Ignore cleanup errors
    }
  }

  // Save caches for next run
  pipeline.cleanup();

  // Macro errors: do not execute code whose macros failed to expand (the
  // same rule as `build`, which exits non-zero on them).
  if (macroErrorCount > 0) {
    console.error(
      `\n🧊 Found ${macroErrorCount} macro error${macroErrorCount === 1 ? "" : "s"}; not running ${filePath}.`
    );
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // Ignore cleanup errors
    }
    process.exit(1);
  }

  if (options.verbose) {
    console.log(`🧊 Wrote transpiled code to ${tempFile}`);
  }

  // Execute with node (ESM)
  const child = spawn("node", [tempFile], {
    stdio: "inherit",
    cwd: path.dirname(filePath),
  });

  child.on("close", (code, signal) => {
    // Clean up temp file
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // Ignore cleanup errors
    }
    // A child killed by a signal has code === null: that is a failure, not
    // success. Use the shell convention 128 + signal number.
    if (code !== null) process.exit(code);
    const signum = signal ? os.constants.signals[signal] : undefined;
    process.exit(signum ? 128 + signum : 1);
  });

  child.on("error", (err) => {
    console.error("Failed to execute:", err);
    process.exit(1);
  });
}

/**
 * Recursively collect all .ts/.tsx files from the given sources (files or directories)
 */
function collectTypeScriptFiles(sources: string[]): string[] {
  const files: string[] = [];

  for (const source of sources) {
    const resolved = path.resolve(source);

    if (!fs.existsSync(resolved)) {
      console.error(`Warning: ${source} does not exist, skipping`);
      continue;
    }

    const stat = fs.statSync(resolved);

    if (stat.isFile()) {
      // Include .ts, .tsx, .js, .jsx files
      if (/\.[jt]sx?$/.test(resolved)) {
        files.push(resolved);
      }
    } else if (stat.isDirectory()) {
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(resolved, entry.name);
        if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
          files.push(...collectTypeScriptFiles([entryPath]));
        } else if (entry.isFile() && /\.[jt]sx?$/.test(entry.name)) {
          files.push(entryPath);
        }
      }
    }
  }

  return files;
}

/**
 * Compute output path preserving directory structure relative to the source root
 */
function computeOutputPath(file: string, sources: string[], outDir: string): string {
  const resolvedFile = path.resolve(file);
  const resolvedOutDir = path.resolve(outDir);

  // Find which source this file belongs to
  for (const source of sources) {
    const resolvedSource = path.resolve(source);
    const sourceStat = fs.existsSync(resolvedSource) ? fs.statSync(resolvedSource) : null;

    if (sourceStat?.isDirectory()) {
      // File is under this source directory
      if (resolvedFile.startsWith(resolvedSource + path.sep)) {
        const relativePath = path.relative(resolvedSource, resolvedFile);
        return path.join(resolvedOutDir, relativePath);
      }
    } else if (sourceStat?.isFile()) {
      // Source is a file, put it directly in outDir
      if (resolvedFile === resolvedSource) {
        return path.join(resolvedOutDir, path.basename(file));
      }
    }
  }

  // Fallback: put file directly in outDir
  return path.join(resolvedOutDir, path.basename(file));
}

/**
 * Ensure directory exists (mkdir -p equivalent)
 */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Preprocess TypeScript files (custom syntax only, no macro expansion)
 */
function preprocessCommand(options: CliOptions): void {
  const sources = options.preprocessSources ?? ["src"];
  const outDir = options.outDir ?? ".typesugar";
  const inPlace = options.inPlace ?? false;

  const files = collectTypeScriptFiles(sources);

  if (files.length === 0) {
    console.error("No TypeScript files found in the specified sources");
    process.exit(1);
  }

  if (options.verbose) {
    console.log(`🧊 Found ${files.length} TypeScript files to preprocess`);
  }

  let processedCount = 0;
  let changedCount = 0;

  for (const file of files) {
    try {
      const source = fs.readFileSync(file, "utf-8");
      const result = hasHKTPatterns(source)
        ? rewriteHKTTypeReferences(source, file)
        : { code: source, changed: false, map: null };

      processedCount++;

      if (result.changed) {
        changedCount++;
        const outputPath = inPlace ? file : computeOutputPath(file, sources, outDir);
        ensureDir(path.dirname(outputPath));
        fs.writeFileSync(outputPath, result.code);

        // Write source map if available
        if (result.map) {
          fs.writeFileSync(outputPath + ".map", JSON.stringify(result.map));
        }

        if (options.verbose) {
          console.log(
            `  ✓ ${path.relative(process.cwd(), file)} → ${path.relative(process.cwd(), outputPath)}`
          );
        }
      } else if (!inPlace) {
        // Copy unchanged files to output directory
        const outputPath = computeOutputPath(file, sources, outDir);
        ensureDir(path.dirname(outputPath));
        fs.writeFileSync(outputPath, source);

        if (options.verbose) {
          console.log(`  → ${path.relative(process.cwd(), file)} (unchanged)`);
        }
      }
    } catch (err) {
      console.error(`Error processing ${file}:`, err);
    }
  }

  if (inPlace) {
    console.log(`✨ Preprocessed ${changedCount} of ${processedCount} files in place`);
  } else {
    console.log(`✨ Preprocessed ${processedCount} files to ${outDir} (${changedCount} changed)`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    process.exit(0);
  }

  const options = parseArgs(args);

  switch (options.command) {
    case "build":
    case "check":
      build(options);
      break;
    case "watch":
      watch(options);
      break;
    case "expand":
      expand(options);
      break;
    case "run":
      await run(options);
      break;
    case "init": {
      const { runInit } = await import("./init.js");
      await runInit(options.verbose, {
        yes: options.yes,
        persona: options.persona,
        ai: options.ai,
      });
      break;
    }
    case "doctor": {
      const { runDoctor } = await import("./doctor.js");
      await runDoctor(options.verbose);
      break;
    }
    case "create": {
      const { runCreate } = await import("./create.js");
      await runCreate(options.createArgs ?? []);
      break;
    }
    case "preprocess":
      preprocessCommand(options);
      break;
    case "approve-macros": {
      const { runApproveMacros } = await import("./approve-macros.js");
      await runApproveMacros({
        project: options.project,
        yes: options.yes ?? false,
        verbose: options.verbose,
      });
      break;
    }
  }
}

main().catch((err) => {
  if (err instanceof UnapprovedMacroPackagesError) {
    console.error(err.message);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
