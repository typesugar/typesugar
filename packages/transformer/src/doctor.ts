/**
 * typesugar doctor -- Diagnostic checker
 *
 * Verifies that typesugar is properly configured and working.
 */

import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import * as ts from "typescript";
import { SUPPORTED_TYPESCRIPT_RANGE, TYPESCRIPT_SUPPORT_URL } from "@typesugar/core";
import { macroTransformerFactory } from "./pipeline.js";
import {
  KNOWN_LANGUAGE_SERVICE_PLUGIN_NAMES,
  LANGUAGE_SERVICE_PLUGIN_NAME,
  LEGACY_BROKEN_LANGUAGE_SERVICE_PLUGIN_NAME,
} from "./init.js";

type TsConfigPlugin = { name?: string; transform?: string; type?: string };

/**
 * Read `compilerOptions.plugins` the way TypeScript does: JSONC (comments,
 * trailing commas) and following `extends`. A plain JSON.parse failed on
 * any commented tsconfig and ignored inherited plugins.
 */
function readTsConfigPlugins(
  tsconfigPath: string
): { plugins: TsConfigPlugin[] } | { error: string } {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    return { error: ts.flattenDiagnosticMessageText(configFile.error.messageText, " ") };
  }
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigPath)
  );
  const plugins = (parsed.options.plugins ?? []) as unknown as TsConfigPlugin[];
  return { plugins };
}

function readPackageDeps(cwd: string): Record<string, string> {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8"));
    return { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return {};
  }
}

/**
 * Does the project compile through a patched tsc? ts-patch installed, or the
 * tsconfig's `{ "transform": "@typesugar/transformer" }` plugin together with
 * a script that runs `tsc`/`tspc`. Only then do the ts-patch checks apply: a
 * project that builds with `typesugar build`, runs under `node --import
 * typesugar/register` or uses a bundler plugin expands macros without it.
 */
function usesPatchedTsc(cwd: string): boolean {
  if (readPackageDeps(cwd)["ts-patch"]) return true;
  if (!hasTransformPlugin(cwd)) return false;
  let scripts: Record<string, string> = {};
  try {
    scripts = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8")).scripts ?? {};
  } catch {
    return false;
  }
  return Object.values(scripts).some(
    (script) => typeof script === "string" && /(^|[\s;&|(])(tsc|tspc)(?=$|[\s;&|)])/.test(script)
  );
}

/** Does tsconfig.json list `{ "transform": "@typesugar/transformer" }`? */
function hasTransformPlugin(cwd: string): boolean {
  const tsconfigPath = path.join(cwd, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) return false;
  try {
    const read = readTsConfigPlugins(tsconfigPath);
    return !("error" in read) && read.plugins.some((p) => p.transform === "@typesugar/transformer");
  } catch {
    return false;
  }
}

const NO_PATCHED_TSC =
  "Not needed: no patched tsc (typesugar build, the Node loader and bundler plugins expand macros themselves)";

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

/**
 * Checks the project's TypeScript against the supported range
 * (`SUPPORTED_TYPESCRIPT_RANGE`, PEP-060 item 1). Prefers the installed
 * version over the declared range, since `^5.0.0` can resolve to 5.9 and
 * `latest` resolves to TypeScript 7.
 */
export function checkTypeScript(cwd: string): DiagnosticCheck {
  const name = "TypeScript installed";
  const fix = "npm install --save-dev typescript@6";
  try {
    const pkgPath = path.join(cwd, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (!allDeps.typescript) {
      return {
        name,
        status: "fail",
        message: "TypeScript is not listed in dependencies",
        fix,
      };
    }

    let version = String(allDeps.typescript);
    try {
      const installed = JSON.parse(
        fs.readFileSync(path.join(cwd, "node_modules", "typescript", "package.json"), "utf-8")
      );
      if (typeof installed.version === "string") version = installed.version;
    } catch {
      // Not installed yet: judge the declared range.
    }

    // `latest` (and `next`) install TypeScript 7 since July 2026.
    const match = /(\d+)(?:\.(\d+))?/.exec(version);
    const major = match ? parseInt(match[1], 10) : /^(latest|next)$/.test(version) ? 7 : NaN;
    const minor = match && match[2] !== undefined ? parseInt(match[2], 10) : 0;

    if (major >= 7) {
      return {
        name,
        status: "fail",
        message: `TypeScript ${version} is not supported: TypeScript 7 removed the compiler API typesugar needs (supported: ${SUPPORTED_TYPESCRIPT_RANGE}). See ${TYPESCRIPT_SUPPORT_URL}`,
        fix,
      };
    }

    if (Number.isNaN(major) || major < 5 || (major === 5 && minor < 9)) {
      return {
        name,
        status: "warn",
        message: `TypeScript ${version} detected. typesugar supports ${SUPPORTED_TYPESCRIPT_RANGE}`,
        fix,
      };
    }

    return { name, status: "pass", message: `v${version}` };
  } catch {
    return {
      name,
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

export function checkTransformerPlugin(cwd: string): DiagnosticCheck {
  const tsconfigPath = path.join(cwd, "tsconfig.json");

  if (!fs.existsSync(tsconfigPath)) {
    return {
      name: "Transformer plugin configured",
      status: "skip",
      message: "No tsconfig.json",
    };
  }

  try {
    const read = readTsConfigPlugins(tsconfigPath);
    if ("error" in read) {
      return {
        name: "Transformer plugin configured",
        status: "fail",
        message: `Could not parse tsconfig.json: ${read.error}`,
      };
    }

    const hasTransformer = read.plugins.some((p) => p.transform === "@typesugar/transformer");

    if (!hasTransformer && !usesPatchedTsc(cwd)) {
      return {
        name: "Transformer plugin configured",
        status: "skip",
        message: NO_PATCHED_TSC,
      };
    }

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

export function checkLanguageServicePlugin(cwd: string): DiagnosticCheck {
  const tsconfigPath = path.join(cwd, "tsconfig.json");

  if (!fs.existsSync(tsconfigPath)) {
    return {
      name: "Language service plugin configured",
      status: "skip",
      message: "No tsconfig.json",
    };
  }

  try {
    const read = readTsConfigPlugins(tsconfigPath);
    if ("error" in read) {
      return {
        name: "Language service plugin configured",
        status: "warn",
        message: `Could not parse tsconfig.json: ${read.error}`,
      };
    }

    // The name older `typesugar init` versions wrote: no package exports it,
    // so tsserver silently never loads the plugin.
    if (read.plugins.some((p) => p.name === LEGACY_BROKEN_LANGUAGE_SERVICE_PLUGIN_NAME)) {
      return {
        name: "Language service plugin configured",
        status: "fail",
        message: `"${LEGACY_BROKEN_LANGUAGE_SERVICE_PLUGIN_NAME}" does not resolve to any package — the IDE plugin never loads`,
        fix: `Replace it with { "name": "${LANGUAGE_SERVICE_PLUGIN_NAME}" } in compilerOptions.plugins (or re-run typesugar init)`,
      };
    }

    const hasLSPlugin = read.plugins.some(
      (p) => p.name !== undefined && KNOWN_LANGUAGE_SERVICE_PLUGIN_NAMES.includes(p.name)
    );

    if (!hasLSPlugin) {
      return {
        name: "Language service plugin configured",
        status: "warn",
        message: "Language service plugin not found (optional but recommended)",
        fix: `Add { "name": "${LANGUAGE_SERVICE_PLUGIN_NAME}" } to compilerOptions.plugins for IDE support`,
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

export function checkTsPatch(cwd: string): DiagnosticCheck {
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

    if (!allDeps["ts-patch"] && !usesPatchedTsc(cwd)) {
      return {
        name: "ts-patch installed",
        status: "skip",
        message: NO_PATCHED_TSC,
      };
    }

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

export function checkTsPatchActive(cwd: string): DiagnosticCheck {
  const tsPath = path.join(cwd, "node_modules", "typescript", "lib", "typescript.js");

  if (!fs.existsSync(tsPath)) {
    return {
      name: "ts-patch active",
      status: "skip",
      message: "TypeScript not installed in node_modules",
    };
  }

  try {
    // ts-patch prepends a `/// tsp-module:` header block to every module it
    // patches (see ts-patch's patch-detail.ts: tspHeaderBlockStart). Check
    // for that definitive marker in the file head instead of grepping the
    // whole ~8MB file for a fuzzy substring — the old check matched the
    // bare string "tsp" anywhere, which false-positives on identifiers
    // like "tspan" in unpatched builds.
    const fd = fs.openSync(tsPath, "r");
    const head = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    const isPatched = head.toString("utf-8", 0, bytesRead).includes("/// tsp-module:");

    if (!isPatched && !usesPatchedTsc(cwd)) {
      return {
        name: "ts-patch active",
        status: "skip",
        message: NO_PATCHED_TSC,
      };
    }

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

export function checkPrepareScript(cwd: string): DiagnosticCheck {
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

    if (!usesPatchedTsc(cwd)) {
      return {
        name: "prepare script configured",
        status: "skip",
        message: NO_PATCHED_TSC,
      };
    }

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

function checkSkipLibCheck(cwd: string): DiagnosticCheck {
  const tsconfigPath = path.join(cwd, "tsconfig.json");

  if (!fs.existsSync(tsconfigPath)) {
    return {
      name: "skipLibCheck enabled",
      status: "skip",
      message: "No tsconfig.json",
    };
  }

  try {
    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, cwd);

    if (!config.options.skipLibCheck) {
      return {
        name: "skipLibCheck enabled",
        status: "warn",
        message: "skipLibCheck is not enabled — @typesugar/fp declarations may produce errors",
        fix: 'Add "skipLibCheck": true to compilerOptions in tsconfig.json',
      };
    }

    return {
      name: "skipLibCheck enabled",
      status: "pass",
      message: "",
    };
  } catch {
    return {
      name: "skipLibCheck enabled",
      status: "skip",
      message: "Could not parse tsconfig.json",
    };
  }
}

export function checkMacroRegistration(cwd: string): DiagnosticCheck {
  // Load the PROJECT's own @typesugar/macros and read the registry from the
  // PROJECT's own @typesugar/core (both resolved from `cwd`, through one CJS
  // require so they share an instance). The old check used a bare `require`,
  // which doesn't exist in this ESM bin, so it was always skipped.
  let projectRequire: NodeRequire;
  try {
    projectRequire = createRequire(path.join(cwd, "package.json"));
    projectRequire.resolve("@typesugar/core");
  } catch {
    return {
      name: "Macro registration",
      status: "skip",
      message: "@typesugar/core is not installed in this project",
    };
  }

  try {
    try {
      projectRequire("@typesugar/macros");
    } catch {
      // Not installed / not loadable: the registry count below says so.
    }
    const { globalRegistry } = projectRequire("@typesugar/core") as {
      globalRegistry: { getAll(): unknown[] };
    };
    const all = globalRegistry.getAll();

    if (all.length === 0) {
      return {
        name: "Macro registration",
        status: "warn",
        message: "0 macros registered — macros may not be loading correctly",
        fix: "Ensure @typesugar/macros is installed, or check for ESM/CJS dual-instance issues",
      };
    }

    return {
      name: "Macro registration",
      status: "pass",
      message: `${all.length} macros registered`,
    };
  } catch (e) {
    return {
      name: "Macro registration",
      status: "warn",
      message: `Could not load @typesugar/core: ${e instanceof Error ? e.message : String(e)}`,
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

/**
 * Actually expand a macro with this project's tsconfig: build a program
 * containing a probe file in the project directory (so `typesugar` resolves
 * from the project), run the real macro transformer over it, and check that
 * the `comptime` call was replaced. The old version only type-checked the
 * probe and never ran the transformer.
 */
export function tryMacroExpansion(cwd: string, verbose: boolean): DiagnosticCheck {
  const name = "Macro expansion test";
  const testCode = `import { comptime } from "typesugar";\nexport const x = comptime(() => 40 + 2);\n`;

  try {
    const configPath = path.join(cwd, "tsconfig.json");
    if (!fs.existsSync(configPath)) {
      return { name, status: "skip", message: "No tsconfig.json" };
    }

    try {
      createRequire(path.join(cwd, "package.json")).resolve("typesugar");
    } catch {
      return { name, status: "skip", message: "typesugar is not installed in this project" };
    }

    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
      return { name, status: "skip", message: "Could not read tsconfig.json" };
    }

    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, cwd);
    const compilerOptions: ts.CompilerOptions = { ...parsed.options, noEmit: true };

    const probePath = path.join(cwd, "__typesugar_doctor_probe__.ts");
    const host = ts.createCompilerHost(compilerOptions);
    const originalGetSourceFile = host.getSourceFile.bind(host);
    const originalFileExists = host.fileExists.bind(host);
    const originalReadFile = host.readFile.bind(host);
    host.fileExists = (f) => path.resolve(f) === probePath || originalFileExists(f);
    host.readFile = (f) => (path.resolve(f) === probePath ? testCode : originalReadFile(f));
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
      path.resolve(fileName) === probePath
        ? ts.createSourceFile(fileName, testCode, languageVersion, true, ts.ScriptKind.TS)
        : originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);

    const program = ts.createProgram([probePath], compilerOptions, host);
    const sourceFile = program.getSourceFile(probePath);
    if (!sourceFile) {
      return { name, status: "warn", message: "Could not create the probe program" };
    }

    const macroErrors: string[] = [];
    const factory = macroTransformerFactory(program, {
      verbose,
      cacheDir: false,
      onDiagnostic: (d) => {
        if (d.category === ts.DiagnosticCategory.Error) {
          macroErrors.push(ts.flattenDiagnosticMessageText(d.messageText, " "));
        }
      },
    });
    const result = ts.transform(sourceFile, [factory], compilerOptions);
    // Inspect the transformed AST: the comptime call must be gone and the
    // folded literal 42 present.
    let comptimeCallLeft = false;
    let has42 = false;
    const inspect = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "comptime"
      ) {
        comptimeCallLeft = true;
      }
      if (ts.isNumericLiteral(node) && node.text === "42") has42 = true;
      ts.forEachChild(node, inspect);
    };
    inspect(result.transformed[0]);
    result.dispose();

    if (macroErrors.length > 0) {
      return { name, status: "fail", message: `Macro errors: ${macroErrors.join("; ")}` };
    }
    if (comptimeCallLeft || !has42) {
      return {
        name,
        status: "fail",
        message: "comptime() was not expanded — the macro transformer is not registering macros",
        fix: "Ensure typesugar and @typesugar/macros are installed and resolvable from this project",
      };
    }

    return { name, status: "pass", message: "comptime(() => 40 + 2) expanded to 42" };
  } catch (e) {
    return {
      name,
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
    checkSkipLibCheck(cwd),
    checkMacroRegistration(cwd),
    checkVersionMismatch(cwd),
    tryMacroExpansion(cwd, verbose),
  ];

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
