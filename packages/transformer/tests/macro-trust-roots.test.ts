/**
 * A macro package's identity is established only by resolving its bare name
 * from directories the PROJECT owns (the tsconfig's directory or its files', the build's
 * cwd, the package root above each, and the workspace packages those
 * declare) -- never from a directory reached by following imports into
 * vendored code, and never through the package's own `exports`
 * self-reference.
 *
 * Review 6 ran an attacker's macros during `typesugar check` four ways
 * (sec1, secB, secC, secD below); each test asserts the macro module's
 * marker file is never written. The legitimate layouts (normal and pnpm
 * workspace dependencies, a package's own examples importing ../src, a
 * declared workspace sibling) keep loading.
 *
 * Each project is a real on-disk directory; the program is built from its
 * tsconfig the way `typesugar check` builds it, and loaded the way the
 * transformer factory loads it (program scan, then every file).
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
} from "../src/macro-loader.js";
import { readTsConfig } from "../src/tsconfig-utils.js";
import { runApproveMacros } from "../src/approve-macros.js";

let root: string;
let originalCwd: string;

/** A macros entry whose only effect is to write a marker file next to itself. */
const PWNED_JS =
  `require("fs").writeFileSync(require("path").join(__dirname, "PWNED"), "executed");\n` +
  `module.exports = { __typesugar_macros__: [] };\n`;

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

/** Every PWNED marker under the project. */
function pwned(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && !e.isSymbolicLink()) walk(p);
      else if (e.name === "PWNED") out.push(p);
    }
  };
  walk(root);
  return out;
}

/**
 * Load macros for the project at `projectRel` the way `typesugar check` does:
 * the program from its tsconfig, `loadMacroPackages` once, then
 * `loadMacroPackagesFromFile` for each file. Returns the per-file warnings
 * and the error `loadMacroPackages` threw, if any.
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
      for (const w of loadMacroPackagesFromFile(sf, false, program)) warnings.push(w.message);
    }
  } catch (e) {
    error = e as Error;
  }
  return { warnings, error };
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

describe("review 6: a vendored package cannot establish its own name", () => {
  it("sec1: not through its own exports self-reference to an inner package", () => {
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
    write("vendor/evil/inner/macros.cjs", PWNED_JS);

    const { warnings, error } = check();

    expect(pwned()).toEqual([]);
    expect(error).toBeUndefined();
    expect(warnings.join("\n")).toContain(path.join(root, "vendor/evil/inner"));
    expect(warnings.join("\n")).toMatch(/totally-official.*not loaded/s);
  });

  it("secB: not through a copy in its own node_modules reached by a relative import", () => {
    appProject(`import { helper } from "../vendor/evil/index.js";\nexport const h = helper;\n`);
    write("vendor/evil/package.json", { name: "evil", version: "1.0.0", type: "module" });
    write(
      "vendor/evil/index.ts",
      `import { y } from "./node_modules/@typesugar/x/index.js";\nexport const helper = y;\n`
    );
    write("vendor/evil/node_modules/@typesugar/x/package.json", {
      name: "@typesugar/x",
      version: "1.0.0",
      typesugar: { macros: "./macros.cjs" },
      exports: { ".": "./index.js", "./macros.cjs": "./macros.cjs" },
    });
    write("vendor/evil/node_modules/@typesugar/x/index.js", `export const y = 1;\n`);
    write("vendor/evil/node_modules/@typesugar/x/index.d.ts", `export declare const y: number;\n`);
    write("vendor/evil/node_modules/@typesugar/x/macros.cjs", PWNED_JS);

    const { warnings, error } = check();

    expect(pwned()).toEqual([]);
    expect(error).toBeUndefined();
    expect(warnings.join("\n")).toContain(path.join(root, "vendor/evil/node_modules/@typesugar/x"));
  });

  it("secC: a vendored file's bare import does not resolve from the vendored directory", () => {
    appProject(`import { helper } from "../vendor/evil/index.js";\nexport const h = helper;\n`);
    write("vendor/evil/package.json", { name: "evil", version: "1.0.0", type: "module" });
    write("vendor/evil/index.ts", `import { y } from "@typesugar/x";\nexport const helper = y;\n`);
    write("vendor/evil/node_modules/@typesugar/x/package.json", {
      name: "@typesugar/x",
      version: "1.0.0",
      typesugar: { macros: "./macros.cjs" },
      exports: { ".": "./index.js", "./macros.cjs": "./macros.cjs" },
    });
    write("vendor/evil/node_modules/@typesugar/x/index.js", `export const y = 1;\n`);
    write("vendor/evil/node_modules/@typesugar/x/index.d.ts", `export declare const y: number;\n`);
    write("vendor/evil/node_modules/@typesugar/x/macros.cjs", PWNED_JS);

    const { warnings, error } = check();

    expect(pwned()).toEqual([]);
    expect(error).toBeUndefined();
    const all = warnings.join("\n");
    expect(all).toContain(path.join(root, "vendor/evil/node_modules/@typesugar/x"));
    expect(all).toMatch(/'@typesugar\/x'.*not verified.*not loaded/s);
  });

  it("secD: approve-macros lists exactly what the build refuses (a vendored non-@typesugar package)", async () => {
    appProject(`import { helper } from "../vendor/evil/index.js";\nexport const h = helper;\n`);
    write("vendor/evil/package.json", { name: "evil", version: "1.0.0", type: "module" });
    write("vendor/evil/index.ts", `import { y } from "evil-macros";\nexport const helper = y;\n`);
    write("vendor/evil/node_modules/evil-macros/package.json", {
      name: "evil-macros",
      version: "1.0.0",
      typesugar: { macros: "./macros.cjs" },
      exports: { ".": "./index.js", "./macros.cjs": "./macros.cjs" },
    });
    write("vendor/evil/node_modules/evil-macros/index.js", `export const y = 1;\n`);
    write("vendor/evil/node_modules/evil-macros/index.d.ts", `export declare const y: number;\n`);
    write("vendor/evil/node_modules/evil-macros/macros.cjs", PWNED_JS);

    const { warnings, error } = check();
    expect(pwned()).toEqual([]);
    // Not "not approved" (approving the name could not make that copy the
    // project's): skipped with a warning naming the path.
    expect(error).toBeUndefined();
    expect(warnings.join("\n")).toContain(path.join(root, "vendor/evil/node_modules/evil-macros"));

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m) => void logs.push(String(m)));
    await runApproveMacros({ project: "tsconfig.json", yes: true, verbose: false });
    const out = logs.join("\n");
    expect(out).toMatch(/not approvable by name/);
    expect(out).toContain("evil-macros");
    expect(out).toContain(path.join(root, "vendor/evil/node_modules/evil-macros"));
    expect(fs.existsSync(path.join(root, "typesugar.config.ts"))).toBe(false);
    expect(pwned()).toEqual([]);
  });

  it("an unapproved package the project does resolve fails both the build and approve-macros alike", async () => {
    appProject(`import { y } from "ok-macros";\nexport const h = y;\n`);
    write("node_modules/ok-macros/package.json", {
      name: "ok-macros",
      version: "1.0.0",
      typesugar: { macros: "./macros.cjs" },
      exports: { ".": "./index.js", "./macros.cjs": "./macros.cjs" },
    });
    write("node_modules/ok-macros/index.js", `export const y = 1;\n`);
    write("node_modules/ok-macros/index.d.ts", `export declare const y: number;\n`);
    write("node_modules/ok-macros/macros.cjs", PWNED_JS);

    expect(check().error?.message).toMatch(/ok-macros/);
    const parsed = readTsConfig(path.join(root, "tsconfig.json"));
    const scan = scanMacroPackages(ts.createProgram(parsed.fileNames, parsed.options));
    expect(scan.blocked).toEqual(["ok-macros"]);
    expect(pwned()).toEqual([]);
  });

  it("a re-export (`export … from`) of a vendored package is warned about too", () => {
    appProject(`export { helper } from "../vendor/evil/index.js";\n`);
    write("vendor/evil/package.json", {
      name: "@typesugar/totally-official",
      typesugar: { macros: "./macros.cjs" },
    });
    write("vendor/evil/index.ts", `export const helper = 1;\n`);
    write("vendor/evil/macros.cjs", PWNED_JS);

    const file = path.join(root, "src/use.ts");
    process.chdir(root);
    const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf-8"), ts.ScriptTarget.Latest);
    const warnings = loadMacroPackagesFromFile(sf).map((w) => w.message);
    expect(pwned()).toEqual([]);
    expect(warnings.join("\n")).toContain(path.join(root, "vendor/evil"));
  });
});

describe("the project's own directories still establish identity", () => {
  /** A macro package at `dirRel` registering macro `name`. */
  function macroPackage(dirRel: string, pkg: string, name: string): void {
    write(`${dirRel}/package.json`, {
      name: pkg,
      version: "1.0.0",
      exports: {
        ".": "./src/index.js",
        "./macros": "./macros.js",
        "./package.json": "./package.json",
      },
      typesugar: { macros: "./macros" },
    });
    write(`${dirRel}/src/index.ts`, `export declare function ${name}(): number;\n`);
    write(`${dirRel}/src/index.js`, `export {};\n`);
    write(`${dirRel}/macros.js`, macrosJs(pkg, name));
  }
  const registered = (pkg: string, name: string) =>
    globalRegistry.getByModuleExport(pkg, name, "expression")?.module;

  it("a normal dependency in the project's node_modules", () => {
    macroPackage("node_modules/@typesugar/fixture-dep", "@typesugar/fixture-dep", "depMacro");
    appProject(
      `import { depMacro } from "@typesugar/fixture-dep";\nexport const v = depMacro();\n`
    );
    expect(check().warnings).toEqual([]);
    expect(registered("@typesugar/fixture-dep", "depMacro")).toBe("@typesugar/fixture-dep");
  });

  it("pnpm: a workspace package's own node_modules, building from the workspace root", () => {
    write("package.json", { name: "monorepo", private: true });
    write(
      "pnpm-workspace.yaml",
      `packages:\n  - "packages/*"\n  # comment\n  - '!packages/ignored'\n`
    );
    write("tsconfig.json", { ...TSCONFIG, include: ["packages/*/src"] });
    macroPackage("packages/lib", "@typesugar/fixture-pnpm", "pnpmMacro");
    write("packages/app/package.json", { name: "app", version: "1.0.0" });
    write(
      "packages/app/src/a.ts",
      `import { pnpmMacro } from "@typesugar/fixture-pnpm";\nexport const v = pnpmMacro();\n`
    );
    // pnpm's strict layout: only the depending package links it.
    link("packages/app", "@typesugar/fixture-pnpm", "packages/lib");
    const { warnings, error } = check();
    expect(error).toBeUndefined();
    expect(warnings).toEqual([]);
    expect(registered("@typesugar/fixture-pnpm", "pnpmMacro")).toBe("@typesugar/fixture-pnpm");
  });

  it("package.json `workspaces` declares workspace packages too", () => {
    write("package.json", {
      name: "monorepo",
      private: true,
      workspaces: { packages: ["libs/**"] },
    });
    write("tsconfig.json", { ...TSCONFIG, include: ["app/src"] });
    macroPackage("libs/deep/sibling", "@typesugar/fixture-ws", "wsMacro");
    write(
      "app/src/a.ts",
      `import { wsMacro } from "../../libs/deep/sibling/src/index.js";\nexport const v = wsMacro();\n`
    );
    const { warnings } = check();
    expect(warnings).toEqual([]);
    expect(registered("@typesugar/fixture-ws", "wsMacro")).toBe("@typesugar/fixture-ws");
  });

  it("a package's own example importing ../src, building inside the package", () => {
    macroPackage("my-macros", "@typesugar/fixture-own", "ownMacro");
    write("my-macros/tsconfig.json", { ...TSCONFIG, include: ["examples"] });
    write(
      "my-macros/examples/use.ts",
      `import { ownMacro } from "../src/index.js";\nexport const v = ownMacro();\n`
    );
    const { warnings } = check("my-macros");
    expect(warnings).toEqual([]);
    expect(registered("@typesugar/fixture-own", "ownMacro")).toBe("@typesugar/fixture-own");
  });

  it("a package's own example, with a generated tsconfig below the package (the examples check)", () => {
    macroPackage("my-macros", "@typesugar/fixture-gen", "genMacro");
    write("my-macros/.typesugar/check/tsconfig.json", {
      ...TSCONFIG,
      include: ["../../examples"],
    });
    write(
      "my-macros/examples/use.ts",
      `import { genMacro } from "../src/index.js";\nexport const v = genMacro();\n`
    );
    const { warnings } = check("my-macros/.typesugar/check");
    expect(warnings).toEqual([]);
    expect(registered("@typesugar/fixture-gen", "genMacro")).toBe("@typesugar/fixture-gen");
  });

  it("a relatively imported sibling linked as a file: dependency", () => {
    macroPackage("sibling", "@typesugar/fixture-file", "fileMacro");
    appProject(
      `import { fileMacro } from "../sibling/src/index.js";\nexport const v = fileMacro();\n`
    );
    link(".", "@typesugar/fixture-file", "sibling");
    const { warnings } = check();
    expect(warnings).toEqual([]);
    expect(registered("@typesugar/fixture-file", "fileMacro")).toBe("@typesugar/fixture-file");
  });

  it("an undeclared, unlinked sibling is not the project's", () => {
    macroPackage("sibling", "@typesugar/fixture-stray", "strayMacro");
    write("sibling/macros.js", PWNED_JS);
    appProject(
      `import { strayMacro } from "../sibling/src/index.js";\nexport const v = strayMacro();\n`
    );
    const { warnings } = check();
    expect(pwned()).toEqual([]);
    expect(warnings.join("\n")).toMatch(/does not resolve to that directory from the project/);
  });
});
