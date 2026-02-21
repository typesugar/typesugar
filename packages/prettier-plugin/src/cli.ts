/**
 * typesugar-fmt CLI
 *
 * Format typesugar files with custom syntax preservation.
 *
 * Usage:
 *   typesugar-fmt [options] <files...>
 *
 * Options:
 *   --check     Check if files are formatted (exit 1 if not)
 *   --write     Write formatted output to files (default)
 *   --help      Show this help message
 *
 * Examples:
 *   typesugar-fmt src/**\/*.ts
 *   typesugar-fmt --check src/**\/*.ts
 */

import { readFile, writeFile } from "node:fs/promises";
import { glob } from "node:fs";
import { promisify } from "node:util";
import { format, check } from "./format.js";

const globAsync = promisify(glob);

interface CliOptions {
  check: boolean;
  write: boolean;
  help: boolean;
  files: string[];
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    check: false,
    write: true,
    help: false,
    files: [],
  };

  for (const arg of args) {
    if (arg === "--check") {
      options.check = true;
      options.write = false;
    } else if (arg === "--write") {
      options.write = true;
      options.check = false;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (!arg.startsWith("-")) {
      options.files.push(arg);
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }

  return options;
}

function showHelp(): void {
  console.log(`
typesugar-fmt - Format typesugar files with custom syntax preservation

Usage:
  typesugar-fmt [options] <files...>

Options:
  --check     Check if files are formatted (exit 1 if not)
  --write     Write formatted output to files (default)
  --help, -h  Show this help message

Examples:
  typesugar-fmt src/**/*.ts
  typesugar-fmt --check src/**/*.ts
  typesugar-fmt "**/*.ts" "**/*.tsx"

Supported file extensions: .ts, .tsx, .mts, .cts
`);
}

async function resolveFiles(patterns: string[]): Promise<string[]> {
  const files: string[] = [];

  for (const pattern of patterns) {
    // Check if it's a glob pattern or a direct file
    if (pattern.includes("*")) {
      const matches = await globAsync(pattern);
      files.push(...(matches as string[]));
    } else {
      files.push(pattern);
    }
  }

  // Filter to supported extensions
  const supportedExtensions = [".ts", ".tsx", ".mts", ".cts"];
  return files.filter((file) => supportedExtensions.some((ext) => file.endsWith(ext)));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  if (options.files.length === 0) {
    console.error("Error: No files specified");
    showHelp();
    process.exit(1);
  }

  const files = await resolveFiles(options.files);

  if (files.length === 0) {
    console.error("Error: No matching files found");
    process.exit(1);
  }

  let hasErrors = false;
  let needsFormatting = false;

  for (const file of files) {
    try {
      const source = await readFile(file, "utf8");

      if (options.check) {
        const needsFormat = await check(source, { filepath: file });
        if (needsFormat) {
          console.log(`${file}: needs formatting`);
          needsFormatting = true;
        }
      } else {
        const formatted = await format(source, { filepath: file });
        if (formatted !== source) {
          await writeFile(file, formatted);
          console.log(`${file}: formatted`);
        }
      }
    } catch (error) {
      console.error(`${file}: ${error instanceof Error ? error.message : error}`);
      hasErrors = true;
    }
  }

  if (hasErrors) {
    process.exit(1);
  }

  if (options.check && needsFormatting) {
    console.log("\nSome files need formatting. Run `typesugar-fmt` to fix.");
    process.exit(1);
  }

  if (options.check) {
    console.log("All files are formatted.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
