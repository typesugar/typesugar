/**
 * Fixture manager: copies a fixture project to the OS temp directory and makes
 * its dependencies resolvable, the way a user's project has them installed.
 *
 * In "local" mode (default) the fixture's `node_modules` links to this
 * monorepo's built packages and TypeScript. In "released" mode it runs
 * `npm install` and uses the published packages from the npm registry.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");
const REPO_ROOT = path.resolve(__dirname, "../..");

export interface PreparedFixture {
  /** Absolute (real) path to the temp project directory */
  dir: string;
  /** Absolute path to the tsserver.js the tests run */
  tsserverPath: string;
  /** Clean up the temp directory */
  cleanup: () => void;
}

/**
 * Prepare a fixture project in the OS temp directory.
 *
 * "local" mode: symlinks the monorepo's packages (which must be built: the
 * plugin loads from `packages/transformer/dist`) into the fixture's
 * `node_modules`, and runs the monorepo's TypeScript.
 *
 * "released" mode: runs `npm install` in the fixture and uses its TypeScript.
 */
export async function prepareFixture(fixtureName: string): Promise<PreparedFixture> {
  const fixtureSource = path.join(FIXTURES_DIR, fixtureName);
  if (!fs.existsSync(fixtureSource)) {
    throw new Error(`Fixture "${fixtureName}" not found at ${fixtureSource}`);
  }

  // realpath: on macOS os.tmpdir() is under /var, a symlink to /private/var,
  // and tsserver reports real paths.
  const tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), `typesugar-integ-${fixtureName}-`))
  );
  fs.cpSync(fixtureSource, tmpDir, { recursive: true });

  const mode = process.env.TYPESUGAR_TEST_MODE || "local";
  let tsserverPath: string;

  if (mode === "local") {
    const pluginEntry = path.join(REPO_ROOT, "packages/transformer/dist/language-service.cjs");
    if (!fs.existsSync(pluginEntry)) {
      throw new Error(
        `typesugar plugin not built at ${pluginEntry}. ` +
          `Run: pnpm build --filter typesugar... --filter @typesugar/std...`
      );
    }
    tsserverPath = path.join(REPO_ROOT, "node_modules/typescript/lib/tsserver.js");
    symlinkMonorepoPackages(tmpDir);
  } else {
    execSync("npm install --ignore-scripts", {
      cwd: tmpDir,
      stdio: "pipe",
      timeout: 120000,
    });
    tsserverPath = path.join(tmpDir, "node_modules/typescript/lib/tsserver.js");
  }

  if (!fs.existsSync(tsserverPath)) {
    throw new Error(`tsserver not found at ${tsserverPath}`);
  }

  return {
    dir: tmpDir,
    tsserverPath,
    cleanup: () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

/**
 * Symlink monorepo packages into the fixture's node_modules so that imports
 * like `import { pipe } from "typesugar"` resolve, and so that tsserver finds
 * the `@typesugar/transformer/language-service` plugin listed in the fixture's
 * tsconfig.json.
 */
function symlinkMonorepoPackages(tmpDir: string): void {
  const nodeModules = path.join(tmpDir, "node_modules");
  const scopedDir = path.join(nodeModules, "@typesugar");

  fs.mkdirSync(scopedDir, { recursive: true });

  // The umbrella "typesugar" package and every @typesugar/* package
  const packagesDir = path.join(REPO_ROOT, "packages");
  for (const pkg of fs.readdirSync(packagesDir)) {
    const pkgDir = path.join(packagesDir, pkg);
    const pkgJson = path.join(pkgDir, "package.json");
    if (!fs.existsSync(pkgJson)) continue;

    const meta = JSON.parse(fs.readFileSync(pkgJson, "utf8"));
    let target: string;
    if (meta.name === "typesugar") target = path.join(nodeModules, "typesugar");
    else if (meta.name?.startsWith("@typesugar/"))
      target = path.join(scopedDir, meta.name.replace("@typesugar/", ""));
    else continue;
    if (!fs.existsSync(target)) linkAsPublished(pkgDir, meta.files, target);
  }

  // The project's own TypeScript (lib .d.ts files and `import "typescript"`)
  const tsPath = path.join(REPO_ROOT, "node_modules/typescript");
  const tsTarget = path.join(nodeModules, "typescript");
  if (fs.existsSync(tsPath) && !fs.existsSync(tsTarget)) {
    fs.symlinkSync(tsPath, tsTarget, "junction");
  }
}

/**
 * Link a workspace package into node_modules with the layout npm would
 * install: `package.json` plus only the entries in its `files` list, each a
 * symlink into the package. Linking the whole package directory instead would
 * let resolution find files that are never published (tsserver's plugin
 * loader ignores `exports` and resolves `<pkg>/<subpath>` by plain file and
 * directory lookup, so a stray file at the package root changes which module
 * it loads).
 */
function linkAsPublished(pkgDir: string, files: unknown, target: string): void {
  const entries = Array.isArray(files) ? (files as unknown[]) : undefined;
  if (!entries || entries.some((f) => typeof f !== "string" || /[*?!{]/.test(f))) {
    fs.symlinkSync(pkgDir, target, "junction");
    return;
  }
  fs.mkdirSync(target, { recursive: true });
  for (const entry of ["package.json", ...(entries as string[])]) {
    const source = path.join(pkgDir, entry);
    if (fs.existsSync(source)) fs.symlinkSync(source, path.join(target, entry));
  }
}
