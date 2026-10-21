/**
 * A type whose derives generate only its companion (`@derive(Eq, Clone)` on
 * an interface: `namespace Vec { export const Eq = ...; export const Clone =
 * ... }`) is a value only in the expanded program. TypeScript decides what an
 * `export { Vec } from "./vec.js"` or an `import { Vec }` re-exported with
 * `export { Vec }` keeps from the source as written, where `Vec` is only an
 * interface, so `typesugar build` dropped the re-export (`dist/idx.js` was
 * `export {};`) while the `.d.ts` still exported `Vec`, and a consumer's
 * `a === b` (`Vec.Eq.equals(a, b)`) failed with "does not provide an export
 * named 'Vec'".
 *
 * Under `verbatimModuleSyntax` / `isolatedModules` the source check reported
 * the value import and re-export instead (TS1484, TS1205), and `typeof
 * Vec.Eq` in a type position was TS2693.
 *
 * Spawns the BUILT CLI (`pnpm --filter @typesugar/transformer build`).
 */

import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgRoot, "..", "..");
const cliPath = path.join(pkgRoot, "dist", "cli.js");

const FILES: Record<string, string> = {
  "src/vec.ts": `/** @derive(Eq, Clone) */
export interface Vec {
  x: number;
  y: number;
}
`,
  // An index file re-exporting by name.
  "src/idx.ts": `export { Vec } from "./vec.js";
`,
  // Imported, then re-exported with a local export clause, nothing else.
  "src/reexp.ts": `import { Vec } from "./vec.js";
export { Vec };
`,
  "src/use.ts": `import "@typesugar/std/syntax/eq/ops";
import { Vec } from "./idx.js";
import { c } from "./use2.js";
type VecEq = typeof Vec.Eq;
const eq: VecEq = Vec.Eq;
const a: Vec = { x: 1, y: 2 };
const b: Vec = { x: 1, y: 2 };
console.log(JSON.stringify([a === b, a === c, eq.equals(a, b), Vec.Clone.clone(c)]));
`,
  "src/use2.ts": `import { Vec } from "./reexp.js";
export const c: Vec = { x: 3, y: 4 };
`,
};

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function makeProject(compilerOptions: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-companion-reexport-"));
  dirs.push(dir);
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "vec-app", private: true, type: "module" }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        skipLibCheck: true,
        types: [],
        outDir: "out",
        ...compilerOptions,
      },
      include: ["src"],
    }),
    ...FILES,
  };
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

function cli(dir: string, command: "build" | "check") {
  const r = spawnSync(process.execPath, [cliPath, command], {
    cwd: dir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  return { status: r.status, output: (r.stdout ?? "") + (r.stderr ?? "") };
}

const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), "utf-8");

const variants: Array<[string, Record<string, unknown>]> = [
  ["default options", {}],
  ["declaration", { declaration: true }],
  ["isolatedModules", { isolatedModules: true }],
  ["verbatimModuleSyntax", { verbatimModuleSyntax: true }],
];

describe.skipIf(!fs.existsSync(cliPath))(
  "re-exporting a type whose derives make it a value",
  () => {
    for (const [label, options] of variants) {
      it(`${label}: check and build report nothing, the re-exports are kept, and it runs`, () => {
        const dir = makeProject(options);
        const checked = cli(dir, "check");
        expect(checked.output).toBe("");
        expect(checked.status).toBe(0);

        const built = cli(dir, "build");
        expect(built.output).toBe("");
        expect(built.status).toBe(0);
        expect(read(dir, "out/idx.js")).toContain('export { Vec } from "./vec.js";');
        expect(read(dir, "out/reexp.js")).toMatch(/import \{ Vec \} from "\.\/vec\.js";/);
        expect(read(dir, "out/reexp.js")).toContain("export { Vec };");
        if (options.declaration) {
          expect(read(dir, "out/idx.d.ts")).toContain('export { Vec } from "./vec.js";');
        }

        const run = spawnSync(process.execPath, [path.join(dir, "out", "use.js")], {
          cwd: dir,
          encoding: "utf-8",
        });
        expect(run.status, run.stderr).toBe(0);
        expect(JSON.parse(run.stdout)).toEqual([true, false, true, { x: 3, y: 4 }]);
      });
    }

    it("a type without derives is still a type: re-exporting it as a value is still TS1205", () => {
      const dir = makeProject({ isolatedModules: true });
      fs.writeFileSync(path.join(dir, "src/plain.ts"), `export interface Plain { x: number }\n`);
      fs.writeFileSync(path.join(dir, "src/plain-idx.ts"), `export { Plain } from "./plain.js";\n`);
      const checked = cli(dir, "check");
      expect(checked.output).toMatch(/plain-idx\.ts\(1,10\): error TS1205/);
      expect(checked.status).toBe(1);
    });
  }
);
