/**
 * `.d.ts` from the EXPANDED program (Turf case study, F5/F20).
 *
 * TypeScript's declaration emit runs the checker over the program it was
 * given. `typesugar build` used to hand it the unexpanded source, so an
 * exported function returning a fluent `match()` was declared `: any`, and
 * pattern-bound names (`.case({ kind: "circle", radius: r })`) were undeclared.
 * The declarations now come from the expanded program: `typesugar build` with
 * `declaration: true`, `typesugar build --emitDeclarationOnly`, and the
 * `emitDeclarations()` API.
 *
 * The CLI cases spawn the BUILT CLI (`pnpm --filter @typesugar/transformer build`).
 */

import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import { emitDeclarations } from "../src/declarations.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgRoot, "..", "..");
const cliPath = path.join(pkgRoot, "dist", "cli.js");
const hasBuild = fs.existsSync(cliPath);

/** A library using fluent match() with binding patterns, as in the pattern-matching guide. */
const LIBRARY = `import { match } from "@typesugar/std";

export type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "square"; side: number };

export function area(shape: Shape) {
  return match(shape)
    .case({ kind: "circle", radius: r })
    .then(Math.PI * r ** 2)
    .case({ kind: "square", side: s })
    .then(s ** 2);
}

export const label = (k: "a" | "b") => match(k).case("a").then("Alpha").case("b").then("Beta");
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function makeProject(compilerOptions: Record<string, unknown>, files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-dts-"));
  dirs.push(dir);
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        skipLibCheck: true,
        types: [],
        ...compilerOptions,
      },
      include: ["src"],
    })
  );
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "dts-fixture", private: true, type: "module" })
  );
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

function runCli(args: string[], cwd: string) {
  const r = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  return { status: r.status, output: (r.stdout ?? "") + (r.stderr ?? "") };
}

const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), "utf-8");

/** The declarations a person would write for LIBRARY. */
function expectLibraryDeclarations(dts: string): void {
  expect(dts).toContain("export declare function area(shape: Shape): number;");
  expect(dts).toContain('export declare const label: (k: "a" | "b") => "Alpha" | "Beta";');
  expect(dts).not.toMatch(/typesugar|FluentMatch|\bany\b/);
}

describe.skipIf(!hasBuild)("typesugar build: declarations from the expanded program", () => {
  it("declaration: true declares the expanded types, and still emits the JS", () => {
    const dir = makeProject({ declaration: true, outDir: "out" }, { "src/index.ts": LIBRARY });
    const { status, output } = runCli(["build", "-p", "tsconfig.json"], dir);
    expect(output).toBe("");
    expect(status).toBe(0);
    expectLibraryDeclarations(read(dir, "out/index.d.ts"));
    expect(read(dir, "out/index.js")).toContain('k === "a" ? "Alpha" : "Beta"');
  });

  it("--emitDeclarationOnly --declarationDir writes only .d.ts files there", () => {
    const dir = makeProject({ noEmit: true }, { "src/index.ts": LIBRARY });
    const { status, output } = runCli(
      ["build", "-p", "tsconfig.json", "--emitDeclarationOnly", "--declarationDir", "types"],
      dir
    );
    expect(output).toBe("");
    expect(status).toBe(0);
    expect(fs.readdirSync(path.join(dir, "types"))).toEqual(["index.d.ts"]);
    expectLibraryDeclarations(read(dir, "types/index.d.ts"));
  });

  it("--emitDeclarationOnly without an output directory is an error, not .d.ts beside the source", () => {
    const dir = makeProject({}, { "src/index.ts": LIBRARY });
    const { status, output } = runCli(["build", "--emitDeclarationOnly"], dir);
    expect(status).toBe(1);
    expect(output).toContain("--declarationDir");
    expect(fs.existsSync(path.join(dir, "src/index.d.ts"))).toBe(false);
  });

  it("declares the expanded types of a match: switch, and drops its activation import", () => {
    const dir = makeProject(
      { declaration: true, outDir: "out", allowUnusedLabels: false },
      {
        "src/index.ts": `import "@typesugar/std/syntax/match";
export type Geometry =
  | { type: "Point"; coordinates: number[] }
  | { type: "LineString"; coordinates: number[][] };
export function size(geom: Geometry) {
  match: switch (geom) {
    case { type: "Point", coordinates: [x, y] }:
      return x + y;
    case { type: "LineString", coordinates }:
      return coordinates.length;
  }
}
`,
      }
    );
    const { status, output } = runCli(["build"], dir);
    expect(output).toBe("");
    expect(status).toBe(0);
    expect(read(dir, "out/index.d.ts")).toContain(
      "export declare function size(geom: Geometry): number;"
    );
    const js = read(dir, "out/index.js");
    expect(js).toContain("const [x, y] = geom.coordinates;");
    expect(js).not.toContain("typesugar");
  });

  it("noEmitOnError: a real type error writes no declarations", () => {
    const dir = makeProject(
      { declaration: true, emitDeclarationOnly: true, outDir: "out", noEmitOnError: true },
      { "src/index.ts": LIBRARY + `export const bad: number = "nope";\n` }
    );
    const { status, output } = runCli(["build"], dir);
    expect(status).toBe(1);
    expect(output).toContain("TS2322");
    expect(fs.existsSync(path.join(dir, "out/index.d.ts"))).toBe(false);
  });
});

describe("emitDeclarations() API", () => {
  it("writes the expanded declarations and reports no phantom errors", () => {
    const dir = makeProject({}, { "src/index.ts": LIBRARY });
    const result = emitDeclarations({ cwd: dir, declarationDir: "dts" });
    expect(result.diagnostics.map((d) => d.code)).toEqual([]);
    expect(result.errorCount).toBe(0);
    expect(result.files).toEqual([path.join(dir, "dts", "index.d.ts")]);
    expectLibraryDeclarations(read(dir, "dts/index.d.ts"));
  });

  it("returns errors (and writes nothing) for a real type error", () => {
    const dir = makeProject(
      { outDir: "out" },
      { "src/index.ts": LIBRARY + `export const bad: number = "nope";\n` }
    );
    const result = emitDeclarations({ cwd: dir });
    expect(result.errorCount).toBe(1);
    expect(result.diagnostics.map((d) => d.code)).toEqual([2322]);
    expect(result.files).toEqual([]);
    expect(fs.existsSync(path.join(dir, "out"))).toBe(false);
  });
});
