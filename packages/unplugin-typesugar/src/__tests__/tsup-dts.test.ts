/**
 * A library built with tsup `dts: true` that uses fluent `match()` with
 * binding patterns (Turf case study, F5/F20).
 *
 * tsup's own dts step type-checks the UNEXPANDED source: binding patterns are
 * TS2304 there, so `dts: true` next to the esbuild plugin fails the build.
 * `withTypesugar` (unplugin-typesugar/tsup) keeps tsup's dts step and output
 * naming but gives it declarations emitted from the expanded program.
 *
 * Spawns the real tsup CLI on an on-disk fixture, so it needs the built
 * packages (`pnpm build`): the fixture's tsup.config.ts imports
 * `unplugin-typesugar/tsup` from dist.
 */

import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import { withTypesugar } from "../tsup.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.resolve(pkgRoot, "..", "..");
const tsupCli = path.join(repoRoot, "node_modules", "tsup", "dist", "cli-default.js");
const hasBuild = fs.existsSync(path.join(pkgRoot, "dist", "tsup.js")) && fs.existsSync(tsupCli);

const SHAPES = `export type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "square"; side: number };
`;

const INDEX = `import { match } from "@typesugar/std";
import type { Shape } from "./shapes.js";

export type { Shape } from "./shapes.js";

/** Area of a shape. */
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

function makeLibrary(tsupConfig: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-tsup-dts-"));
  dirs.push(dir);
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
  const files: Record<string, string> = {
    // A library that keeps match's runtime MatchError needs @typesugar/std at
    // run time (F19), so it is a dependency, and tsup leaves it external.
    "package.json": JSON.stringify({
      name: "shapes-lib",
      type: "module",
      dependencies: { "@typesugar/std": "*" },
    }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        skipLibCheck: true,
        types: [],
      },
      include: ["src"],
    }),
    "src/shapes.ts": SHAPES,
    "src/index.ts": INDEX,
    "tsup.config.ts": tsupConfig,
  };
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

function tsup(cwd: string) {
  const r = spawnSync(process.execPath, [tsupCli], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 180_000,
  });
  return { status: r.status, output: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe.skipIf(!hasBuild)("tsup dts: true with fluent match()", () => {
  it("without the helper, tsup's dts step fails on the unexpanded source (the F20 problem)", () => {
    const dir = makeLibrary(`import { defineConfig } from "tsup";
import typesugar from "unplugin-typesugar/esbuild";
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  esbuildPlugins: [typesugar()],
});
`);
    const { status, output } = tsup(dir);
    expect(status).not.toBe(0);
    expect(output).toContain("TS2304: Cannot find name 'r'");
  });

  it("withTypesugar: correct .d.ts and .d.cts with no typesugar imports", () => {
    const dir = makeLibrary(`import { defineConfig } from "tsup";
import { withTypesugar } from "unplugin-typesugar/tsup";
export default defineConfig(
  withTypesugar({ entry: ["src/index.ts"], format: ["esm", "cjs"], dts: true })
);
`);
    const { status, output } = tsup(dir);
    expect(output).not.toMatch(/error/i);
    expect(status).toBe(0);

    const dist = path.join(dir, "dist");
    expect(fs.readdirSync(dist).sort()).toEqual([
      "index.cjs",
      "index.d.cts",
      "index.d.ts",
      "index.js",
    ]);
    for (const file of ["index.d.ts", "index.d.cts"]) {
      const dts = fs.readFileSync(path.join(dist, file), "utf-8");
      // Bundled by tsup: Shape is inlined from ./shapes, as tsup's dts does.
      expect(dts).toContain("type Shape = {");
      expect(dts).toContain("declare function area(shape: Shape): number;");
      expect(dts).toContain('declare const label: (k: "a" | "b") => "Alpha" | "Beta";');
      expect(dts).toContain("/** Area of a shape. */");
      expect(dts).not.toMatch(/typesugar|FluentMatch|\bany\b|import /);
    }
    // The JavaScript is the expanded match, with only std's runtime MatchError.
    const js = fs.readFileSync(path.join(dist, "index.js"), "utf-8");
    expect(js).toContain('k === "a" ? "Alpha" : "Beta"');
    expect(js).not.toContain(".case(");
  });
});

describe.skipIf(!hasBuild)("withTypesugar in watch mode", () => {
  it("re-emits the declarations tsup's dts step watches after each JS rebuild", async () => {
    const dir = makeLibrary("");
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      let userHookRan = false;
      const config = await withTypesugar({
        entry: ["src/index.ts"],
        dts: true,
        watch: true,
        onSuccess: async () => {
          userHookRan = true;
        },
      })();
      const entry = (config.dts as { entry: Record<string, string> }).entry;
      expect(Object.keys(entry)).toEqual(["index"]);
      expect(fs.readFileSync(entry.index, "utf-8")).not.toContain("extra");

      fs.appendFileSync(path.join(dir, "src/index.ts"), "export const extra = 1;\n");
      await (config.onSuccess as () => Promise<void>)();
      expect(fs.readFileSync(entry.index, "utf-8")).toContain("export declare const extra = 1;");
      expect(userHookRan).toBe(true);
    } finally {
      process.chdir(cwd);
    }
  });
});
