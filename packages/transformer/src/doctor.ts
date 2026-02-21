/**
 * typesugar doctor -- Diagnostic checker
 *
 * Verifies that typesugar is properly configured and working.
 */

import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

interface DiagnosticCheck {
  name: string;
  status: "pass" | "fail" | "warn" | "skip";
  message: string;
  fix?: string;
}

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

function statusIcon(status: DiagnosticCheck["status"]): string {
  switch (status) {
    case "pass":
      return `${COLORS.green}✓${COLORS.reset}`;
    case "fail":
      return `${COLORS.red}✗${COLORS.reset}`;
    case "warn":
      return `${COLORS.yellow}⚠${COLORS.reset}`;
    case "skip":
      return `${COLORS.dim}○${COLORS.reset}`;
  }
}

function header(message: string): void {
  console.log(`\n${COLORS.bright}${COLORS.cyan}${message}${COLORS.reset}\n`);
}

function printCheck(check: DiagnosticCheck): void {
  console.log(`${statusIcon(check.status)} ${check.name}`);
  if (check.status !== "pass" && check.status !== "skip") {
    console.log(`  ${COLORS.dim}${check.message}${COLORS.reset}`);
    if (check.fix) {
      console.log(`  ${COLORS.blue}Fix:${COLORS.reset} ${check.fix}`);
    }
  }
}

function checkPackageJson(cwd: string): DiagnosticCheck {
  const pkgPath = path.join(cwd, "package.json");

  if (!fs.existsSync(pkgPath)) {
    return {
      name: "package.json exists",
      status: "fail",
      message: "No package.json found in current directory",
      fix: "Run `npm init` or `pnpm init` to create one",
    };
  }

  return {
    name: "package.json exists",
    status: "pass",
    message: "",
  };
}

function checkTypeScript(cwd: string): DiagnosticCheck {
  const pkgPath = path.join(cwd, "package.json");

  if (!fs.existsSync(pkgPath)) {
    return {
      name: "TypeScript installed",
      status: "skip",
      message: "No package.json",
    };
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (!allDeps.typescript) {
      return {
        name: "TypeScript installed",
        status: "fail",
        message: "TypeScript is not listed in dependencies",
        fix: "npm install --save-dev typescript",
      };
    }

    const version = allDeps.typescript.replace(/[\^~]/g, "");
    const major = parseInt(version.split(".")[0], 10);

    if (major < 5) {
      return {
        name: "TypeScript installed",
        status: "warn",
        message: `TypeScript ${version} detected. typesugar requires TypeScript 5.0+`,
        fix: "npm install --save-dev typescript@latest",
      };
    }

    return {
      name: "TypeScript installed",
      status: "pass",
      message: `v${version}`,
    };
  } catch {
    return {
      name: "TypeScript installed",
      status: "fail",
      message: "Could not parse package.json",
    };
  }
}

function checkTsConfig(cwd: string): DiagnosticCheck {
  const tsconfigPath = path.join(cwd, "tsconfig.json");

  if (!fs.existsSync(tsconfigPath)) {
    return {
      name: "tsconfig.json exists",
      status: "fail",
      message: "No tsconfig.json found",
      fix: "Run `npx tsc --init` or `typesugar init`",
    };
  }

  return {
    name: "tsconfig.json exists",
    status: "pass",
    message: "",
  };
}

function checkTransformerPlugin(cwd: string): DiagnosticCheck {
  const tsconfigPath = path.join(cwd, "tsconfig.json");

  if (!fs.existsSync(tsconfigPath)) {
    return {
      name: "Transformer plugin configured",
      status: "skip",
      message: "No tsconfig.json",
    };
  }

  try {
    const content = fs.readFileSync(tsconfigPath, "utf-8");
    const tsconfig = JSON.parse(content);
    const plugins = tsconfig.compilerOptions?.plugins ?? [];

    const hasTransformer = plugins.some(
      (p: { transform?: string }) => p.transform === "@typesugar/transformer"
    );

    if (!hasTransformer) {
      return {
        name: "Transformer plugin configured",
        status: "fail",
        message: "@typesugar/transformer not found in tsconfig plugins",
        fix: 'Add { "transform": "@typesugar/transformer" } to compilerOptions.plugins',
      };
    }

    return {
      name: "Transformer plugin configured",
      status: "pass",
      message: "",
    };
  } catch {
    return {
      name: "Transformer plugin configured",
      status: "fail",
      message: "Could not parse tsconfig.json",
    };
  }
}

function checkLanguageServicePlugin(cwd: string): DiagnosticCheck {
  const tsconfigPath = path.join(cwd, "tsconfig.json");

  if (!fs.existsSync(tsconfigPath)) {
    return {
      name: "Language service plugin configured",
      status: "skip",
      message: "No tsconfig.json",
    };
  }

  try {
    const content = fs.readFileSync(tsconfigPath, "utf-8");
    const tsconfig = JSON.parse(content);
    const plugins = tsconfig.compilerOptions?.plugins ?? [];

    const hasLSPlugin = plugins.some(
      (p: { name?: string }) =>
        p.name === "typesugar/language-service" ||
        p.name === "@typesugar/transformer/language-service"
    );

    if (!hasLSPlugin) {
      return {
        name: "Language service plugin configured",
        status: "warn",
        message: "Language service plugin not found (optional but recommended)",
        fix: 'Add { "name": "typesugar/language-service" } to compilerOptions.plugins for IDE support',
      };
    }

    return {
      name: "Language service plugin configured",
      status: "pass",
      message: "",
    };
  } catch {
    return {
      name: "Language service plugin configured",
      status: "warn",
      message: "Could not parse tsconfig.json",
    };
  }
}

function checkTsPatch(cwd: string): DiagnosticCheck {
  const pkgPath = path.join(cwd, "package.json");

  if (!fs.existsSync(pkgPath)) {
    return {
      name: "ts-patch installed",
      status: "skip",
      message: "No package.json",
    };
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (!allDeps["ts-patch"]) {
      return {
        name: "ts-patch installed",
        status: "fail",
        message: "ts-patch is required for the transformer to work with tsc",
        fix: "npm install --save-dev ts-patch",
      };
    }

    return {
      name: "ts-patch installed",
      status: "pass",
      message: "",
    };
  } catch {
    return {
      name: "ts-patch installed",
      status: "fail",
      message: "Could not parse package.json",
    };
  }
}

function checkTsPatchActive(cwd: string): DiagnosticCheck {
  const tsPath = path.join(cwd, "node_modules", "typescript", "lib", "typescript.js");

  if (!fs.existsSync(tsPath)) {
    return {
      name: "ts-patch active",
      status: "skip",
      message: "TypeScript not installed in node_modules",
    };
  }

  try {
    const content = fs.readFileSync(tsPath, "utf-8");
    const isPatched = content.includes("ts-patch") || content.includes("tsp");

    if (!isPatched) {
      return {
        name: "ts-patch active",
        status: "fail",
        message: "TypeScript is not patched. The transformer will not run.",
        fix: "Run `npx ts-patch install` (or add it to your prepare script)",
      };
    }

    return {
      name: "ts-patch active",
      status: "pass",
      message: "",
    };
  } catch {
    return {
      name: "ts-patch active",
      status: "warn",
      message: "Could not verify ts-patch status",
    };
  }
}

function checkPrepareScript(cwd: string): DiagnosticCheck {
  const pkgPath = path.join(cwd, "package.json");

  if (!fs.existsSync(pkgPath)) {
    return {
      name: "prepare script configured",
      status: "skip",
      message: "No package.json",
    };
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const prepareScript = pkg.scripts?.prepare ?? "";

    if (!prepareScript.includes("ts-patch")) {
      return {
        name: "prepare script configured",
        status: "warn",
        message: "No ts-patch in prepare script. ts-patch may be lost after npm install.",
        fix: 'Add "prepare": "ts-patch install -s" to scripts in package.json',
      };
    }

    return {
      name: "prepare script configured",
      status: "pass",
      message: "",
    };
  } catch {
    return {
      name: "prepare script configured",
      status: "warn",
      message: "Could not parse package.json",
    };
  }
}

function checkTransformerPackage(cwd: string): DiagnosticCheck {
  const pkgPath = path.join(cwd, "package.json");

  if (!fs.existsSync(pkgPath)) {
    return {
      name: "@typesugar/transformer installed",
      status: "skip",
      message: "No package.json",
    };
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    const hasTransformer = allDeps["@typesugar/transformer"] || allDeps["typesugar"];

    if (!hasTransformer) {
      return {
        name: "@typesugar/transformer installed",
        status: "fail",
        message: "typesugar transformer package not found in dependencies",
        fix: "npm install --save-dev @typesugar/transformer",
      };
    }

    return {
      name: "@typesugar/transformer installed",
      status: "pass",
      message: "",
    };
  } catch {
    return {
      name: "@typesugar/transformer installed",
      status: "fail",
      message: "Could not parse package.json",
    };
  }
}

function checkUnplugin(cwd: string): DiagnosticCheck {
  const pkgPath = path.join(cwd, "package.json");

  if (!fs.existsSync(pkgPath)) {
    return {
      name: "unplugin-typesugar (for bundlers)",
      status: "skip",
      message: "No package.json",
    };
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    const hasBundler =
      allDeps["vite"] || allDeps["webpack"] || allDeps["esbuild"] || allDeps["rollup"];
    const hasUnplugin = allDeps["unplugin-typesugar"];

    if (hasBundler && !hasUnplugin) {
      return {
        name: "unplugin-typesugar (for bundlers)",
        status: "warn",
        message: "Bundler detected but unplugin-typesugar not installed",
        fix: "npm install --save-dev unplugin-typesugar",
      };
    }

    if (!hasBundler) {
      return {
        name: "unplugin-typesugar (for bundlers)",
        status: "skip",
        message: "No bundler detected",
      };
    }

    return {
      name: "unplugin-typesugar (for bundlers)",
      status: "pass",
      message: "",
    };
  } catch {
    return {
      name: "unplugin-typesugar (for bundlers)",
      status: "warn",
      message: "Could not parse package.json",
    };
  }
}

function checkVersionMismatch(cwd: string): DiagnosticCheck {
  const pkgPath = path.join(cwd, "package.json");

  if (!fs.existsSync(pkgPath)) {
    return {
      name: "Package version consistency",
      status: "skip",
      message: "No package.json",
    };
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    const typesugarPackages = Object.keys(allDeps).filter(
      (name) =>
        name.startsWith("@typesugar/") || name === "typesugar" || name === "unplugin-typesugar"
    );

    if (typesugarPackages.length === 0) {
      return {
        name: "Package version consistency",
        status: "skip",
        message: "No typesugar packages found",
      };
    }

    const versions = new Set<string>();
    for (const pkg of typesugarPackages) {
      const version = allDeps[pkg];
      if (version && !version.includes("workspace:")) {
        const cleanVersion = version.replace(/[\^~]/g, "").split(".").slice(0, 2).join(".");
        versions.add(cleanVersion);
      }
    }

    if (versions.size > 1) {
      return {
        name: "Package version consistency",
        status: "warn",
        message: `Multiple typesugar versions detected: ${[...versions].join(", ")}`,
        fix: "Update all @typesugar/* packages to the same version",
      };
    }

    return {
      name: "Package version consistency",
      status: "pass",
      message: "",
    };
  } catch {
    return {
      name: "Package version consistency",
      status: "warn",
      message: "Could not parse package.json",
    };
  }
}

function tryMacroExpansion(cwd: string, verbose: boolean): DiagnosticCheck {
  const testCode = `
import { comptime } from "@typesugar/comptime";
const x = comptime(1 + 1);
`;

  try {
    const configPath = path.join(cwd, "tsconfig.json");
    if (!fs.existsSync(configPath)) {
      return {
        name: "Macro expansion test",
        status: "skip",
        message: "No tsconfig.json",
      };
    }

    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
      return {
        name: "Macro expansion test",
        status: "skip",
        message: "Could not read tsconfig.json",
      };
    }

    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, cwd);

    const sourceFile = ts.createSourceFile("test.ts", testCode, ts.ScriptTarget.ES2022, true);

    const compilerOptions: ts.CompilerOptions = {
      ...parsed.options,
      noEmit: true,
    };

    const host = ts.createCompilerHost(compilerOptions);
    const originalGetSourceFile = host.getSourceFile;
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
      if (fileName === "test.ts") {
        return sourceFile;
      }
      return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    };

    const program = ts.createProgram(["test.ts"], compilerOptions, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);

    const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);

    if (errors.length > 0 && verbose) {
      const messages = errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "));
      return {
        name: "Macro expansion test",
        status: "warn",
        message: `Compilation errors: ${messages.join("; ")}`,
      };
    }

    return {
      name: "Macro expansion test",
      status: "pass",
      message: "",
    };
  } catch (e) {
    return {
      name: "Macro expansion test",
      status: "warn",
      message: `Could not run test: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export async function runDoctor(verbose: boolean): Promise<void> {
  const cwd = process.cwd();

  header("🧊 typesugar doctor");

  console.log(`Checking typesugar configuration in: ${cwd}\n`);

  const checks: DiagnosticCheck[] = [
    checkPackageJson(cwd),
    checkTypeScript(cwd),
    checkTsConfig(cwd),
    checkTransformerPackage(cwd),
    checkTransformerPlugin(cwd),
    checkLanguageServicePlugin(cwd),
    checkTsPatch(cwd),
    checkTsPatchActive(cwd),
    checkPrepareScript(cwd),
    checkUnplugin(cwd),
    checkVersionMismatch(cwd),
  ];

  if (verbose) {
    checks.push(tryMacroExpansion(cwd, verbose));
  }

  let passCount = 0;
  let failCount = 0;
  let warnCount = 0;

  for (const check of checks) {
    printCheck(check);

    switch (check.status) {
      case "pass":
        passCount++;
        break;
      case "fail":
        failCount++;
        break;
      case "warn":
        warnCount++;
        break;
    }
  }

  console.log("");

  if (failCount > 0) {
    console.log(
      `${COLORS.red}${COLORS.bright}${failCount} issue${failCount === 1 ? "" : "s"} found${COLORS.reset}`
    );
    console.log(
      `\nRun ${COLORS.cyan}typesugar init${COLORS.reset} to fix configuration automatically.`
    );
    process.exit(1);
  } else if (warnCount > 0) {
    console.log(
      `${COLORS.yellow}${COLORS.bright}${warnCount} warning${warnCount === 1 ? "" : "s"}${COLORS.reset}`
    );
    console.log(`${COLORS.green}All critical checks passed.${COLORS.reset}`);
  } else {
    console.log(`${COLORS.green}${COLORS.bright}✨ All checks passed!${COLORS.reset}`);
    console.log("\n🧊 typesugar is properly configured and ready to use.");
  }

  if (verbose) {
    console.log(`\n${COLORS.dim}Detailed info:${COLORS.reset}`);
    console.log(`  Working directory: ${cwd}`);
    console.log(`  TypeScript version: ${ts.version}`);
    console.log(`  Node.js version: ${process.version}`);
  }
}
