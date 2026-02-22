#!/usr/bin/env node

/**
 * typemacro CLI -- Compile TypeScript with macro expansion
 *
 * Usage:
 *   typemacro build [--project tsconfig.json] [--verbose]
 *   typemacro watch [--project tsconfig.json] [--verbose]
 *   typemacro check [--project tsconfig.json] [--verbose]
 */

import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import macroTransformerFactory from "../transforms/macro-transformer.js";
import { globalRegistry } from "@typesugar/core";
import { generateManifest } from "./manifest-generator.js";
import { runExpand } from "./expand.js";

interface CliOptions {
  command: "build" | "watch" | "check" | "expand";
  project: string;
  verbose: boolean;
  manifest: boolean;
  manifestOut: string;
  expandFile?: string;
  expandDiff: boolean;
  expandAst: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const command = (args[0] ?? "build") as CliOptions["command"];
  if (!["build", "watch", "check", "expand"].includes(command)) {
    console.error(
      `Unknown command: ${command}\nUsage: typemacro <build|watch|check|expand> [--project tsconfig.json] [--verbose]`
    );
    process.exit(1);
  }

  let project = "tsconfig.json";
  let verbose = false;
  let manifest = false;
  let manifestOut = "typemacro.manifest.json";
  let expandFile: string | undefined;
  let expandDiff = false;
  let expandAst = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--project" || args[i] === "-p") {
      project = args[++i] ?? "tsconfig.json";
    } else if (args[i] === "--verbose" || args[i] === "-v") {
      verbose = true;
    } else if (args[i] === "--manifest") {
      manifest = true;
      if (args[i + 1] && !args[i + 1].startsWith("-")) {
        manifestOut = args[++i];
      }
    } else if (args[i] === "--diff") {
      expandDiff = true;
    } else if (args[i] === "--ast") {
      expandAst = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      printHelp();
      process.exit(0);
    } else if (command === "expand" && !expandFile && !args[i].startsWith("-")) {
      expandFile = args[i];
    }
  }

  return {
    command,
    project,
    verbose,
    manifest,
    manifestOut,
    expandFile,
    expandDiff,
    expandAst,
  };
}

function printHelp(): void {
  console.log(`
typemacro - Compile-time macros for TypeScript

USAGE:
  typemacro <command> [options]

COMMANDS:
  build    Compile TypeScript with macro expansion (default)
  watch    Watch mode -- recompile on file changes
  check    Type-check with macro expansion, but don't emit files
  expand   Show macro-expanded output (like cargo expand)

OPTIONS:
  -p, --project <path>   Path to tsconfig.json (default: tsconfig.json)
  -v, --verbose          Enable verbose logging
  --manifest [path]      Generate typemacro.manifest.json for IDE integration
                         (default output: typemacro.manifest.json)
  --diff                 Show unified diff (expand command)
  --ast                  Show AST as JSON (expand command)
  -h, --help             Show this help message

EXAMPLES:
  typemacro build
  typemacro build --project tsconfig.build.json
  typemacro build --manifest
  typemacro watch --verbose
  typemacro check
  typemacro expand src/models/user.ts
  typemacro expand --diff src/models/user.ts
  typemacro expand src/models/user.ts:42
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
    console.log(`[typemacro] Using config: ${path.resolve(options.project)}`);
    console.log(`[typemacro] Compiling ${config.fileNames.length} files...`);
  }

  const noEmit = options.command === "check";
  const compilerOptions: ts.CompilerOptions = {
    ...config.options,
    ...(noEmit ? { noEmit: true } : {}),
  };

  const program = ts.createProgram(config.fileNames, compilerOptions);

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
        `\n[typemacro] Found ${errorCount} error${errorCount === 1 ? "" : "s"} in ${fileCount} files.`
      );
    } else {
      console.log(`[typemacro] Successfully compiled ${fileCount} files.`);
    }
  }

  // Generate manifest if requested
  if (options.manifest) {
    writeManifest(options);
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
      console.log(`[typemacro] ${message}`);
    }
  );

  const origCreateProgram = host.createProgram;
  host.createProgram = (rootNames, opts, hostObj, oldProgram) => {
    if (options.verbose) {
      console.log("[typemacro] Recompiling...");
    }
    return origCreateProgram(rootNames, opts, hostObj, oldProgram);
  };

  const origAfterProgramCreate = host.afterProgramCreate;
  host.afterProgramCreate = (builderProgram) => {
    const program = builderProgram.getProgram();
    const transformerFactory = macroTransformerFactory(program, {
      verbose: options.verbose,
    });

    // Patch the emit to include our transformer
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

  console.log("[typemacro] Starting watch mode...");
  ts.createWatchProgram(host);
}

function writeManifest(options: CliOptions): void {
  const outPath = path.resolve(options.manifestOut);
  const manifest = generateManifest(globalRegistry);
  const json = JSON.stringify(manifest, null, 2) + "\n";

  fs.writeFileSync(outPath, json, "utf-8");
  console.log(`[typemacro] Manifest written to ${outPath}`);

  if (options.verbose) {
    const m = manifest.macros;
    console.log(
      `[typemacro]   ${Object.keys(m.expression).length} expression macros, ` +
        `${Object.keys(m.decorator).length} decorator macros, ` +
        `${Object.keys(m.taggedTemplate).length} tagged template macros, ` +
        `${Object.keys(m.labeledBlock).length} labeled block macros, ` +
        `${Object.keys(m.type).length} type macros, ` +
        `${Object.keys(m.extensionMethods).length} extension methods`
    );
  }
}

function main(): void {
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
      if (!options.expandFile) {
        console.error("expand requires a file argument: typemacro expand <file>");
        process.exit(1);
      }
      runExpand({
        file: options.expandFile,
        diff: options.expandDiff,
        ast: options.expandAst,
        project: options.project,
        verbose: options.verbose,
      });
      break;
  }
}

main();
