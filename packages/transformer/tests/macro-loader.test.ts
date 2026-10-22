/**
 * Tests for manifest-based macro-package discovery (PEP-055 Phase A).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createRequire } from "module";
import * as ts from "typescript";
import { config, globalRegistry } from "@typesugar/core";
import {
  classifyManifestPackages,
  loadMacroPackages,
  loadMacroPackagesFromFile,
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

describe("macro identity across packages (PEP-060 item 8)", () => {
  let tmpDir: string;
  const macrosJs = (entries: Array<Record<string, string>>) =>
    `module.exports.__typesugar_macros__ = ${JSON.stringify(entries)}.map(` +
    `(m) => ({ ...m, expand: (_ctx, call) => call }));`;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-macro-identity-"));
    const nodeModules = path.join(tmpDir, "node_modules");
    // Two packages registering the same macro name, each under its own module.
    for (const pkg of ["@typesugar/fixture-ida", "@typesugar/fixture-idb"]) {
      writeFixturePackage(
        nodeModules,
        pkg,
        { typesugar: { macros: "./macros" } },
        {
          "macros.js": macrosJs([
            { kind: "expression", name: "pep060Shared", module: pkg, description: pkg },
          ]),
        }
      );
    }
    // A package whose first macro genuinely conflicts (a different legacy,
    // module-less definition of a name already taken) — its later macro must
    // still register, and the conflict must be reported.
    writeFixturePackage(
      nodeModules,
      "@typesugar/fixture-idc",
      { typesugar: { macros: "./macros" } },
      {
        "macros.js": macrosJs([
          { kind: "expression", name: "pep060Legacy", description: "second definition" },
          {
            kind: "expression",
            name: "pep060After",
            module: "@typesugar/fixture-idc",
            description: "after the conflict",
          },
        ]),
      }
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

  function load(imports: string[]) {
    const sf = ts.createSourceFile(
      path.join(tmpDir, "main.ts"),
      imports.map((m) => `import "${m}";`).join("\n"),
      ts.ScriptTarget.Latest,
      true
    );
    return loadMacroPackagesFromFile(sf).map((w) => w.message);
  }

  it("two packages' same-named macros both load, without a warning", () => {
    expect(load(["@typesugar/fixture-ida", "@typesugar/fixture-idb"])).toEqual([]);
    for (const pkg of ["@typesugar/fixture-ida", "@typesugar/fixture-idb"]) {
      expect(globalRegistry.getByModuleExport(pkg, "pep060Shared", "expression")?.module).toBe(pkg);
    }
  });

  it("a genuine conflict is reported, and the package's later macros still register", () => {
    globalRegistry.register({
      kind: "expression",
      name: "pep060Legacy",
      description: "first definition",
      expand: (_ctx, call) => call,
    });
    const warnings = load(["@typesugar/fixture-idc"]);
    expect(warnings.join("\n")).toMatch(/fixture-idc.*'pep060Legacy'.*already registered/s);
    expect(
      globalRegistry.getByModuleExport("@typesugar/fixture-idc", "pep060After", "expression")
    ).toBeDefined();
  });
});

describe("a macro package imported by a relative path (its own examples, a workspace sibling)", () => {
  // `packages/mapper/examples/showcase.ts` imports transformInto from
  // "../src/index.js": the loader only looked at bare specifiers, so
  // @typesugar/mapper's macros were never loaded and the call ran its
  // runtime stub ("transformInto() was called at runtime").
  //
  // Trust: a package reached by a relative path is trusted under its
  // package.json name only when it is one of the project's own directories
  // (the build's cwd / tsconfig package, or a workspace package it
  // declares), or when that name, looked up from those directories, lands in
  // the same directory. `@typesugar/*` auto-trust rests on npm scope
  // ownership, which a relative path bypasses (review 5, item 1; review 6).
  // Each test chdirs into the project it builds: the project is what the
  // build's cwd (or tsconfig) says, never the importing file's directory.
  let tmpDir: string;
  let originalCwd: string;
  const macrosJs = (pkg: string) =>
    `module.exports.__typesugar_macros__ = [{ kind: "expression", name: "relAnswer", ` +
    `module: ${JSON.stringify(pkg)}, description: "fixture", expand: (_ctx, call) => call }];`;
  /** A macros entry whose only effect is to write a marker file next to itself. */
  const pwnedJs =
    `require("fs").writeFileSync(require("path").join(__dirname, "PWNED"), "executed");\n` +
    `module.exports = { __typesugar_macros__: [] };`;

  function writeWorkspacePackage(
    dir: string,
    name: string,
    macros: string | undefined,
    extra: Record<string, unknown> = {}
  ): string {
    const pkgDir = path.join(tmpDir, dir);
    fs.mkdirSync(path.join(pkgDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(pkgDir, "examples"), { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name,
        version: "1.0.0",
        exports: { ".": "./src/index.js", "./macros": "./macros.js" },
        typesugar: { macros: "./macros" },
        ...extra,
      })
    );
    fs.writeFileSync(
      path.join(pkgDir, "src", "index.ts"),
      "export declare function relAnswer(): number;\n"
    );
    fs.writeFileSync(path.join(pkgDir, "src", "index.js"), "export {};\n");
    if (macros !== undefined) fs.writeFileSync(path.join(pkgDir, "macros.js"), macros);
    return pkgDir;
  }

  /** Link `name` in `<tmp>/<at>/node_modules` to `target` (a pnpm workspace link). */
  function link(at: string, name: string, target: string): void {
    const linkPath = path.join(tmpDir, at, "node_modules", ...name.split("/"));
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(target, linkPath, "dir");
  }

  function loadFrom(file: string, imports: string[]): string[] {
    const sf = ts.createSourceFile(
      file,
      imports.map((m) => `import { relAnswer } from "${m}";`).join("\n"),
      ts.ScriptTarget.Latest,
      true
    );
    return loadMacroPackagesFromFile(sf).map((w) => w.message);
  }

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-macro-rel-")));
    originalCwd = process.cwd();
    resetLoadedPackages();
    config.reset();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    resetLoadedPackages();
    config.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads the package's macros for its own example importing ../src (workspace-linked)", () => {
    const pkg = "@typesugar/fixture-rel-a";
    const dir = writeWorkspacePackage("packages/fixture-rel-a", pkg, macrosJs(pkg));
    link(".", pkg, dir);
    process.chdir(tmpDir);
    expect(loadFrom(path.join(dir, "examples", "use.ts"), ["../src/index.js"])).toEqual([]);
    expect(globalRegistry.getByModuleExport(pkg, "relAnswer", "expression")?.module).toBe(pkg);
  });

  it("loads the package's macros for its own example when the build runs inside the package", () => {
    const pkg = "@typesugar/fixture-rel-cwd";
    const dir = writeWorkspacePackage("my-macros", pkg, macrosJs(pkg));
    process.chdir(dir);
    expect(loadFrom(path.join(dir, "examples", "use.ts"), ["../src/index.js"])).toEqual([]);
    expect(globalRegistry.getByModuleExport(pkg, "relAnswer", "expression")?.module).toBe(pkg);
  });

  it("loadMacroPackages finds it through the program's files too", () => {
    const pkg = "@typesugar/fixture-rel-b";
    const dir = writeWorkspacePackage("packages/fixture-rel-b", pkg, macrosJs(pkg));
    link(".", pkg, dir);
    const use = path.join(dir, "examples", "use.ts");
    fs.writeFileSync(use, `import { relAnswer } from "../src/index.js";\nrelAnswer();\n`);
    // The project: the program's current directory (TypeScript's own sys
    // memoizes process.cwd(), so give the host the directory explicitly).
    const options = { noEmit: true, allowJs: false };
    const host = { ...ts.createCompilerHost(options), getCurrentDirectory: () => tmpDir };
    const program = ts.createProgram([use], options, host);
    loadMacroPackages(program);
    expect(globalRegistry.getByModuleExport(pkg, "relAnswer", "expression")?.module).toBe(pkg);
  });

  it("a linked sibling's broken macros are reported; an unapproved one is reported, not loaded", () => {
    const broken = "@typesugar/fixture-rel-c";
    const brokenDir = writeWorkspacePackage(
      "packages/fixture-rel-c",
      broken,
      `throw new Error("boom");`
    );
    const untrustedDir = writeWorkspacePackage(
      "packages/rel-untrusted",
      "rel-untrusted",
      macrosJs("rel-untrusted")
    );
    link("app", broken, brokenDir);
    link("app", "rel-untrusted", untrustedDir);
    process.chdir(path.join(tmpDir, "app"));
    const app = path.join(tmpDir, "app", "main.ts");
    const warnings = loadFrom(app, [
      "../packages/fixture-rel-c/src/index.js",
      "../packages/rel-untrusted/src/index.js",
    ]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/fixture-rel-c.*boom/);
    expect(warnings[1]).toMatch(/'rel-untrusted'.*not approved.*approve-macros/s);
    expect(globalRegistry.getByModuleExport("rel-untrusted", "relAnswer", "expression")).toBe(
      undefined
    );
  });

  it("does not run a relatively imported package that merely claims an @typesugar/* name", () => {
    // review5/sec: vendor/evil/package.json says "@typesugar/totally-official".
    fs.mkdirSync(path.join(tmpDir, "app", "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "app", "package.json"), `{"name":"app"}`);
    const evil = path.join(tmpDir, "app", "vendor", "evil");
    fs.mkdirSync(evil, { recursive: true });
    fs.writeFileSync(
      path.join(evil, "package.json"),
      JSON.stringify({
        name: "@typesugar/totally-official",
        typesugar: { macros: "./macros.cjs" },
        exports: { ".": "./index.js", "./macros.cjs": "./macros.cjs" },
      })
    );
    fs.writeFileSync(path.join(evil, "index.d.ts"), "export declare const helper: number;\n");
    fs.writeFileSync(path.join(evil, "macros.cjs"), pwnedJs);
    const use = path.join(tmpDir, "app", "src", "use.ts");
    fs.writeFileSync(
      use,
      `import { helper } from "../vendor/evil/index.js";\nexport const h = helper;\n`
    );

    const warnings = loadFrom(use, ["../vendor/evil/index.js"]);
    loadMacroPackages(ts.createProgram([use], { noEmit: true }));

    expect(fs.existsSync(path.join(evil, "PWNED"))).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(evil);
    expect(warnings[0]).toMatch(/@typesugar\/totally-official.*not loaded/s);
  });

  it("does not run it either when the package's own .ts files are in the program", () => {
    // The importing file is inside the spoofing package (its index.ts, pulled
    // into the program by the project's import): being inside a package is
    // not evidence of its name.
    fs.mkdirSync(path.join(tmpDir, "app", "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "app", "package.json"), `{"name":"app"}`);
    const evil = path.join(tmpDir, "app", "vendor", "evil");
    fs.mkdirSync(evil, { recursive: true });
    fs.writeFileSync(
      path.join(evil, "package.json"),
      JSON.stringify({ name: "@typesugar/totally-official", typesugar: { macros: "./macros.cjs" } })
    );
    fs.writeFileSync(path.join(evil, "index.ts"), `export { helper } from "./helper.js";\n`);
    fs.writeFileSync(path.join(evil, "helper.ts"), `export const helper = 1;\n`);
    fs.writeFileSync(path.join(evil, "macros.cjs"), pwnedJs);
    const use = path.join(tmpDir, "app", "src", "use.ts");
    fs.writeFileSync(
      use,
      `import { helper } from "../vendor/evil/index.js";\nexport const h = helper;\n`
    );

    const program = ts.createProgram([use], { noEmit: true });
    expect(program.getSourceFile(path.join(evil, "index.ts"))).toBeDefined();
    loadMacroPackages(program);
    loadFrom(path.join(evil, "index.ts"), ["./helper.js"]);

    expect(fs.existsSync(path.join(evil, "PWNED"))).toBe(false);
  });

  it("a spoof of a real package's name doesn't shadow the real one", () => {
    const pkg = "@typesugar/fixture-genuine";
    const real = writeWorkspacePackage(
      "app/node_modules/@typesugar/fixture-genuine",
      pkg,
      macrosJs(pkg)
    );
    const fake = writeWorkspacePackage("app/vendor/fake", pkg, pwnedJs);
    fs.writeFileSync(path.join(tmpDir, "app", "package.json"), `{"name":"app"}`);
    process.chdir(path.join(tmpDir, "app"));
    const use = path.join(tmpDir, "app", "src", "use.ts");
    const warnings = loadFrom(use, ["../vendor/fake/src/index.js", pkg]);
    expect(fs.existsSync(path.join(fake, "PWNED"))).toBe(false);
    expect(warnings.join("\n")).toContain(fake);
    expect(globalRegistry.getByModuleExport(pkg, "relAnswer", "expression")?.module).toBe(pkg);
    expect(real).toBeTruthy();
  });

  it("an unlinked sibling claiming an @typesugar/* name is reported, not loaded", () => {
    const pkg = "@typesugar/fixture-rel-d";
    const dir = writeWorkspacePackage("packages/fixture-rel-d", pkg, pwnedJs);
    const warnings = loadFrom(path.join(tmpDir, "app", "main.ts"), [
      "../packages/fixture-rel-d/src/index.js",
    ]);
    expect(fs.existsSync(path.join(dir, "PWNED"))).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/does not resolve to/);
  });
});
