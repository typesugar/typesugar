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
 */

import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import macroTransformerFactory from "./index.js";
import { preprocess } from "@typesugar/preprocessor";
import { VirtualCompilerHost } from "./virtual-host.js";

type Command = "build" | "watch" | "check" | "expand" | "run" | "init" | "doctor" | "create" | "preprocess";

interface CliOptions {
  command: Command;
  project: string;
  verbose: boolean;
  file?: string;
  diff?: boolean;
  ast?: boolean;
  createArgs?: string[];
  preprocessSources?: string[];
  outDir?: string;
  inPlace?: boolean;
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
  ];

  if (!validCommands.includes(command)) {
    console.error(
      `Unknown command: ${command}\nUsage: typesugar <build|watch|check|expand|init|doctor|create|preprocess> [options]`
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

  let project = "tsconfig.json";
  let verbose = false;
  let file: string | undefined;
  let diff = false;
  let ast = false;

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
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith("-") && !file) {
      file = arg;
    }
  }

  return { command, project, verbose, file, diff, ast };
}

function printHelp(): void {
  console.log(`
🧊 typesugar — Syntactic sugar for TypeScript with zero calories

USAGE:
  typesugar <command> [options]

COMMANDS:
  build              Compile TypeScript with macro expansion (default)
  watch              Watch mode -- recompile on file changes
  check              Type-check with macro expansion, but don't emit files
  expand <file>      Show macro-expanded output for a file
  run <file>         Compile and execute a file with macro expansion
  init               Interactive setup wizard for existing projects
  doctor             Diagnose configuration issues
  create [template]  Create a new project from a template
  preprocess <files|dirs>  Preprocess files (custom syntax only, no macro expansion)

OPTIONS:
  -p, --project <path>   Path to tsconfig.json (default: tsconfig.json)
  -v, --verbose          Enable verbose logging
  -h, --help             Show this help message

EXPAND OPTIONS:
  --diff                 Show unified diff between original and expanded
  --ast                  Show expanded AST as JSON

PREPROCESS OPTIONS:
  --outDir <dir>         Output directory (default: .typesugar)
  --inPlace              Preprocess files in place (overwrites originals)

CREATE TEMPLATES:
  app                Vite application with comptime, derive, and sql
  library            Publishable library with typeclasses
  macro-plugin       Custom macros package

EXAMPLES:
  typesugar build
  typesugar build --project tsconfig.build.json
  typesugar watch --verbose
  typesugar check
  typesugar expand src/main.ts
  typesugar expand src/main.ts --diff
  typesugar run examples/showcase.ts
  typesugar init
  typesugar doctor
  typesugar create app my-app
  typesugar create library my-lib
  typesugar create macro-plugin my-macros
  typesugar preprocess src/ --outDir .typesugar
  typesugar preprocess src/index.ts src/types.ts --outDir dist
  typesugar preprocess src/ --inPlace
`);
}

function readTsConfig(configPath: string): ts.ParsedCommandLine {
  const absolutePath = path.resolve(configPath);
  const configFile = ts.readConfigFile(absolutePath, ts.sys.readFile);

  if (configFile.error) {
    const message = ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n");
    console.error(`Error reading ${configPath}: ${message}`);
    process.exit(1);
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(absolutePath)
  );

  if (parsed.errors.length > 0) {
    const messages = parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    console.error(`Config errors:\n${messages.join("\n")}`);
    process.exit(1);
  }

  return parsed;
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

function build(options: CliOptions): void {
  const config = readTsConfig(options.project);

  if (options.verbose) {
    console.log(`🧊 Using config: ${path.resolve(options.project)}`);
    console.log(`🧊 Compiling ${config.fileNames.length} files...`);
  }

  const noEmit = options.command === "check";
  const compilerOptions: ts.CompilerOptions = {
    ...config.options,
    ...(noEmit ? { noEmit: true } : {}),
  };

  // Stage 1: Preprocess all files (custom syntax like HKT F<_>, |>, ::)
  const preprocessedFiles = new Map<string, string>();
  let preprocessCount = 0;

  for (const fileName of config.fileNames) {
    if (/\.[jt]sx?$/.test(fileName) && !/node_modules/.test(fileName)) {
      try {
        const source = fs.readFileSync(fileName, "utf-8");
        const result = preprocess(source, { fileName });
        if (result.changed) {
          preprocessedFiles.set(path.resolve(fileName), result.code);
          preprocessCount++;
        }
      } catch {
        // File read error - let TS handle it
      }
    }
  }

  if (options.verbose && preprocessCount > 0) {
    console.log(`🧊 Preprocessed custom syntax in ${preprocessCount} files`);
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
  const program = ts.createProgram(config.fileNames, compilerOptions, host);

  const transformerFactory = macroTransformerFactory(program, {
    verbose: options.verbose,
  });

  const emitResult = program.emit(undefined, undefined, undefined, false, {
    before: [transformerFactory],
  });

  const allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);

  const errorCount = reportDiagnostics(allDiagnostics);

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

  process.exit(errorCount > 0 ? 1 : 0);
}

function watch(options: CliOptions): void {
  const configPath = ts.findConfigFile(
    path.dirname(path.resolve(options.project)),
    ts.sys.fileExists,
    path.basename(options.project)
  );

  if (!configPath) {
    console.error(`Could not find ${options.project}`);
    process.exit(1);
  }

  const host = ts.createWatchCompilerHost(
    configPath,
    {},
    ts.sys,
    ts.createEmitAndSemanticDiagnosticsBuilderProgram,
    (diagnostic) => {
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
    const transformerFactory = macroTransformerFactory(program, {
      verbose: options.verbose,
    });

    const origEmit = builderProgram.emit;
    builderProgram.emit = (
      targetSourceFile,
      writeFile,
      cancellationToken,
      emitOnlyDtsFiles,
      customTransformers
    ) => {
      return origEmit(targetSourceFile, writeFile, cancellationToken, emitOnlyDtsFiles, {
        ...customTransformers,
        before: [transformerFactory, ...(customTransformers?.before ?? [])],
      });
    };

    origAfterProgramCreate?.(builderProgram);
  };

  console.log("🧊 Starting watch mode...");
  ts.createWatchProgram(host);
}

function expand(options: CliOptions): void {
  if (!options.file) {
    console.error("Error: expand command requires a file argument");
    console.error("Usage: typesugar expand <file> [--diff] [--ast]");
    process.exit(1);
  }

  const config = readTsConfig(options.project);
  const filePath = path.resolve(options.file);

  if (!ts.sys.fileExists(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const originalContent = ts.sys.readFile(filePath) ?? "";

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

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const expandedContent = printer.printFile(transformedSourceFile as ts.SourceFile);

  if (options.ast) {
    const ast = JSON.stringify(
      transformedSourceFile,
      (key, value) => {
        if (key === "parent" || key === "pos" || key === "end" || key === "flags") {
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
  } else if (options.diff) {
    const originalLines = originalContent.split("\n");
    const expandedLines = expandedContent.split("\n");

    console.log(`--- ${options.file} (original)`);
    console.log(`+++ ${options.file} (expanded)`);

    let inDiff = false;
    const maxLines = Math.max(originalLines.length, expandedLines.length);

    for (let i = 0; i < maxLines; i++) {
      const orig = originalLines[i] ?? "";
      const exp = expandedLines[i] ?? "";

      if (orig !== exp) {
        if (!inDiff) {
          console.log(`@@ -${i + 1} +${i + 1} @@`);
          inDiff = true;
        }
        if (originalLines[i] !== undefined) {
          console.log(`-${orig}`);
        }
        if (expandedLines[i] !== undefined) {
          console.log(`+${exp}`);
        }
      } else {
        inDiff = false;
      }
    }
  } else {
    console.log(expandedContent);
  }

  result.dispose();
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

  // Transform using the two-stage pipeline
  const transformedCode = transformFile(filePath, config, { verbose: options.verbose });

  // Bundle with esbuild (handles TS transpilation and dependency resolution)
  const esbuild = await import("esbuild");
  const os = await import("os");
  const crypto = await import("crypto");
  const { spawn } = await import("child_process");

  const fileDir = path.dirname(filePath);
  const hash = crypto.createHash("md5").update(filePath).digest("hex").slice(0, 8);
  const tempInputFile = path.join(fileDir, `.typesugar-${hash}-input.ts`);
  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `typesugar-${hash}.mjs`);

  // Write transformed TypeScript to temp file next to original (for import resolution)
  fs.writeFileSync(tempInputFile, transformedCode);

  try {
    // Create an esbuild plugin to preprocess TypeScript files
    const preprocessPlugin = {
      name: "typesugar-preprocess",
      setup(build: { onLoad: (opts: { filter: RegExp }, cb: (args: { path: string }) => Promise<{ contents: string; loader: "ts" | "tsx" }>) => void }) {
        build.onLoad({ filter: /\.tsx?$/ }, async (args: { path: string }) => {
          const source = await fs.promises.readFile(args.path, "utf-8");
          const result = preprocess(source, { fileName: args.path });
          return {
            contents: result.code,
            loader: args.path.endsWith(".tsx") ? "tsx" as const : "ts" as const,
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

  if (options.verbose) {
    console.log(`🧊 Wrote transpiled code to ${tempFile}`);
  }

  // Execute with node (ESM)
  const child = spawn("node", [tempFile], {
    stdio: "inherit",
    cwd: path.dirname(filePath),
  });

  child.on("close", (code) => {
    // Clean up temp file
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // Ignore cleanup errors
    }
    process.exit(code ?? 0);
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
      const result = preprocess(source, { fileName: file });

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
          console.log(`  ✓ ${path.relative(process.cwd(), file)} → ${path.relative(process.cwd(), outputPath)}`);
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
      await runInit(options.verbose);
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
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
