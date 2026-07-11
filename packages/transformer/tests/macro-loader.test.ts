/**
 * Tests for manifest-based macro-package discovery (PEP-055 Phase A).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createRequire } from "module";
import * as ts from "typescript";
import { config } from "@typesugar/core";
import {
  classifyManifestPackages,
  loadMacroPackages,
  resetLoadedPackages,
  __setRequireForTesting,
  UnapprovedMacroPackagesError,
} from "../src/macro-loader.js";

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
    const filePath = path.join(pkgDir, relPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

function createProgramFromImports(imports: string[]): ts.Program {
  const fileName = "test-entry.ts";
  const sourceText = imports.map((mod) => `import "${mod}";`).join("\n") || "export {};";
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
  };
  const host = ts.createCompilerHost(options);
  return ts.createProgram([fileName], options, {
    ...host,
    getSourceFile: (name) =>
      name === fileName ? sourceFile : host.getSourceFile(name, ts.ScriptTarget.Latest),
  });
}

describe("macro-loader manifest discovery (PEP-055)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-macro-loader-"));
    const nodeModules = path.join(tmpDir, "node_modules");
    fs.mkdirSync(nodeModules, { recursive: true });

    writeFixturePackage(
      nodeModules,
      "@typesugar/fixture-trusted",
      { typesugar: { macros: "./macros" } },
      { "macros.js": "module.exports.__typesugar_macros__ = [];" }
    );
    writeFixturePackage(
      nodeModules,
      "unscoped-macro-pkg",
      { typesugar: { macros: "./macros" } },
      { "macros.js": "module.exports.__typesugar_macros__ = [];" }
    );
    writeFixturePackage(nodeModules, "no-manifest-pkg", {});
    writeFixturePackage(nodeModules, "facade-pkg", {
      typesugar: { macros: "provider-pkg/macros" },
    });
    writeFixturePackage(
      nodeModules,
      "provider-pkg",
      {},
      { "macros.js": "module.exports.__typesugar_macros__ = [];" }
    );
    writeFixturePackage(
      nodeModules,
      "restricted-exports-pkg",
      { exports: { ".": "./index.js" }, typesugar: { macros: "./macros" } },
      { "index.js": "module.exports = {};" }
    );
    writeFixturePackage(nodeModules, "@my-scope/wildcard-pkg", {
      typesugar: { macros: "./macros" },
    });
    writeFixturePackage(
      nodeModules,
      "typesugar",
      { typesugar: { macros: "." } },
      { "index.js": "module.exports.__typesugar_macros__ = [];" }
    );

    fs.writeFileSync(path.join(tmpDir, "entry.js"), "");
    __setRequireForTesting(createRequire(path.join(tmpDir, "entry.js")));
    resetLoadedPackages();
    config.reset();
  });

  afterEach(() => {
    __setRequireForTesting(undefined);
    resetLoadedPackages();
    config.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("auto-trusts @typesugar/* packages declaring the manifest field", () => {
    const { toLoad, blocked } = classifyManifestPackages(["@typesugar/fixture-trusted"]);
    expect(toLoad.get("@typesugar/fixture-trusted")).toBe("@typesugar/fixture-trusted/macros");
    expect(blocked).toEqual([]);
  });

  it('auto-trusts the bare unscoped "typesugar" package (self-referencing ".")', () => {
    const { toLoad, blocked } = classifyManifestPackages(["typesugar"]);
    expect(toLoad.get("typesugar")).toBe("typesugar");
    expect(blocked).toEqual([]);
  });

  it("blocks unscoped packages by default", () => {
    const { toLoad, blocked } = classifyManifestPackages(["unscoped-macro-pkg"]);
    expect(toLoad.size).toBe(0);
    expect(blocked).toEqual(["unscoped-macro-pkg"]);
  });

  it("trusts an unscoped package once approved by exact name", () => {
    config.set({ security: { allowedMacroPackages: ["unscoped-macro-pkg"] } });
    const { toLoad, blocked } = classifyManifestPackages(["unscoped-macro-pkg"]);
    expect(toLoad.get("unscoped-macro-pkg")).toBe("unscoped-macro-pkg/macros");
    expect(blocked).toEqual([]);
  });

  it("trusts a package via a scope wildcard entry", () => {
    config.set({ security: { allowedMacroPackages: ["@my-scope/*"] } });
    const { toLoad, blocked } = classifyManifestPackages(["@my-scope/wildcard-pkg"]);
    expect(toLoad.get("@my-scope/wildcard-pkg")).toBe("@my-scope/wildcard-pkg/macros");
    expect(blocked).toEqual([]);
  });

  it("ignores packages with no manifest field", () => {
    const { toLoad, blocked } = classifyManifestPackages(["no-manifest-pkg"]);
    expect(toLoad.size).toBe(0);
    expect(blocked).toEqual([]);
  });

  it("resolves a facade's cross-package bare-specifier target", () => {
    config.set({ security: { allowedMacroPackages: ["facade-pkg"] } });
    const { toLoad } = classifyManifestPackages(["facade-pkg"]);
    expect(toLoad.get("facade-pkg")).toBe("provider-pkg/macros");
  });

  it("finds the manifest via the walk-up fallback when exports restricts package.json", () => {
    config.set({ security: { allowedMacroPackages: ["restricted-exports-pkg"] } });
    const { toLoad, blocked } = classifyManifestPackages(["restricted-exports-pkg"]);
    expect(toLoad.get("restricted-exports-pkg")).toBe("restricted-exports-pkg/macros");
    expect(blocked).toEqual([]);
  });

  it("loadMacroPackages throws UnapprovedMacroPackagesError naming blocked packages", () => {
    const program = createProgramFromImports(["unscoped-macro-pkg"]);
    let caught: unknown;
    try {
      loadMacroPackages(program);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnapprovedMacroPackagesError);
    expect((caught as UnapprovedMacroPackagesError).packages).toEqual(["unscoped-macro-pkg"]);
  });

  it("loadMacroPackages does not throw for a trusted @typesugar/* manifest package", () => {
    const program = createProgramFromImports(["@typesugar/fixture-trusted"]);
    expect(() => loadMacroPackages(program)).not.toThrow();
  });

  it("loadMacroPackages does not throw when nothing declares the manifest field", () => {
    const program = createProgramFromImports(["no-manifest-pkg"]);
    expect(() => loadMacroPackages(program)).not.toThrow();
  });
});

describe("manifest discovery against the real workspace packages (PEP-055 Phase B)", () => {
  // No __setRequireForTesting override here — these resolve through the
  // real, workspace-linked node_modules, exercising the actual
  // typesugar.macros fields Phase B added to each package's package.json.
  beforeEach(() => {
    resetLoadedPackages();
  });

  afterEach(() => {
    resetLoadedPackages();
  });

  it('resolves @typesugar/macros\' own root-level manifest entry (".")', () => {
    const { toLoad, blocked } = classifyManifestPackages(["@typesugar/macros"]);
    expect(toLoad.get("@typesugar/macros")).toBe("@typesugar/macros");
    expect(blocked).toEqual([]);
  });

  it("resolves each ./macros-subpath package's manifest entry", () => {
    const packages = [
      "@typesugar/codec",
      "@typesugar/contracts",
      "@typesugar/effect",
      "@typesugar/erased",
      "@typesugar/fusion",
      "@typesugar/graph",
      "@typesugar/mapper",
      "@typesugar/strings",
      "@typesugar/testing",
      "@typesugar/type-system",
      "@typesugar/sql",
      "@typesugar/parser",
      "@typesugar/std",
      "@typesugar/units",
      "@typesugar/validate",
    ];
    const { toLoad, blocked } = classifyManifestPackages(packages);
    expect(blocked).toEqual([]);
    for (const pkg of packages) {
      expect(toLoad.get(pkg)).toBe(`${pkg}/macros`);
    }
  });

  it("resolves each facade's cross-package reference to @typesugar/macros", () => {
    const facades = [
      "@typesugar/derive",
      "@typesugar/reflect",
      "@typesugar/typeclass",
      "typesugar",
    ];
    const { toLoad, blocked } = classifyManifestPackages(facades);
    expect(blocked).toEqual([]);
    for (const pkg of facades) {
      expect(toLoad.get(pkg)).toBe("@typesugar/macros");
    }
  });
});
