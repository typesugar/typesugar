/**
 * A macro package installed while the host is running (tsserver, a dev
 * server, watch) is picked up: "could not be resolved ... Install it in this
 * project" is not cached for the life of the process.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createRequire } from "module";
import * as ts from "typescript";
import { config, globalRegistry, TS9704 } from "@typesugar/core";
import tsPatchEntry from "../src/index.js";
import {
  loadMacroPackagesFromFile,
  resetLoadedPackages,
  __setRequireForTesting,
} from "../src/macro-loader.js";

const PKG = "@typesugar/fixture-installed-later";

function install(tmpDir: string): void {
  const pkgDir = path.join(tmpDir, "node_modules", ...PKG.split("/"));
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name: PKG, version: "1.0.0", typesugar: { macros: "./macros" } })
  );
  fs.writeFileSync(
    path.join(pkgDir, "macros.js"),
    `module.exports.__typesugar_macros__ = [{ kind: "expression", name: "laterAnswer", ` +
      `module: ${JSON.stringify(PKG)}, description: "", expand: (_c, call) => call }];`
  );
}

describe("a macro package installed while the host runs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-install-later-")));
    resetLoadedPackages();
    config.reset();
  });

  afterEach(() => {
    resetLoadedPackages();
    config.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function warningsFor(): string[] {
    const sf = ts.createSourceFile(
      path.join(tmpDir, "main.ts"),
      `import { laterAnswer } from "${PKG}";\n`,
      ts.ScriptTarget.Latest,
      true
    );
    return loadMacroPackagesFromFile(sf).map((w) => w.message);
  }

  it("stops warning and loads the macros once the package is installed", () => {
    expect(warningsFor().join("\n")).toMatch(/could not be resolved.*Install it/s);
    install(tmpDir);
    expect(warningsFor()).toEqual([]);
    expect(globalRegistry.getByModuleExport(PKG, "laterAnswer", "expression")?.module).toBe(PKG);
  });

  it("loads the macros entry once it exists (a workspace package built after the host started)", () => {
    install(tmpDir);
    const macrosJs = path.join(tmpDir, "node_modules", ...PKG.split("/"), "macros.js");
    const built = fs.readFileSync(macrosJs, "utf-8");
    fs.rmSync(macrosJs);
    expect(warningsFor().join("\n")).toMatch(/loading it failed: Cannot find module/);
    fs.writeFileSync(macrosJs, built);
    expect(warningsFor()).toEqual([]);
    expect(globalRegistry.getByModuleExport(PKG, "laterAnswer", "expression")?.module).toBe(PKG);
  });

  it("still reports a macros entry that throws on every load", () => {
    install(tmpDir);
    const macrosJs = path.join(tmpDir, "node_modules", ...PKG.split("/"), "macros.js");
    fs.writeFileSync(macrosJs, `throw new Error("boom");`);
    expect(warningsFor().join("\n")).toMatch(/loading it failed: boom/);
    expect(warningsFor().join("\n")).toMatch(/loading it failed: boom/);
  });
});

describe("the warning for a macro package that could not be loaded", () => {
  it("is reported as TS9704, not the internal-error code TS9999", () => {
    const tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-ts9704-")));
    try {
      resetLoadedPackages();
      const mainPath = path.join(tmpDir, "main.ts");
      fs.writeFileSync(mainPath, `import { laterAnswer } from "${PKG}";\nexport const x = 1;\n`);
      const program = ts.createProgram([mainPath], {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        noEmit: false,
      });
      const added: ts.Diagnostic[] = [];
      const factory = tsPatchEntry(
        program,
        {},
        { addDiagnostic: (d: ts.Diagnostic) => added.push(d) }
      );
      program.emit(program.getSourceFile(mainPath), () => {}, undefined, false, {
        before: [factory],
      });
      const warning = added.find((d) =>
        ts.flattenDiagnosticMessageText(d.messageText, " ").includes("could not be resolved")
      );
      expect(warning?.code).toBe(TS9704.code);
      expect(warning?.category).toBe(ts.DiagnosticCategory.Warning);
    } finally {
      resetLoadedPackages();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("a package that stays unresolvable is not looked up again for every file", () => {
  let tmpDir: string;
  let resolveCalls: string[];

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-unresolvable-")));
    fs.writeFileSync(path.join(tmpDir, "entry.js"), "");
    const base = createRequire(path.join(tmpDir, "entry.js"));
    resolveCalls = [];
    const resolve = Object.assign(
      (id: string, options?: { paths?: string[] }) => {
        resolveCalls.push(id);
        return base.resolve(id, options);
      },
      { paths: base.resolve.paths }
    );
    const req = Object.assign((id: string) => base(id), base, { resolve }) as NodeRequire;
    __setRequireForTesting(req);
    resetLoadedPackages();
    config.reset();
  });

  afterEach(() => {
    __setRequireForTesting(undefined);
    resetLoadedPackages();
    config.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function load(file: string, pkg: string): string[] {
    const sf = ts.createSourceFile(
      path.join(tmpDir, file),
      `import "${pkg}";\n`,
      ts.ScriptTarget.Latest,
      true
    );
    return loadMacroPackagesFromFile(sf).map((w) => w.message);
  }

  it("an installed package require() cannot resolve (ESM-only exports)", () => {
    const pkg = "esm-only-fixture";
    const dir = path.join(tmpDir, "node_modules", pkg);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: pkg, exports: { ".": { import: "./index.mjs" } } })
    );
    fs.writeFileSync(path.join(dir, "index.mjs"), "export {};\n");
    load("a.ts", pkg);
    const after = resolveCalls.length;
    expect(after).toBeGreaterThan(0);
    load("b.ts", pkg);
    load("c.ts", pkg);
    expect(resolveCalls.length).toBe(after);
  });

  it("macro targets that do not resolve (no @typesugar/std here)", () => {
    // Every file importing a typesugar package preloads @typesugar/std; here
    // it can't be resolved, and neither can the imported package.
    load("a.ts", "@typesugar/fixture-absent");
    const after = resolveCalls.length;
    expect(resolveCalls).toContain("@typesugar/std");
    load("b.ts", "@typesugar/fixture-absent");
    load("c.ts", "@typesugar/fixture-absent");
    expect(resolveCalls.length).toBe(after);
  });
});
