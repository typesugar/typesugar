/**
 * typesugar approve-macros -- Review and approve third-party macro packages
 *
 * Scans the project the same way the real macro loader would (PEP-055's
 * manifest-based discovery), finds packages that declare `typesugar.macros`
 * but aren't `@typesugar/*`-scoped and aren't yet approved, and — after
 * confirmation — writes them into `typesugar.config.ts`'s
 * `security.allowedMacroPackages`.
 */

import * as path from "path";
import * as readline from "readline";
import * as ts from "typescript";
import { config as typesugarConfig } from "@typesugar/core";
import { readTsConfig } from "./tsconfig-utils.js";
import {
  classifyManifestPackages,
  classifyRelativeMacroPackages,
  collectImportedModules,
} from "./macro-loader.js";
import { writeApprovedMacroPackages } from "./config-writer.js";

export interface ApproveMacrosOptions {
  project: string;
  yes: boolean;
  verbose: boolean;
}

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      `${COLORS.cyan}?${COLORS.reset} ${question} ${COLORS.dim}[y/N]${COLORS.reset} `,
      (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase().startsWith("y"));
      }
    );
  });
}

export async function runApproveMacros(options: ApproveMacrosOptions): Promise<void> {
  // Read the config of the project we were pointed at (searching upward
  // from its tsconfig directory), not whatever is above the cwd — the file
  // we may write below lives there (deep review 2026-10, core #35).
  const projectRoot = path.dirname(path.resolve(options.project));
  typesugarConfig.load({ searchFrom: projectRoot });

  // Fail loudly before doing anything else if the existing config couldn't
  // be loaded: the approval list in it can't be read, and writing a fresh
  // file would overwrite it (core #20).
  const loadError = typesugarConfig.getLoadError();
  if (loadError) {
    const where = loadError.filepath ? ` ${loadError.filepath}` : "";
    console.error(
      `${COLORS.red}✗${COLORS.reset} Could not load the typesugar config file${where}: ` +
        `${loadError.message}\n` +
        `  approve-macros will not modify or create a config file until this is fixed.`
    );
    process.exitCode = 1;
    return;
  }

  const parsed = readTsConfig(options.project);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const importedModules = collectImportedModules(program);

  if (options.verbose) {
    console.log(`[typesugar] Scanned ${importedModules.size} imported package(s)`);
  }

  // `classifyManifestPackages` already checks each package against the
  // CURRENT `security.allowedMacroPackages` (via `isTrusted`) — so
  // `blocked` here is exactly "declares typesugar.macros, not
  // @typesugar/*-scoped, not already approved," i.e. what needs approval.
  // Resolve from the project (the tsconfig's directory), as the build does.
  const { blocked: bareBlocked } = classifyManifestPackages(importedModules, projectRoot);
  // Packages reached by a relative path (a workspace sibling, a package's own
  // examples): approvable by name only when that name resolves to the
  // imported directory; the others are listed, since approval can't help.
  const relative = classifyRelativeMacroPackages(program);
  const newlyBlocked = [...new Set([...bareBlocked, ...relative.blocked])];

  if (relative.unverified.length > 0) {
    console.log(
      `${COLORS.bright}Not loaded, and not approvable by name:${COLORS.reset} these are imported ` +
        `by a relative path, and the name in their package.json does not resolve to them ` +
        `from this project. Make each one the package its name resolves to (a dependency ` +
        `such as "name": "file:<path>", or a workspace link), then run this again.\n`
    );
    for (const { pkg, dir } of relative.unverified) {
      console.log(`  ${COLORS.red}✗${COLORS.reset} ${pkg} ${COLORS.dim}(${dir})${COLORS.reset}`);
    }
    console.log("");
  }

  if (newlyBlocked.length === 0) {
    console.log(`${COLORS.green}✓${COLORS.reset} No new macro packages need approval.`);
    return;
  }

  console.log(
    `${COLORS.bright}The following package(s) declare a "typesugar.macros" entry and are not yet approved:${COLORS.reset}\n`
  );
  for (const pkg of newlyBlocked) {
    console.log(`  ${COLORS.yellow}?${COLORS.reset} ${pkg}`);
  }
  console.log(
    `\nApproving a package means its code will run at compile time, on every build,\n` +
      `for anyone who builds this project. Review each package as carefully as a\n` +
      `new production dependency before approving.\n`
  );

  if (!options.yes) {
    const approved = await confirm(`Approve ${newlyBlocked.length} package(s)?`);
    if (!approved) {
      console.log("Aborted — no changes made.");
      process.exitCode = 1;
      return;
    }
  }

  const result = writeApprovedMacroPackages({
    projectRoot,
    existingConfigPath: typesugarConfig.getConfigFilePath(),
    newPackages: newlyBlocked,
  });

  switch (result.kind) {
    case "created":
      console.log(`${COLORS.green}✓${COLORS.reset} Created ${result.path}`);
      break;
    case "patched":
      console.log(`${COLORS.green}✓${COLORS.reset} Updated ${result.path}`);
      break;
    case "unchanged":
      console.log(`${COLORS.green}✓${COLORS.reset} ${result.path} already up to date.`);
      break;
    case "manual":
      console.log(
        `${COLORS.yellow}⚠${COLORS.reset} Could not automatically patch ${result.path} ` +
          `(unrecognized shape). Add this to its "security" field by hand:\n\n${result.snippet}\n`
      );
      process.exitCode = 1;
      break;
    case "refused":
      console.error(`${COLORS.red}✗${COLORS.reset} Not writing ${result.path}: ${result.reason}.`);
      process.exitCode = 1;
      break;
  }
}
