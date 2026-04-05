/**
 * Fixture manager: copies fixture templates to /tmp and installs deps.
 *
 * In "released" mode (default), installs typesugar from npm.
 * In "local" mode, rewrites package.json to use local tarballs.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");
const REPO_ROOT = path.resolve(__dirname, "../..");

export interface PreparedFixture {
  /** Absolute path to the /tmp project directory */
  dir: string;
  /** Absolute path to the LSP server entry point (dist/server.js) */
  lspServerPath: string;
  /** Clean up the /tmp directory */
  cleanup: () => void;
}

/**
 * Prepare a fixture project in /tmp.
 *
 * In "local" mode (default): copies fixture to /tmp and uses the monorepo's
 * built LSP server directly. No npm install needed — the LSP server resolves
 * its own dependencies from the monorepo's node_modules.
 *
 * In "released" mode: copies fixture to /tmp and runs npm install to get
 * published packages from the npm registry.
 */
export async function prepareFixture(fixtureName: string): Promise<PreparedFixture> {
  const fixtureSource = path.join(FIXTURES_DIR, fixtureName);
  if (!fs.existsSync(fixtureSource)) {
    throw new Error(`Fixture "${fixtureName}" not found at ${fixtureSource}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `typesugar-integ-${fixtureName}-`));
  fs.cpSync(fixtureSource, tmpDir, { recursive: true });

  const mode = process.env.TYPESUGAR_TEST_MODE || "local";
  let lspServerPath: string;

  if (mode === "local") {
    // Use the monorepo's built LSP server directly
    lspServerPath = path.join(REPO_ROOT, "packages/lsp-server/dist/server.js");
    if (!fs.existsSync(lspServerPath)) {
      throw new Error(
        `LSP server not built at ${lspServerPath}. ` +
          `Run: pnpm build --filter @typesugar/lsp-server`
      );
    }

    // Symlink node_modules so imports like "typesugar" resolve
    symlinkMonorepoPackages(tmpDir);
  } else {
    // Released mode: install from npm
    execSync("npm install --ignore-scripts", {
      cwd: tmpDir,
      stdio: "pipe",
      timeout: 120000,
    });
    lspServerPath = findLspServer(tmpDir);
  }

  return {
    dir: tmpDir,
    lspServerPath,
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
 * Symlink monorepo packages into the fixture's node_modules so that
 * imports like `import { pipe } from "typesugar"` resolve.
 */
function symlinkMonorepoPackages(tmpDir: string): void {
  const nodeModules = path.join(tmpDir, "node_modules");
  const scopedDir = path.join(nodeModules, "@typesugar");

  fs.mkdirSync(scopedDir, { recursive: true });

  // Symlink the main "typesugar" package
  const typesugarPkg = path.join(REPO_ROOT, "packages/typesugar");
  if (fs.existsSync(typesugarPkg)) {
    const target = path.join(nodeModules, "typesugar");
    if (!fs.existsSync(target)) fs.symlinkSync(typesugarPkg, target, "junction");
  }

  // Symlink all @typesugar/* packages
  const packagesDir = path.join(REPO_ROOT, "packages");
  for (const pkg of fs.readdirSync(packagesDir)) {
    const pkgDir = path.join(packagesDir, pkg);
    const pkgJson = path.join(pkgDir, "package.json");
    if (!fs.existsSync(pkgJson)) continue;

    const meta = JSON.parse(fs.readFileSync(pkgJson, "utf8"));
    if (meta.name?.startsWith("@typesugar/")) {
      const target = path.join(scopedDir, meta.name.replace("@typesugar/", ""));
      if (!fs.existsSync(target)) fs.symlinkSync(pkgDir, target, "junction");
    }
  }

  // Also symlink typescript if not present
  const tsPath = path.join(REPO_ROOT, "node_modules/typescript");
  const tsTarget = path.join(nodeModules, "typescript");
  if (fs.existsSync(tsPath) && !fs.existsSync(tsTarget)) {
    fs.symlinkSync(tsPath, tsTarget, "junction");
  }
}

function findLspServer(projectDir: string): string {
  // Look for the dist/server.js directly
  const serverJs = path.join(projectDir, "node_modules/@typesugar/lsp-server/dist/server.js");
  if (fs.existsSync(serverJs)) {
    return serverJs;
  }

  // Fallback: look for the binary
  const binPath = path.join(projectDir, "node_modules/.bin/typesugar-lsp");
  if (fs.existsSync(binPath)) {
    return fs.realpathSync(binPath);
  }

  throw new Error(
    `Could not find typesugar-lsp server in ${projectDir}. ` +
      `Did npm install succeed? Check node_modules/@typesugar/lsp-server/`
  );
}
