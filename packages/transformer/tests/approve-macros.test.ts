/**
 * End-to-end test for `typesugar approve-macros` (PEP-055 Phase A).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createRequire } from "module";
import * as ts from "typescript";
import { config } from "@typesugar/core";
import {
  classifyManifestPackages,
  collectImportedModules,
  resetLoadedPackages,
  __setRequireForTesting,
} from "../src/macro-loader.js";
import { runApproveMacros } from "../src/approve-macros.js";

function writeFixturePackage(
  nodeModulesDir: string,
  name: string,
  pkgJsonExtra: Record<string, unknown>,
  files: Record<string, string> = {}
): void {
  const pkgDir = path.join(nodeModulesDir, ...name.split("/"));
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", ...pkgJsonExtra }, null, 2)
  );
  for (const [relPath, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(pkgDir, relPath), content);
  }
}

describe("runApproveMacros (PEP-055 CLI)", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-approve-macros-"));
    originalCwd = process.cwd();

    const nodeModules = path.join(tmpDir, "node_modules");
    fs.mkdirSync(nodeModules, { recursive: true });
    writeFixturePackage(
      nodeModules,
      "unscoped-macro-pkg",
      { typesugar: { macros: "./macros" } },
      { "macros.js": "module.exports.__typesugar_macros__ = [];" }
    );
    // The written typesugar.config.ts imports `defineConfig` from
    // @typesugar/core (cosmiconfig requires it to actually load the file
    // when re-reading config below) — stub it, since a real project would
    // already have this as a dependency.
    writeFixturePackage(
      nodeModules,
      "@typesugar/core",
      {},
      {
        "index.js": "module.exports.defineConfig = (cfg) => cfg;",
      }
    );

    fs.writeFileSync(
      path.join(tmpDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { target: "ES2020", module: "ESNext", skipLibCheck: true },
        include: ["src"],
      })
    );
    fs.mkdirSync(path.join(tmpDir, "src"));
    fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), `import "unscoped-macro-pkg";\n`);
    fs.writeFileSync(path.join(tmpDir, "entry.js"), "");

    __setRequireForTesting(createRequire(path.join(tmpDir, "entry.js")));
    resetLoadedPackages();
    config.reset();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    __setRequireForTesting(undefined);
    resetLoadedPackages();
    config.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes a newly-blocked package into typesugar.config.ts, and a subsequent scan reports it approved", async () => {
    await runApproveMacros({ project: "tsconfig.json", yes: true, verbose: false });

    const configPath = path.join(tmpDir, "typesugar.config.ts");
    expect(fs.existsSync(configPath)).toBe(true);
    expect(fs.readFileSync(configPath, "utf-8")).toContain("unscoped-macro-pkg");

    // Force `config` to re-read the file this just wrote, then re-scan.
    config.reset();
    const program = ts.createProgram([path.join(tmpDir, "src", "index.ts")], {
      target: ts.ScriptTarget.ES2020,
      skipLibCheck: true,
    });
    const { blocked, toLoad } = classifyManifestPackages(collectImportedModules(program));
    expect(blocked).toEqual([]);
    expect(toLoad.get("unscoped-macro-pkg")).toBe("unscoped-macro-pkg/macros");
  });

  it("a subsequent unrelated unapproved package is still reported blocked (per-package, not global)", async () => {
    await runApproveMacros({ project: "tsconfig.json", yes: true, verbose: false });

    writeFixturePackage(
      path.join(tmpDir, "node_modules"),
      "another-unscoped-pkg",
      { typesugar: { macros: "./macros" } },
      { "macros.js": "module.exports.__typesugar_macros__ = [];" }
    );
    fs.writeFileSync(
      path.join(tmpDir, "src", "index.ts"),
      `import "unscoped-macro-pkg";\nimport "another-unscoped-pkg";\n`
    );

    config.reset();
    const program = ts.createProgram([path.join(tmpDir, "src", "index.ts")], {
      target: ts.ScriptTarget.ES2020,
      skipLibCheck: true,
    });
    const { blocked } = classifyManifestPackages(collectImportedModules(program));
    expect(blocked).toEqual(["another-unscoped-pkg"]);
  });

  it("lists a dependency reached by a relative path into node_modules; project code is not listed", async () => {
    // `../node_modules/rel-npm/...` is a dependency, judged as a bare import
    // of rel-npm. packages/rel-pkg (even though node_modules links it) and
    // vendor/evil are project code by real path: they load without approval.
    writeFixturePackage(
      path.join(tmpDir, "node_modules"),
      "rel-npm",
      { typesugar: { macros: "./macros" } },
      { "index.d.ts": "export declare const w: number;\n" }
    );
    const relDir = path.join(tmpDir, "packages", "rel-pkg");
    fs.mkdirSync(relDir, { recursive: true });
    fs.writeFileSync(
      path.join(relDir, "package.json"),
      JSON.stringify({ name: "rel-pkg", typesugar: { macros: "./macros" } })
    );
    fs.writeFileSync(path.join(relDir, "index.d.ts"), "export declare const x: number;\n");
    fs.symlinkSync(relDir, path.join(tmpDir, "node_modules", "rel-pkg"), "dir");
    const evilDir = path.join(tmpDir, "vendor", "evil");
    fs.mkdirSync(evilDir, { recursive: true });
    fs.writeFileSync(
      path.join(evilDir, "package.json"),
      JSON.stringify({ name: "@typesugar/totally-official", typesugar: { macros: "./m.cjs" } })
    );
    fs.writeFileSync(path.join(evilDir, "index.d.ts"), "export declare const y: number;\n");
    fs.writeFileSync(
      path.join(tmpDir, "src", "index.ts"),
      `import { w } from "../node_modules/rel-npm/index.js";\n` +
        `import { x } from "../packages/rel-pkg/index.js";\n` +
        `import { y } from "../vendor/evil/index.js";\nexport const z = w + x + y;\n`
    );
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runApproveMacros({ project: "tsconfig.json", yes: true, verbose: false });
    vi.restoreAllMocks();

    const written = fs.readFileSync(path.join(tmpDir, "typesugar.config.ts"), "utf-8");
    expect(written).toContain("rel-npm");
    expect(written).not.toContain("rel-pkg");
    expect(written).not.toContain("totally-official");
  });

  it("reports nothing to approve when there are no blocked packages", async () => {
    fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), `export {};\n`);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runApproveMacros({ project: "tsconfig.json", yes: true, verbose: false });

    expect(logSpy.mock.calls.some(([msg]) => String(msg).includes("No new macro packages"))).toBe(
      true
    );
    expect(fs.existsSync(path.join(tmpDir, "typesugar.config.ts"))).toBe(false);

    logSpy.mockRestore();
  });
});
