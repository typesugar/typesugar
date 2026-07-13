/**
 * typesugar init -- Interactive project scaffolder
 *
 * Detects the existing stack and configures typesugar automatically.
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { findAiDir, scaffoldAiContext } from "./ai-context.js";

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface DetectedStack {
  packageManager: "npm" | "pnpm" | "yarn" | "bun";
  bundler: "vite" | "webpack" | "esbuild" | "rollup" | "next" | "none";
  hasTypeScript: boolean;
  hasTsConfig: boolean;
  hasTsPatch: boolean;
  configFile?: string;
}

type Persona = "end-user" | "app-developer" | "extension-author";

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

function log(message: string): void {
  console.log(message);
}

function success(message: string): void {
  console.log(`${COLORS.green}✓${COLORS.reset} ${message}`);
}

function warn(message: string): void {
  console.log(`${COLORS.yellow}⚠${COLORS.reset} ${message}`);
}

function error(message: string): void {
  console.error(`${COLORS.red}✗${COLORS.reset} ${message}`);
}

function info(message: string): void {
  console.log(`${COLORS.blue}ℹ${COLORS.reset} ${message}`);
}

function header(message: string): void {
  console.log(`\n${COLORS.bright}${COLORS.cyan}${message}${COLORS.reset}\n`);
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${COLORS.cyan}?${COLORS.reset} ${question} `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await prompt(`${question} ${COLORS.dim}${hint}${COLORS.reset}`);
  if (answer === "") return defaultYes;
  return answer.toLowerCase().startsWith("y");
}

async function select<T extends string>(
  question: string,
  options: { value: T; label: string }[]
): Promise<T> {
  log(`${COLORS.cyan}?${COLORS.reset} ${question}`);
  options.forEach((opt, i) => {
    log(`  ${COLORS.dim}${i + 1}.${COLORS.reset} ${opt.label}`);
  });

  const answer = await prompt(`Enter choice (1-${options.length}):`);
  const index = parseInt(answer, 10) - 1;

  if (index >= 0 && index < options.length) {
    return options[index].value;
  }

  warn("Invalid selection, using first option");
  return options[0].value;
}

function detectStack(cwd: string): DetectedStack {
  const pkgPath = path.join(cwd, "package.json");
  const pkg: PackageJson = fs.existsSync(pkgPath)
    ? JSON.parse(fs.readFileSync(pkgPath, "utf-8"))
    : {};

  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  let packageManager: DetectedStack["packageManager"] = "npm";
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) {
    packageManager = "pnpm";
  } else if (fs.existsSync(path.join(cwd, "yarn.lock"))) {
    packageManager = "yarn";
  } else if (fs.existsSync(path.join(cwd, "bun.lockb"))) {
    packageManager = "bun";
  }

  let bundler: DetectedStack["bundler"] = "none";
  let configFile: string | undefined;

  if (allDeps["next"]) {
    bundler = "next";
    if (fs.existsSync(path.join(cwd, "next.config.ts"))) {
      configFile = "next.config.ts";
    } else if (fs.existsSync(path.join(cwd, "next.config.mjs"))) {
      configFile = "next.config.mjs";
    } else if (fs.existsSync(path.join(cwd, "next.config.js"))) {
      configFile = "next.config.js";
    }
  } else if (allDeps["vite"]) {
    bundler = "vite";
    if (fs.existsSync(path.join(cwd, "vite.config.ts"))) {
      configFile = "vite.config.ts";
    } else if (fs.existsSync(path.join(cwd, "vite.config.js"))) {
      configFile = "vite.config.js";
    }
  } else if (allDeps["webpack"]) {
    bundler = "webpack";
    if (fs.existsSync(path.join(cwd, "webpack.config.ts"))) {
      configFile = "webpack.config.ts";
    } else if (fs.existsSync(path.join(cwd, "webpack.config.js"))) {
      configFile = "webpack.config.js";
    }
  } else if (allDeps["esbuild"]) {
    bundler = "esbuild";
  } else if (allDeps["rollup"]) {
    bundler = "rollup";
    if (fs.existsSync(path.join(cwd, "rollup.config.ts"))) {
      configFile = "rollup.config.ts";
    } else if (fs.existsSync(path.join(cwd, "rollup.config.js"))) {
      configFile = "rollup.config.js";
    }
  }

  return {
    packageManager,
    bundler,
    hasTypeScript: "typescript" in allDeps,
    hasTsConfig: fs.existsSync(path.join(cwd, "tsconfig.json")),
    hasTsPatch: "ts-patch" in allDeps,
    configFile,
  };
}

function getInstallCommand(
  pm: DetectedStack["packageManager"],
  packages: string[],
  dev = true
): string {
  const pkgList = packages.join(" ");
  switch (pm) {
    case "pnpm":
      return `pnpm add ${dev ? "-D " : ""}${pkgList}`;
    case "yarn":
      return `yarn add ${dev ? "--dev " : ""}${pkgList}`;
    case "bun":
      return `bun add ${dev ? "-d " : ""}${pkgList}`;
    default:
      return `npm install ${dev ? "--save-dev " : ""}${pkgList}`;
  }
}

function patchTsConfig(cwd: string): boolean {
  const tsconfigPath = path.join(cwd, "tsconfig.json");

  if (!fs.existsSync(tsconfigPath)) {
    const defaultTsConfig = {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        declaration: true,
        outDir: "./dist",
        rootDir: "./src",
        plugins: [
          { name: "typesugar/language-service" },
          { transform: "@typesugar/transformer", type: "program" },
        ],
      },
      include: ["src/**/*"],
    };

    fs.writeFileSync(tsconfigPath, JSON.stringify(defaultTsConfig, null, 2));
    return true;
  }

  try {
    const content = fs.readFileSync(tsconfigPath, "utf-8");
    const tsconfig = JSON.parse(content);

    if (!tsconfig.compilerOptions) {
      tsconfig.compilerOptions = {};
    }

    if (!tsconfig.compilerOptions.plugins) {
      tsconfig.compilerOptions.plugins = [];
    }

    const plugins = tsconfig.compilerOptions.plugins as Array<{
      name?: string;
      transform?: string;
      type?: string;
    }>;

    const hasLanguageService = plugins.some((p) => p.name === "typesugar/language-service");
    const hasTransformer = plugins.some((p) => p.transform === "@typesugar/transformer");

    if (!hasLanguageService) {
      plugins.unshift({ name: "typesugar/language-service" });
    }

    if (!hasTransformer) {
      plugins.push({ transform: "@typesugar/transformer", type: "program" });
    }

    fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
    return true;
  } catch {
    return false;
  }
}

function patchPackageJson(cwd: string): boolean {
  const pkgPath = path.join(cwd, "package.json");

  if (!fs.existsSync(pkgPath)) {
    return false;
  }

  try {
    const content = fs.readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(content);

    if (!pkg.scripts) {
      pkg.scripts = {};
    }

    if (!pkg.scripts.prepare) {
      pkg.scripts.prepare = "ts-patch install -s";
    } else if (!pkg.scripts.prepare.includes("ts-patch")) {
      pkg.scripts.prepare = `ts-patch install -s && ${pkg.scripts.prepare}`;
    }

    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    return true;
  } catch {
    return false;
  }
}

function generateViteConfig(): string {
  return `import { defineConfig } from "vite";
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [typesugar()],
});
`;
}

function generateWebpackConfig(): string {
  return `const typesugar = require("unplugin-typesugar/webpack");

module.exports = {
  plugins: [typesugar.default()],
  // ... your other webpack config
};
`;
}

function generateEsbuildConfig(): string {
  return `import { build } from "esbuild";
import typesugar from "unplugin-typesugar/esbuild";

build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/bundle.js",
  plugins: [typesugar()],
});
`;
}

function generateRollupConfig(): string {
  return `import typesugar from "unplugin-typesugar/rollup";

export default {
  input: "src/index.ts",
  output: {
    file: "dist/bundle.js",
    format: "es",
  },
  plugins: [typesugar()],
};
`;
}

export function patchBundlerConfig(
  cwd: string,
  bundler: DetectedStack["bundler"],
  configFile?: string
): { created: boolean; patched: boolean; alreadyConfigured?: boolean; file?: string } {
  if (bundler === "none" || bundler === "next") {
    return { created: false, patched: false };
  }

  const generators: Record<string, () => string> = {
    vite: generateViteConfig,
    webpack: generateWebpackConfig,
    esbuild: generateEsbuildConfig,
    rollup: generateRollupConfig,
  };

  const defaultFiles: Record<string, string> = {
    vite: "vite.config.ts",
    webpack: "webpack.config.js",
    esbuild: "build.js",
    rollup: "rollup.config.js",
  };

  if (!configFile) {
    const newFile = defaultFiles[bundler];
    const fullPath = path.join(cwd, newFile);
    fs.writeFileSync(fullPath, generators[bundler]());
    return { created: true, patched: false, file: newFile };
  }

  const fullPath = path.join(cwd, configFile);
  const content = fs.readFileSync(fullPath, "utf-8");

  if (content.includes("unplugin-typesugar")) {
    return { created: false, patched: false, alreadyConfigured: true, file: configFile };
  }

  // esbuild "configs" are arbitrary build scripts — patching one textually
  // is too risky, so those stay hint-only.
  if (bundler === "esbuild") {
    return { created: false, patched: false, file: configFile };
  }

  const patched = injectPluginIntoConfig(content, bundler);
  if (patched === undefined) {
    return { created: false, patched: false, file: configFile };
  }

  fs.writeFileSync(fullPath, patched);
  return { created: false, patched: true, file: configFile };
}

/**
 * Textually inject the typesugar unplugin into an existing bundler config:
 * add the import/require after the last single-line import/require, and
 * insert `typesugar()` as the first element of the first `plugins: [...]`
 * array. Returns undefined when the config has no recognizable plugins
 * array — the caller then falls back to the "add it manually" hint, which
 * becomes the exception rather than the silent default.
 *
 * Deliberately textual, not AST-based: this runs inside a USER's project
 * against a config file we don't control, and the edit is two anchored
 * insertions into real, human-authored source — the same "patch one small
 * region, leave the rest byte-for-byte untouched" reasoning as
 * config-writer.ts (see CLAUDE.md). A parse-and-reprint would destroy the
 * user's comments and formatting.
 */
export function injectPluginIntoConfig(
  content: string,
  bundler: "vite" | "webpack" | "rollup"
): string | undefined {
  const pluginsMatch = /\bplugins\s*:\s*\[/.exec(content);
  if (!pluginsMatch) return undefined;

  // CJS configs (module.exports, no ESM imports) need a require; unplugin's
  // CJS entry exposes the factory on `.default`.
  const isCjs = /\bmodule\.exports\b/.test(content) && !/^\s*import\b/m.test(content);
  const importLine = isCjs
    ? `const typesugar = require("unplugin-typesugar/${bundler}").default;`
    : `import typesugar from "unplugin-typesugar/${bundler}";`;

  // 1. Insert typesugar() as the first plugins element (no separator needed
  //    before a closing bracket — trailing comma is valid otherwise).
  const insertPos = pluginsMatch.index + pluginsMatch[0].length;
  const separator = /^\s*\]/.test(content.slice(insertPos)) ? "" : ", ";
  let result = content.slice(0, insertPos) + "typesugar()" + separator + content.slice(insertPos);

  // 2. Insert the import after the last SINGLE-LINE import/require (a
  //    multi-line import's opening line is not a safe anchor; if only those
  //    exist, prepend at the very top, which is always safe).
  const lines = result.split("\n");
  const anchorRe = isCjs
    ? /^\s*(?:const|let|var)\s+.*=\s*require\(.*\);?\s*$/
    : /^\s*import\b.*(?:from\s*["'][^"']+["']|["'][^"']+["'])\s*;?\s*$/;
  let lastAnchor = -1;
  for (let i = 0; i < lines.length; i++) {
    if (anchorRe.test(lines[i])) lastAnchor = i;
  }
  if (lastAnchor >= 0) {
    lines.splice(lastAnchor + 1, 0, importLine);
  } else {
    lines.unshift(importLine);
  }
  result = lines.join("\n");

  return result;
}

function createExampleFile(cwd: string): void {
  const srcDir = path.join(cwd, "src");
  if (!fs.existsSync(srcDir)) {
    fs.mkdirSync(srcDir, { recursive: true });
  }

  const examplePath = path.join(srcDir, "typesugar-example.ts");
  if (fs.existsSync(examplePath)) {
    return;
  }

  const content = `/**
 * typesugar Example
 *
 * This file demonstrates basic typesugar features.
 * Run \`typesugar build\` or your bundler to see macro expansion.
 */

import { comptime, derive, Eq, Clone, Debug, Json } from "typesugar";

// Compile-time evaluation: this runs at build time, not runtime
const BUILD_TIME = comptime(new Date().toISOString());
const COMPUTED_VALUE = comptime(() => {
  let sum = 0;
  for (let i = 1; i <= 100; i++) sum += i;
  return sum;
});

console.log(\`Built at: \${BUILD_TIME}\`);
console.log(\`Sum of 1-100: \${COMPUTED_VALUE}\`);

// Auto-derived implementations
@derive(Eq, Clone, Debug, Json)
class User {
  constructor(
    public id: number,
    public name: string,
    public email: string,
  ) {}
}

const user1 = new User(1, "Alice", "alice@example.com");
const user2 = user1.clone();

console.log(user1.debug());
console.log(\`Equal: \${user1.equals(user2)}\`);
console.log(\`JSON: \${user1.toJson()}\`);
`;

  fs.writeFileSync(examplePath, content);
}

function getPackagesForPersona(
  persona: Persona,
  bundler: DetectedStack["bundler"]
): { runtime: string[]; dev: string[] } {
  const dev: string[] = ["@typesugar/transformer", "ts-patch"];

  if (bundler !== "none") {
    dev.push("unplugin-typesugar");
  }

  switch (persona) {
    case "end-user":
      return { runtime: [], dev };

    case "app-developer":
      return {
        runtime: ["typesugar", "@typesugar/derive", "@typesugar/reflect"],
        dev,
      };

    case "extension-author":
      return {
        runtime: ["typesugar", "@typesugar/core"],
        dev: [...dev, "@typesugar/testing"],
      };
  }
}

/**
 * Scaffold AI-assistant context into the project (PEP-058 Wave 6).
 *
 * `aiMode` is the CLI's `--ai` / `--no-ai`; `undefined` means "ask".
 */
async function scaffoldAiContextStep(cwd: string, aiMode: boolean | undefined): Promise<void> {
  const aiDir = findAiDir();
  if (!aiDir) return; // package installed without its ai/ assets — nothing to do

  let wanted = aiMode;
  if (wanted === undefined) {
    header("AI assistant context");
    log("typesugar can write an AGENTS.md describing how macros work in this");
    log("project, so Claude Code / Cursor / Copilot don't break your build by");
    log("'cleaning up' macro imports or hand-writing generated code.");
    log("");
    wanted = await confirm("Add AI assistant context (AGENTS.md)?", true);
  }
  if (!wanted) return;

  // Install the Claude Code skill when the project already uses Claude Code,
  // or when --ai was passed explicitly (an opt-in for everything).
  const installSkill = aiMode === true || fs.existsSync(path.join(cwd, ".claude"));

  const result = scaffoldAiContext(cwd, aiDir, installSkill);

  if (result.agentsMd === "created") success("Created AGENTS.md");
  else if (result.agentsMd === "updated") success("Updated the typesugar section of AGENTS.md");
  else info("AGENTS.md already up to date");

  if (result.claudePointer === "created") {
    success("Created CLAUDE.md (points at AGENTS.md)");
  } else if (result.claudePointer === "exists") {
    info("CLAUDE.md exists — add this line so Claude Code picks up the context:");
    log(`    ${COLORS.cyan}See @AGENTS.md for typesugar usage rules.${COLORS.reset}`);
  }

  if (result.skill === "installed") {
    success("Installed the typesugar skill (.claude/skills/typesugar/)");
  }
}

export async function runInit(verbose: boolean, aiMode?: boolean): Promise<void> {
  const cwd = process.cwd();

  header("🧊 typesugar init");

  log("Detecting your project setup...\n");
  const stack = detectStack(cwd);

  info(`Package manager: ${COLORS.bright}${stack.packageManager}${COLORS.reset}`);
  info(`Bundler: ${COLORS.bright}${stack.bundler}${COLORS.reset}`);
  info(`TypeScript: ${stack.hasTypeScript ? "yes" : "no"}`);
  info(`tsconfig.json: ${stack.hasTsConfig ? "exists" : "will be created"}`);
  info(`ts-patch: ${stack.hasTsPatch ? "installed" : "will be installed"}`);

  if (stack.configFile) {
    info(`Config file: ${stack.configFile}`);
  }

  log("");

  const persona = await select<Persona>("What describes you best?", [
    {
      value: "end-user",
      label: "I'm using a library built with typesugar",
    },
    {
      value: "app-developer",
      label: "I want to use typesugar in my app/library",
    },
    {
      value: "extension-author",
      label: "I want to write custom macros or extensions",
    },
  ]);

  const packages = getPackagesForPersona(persona, stack.bundler);

  log("");
  header("Installation Plan");

  if (packages.runtime.length > 0) {
    info(`Runtime packages: ${packages.runtime.join(", ")}`);
  }
  info(`Dev packages: ${packages.dev.join(", ")}`);

  const proceed = await confirm("\nProceed with installation?");
  if (!proceed) {
    log("Aborted.");
    process.exit(0);
  }

  log("");
  header("Installing packages...");

  const allPackages = [...packages.runtime, ...packages.dev];
  const installCmd = getInstallCommand(stack.packageManager, allPackages, true);

  info(`Running: ${installCmd}`);
  log("");

  const { execSync } = await import("child_process");
  try {
    execSync(installCmd, { cwd, stdio: "inherit" });
    success("Packages installed");
  } catch {
    error("Package installation failed");
    log(`\nRun manually: ${installCmd}`);
  }

  header("Configuring project...");

  if (patchTsConfig(cwd)) {
    success("tsconfig.json configured with typesugar transformer");
  } else {
    warn("Could not patch tsconfig.json - please add the plugin manually");
  }

  if (patchPackageJson(cwd)) {
    success('Added "prepare" script for ts-patch');
  }

  if (stack.bundler === "next") {
    warn("Next.js is not yet supported by `typesugar init` — no plugin was configured.");
    log("  The transformer must be wired manually through a custom webpack config;");
    log("  see https://typesugar.org/getting-started/environments/webpack for the");
    log("  building blocks. Track Next.js support in the typesugar issue tracker.");
  }

  const bundlerResult = patchBundlerConfig(cwd, stack.bundler, stack.configFile);
  if (bundlerResult.created) {
    success(`Created ${bundlerResult.file} with typesugar plugin`);
  } else if (bundlerResult.patched) {
    success(`Patched ${bundlerResult.file}: added unplugin-typesugar to plugins`);
  } else if (bundlerResult.alreadyConfigured) {
    success(`${bundlerResult.file} already configured with unplugin-typesugar`);
  } else if (bundlerResult.file) {
    warn(`${bundlerResult.file} exists - add unplugin-typesugar manually`);
    log(`\n  Example for ${stack.bundler}:`);
    log(`  import typesugar from "unplugin-typesugar/${stack.bundler}";`);
    log(`  // Add typesugar() to your plugins array`);
  }

  if (persona !== "end-user") {
    createExampleFile(cwd);
    success("Created src/typesugar-example.ts");
  }

  // AI-assistant context (PEP-058 Wave 6). Offered to every persona — the
  // end-user persona (someone consuming a typesugar-powered library) is
  // exactly who benefits most from their assistant knowing not to "clean up"
  // a macro import.
  await scaffoldAiContextStep(cwd, aiMode);

  header("Running ts-patch install...");
  try {
    execSync("npx ts-patch install -s", { cwd, stdio: "inherit" });
    success("ts-patch installed");
  } catch {
    warn("ts-patch install failed - run manually: npx ts-patch install");
  }

  header("✨ Setup complete!");

  log("Next steps:");
  log("");
  log(`  1. ${COLORS.dim}Build your project:${COLORS.reset}`);

  if (stack.bundler === "vite") {
    log(`     ${COLORS.cyan}npx vite build${COLORS.reset}`);
  } else if (stack.bundler === "next") {
    log(`     ${COLORS.cyan}npx next build${COLORS.reset}`);
  } else {
    log(`     ${COLORS.cyan}npx typesugar build${COLORS.reset}`);
  }

  log("");
  log(`  2. ${COLORS.dim}Check macro expansion:${COLORS.reset}`);
  log(`     ${COLORS.cyan}npx typesugar expand src/typesugar-example.ts${COLORS.reset}`);

  log("");
  log(`  3. ${COLORS.dim}Run diagnostics if issues arise:${COLORS.reset}`);
  log(`     ${COLORS.cyan}npx typesugar doctor${COLORS.reset}`);

  log("");
  info("Documentation: https://typesugar.org/getting-started/");
  log("");
}
