#!/usr/bin/env node

/**
 * typesugar CLI -- Compile TypeScript with macro expansion
 *
 * Usage:
 *   typesugar build [--project tsconfig.json] [--verbose]
 *   typesugar watch [--project tsconfig.json] [--verbose]
 *   typesugar check [--project tsconfig.json] [--verbose]
 *   typesugar expand <file> [--diff] [--ast]
 *   typesugar init [--verbose]
 *   typesugar doctor [--verbose]
 *   typesugar create <template> [name]
 */

import * as ts from "typescript";
import * as path from "path";
import macroTransformerFactory from "./index.js";

type Command = "build" | "watch" | "check" | "expand" | "init" | "doctor" | "create";

interface CliOptions {
  command: Command;
  project: string;
  verbose: boolean;
  file?: string;
  diff?: boolean;
  ast?: boolean;
  createArgs?: string[];
}

function parseArgs(args: string[]): CliOptions {
  const command = (args[0] ?? "build") as Command;
  const validCommands: Command[] = [
    "build",
    "watch",
    "check",
    "expand",
    "init",
    "doctor",
    "create",
  ];

  if (!validCommands.includes(command)) {
    console.error(
      `Unknown command: ${command}\nUsage: typesugar <build|watch|check|expand|init|doctor|create> [options]`
    );
    process.exit(1);
  }

  // For create command, pass remaining args directly
  if (command === "create") {
    const createArgs = args.slice(1);
    return { command, project: "tsconfig.json", verbose: false, createArgs };
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
  init               Interactive setup wizard for existing projects
  doctor             Diagnose configuration issues
  create [template]  Create a new project from a template

OPTIONS:
  -p, --project <path>   Path to tsconfig.json (default: tsconfig.json)
  -v, --verbose          Enable verbose logging
  -h, --help             Show this help message

EXPAND OPTIONS:
  --diff                 Show unified diff between original and expanded
  --ast                  Show expanded AST as JSON

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
  typesugar init
  typesugar doctor
  typesugar create app my-app
  typesugar create library my-lib
  typesugar create macro-plugin my-macros
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

  const program = ts.createProgram([filePath], compilerOptions);
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
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
