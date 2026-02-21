/**
 * typemacro expand — Show macro-expanded output
 *
 * Compiles a TypeScript file with macro expansion and prints the result,
 * similar to Rust's `cargo expand`.
 *
 * Usage:
 *   typemacro expand src/models/user.ts
 *   typemacro expand --diff src/models/user.ts
 *   typemacro expand src/models/user.ts:42
 */

import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import macroTransformerFactory from "../transforms/macro-transformer.js";

export interface ExpandOptions {
  /** File to expand */
  file: string;

  /** Optional line number to focus on */
  line?: number;

  /** Show unified diff between original and expanded */
  diff: boolean;

  /** Output raw AST as JSON */
  ast: boolean;

  /** Path to tsconfig.json */
  project: string;

  /** Enable verbose logging */
  verbose: boolean;
}

/**
 * Run the expand command.
 */
export function runExpand(options: ExpandOptions): void {
  // Parse file:line syntax
  let filePath = options.file;
  let focusLine = options.line;

  const colonMatch = filePath.match(/^(.+):(\d+)$/);
  if (colonMatch && !fs.existsSync(filePath)) {
    filePath = colonMatch[1];
    focusLine = parseInt(colonMatch[2], 10);
  }

  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  // Read the original source
  const originalSource = fs.readFileSync(absolutePath, "utf-8");

  // Set up the compiler
  const configPath = path.resolve(options.project);
  let compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    strict: true,
    noEmit: true,
  };

  if (fs.existsSync(configPath)) {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (!configFile.error) {
      const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(configPath)
      );
      compilerOptions = parsed.options;
    }
  }

  // Create program
  const program = ts.createProgram([absolutePath], compilerOptions);
  const sourceFile = program.getSourceFile(absolutePath);

  if (!sourceFile) {
    console.error(`Could not load source file: ${absolutePath}`);
    process.exit(1);
  }

  // Create transformer
  const transformerFactory = macroTransformerFactory(program, {
    verbose: options.verbose,
  });

  // Run transformation
  const result = ts.transform(sourceFile, [transformerFactory]);
  const transformedFile = result.transformed[0];

  // Print the expanded output
  const printer = ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
    removeComments: false,
  });

  const expandedSource = printer.printFile(transformedFile);

  if (options.ast) {
    // Output AST as JSON
    printAst(transformedFile);
  } else if (options.diff) {
    // Show unified diff
    printDiff(originalSource, expandedSource, filePath);
  } else if (focusLine !== undefined) {
    // Show only the expansion around the focus line
    printFocusedExpansion(originalSource, expandedSource, focusLine);
  } else {
    // Print full expanded output
    console.log(expandedSource);
  }

  result.dispose();
}

/**
 * Print a simple unified diff between original and expanded source.
 */
function printDiff(original: string, expanded: string, filePath: string): void {
  const origLines = original.split("\n");
  const expLines = expanded.split("\n");

  console.log(`--- ${filePath} (original)`);
  console.log(`+++ ${filePath} (expanded)`);
  console.log();

  // Simple line-by-line diff
  const maxLen = Math.max(origLines.length, expLines.length);
  let inHunk = false;
  let hunkStart = -1;
  const hunks: Array<{
    origStart: number;
    origLines: string[];
    expLines: string[];
  }> = [];

  for (let i = 0; i < maxLen; i++) {
    const origLine = origLines[i] ?? "";
    const expLine = expLines[i] ?? "";

    if (origLine !== expLine) {
      if (!inHunk) {
        hunkStart = i;
        inHunk = true;
        hunks.push({
          origStart: i,
          origLines: [],
          expLines: [],
        });
      }
      const hunk = hunks[hunks.length - 1];
      if (i < origLines.length) hunk.origLines.push(origLine);
      if (i < expLines.length) hunk.expLines.push(expLine);
    } else {
      if (inHunk) {
        inHunk = false;
      }
    }
  }

  if (hunks.length === 0) {
    console.log("(no changes — no macros expanded)");
    return;
  }

  for (const hunk of hunks) {
    console.log(
      `@@ -${hunk.origStart + 1},${hunk.origLines.length} +${hunk.origStart + 1},${hunk.expLines.length} @@`
    );
    for (const line of hunk.origLines) {
      console.log(`\x1b[31m- ${line}\x1b[0m`);
    }
    for (const line of hunk.expLines) {
      console.log(`\x1b[32m+ ${line}\x1b[0m`);
    }
    console.log();
  }
}

/**
 * Print the expansion focused around a specific line number.
 */
function printFocusedExpansion(original: string, expanded: string, line: number): void {
  const origLines = original.split("\n");
  const expLines = expanded.split("\n");

  // Show context around the line
  const contextSize = 5;
  const start = Math.max(0, line - 1 - contextSize);
  const end = Math.min(origLines.length, line - 1 + contextSize + 1);

  console.log(`\x1b[1m--- Original (line ${line}) ---\x1b[0m`);
  for (let i = start; i < end; i++) {
    const prefix = i === line - 1 ? ">>>" : "   ";
    const color = i === line - 1 ? "\x1b[33m" : "";
    const reset = i === line - 1 ? "\x1b[0m" : "";
    console.log(`${color}${prefix} ${i + 1} | ${origLines[i]}${reset}`);
  }

  console.log();
  console.log(`\x1b[1m--- Expanded ---\x1b[0m`);

  // Find the corresponding region in expanded output
  // (heuristic: look for lines that differ)
  const expStart = Math.max(0, start);
  const expEnd = Math.min(expLines.length, end + 20); // Show more of expanded

  for (let i = expStart; i < expEnd; i++) {
    const isNew = i >= origLines.length || expLines[i] !== origLines[i];
    const color = isNew ? "\x1b[32m" : "";
    const reset = isNew ? "\x1b[0m" : "";
    const prefix = isNew ? " + " : "   ";
    console.log(`${color}${prefix} ${i + 1} | ${expLines[i]}${reset}`);
  }
}

/**
 * Print the AST of the transformed file as JSON.
 */
function printAst(sourceFile: ts.SourceFile): void {
  function nodeToJson(node: ts.Node): unknown {
    const result: Record<string, unknown> = {
      kind: ts.SyntaxKind[node.kind],
    };

    if (ts.isIdentifier(node)) {
      result.text = node.text;
    } else if (ts.isStringLiteral(node)) {
      result.text = node.text;
    } else if (ts.isNumericLiteral(node)) {
      result.text = node.text;
    }

    const children: unknown[] = [];
    node.forEachChild((child) => {
      children.push(nodeToJson(child));
    });

    if (children.length > 0) {
      result.children = children;
    }

    return result;
  }

  console.log(JSON.stringify(nodeToJson(sourceFile), null, 2));
}
