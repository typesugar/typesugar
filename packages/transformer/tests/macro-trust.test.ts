/**
 * Which macro packages typesugar runs (SECURITY.md, "What typesugar trusts";
 * PEP-055, decision of 2026-10-22):
 *
 * - The project tree is trusted. A macro package reached by a RELATIVE import
 *   whose real path is not inside a `node_modules` directory is project code
 *   (a vendored directory, a workspace sibling, a nested project). It loads
 *   whatever its package.json calls itself, with no approval and no warning:
 *   someone who can write files into the repository can already edit
 *   vite.config.ts or package.json scripts, which every build runs.
 * - A package inside `node_modules` is a dependency and keeps PEP-055's gate:
 *   `@typesugar/*` (and `typesugar`) are trusted, anything else needs
 *   `security.allowedMacroPackages` (`typesugar approve-macros`). Its name is
 *   the one Node resolution gives from the importing file's location, and a
 *   relative path into `node_modules` counts as a bare import of that package.
 * - Files inside `node_modules` are never scanned, so a dependency's own
 *   imports never load macros.
 *
 * Reviews 6 and 7 (sec1, secB-secF) ran a vendored directory's macros by
 * having it claim an `@typesugar/*` name or reach a copy in its own
 * node_modules. Those directories are inside the project tree, so they are
 * now project code; "the reviewers' fixtures" below assert what each one
 * does now. A relative import still cannot make a directory pass as a
 * trusted `@typesugar/*` DEPENDENCY: a project directory loads as project
 * code, never under its claimed name (so it cannot stand in for the real
 * package), and a directory inside node_modules is judged by the name its
 * node_modules path gives it.
 *
 * Each project is a real on-disk directory; the program is built from its
 * tsconfig the way `typesugar check` builds it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as ts from "typescript";
import { config, globalRegistry } from "@typesugar/core";
import {
  loadMacroPackages,
  loadMacroPackagesFromFile,
  resetLoadedPackages,
  scanMacroPackages,
  UnapprovedMacroPackagesError,
} from "../src/macro-loader.js";
import { readTsConfig } from "../src/tsconfig-utils.js";
import { runApproveMacros } from "../src/approve-macros.js";
import {
  TransformationPipeline,
  createPipeline,
  macroTransformerFactory,
} from "../src/pipeline.js";
import { emitDeclarations } from "../src/declarations.js";
import tsPatchEntry from "../src/index.js";

let root: string;
let originalCwd: string;

/** A macros entry that writes a marker file `name` next to itself when it runs. */
const markerJs = (name: string) =>
  `require("fs").writeFileSync(require("path").join(__dirname, ${JSON.stringify(name)}), "ran");\n` +
  `module.exports = { __typesugar_macros__: [] };\n`;
const PWNED_JS = markerJs("PWNED");
const RAN_JS = markerJs("RAN");

/** A macros entry registering one expression macro named `name` for module `pkg`. */
const macrosJs = (pkg: string, name: string) =>
  `module.exports.__typesugar_macros__ = [{ kind: "expression", name: ${JSON.stringify(name)}, ` +
  `module: ${JSON.stringify(pkg)}, description: "fixture", expand: (_ctx, call) => call }];\n`;

function write(rel: string, content: string | object): string {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
}

function link(at: string, name: string, targetRel: string): void {
  const linkPath = path.join(root, at, "node_modules", ...name.split("/"));
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(path.join(root, targetRel), linkPath, "dir");
}

const TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "Bundler",
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  },
  include: ["src"],
};

/** A tsconfig that can emit (declarations, outDir). */
const EMITTING_TSCONFIG = {
  ...TSCONFIG,
  compilerOptions: {
    ...TSCONFIG.compilerOptions,
    noEmit: false,
    declaration: true,
    outDir: "dist",
  },
};

/** Every marker file named `name` under the project, relative to it. */
function markers(name: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && !e.isSymbolicLink()) walk(p);
      else if (e.name === name) out.push(path.relative(root, p));
    }
  };
  walk(root);
  return out.sort();
}
const pwned = () => markers("PWNED");
const ran = () => markers("RAN");

/** A package directory at `dirRel` whose macros entry (`./macros.cjs`) is `macros`. */
function macroPackage(dirRel: string, pkg: string, macros: string): void {
  write(`${dirRel}/package.json`, {
    name: pkg,
    version: "1.0.0",
    typesugar: { macros: "./macros.cjs" },
    exports: {
      ".": "./index.js",
      "./macros.cjs": "./macros.cjs",
      "./package.json": "./package.json",
    },
  });
  write(`${dirRel}/index.js`, `export const y = 1;\n`);
  write(`${dirRel}/index.d.ts`, `export declare const y: number;\n`);
  write(`${dirRel}/macros.cjs`, macros);
}

/**
 * Load macros for the project at `projectRel` the way the transformer factory
 * does: the program from its tsconfig, `loadMacroPackages` once, then
 * `loadMacroPackagesFromFile` for each file. Returns the per-file warnings and
 * the error thrown, if any.
 */
function check(projectRel = "."): { warnings: string[]; error?: Error } {
  const dir = path.join(root, projectRel);
  process.chdir(dir);
  const parsed = readTsConfig(path.join(dir, "tsconfig.json"));
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const warnings: string[] = [];
  let error: Error | undefined;
  try {
    loadMacroPackages(program);
    for (const sf of program.getSourceFiles()) {
      for (const w of loadMacroPackagesFromFile(sf)) warnings.push(w.message);
    }
  } catch (e) {
    error = e as Error;
  }
  return error ? { warnings, error } : { warnings };
}

/** What approve-macros would list for the project at `projectRel`. */
function scan(projectRel = "."): string[] {
  const parsed = readTsConfig(path.join(root, projectRel, "tsconfig.json"));
  return scanMacroPackages(ts.createProgram(parsed.fileNames, parsed.options)).blocked;
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-trust-")));
  originalCwd = process.cwd();
  resetLoadedPackages();
  config.reset();
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  resetLoadedPackages();
  config.reset();
  fs.rmSync(root, { recursive: true, force: true });
});

function appProject(useTs: string): void {
  write("package.json", { name: "app", version: "1.0.0", type: "module" });
  write("tsconfig.json", TSCONFIG);
  write("src/use.ts", useTs);
}

const registered = (pkg: string, name: string) =>
  globalRegistry.getByModuleExport(pkg, name, "expression")?.module;

describe("the project tree is trusted", () => {
  it("a vendored package with any name loads, with no approval and no warning", () => {
    appProject(`import { y } from "../vendor/acme/index.js";\nexport const h = y;\n`);
    macroPackage("vendor/acme", "acme-vendored-macros", RAN_JS);
    expect(check()).toEqual({ warnings: [] });
    expect(ran()).toEqual(["vendor/acme/RAN"]);
    expect(scan()).toEqual([]);
  });

  it("a nested project that is not a workspace package loads its macros", () => {
    write("package.json", { name: "monorepo", private: true, workspaces: ["packages/*"] });
    write("tsconfig.json", { ...TSCONFIG, include: ["packages/app/src"] });
    write("packages/app/package.json", { name: "app", version: "1.0.0" });
    write(
      "packages/app/src/a.ts",
      `import { genMacro } from "../../../tools/gen/index.js";\nexport const v = genMacro();\n`
    );
    // tools/gen: a project of its own (package.json, tsconfig), declared nowhere.
    write("tools/gen/tsconfig.json", TSCONFIG);
    macroPackage("tools/gen", "@acme/gen", macrosJs("@acme/gen", "genMacro"));
    write("tools/gen/index.d.ts", `export declare function genMacro(): number;\n`);
    expect(check()).toEqual({ warnings: [] });
    expect(registered("@acme/gen", "genMacro")).toBe("@acme/gen");
  });

  it("a package's own example importing ../src loads (the mapper showcase)", () => {
    write("my-macros/package.json", {
      name: "@typesugar/fixture-own",
      version: "1.0.0",
      exports: { ".": "./src/index.js", "./macros": "./macros.js" },
      typesugar: { macros: "./macros" },
    });
    write("my-macros/src/index.ts", `export declare function ownMacro(): number;\n`);
    write("my-macros/macros.js", macrosJs("@typesugar/fixture-own", "ownMacro"));
    write("my-macros/tsconfig.json", { ...TSCONFIG, include: ["examples"] });
    write(
      "my-macros/examples/use.ts",
      `import { ownMacro } from "../src/index.js";\nexport const v = ownMacro();\n`
    );
    expect(check("my-macros")).toEqual({ warnings: [] });
    expect(registered("@typesugar/fixture-own", "ownMacro")).toBe("@typesugar/fixture-own");
  });

  it("a re-export (`export … from`) of a vendored package loads it too", () => {
    appProject(`export { y } from "../vendor/acme/index.js";\n`);
    macroPackage("vendor/acme", "acme-reexported", RAN_JS);
    expect(check()).toEqual({ warnings: [] });
    expect(ran()).toEqual(["vendor/acme/RAN"]);
  });

  it("a project directory claiming a dependency's name does not stand in for it", () => {
    // vendor/fake says it is @typesugar/fixture-genuine. It is project code,
    // so it runs, keyed by its real path: the real package (a dependency)
    // still loads under its name.
    const pkg = "@typesugar/fixture-genuine";
    macroPackage("node_modules/@typesugar/fixture-genuine", pkg, macrosJs(pkg, "genuineMacro"));
    macroPackage("vendor/fake", pkg, RAN_JS);
    appProject(
      `import { y as a } from "../vendor/fake/index.js";\n` +
        `import { y as b } from "${pkg}";\nexport const h = a + b;\n`
    );
    expect(check()).toEqual({ warnings: [] });
    expect(ran()).toEqual(["vendor/fake/RAN"]);
    expect(registered(pkg, "genuineMacro")).toBe(pkg);
  });

  it("a workspace sibling imported by a relative path needs no approval; imported by its name it does", () => {
    // The relative import reaches project code; the bare import is a
    // dependency, and PEP-055's gate is about the name a bare import uses.
    write("package.json", { name: "monorepo", private: true, workspaces: ["packages/*"] });
    write("tsconfig.json", { ...TSCONFIG, include: ["packages/app/src"] });
    macroPackage("packages/sib", "sib-macros", RAN_JS);
    link(".", "sib-macros", "packages/sib");
    write(
      "packages/app/src/a.ts",
      `import { y } from "../../sib/index.js";\nexport const v = y;\n`
    );
    expect(check()).toEqual({ warnings: [] });
    expect(ran()).toEqual(["packages/sib/RAN"]);

    write("packages/app/src/a.ts", `import { y } from "sib-macros";\nexport const v = y;\n`);
    resetLoadedPackages();
    expect(check().error).toBeInstanceOf(UnapprovedMacroPackagesError);
    expect(scan()).toEqual(["sib-macros"]);
  });
});

describe("packages inside node_modules keep PEP-055's gate", () => {
  it("an unapproved non-@typesugar dependency fails the build, and approve-macros lists it", async () => {
    appProject(`import { y } from "evil-dep";\nexport const h = y;\n`);
    macroPackage("node_modules/evil-dep", "evil-dep", PWNED_JS);

    const { error } = check();
    expect(error).toBeInstanceOf(UnapprovedMacroPackagesError);
    expect(error?.message).toContain("evil-dep");
    expect(pwned()).toEqual([]);
    expect(scan()).toEqual(["evil-dep"]);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m) => void logs.push(String(m)));
    await runApproveMacros({ project: "tsconfig.json", yes: true, verbose: false });
    expect(logs.join("\n")).toMatch(/not yet approved[\s\S]*evil-dep/);
    expect(fs.readFileSync(path.join(root, "typesugar.config.ts"), "utf-8")).toContain("evil-dep");
    expect(pwned()).toEqual([]);
  });

  it("an approved one loads", () => {
    appProject(`import { y } from "ok-dep";\nexport const h = y;\n`);
    macroPackage("node_modules/ok-dep", "ok-dep", RAN_JS);
    config.set({ security: { allowedMacroPackages: ["ok-dep"] } });
    expect(check()).toEqual({ warnings: [] });
    expect(ran()).toEqual(["node_modules/ok-dep/RAN"]);
  });

  it("a relative import into node_modules is gated like a bare import of that package", () => {
    appProject(`import { y } from "../node_modules/evil-rel/index.js";\nexport const h = y;\n`);
    macroPackage("node_modules/evil-rel", "evil-rel", PWNED_JS);
    const { error } = check();
    expect(error).toBeInstanceOf(UnapprovedMacroPackagesError);
    expect(error?.message).toContain("evil-rel");
    expect(pwned()).toEqual([]);
    expect(scan()).toEqual(["evil-rel"]);
  });

  it("...by the name its node_modules path gives it, not the name its package.json claims", () => {
    appProject(`import { y } from "../node_modules/evil-rel/index.js";\nexport const h = y;\n`);
    macroPackage("node_modules/evil-rel", "@typesugar/totally-official", PWNED_JS);
    expect(check().error?.message).toContain("evil-rel");
    expect(pwned()).toEqual([]);
    expect(scan()).toEqual(["evil-rel"]);
  });

  it("...including a deep path into pnpm's store", () => {
    const store = "node_modules/.pnpm/evil-pnpm@1.0.0/node_modules/evil-pnpm";
    appProject(`import { y } from "../${store}/index.js";\nexport const h = y;\n`);
    macroPackage(store, "evil-pnpm", PWNED_JS);
    expect(check().error?.message).toContain("evil-pnpm");
    expect(pwned()).toEqual([]);
  });

  it("a relative import into node_modules of an @typesugar/* package loads it", () => {
    appProject(
      `import { y } from "../node_modules/@typesugar/rel-ok/index.js";\nexport const h = y;\n`
    );
    macroPackage("node_modules/@typesugar/rel-ok", "@typesugar/rel-ok", RAN_JS);
    expect(check()).toEqual({ warnings: [] });
    expect(ran()).toEqual(["node_modules/@typesugar/rel-ok/RAN"]);
  });

  it("a node_modules symlink to a project directory is project code (decided by real path)", () => {
    appProject(`import { y } from "../node_modules/linked/index.js";\nexport const h = y;\n`);
    macroPackage("libs/linked", "linked", RAN_JS);
    link(".", "linked", "libs/linked");
    expect(check()).toEqual({ warnings: [] });
    expect(ran()).toEqual(["libs/linked/RAN"]);
  });

  it("pnpm: a workspace package's own node_modules resolves its dependencies", () => {
    write("package.json", { name: "monorepo", private: true });
    write("pnpm-workspace.yaml", `packages:\n  - "packages/*"\n`);
    write("tsconfig.json", { ...TSCONFIG, include: ["packages/*/src"] });
    write("packages/lib/package.json", {
      name: "@typesugar/fixture-pnpm",
      version: "1.0.0",
      exports: { ".": "./src/index.js", "./macros": "./macros.js" },
      typesugar: { macros: "./macros" },
    });
    write("packages/lib/src/index.ts", `export declare function pnpmMacro(): number;\n`);
    write("packages/lib/src/index.js", `export {};\n`);
    write("packages/lib/macros.js", macrosJs("@typesugar/fixture-pnpm", "pnpmMacro"));
    write("packages/app/package.json", { name: "app", version: "1.0.0" });
    write(
      "packages/app/src/a.ts",
      `import { pnpmMacro } from "@typesugar/fixture-pnpm";\nexport const v = pnpmMacro();\n`
    );
    // pnpm's strict layout: only the depending package links it.
    link("packages/app", "@typesugar/fixture-pnpm", "packages/lib");
    expect(check()).toEqual({ warnings: [] });
    expect(registered("@typesugar/fixture-pnpm", "pnpmMacro")).toBe("@typesugar/fixture-pnpm");
  });

  it("a dependency's own files are never scanned, so its imports load nothing", () => {
    // The project imports a file inside node_modules (so it is in the
    // program), and that file imports an unapproved macro package.
    appProject(`import { z } from "../node_modules/plain-dep/index.js";\nexport const h = z;\n`);
    write("node_modules/plain-dep/package.json", { name: "plain-dep", version: "1.0.0" });
    write(
      "node_modules/plain-dep/index.ts",
      `import { y } from "evil-dep";\nexport const z = y;\n`
    );
    macroPackage("node_modules/evil-dep", "evil-dep", PWNED_JS);
    const parsed = readTsConfig(path.join(root, "tsconfig.json"));
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    expect(program.getSourceFile(path.join(root, "node_modules/plain-dep/index.ts"))).toBeDefined();
    expect(check()).toEqual({ warnings: [] });
    expect(scan()).toEqual([]);
    expect(pwned()).toEqual([]);
  });
});

/**
 * The reviewers' fixtures (scratchpad review6/ and review7/), under the new
 * model. Each attacked the owned-roots rules from a directory inside the
 * project tree, which is now project code.
 */
describe("the reviewers' fixtures", () => {
  function vendored(indexTs: string): void {
    appProject(`import { helper } from "../vendor/evil/index.js";\nexport const h = helper;\n`);
    write("vendor/evil/package.json", { name: "evil", version: "1.0.0", type: "module" });
    write("vendor/evil/index.ts", indexTs);
  }

  it("sec1: a vendored package claiming @typesugar/* (via an inner package.json) is project code: it runs", () => {
    appProject(`import { helper } from "../vendor/evil/index.js";\nexport const h = helper;\n`);
    write("vendor/evil/package.json", {
      name: "@typesugar/totally-official",
      version: "1.0.0",
      exports: { ".": "./index.js", "./package.json": "./inner/package.json" },
    });
    write("vendor/evil/index.ts", `import { x } from "./inner/x.js";\nexport const helper = x;\n`);
    write("vendor/evil/inner/package.json", {
      name: "@typesugar/totally-official",
      version: "1.0.0",
      typesugar: { macros: "./macros.cjs" },
      exports: { "./macros.cjs": "./macros.cjs", ".": "./x.js" },
    });
    write("vendor/evil/inner/x.ts", `export const x = 1;\n`);
    write("vendor/evil/inner/macros.cjs", RAN_JS);
    expect(check()).toEqual({ warnings: [] });
    expect(ran()).toEqual(["vendor/evil/inner/RAN"]);
  });

  it("secB: a relative import into a vendored node_modules/@typesugar/x is judged as @typesugar/x: trusted", () => {
    vendored(
      `import { y } from "./node_modules/@typesugar/x/index.js";\nexport const helper = y;\n`
    );
    macroPackage("vendor/evil/node_modules/@typesugar/x", "@typesugar/x", RAN_JS);
    expect(check()).toEqual({ warnings: [] });
    expect(ran()).toEqual(["vendor/evil/node_modules/@typesugar/x/RAN"]);
  });

  it("secC/secE: a vendored file's bare @typesugar/x resolves (Node) from that file: trusted", () => {
    vendored(`import { y } from "@typesugar/x";\nexport const helper = y;\n`);
    macroPackage("vendor/evil/node_modules/@typesugar/x", "@typesugar/x", RAN_JS);
    expect(check()).toEqual({ warnings: [] });
    expect(ran()).toEqual(["vendor/evil/node_modules/@typesugar/x/RAN"]);
  });

  it("secD: a vendored file's bare non-@typesugar dependency fails the build; approve-macros lists it", () => {
    vendored(`import { y } from "evil-macros";\nexport const helper = y;\n`);
    macroPackage("vendor/evil/node_modules/evil-macros", "evil-macros", PWNED_JS);
    const { error } = check();
    expect(error).toBeInstanceOf(UnapprovedMacroPackagesError);
    expect(error?.message).toContain("evil-macros");
    expect(scan()).toEqual(["evil-macros"]);
    expect(pwned()).toEqual([]);
  });

  it("secF: the vendored directory's own tsconfig (the editor's project for it) sees the same", () => {
    vendored(`import { y } from "@typesugar/x";\nexport const helper = y;\n`);
    write("vendor/evil/tsconfig.json", { ...TSCONFIG, include: ["*.ts"] });
    macroPackage("vendor/evil/node_modules/@typesugar/x", "@typesugar/x", RAN_JS);
    expect(check("vendor/evil")).toEqual({ warnings: [] });
    expect(ran()).toEqual(["vendor/evil/node_modules/@typesugar/x/RAN"]);
  });
});

describe("config is read from the tsconfig's directory, walking up to the repository root", () => {
  function monorepo(): void {
    fs.mkdirSync(path.join(root, ".git"));
    write("package.json", { name: "monorepo", private: true });
    write(".typesugarrc.json", { contracts: { mode: "full" } });
    write("packages/app/package.json", { name: "app", version: "1.0.0" });
    write("packages/app/tsconfig.json", EMITTING_TSCONFIG);
    write("packages/app/src/a.ts", `export const v = 1;\n`);
    write("packages/app/.typesugarrc.json", { contracts: { mode: "none" } });
    process.chdir(root);
  }
  const appConfig = () => path.join(root, "packages/app/.typesugarrc.json");

  it("tspc -p packages/app from the repository root (the ts-patch entry)", () => {
    monorepo();
    const parsed = ts.getParsedCommandLineOfConfigFile(
      path.join(root, "packages/app/tsconfig.json"),
      {},
      { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} }
    )!;
    tsPatchEntry(ts.createProgram(parsed.fileNames, parsed.options), { cacheDir: false });
    expect(config.getConfigFilePath()).toBe(appConfig());
  });

  it("createPipeline (unplugin, the Node loader, ESLint) from the repository root", () => {
    monorepo();
    createPipeline(path.join(root, "packages/app/tsconfig.json"), { cacheDir: false });
    expect(config.getConfigFilePath()).toBe(appConfig());
  });

  it("emitDeclarations from the repository root", () => {
    monorepo();
    emitDeclarations({ project: "packages/app/tsconfig.json" });
    expect(config.getConfigFilePath()).toBe(appConfig());
  });

  it("approve-macros -p packages/app/tsconfig.json from the repository root", async () => {
    monorepo();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runApproveMacros({ project: "packages/app/tsconfig.json", yes: true, verbose: false });
    expect(config.getConfigFilePath()).toBe(appConfig());
  });

  it("the nearest config wins, and the walk stops at the repository root", () => {
    monorepo();
    fs.rmSync(appConfig());
    config.load({ searchFrom: path.join(root, "packages/app") });
    expect(config.getConfigFilePath()).toBe(path.join(root, ".typesugarrc.json"));
    fs.rmSync(path.join(root, ".typesugarrc.json"));
    config.load({ searchFrom: path.join(root, "packages/app") });
    expect(config.getConfigFilePath()).toBeUndefined();
  });

  it("a vendored directory's own config is project code: a host starting there reads it", () => {
    monorepo();
    write("vendor/x/tsconfig.json", TSCONFIG);
    write("vendor/x/.typesugarrc.json", { contracts: { mode: "assertions" } });
    config.load({ searchFrom: path.join(root, "vendor/x") });
    expect(config.getConfigFilePath()).toBe(path.join(root, "vendor/x/.typesugarrc.json"));
  });
});

/**
 * Every host goes through the same discovery: the transformer factory (which
 * `check`, `build`, `watch`, `expand`, `doctor` and the declarations emit
 * build on), the ts-patch entry, the TransformationPipeline (the language
 * service, unplugin, the Node loader, ESLint) and approve-macros' scan. One
 * fixture: a vendored macro package (project code: runs) and an unapproved
 * dependency (refused, by name).
 */
describe("every host uses the same discovery", () => {
  function fixture(): void {
    write("package.json", { name: "app", version: "1.0.0", type: "module" });
    write("tsconfig.json", EMITTING_TSCONFIG);
    write(
      "src/use.ts",
      `import { y as a } from "../vendor/acme/index.js";\nimport { y as b } from "evil-dep";\n` +
        `export const h = a + b;\n`
    );
    macroPackage("vendor/acme", "acme-vendored", RAN_JS);
    macroPackage("node_modules/evil-dep", "evil-dep", PWNED_JS);
    process.chdir(root);
  }
  const parsed = () =>
    ts.getParsedCommandLineOfConfigFile(
      path.join(root, "tsconfig.json"),
      {},
      { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} }
    )!;
  /** What `host` threw or reported, as text. */
  const outcome = (host: () => string | void): string => {
    try {
      return host() ?? "";
    } catch (e) {
      return String(e);
    }
  };

  const hosts: Array<[string, () => string | void]> = [
    [
      "the transformer factory (check, build, watch, expand, doctor)",
      () => {
        const p = parsed();
        const program = ts.createProgram(p.fileNames, p.options);
        const factory = macroTransformerFactory(program, { cacheDir: false });
        for (const sf of program.getSourceFiles()) {
          if (!sf.isDeclarationFile) ts.transform(sf, [factory]).dispose();
        }
      },
    ],
    [
      "the ts-patch entry (tspc)",
      () => {
        const p = parsed();
        tsPatchEntry(ts.createProgram(p.fileNames, p.options), { cacheDir: false });
      },
    ],
    [
      "TransformationPipeline (language service, unplugin, Node loader, ESLint)",
      () => {
        const p = parsed();
        const pipeline = new TransformationPipeline(p.options, p.fileNames, { cacheDir: false });
        return p.fileNames
          .flatMap((f) => pipeline.transform(f).diagnostics.map((d) => d.message))
          .join("\n");
      },
    ],
    ["emitDeclarations", () => void emitDeclarations({ project: "tsconfig.json" })],
    [
      "approve-macros' scan",
      () => {
        const p = parsed();
        const { blocked } = scanMacroPackages(ts.createProgram(p.fileNames, p.options));
        return `blocked: ${blocked.join(", ")}`;
      },
    ],
  ];

  it.each(hosts)("%s", (name, host) => {
    fixture();
    const out = outcome(host);
    expect(out).toContain("evil-dep");
    expect(out).not.toContain("acme-vendored");
    expect(pwned()).toEqual([]);
    // A scan loads nothing; every other host has run the vendored package.
    expect(ran()).toEqual(name.startsWith("approve") ? [] : ["vendor/acme/RAN"]);
  });
});

/**
 * Review 8: a vendored package's macros entry is the vendored package's own
 * file. `${name}/macros` resolved BY NAME from the vendored package.json
 * found the npm copy of the same name in the project's node_modules
 * (Node's self-reference needs an `exports` map), which then ran unapproved.
 */
describe("a vendored package's macros entry is its own file", () => {
  it("a vendored fork with the same name as an npm package runs its own macros, not the npm copy's", () => {
    appProject(`import { x } from "../vendor/cool-macros/src/index.js";\nexport const h = x;\n`);
    write("vendor/cool-macros/package.json", {
      name: "cool-macros",
      version: "1.0.0",
      typesugar: { macros: "./macros" },
    });
    write("vendor/cool-macros/macros.js", RAN_JS);
    write("vendor/cool-macros/src/index.ts", `export const x = 1;\n`);
    write("node_modules/cool-macros/package.json", {
      name: "cool-macros",
      version: "9.9.9",
      typesugar: { macros: "./macros" },
    });
    write("node_modules/cool-macros/macros.js", PWNED_JS);
    expect(check()).toEqual({ warnings: [] });
    expect(ran()).toEqual(["vendor/cool-macros/RAN"]);
    expect(pwned()).toEqual([]);
    expect(scan()).toEqual([]);
  });

  it("an entry that resolves outside the package (a symlink out of it) is refused, with a warning", () => {
    appProject(`import { x } from "../vendor/acme/src/index.js";\nexport const h = x;\n`);
    write("vendor/acme/package.json", {
      name: "acme",
      version: "1.0.0",
      typesugar: { macros: "./macros" },
    });
    write("vendor/acme/src/index.ts", `export const x = 1;\n`);
    write("node_modules/evil-dep/macros.js", PWNED_JS);
    fs.symlinkSync(
      path.join(root, "node_modules/evil-dep/macros.js"),
      path.join(root, "vendor/acme/macros.js")
    );
    const { warnings, error } = check();
    expect(error).toBeUndefined();
    expect(warnings.join("\n")).toMatch(/acme[\s\S]*outside/);
    expect(pwned()).toEqual([]);
  });

  it("a bare (cross-package) entry names a dependency, which keeps the approval gate", () => {
    appProject(`import { x } from "../vendor/facade/src/index.js";\nexport const h = x;\n`);
    write("vendor/facade/package.json", {
      name: "facade",
      version: "1.0.0",
      typesugar: { macros: "evil-dep" },
    });
    write("vendor/facade/src/index.ts", `export const x = 1;\n`);
    macroPackage("node_modules/evil-dep", "evil-dep", PWNED_JS);
    const { error } = check();
    expect(error).toBeInstanceOf(UnapprovedMacroPackagesError);
    expect(error?.message).toContain("evil-dep");
    expect(scan()).toEqual(["evil-dep"]);
    expect(pwned()).toEqual([]);
  });
});

/**
 * Review 8: a dependency's own config is never read. tsserver gives a file
 * inside `node_modules/evil` the project `node_modules/evil/tsconfig.json`,
 * and every host searches for config from the tsconfig's directory -- which
 * ran `node_modules/evil/typesugar.config.cjs`, and let evil's package.json
 * `typesugar.security` block approve evil's own macros.
 */
describe("config inside node_modules is never read", () => {
  /** `node_modules/evil`: a dependency with its own tsconfig and the given config. */
  function evilDependency(how: "config file" | "package.json block"): void {
    write("package.json", { name: "app", version: "1.0.0" });
    write("tsconfig.json", TSCONFIG);
    write("src/use.ts", `import { y } from "evil";\nexport const h = y;\n`);
    macroPackage("node_modules/evil", "evil", PWNED_JS);
    write("node_modules/evil/tsconfig.json", { ...TSCONFIG, include: ["*.ts"] });
    write("node_modules/evil/index.ts", `export const y = 1;\n`);
    if (how === "config file") {
      write(
        "node_modules/evil/typesugar.config.cjs",
        // Runs (writes PWNED) if loaded, then approves evil.
        PWNED_JS + `module.exports = { security: { allowedMacroPackages: ["evil"] } };\n`
      );
    } else {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(root, "node_modules/evil/package.json"), "utf-8")
      );
      pkg.typesugar.security = { allowedMacroPackages: ["evil"] };
      write("node_modules/evil/package.json", pkg);
    }
    process.chdir(root);
  }
  const evilDir = () => path.join(root, "node_modules/evil");
  const approved = () => config.get<string[]>("security.allowedMacroPackages") ?? [];

  it.each(["config file", "package.json block"] as const)(
    "searching from a dependency's directory skips its %s and finds the project's config",
    (how) => {
      evilDependency(how);
      write(".typesugarrc.json", { contracts: { mode: "none" } });
      config.load({ searchFrom: evilDir() });
      expect(pwned()).toEqual([]);
      expect(approved()).not.toContain("evil");
      expect(config.getConfigFilePath()).toBe(path.join(root, ".typesugarrc.json"));
    }
  );

  it.each(["config file", "package.json block"] as const)(
    "a host built from the dependency's tsconfig doesn't read its %s, and the project still gates evil",
    (how) => {
      evilDependency(how);
      createPipeline(path.join(evilDir(), "tsconfig.json"), { cacheDir: false });
      const p = ts.getParsedCommandLineOfConfigFile(
        path.join(evilDir(), "tsconfig.json"),
        {},
        { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} }
      )!;
      tsPatchEntry(ts.createProgram(p.fileNames, p.options), { cacheDir: false });
      expect(pwned()).toEqual([]);
      expect(approved()).not.toContain("evil");
      expect(check().error?.message).toContain("evil");
      expect(pwned()).toEqual([]);
    }
  );
});

/**
 * Review 8: config was one per process, so a host serving two projects (the
 * editor with two tsconfigs open, the Node loader across packages) applied
 * whichever project loaded last to both. Each pipeline keeps its own.
 */
describe("each project's pipeline keeps its own config", () => {
  it("two projects with different approvals don't bleed into each other", () => {
    for (const name of ["a", "b"]) {
      write(`${name}/package.json`, { name, version: "1.0.0" });
      write(`${name}/tsconfig.json`, TSCONFIG);
      write(`${name}/src/use.ts`, `import { y } from "acme-dep";\nexport const h = y;\n`);
      macroPackage(`${name}/node_modules/acme-dep`, "acme-dep", RAN_JS);
    }
    write("a/.typesugarrc.json", { security: { allowedMacroPackages: ["acme-dep"] } });
    write("b/.typesugarrc.json", { contracts: { mode: "none" } });
    const a = createPipeline(path.join(root, "a/tsconfig.json"), { cacheDir: false });
    const b = createPipeline(path.join(root, "b/tsconfig.json"), { cacheDir: false });
    const messages = (p: TransformationPipeline, dir: string) =>
      p
        .transform(path.join(root, dir, "src/use.ts"))
        .diagnostics.map((d) => d.message)
        .join("\n");

    // b was loaded last; a still sees its own approval...
    expect(messages(a, "a")).not.toContain("acme-dep");
    expect(ran()).toEqual(["a/node_modules/acme-dep/RAN"]);
    // ...and b still doesn't, though a just ran.
    expect(messages(b, "b")).toContain("acme-dep");
    expect(ran()).toEqual(["a/node_modules/acme-dep/RAN"]);
  });
});
