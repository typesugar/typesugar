/**
 * A library's `@derive` companions, used by its consumers (authoring rule 5:
 * ship instances with types).
 *
 *   // geo-lib/src/index.ts
 *   /** @derive(Eq, Ord, Clone, Show, Destructure) *\/
 *   export interface Point { x: number; y: number }
 *
 *   // app/src/main.ts
 *   import { Point } from "geo-lib";
 *   p1 === p2;  // → Point.Eq.equals(p1, p2)
 *
 * The library is built to JavaScript and `.d.ts` on disk, with `typesugar
 * build` and with tsup's `withTypesugar`; the consumer imports it from
 * node_modules, is built with `typesugar build`, and runs. Before the fix the
 * companions were invisible from the `.d.ts`: `p1 === p2` stayed a reference
 * comparison and `summon<Eq<Point>>()` derived a second instance with TS9009.
 *
 * Spawns the BUILT CLI and tsup (`pnpm build`).
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
const tsupCli = path.join(repoRoot, "node_modules", "tsup", "dist", "cli-default.js");
const hasBuild =
  fs.existsSync(cliPath) &&
  fs.existsSync(tsupCli) &&
  fs.existsSync(path.join(repoRoot, "packages", "unplugin-typesugar", "dist", "tsup.js"));

const LIBRARY = `import { derive, Eq } from "typesugar";

/** @derive(Eq, Ord, Clone, Show, Destructure) */
export interface Point {
  x: number;
  y: number;
}

// The decorator form leaves no @derive in the .d.ts: the companion's own
// @impl tag is what a consumer finds.
@derive(Eq)
export class Money {
  constructor(
    public amount: number,
    public currency: string
  ) {}
}

export const origin: Point = { x: 0, y: 0 };
`;

/** The package entry re-exports the module by name (bug 5's index file). */
const LIBRARY_INDEX = `export { Point, Money, origin, destructurePoint } from "./point.js";
`;

/** Every way a consumer reaches the instances. */
const MAIN = `import "@typesugar/std/syntax/eq/ops";
import "@typesugar/std/syntax/ord/ops";
import "@typesugar/std/syntax/eq";
import "@typesugar/std/syntax/clone";
import { summon, implicit } from "typesugar";
import type { Eq, Show } from "typesugar";
import { match } from "@typesugar/std";
import { Point, Money } from "geo-lib";

const p1: Point = { x: 1, y: 2 };
const p2: Point = { x: 1, y: 2 };
const p3: Point = { x: 3, y: 0 };
function same<A>(a: A, b: A, E: Eq<A> = implicit()): boolean {
  return E.equals(a, b);
}
const copy = p1.clone();
console.log(JSON.stringify({
  operator: [p1 === p2, p1 === p3, p1 < p3],
  summon: summon<Eq<Point>>().equals(p1, p3),
  show: summon<Show<Point>>().show(p3),
  implicit: [same(p1, p2), same(p1, p3)],
  method: [p1.equals(p2), copy !== p1 && copy.x === 1],
  match: match(p3).case(Point(x, y)).then(x + y).else(-1),
  money: new Money(1, "AUD") === new Money(1, "AUD"),
}));
`;

/** Point is used only as a type here: TypeScript elides its import unless kept. */
const NAMED_TYPE_USE = `import "@typesugar/std/syntax/eq/ops";
import { Point } from "geo-lib";
const a: Point = { x: 1, y: 2 };
const b: Point = { x: 1, y: 2 };
console.log(a === b);
`;

/** \`import type\`: the companion's value needs an import of its own. */
const IMPORT_TYPE_USE = `import "@typesugar/std/syntax/eq/ops";
import type { Point } from "geo-lib";
const a: Point = { x: 1, y: 2 };
const b: Point = { x: 1, y: 3 };
console.log(a === b);
`;

const EXPECTED = {
  operator: [true, false, true],
  summon: false,
  show: "Point(x = 3, y = 0)",
  implicit: [true, false],
  method: [true, true],
  match: 3,
  money: true,
};

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function write(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
}

/** A node_modules of symlinks: the workspace's packages plus `extra`. */
function linkModules(dir: string, extra: Record<string, string> = {}): void {
  const nm = path.join(dir, "node_modules");
  fs.mkdirSync(nm, { recursive: true });
  for (const name of ["typescript", "typesugar", "@typesugar", "tsup", "unplugin-typesugar"]) {
    fs.symlinkSync(path.join(repoRoot, "node_modules", name), path.join(nm, name), "dir");
  }
  for (const [name, target] of Object.entries(extra)) {
    fs.symlinkSync(target, path.join(nm, name), "dir");
  }
}

const TSCONFIG = (extra: Record<string, unknown>) =>
  JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      skipLibCheck: true,
      types: [],
      ...extra,
    },
    include: ["src"],
  });

function spawn(args: string[], cwd: string) {
  const r = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 180_000,
  });
  return { status: r.status, output: (r.stdout ?? "") + (r.stderr ?? "") };
}

type Builder = "typesugar build" | "tsup withTypesugar";

/**
 * A type whose derives generate only its companion (no Destructure
 * constructor, not a class): only the companion namespace makes `Vec` a
 * value, and `typesugar build` dropped the index's `export { Vec }`.
 */
const VEC_LIBRARY = {
  "src/shape.ts": `/** @derive(Eq, Clone) */
export interface Vec {
  x: number;
  y: number;
}
`,
  "src/index.ts": `export { Vec } from "./shape.js";
`,
};

const VEC_MAIN = `import "@typesugar/std/syntax/eq/ops";
import { Vec } from "geo-lib";
const a: Vec = { x: 1, y: 2 };
const b: Vec = { x: 1, y: 2 };
console.log(JSON.stringify([a === b, Vec.Clone.clone(a)]));
`;

function buildLibrary(
  builder: Builder,
  sources: Record<string, string> = { "src/point.ts": LIBRARY, "src/index.ts": LIBRARY_INDEX }
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-geo-lib-"));
  dirs.push(dir);
  linkModules(dir);
  write(dir, {
    "package.json": JSON.stringify({
      name: "geo-lib",
      version: "1.0.0",
      type: "module",
      exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
    }),
    "tsconfig.json": TSCONFIG(
      builder === "typesugar build" ? { declaration: true, outDir: "dist" } : {}
    ),
    ...sources,
    "tsup.config.ts": `import { defineConfig } from "tsup";
import { withTypesugar } from "unplugin-typesugar/tsup";
export default defineConfig(
  withTypesugar({ entry: ["src/index.ts"], format: ["esm"], dts: true })
);
`,
  });
  const r = builder === "typesugar build" ? spawn([cliPath, "build"], dir) : spawn([tsupCli], dir);
  if (r.status !== 0) throw new Error(`${builder} failed:\n${r.output}`);
  return dir;
}

function buildConsumer(library: string, files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-geo-app-"));
  dirs.push(dir);
  linkModules(dir, { "geo-lib": library });
  write(dir, {
    "package.json": JSON.stringify({ name: "geo-app", private: true, type: "module" }),
    "tsconfig.json": TSCONFIG({ outDir: "dist" }),
    ...files,
  });
  const build = spawn([cliPath, "build"], dir);
  return { dir, build };
}

const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), "utf-8");

describe.skipIf(!hasBuild)("a library's @derive companions, from its .d.ts", () => {
  for (const builder of ["typesugar build", "tsup withTypesugar"] as const) {
    describe(builder, () => {
      let built: string | undefined;
      const library = () => (built ??= buildLibrary(builder));

      it("the .d.ts tags each companion with @impl", { timeout: 180_000 }, () => {
        // tsup bundles the declarations into index.d.ts; tsc-style output
        // keeps one per module.
        const dts = fs.existsSync(path.join(library(), "dist/point.d.ts"))
          ? read(library(), "dist/point.d.ts")
          : read(library(), "dist/index.d.ts");
        expect(dts).toContain("/** @impl Eq<Point> */");
        expect(dts).toContain("/** @impl Ord<Point> */");
        expect(dts).toContain("/** @impl Eq<Money> */");
        expect(dts).toMatch(/@impl Destructure<typeof Point, Point, \[number, number\]>/);
      });

      it(
        "operators, summon, implicit(), method syntax and match use the library's instances",
        { timeout: 180_000 },
        () => {
          const { dir, build } = buildConsumer(library(), { "src/main.ts": MAIN });
          // No TS9009 "derived one here", no error. The only output: same()'s
          // two calls are not specialized, since a .d.ts instance has no
          // method bodies to inline (TS9602, as for any published instance).
          const lines = build.output.trim().split("\n");
          expect(lines).toHaveLength(2);
          for (const line of lines) {
            expect(line).toMatch(
              /main\.ts\(21,\d+\): warning TS9602: .*Auto-specialization of same skipped — instance 'Point\.Eq' is only visible as a declaration/
            );
          }
          expect(build.status).toBe(0);

          const js = read(dir, "dist/main.js");
          expect(js).toContain("Point.Eq.equals(p1, p2)");
          expect(js).toContain("Point.Ord.lessThan(p1, p3)");
          expect(js).toContain("Point.Eq.equals(p1, p3)"); // summon
          expect(js).toContain("Point.Show.show(p3)");
          expect(js).toContain("same(p1, p2, Point.Eq)");
          expect(js).toContain("Point.Eq.equals(p1, p2)"); // p1.equals(p2)
          expect(js).toContain("Point.Clone.clone(p1)");
          expect(js).toContain('Money.Eq.equals(new Money(1, "AUD"), new Money(1, "AUD"))');
          // The extractor is inlined: field reads, no call to Point or its instance.
          expect(js).toMatch(/const x = _p3\.x;/);
          expect(js).not.toContain("destructurePoint");
          // Nothing derived again at the use site.
          expect(js).not.toMatch(/equals: \(a, b\) =>/);

          const run = spawn([path.join(dir, "dist", "main.js")], dir);
          expect(run.status, run.output).toBe(0);
          expect(JSON.parse(run.output)).toEqual(EXPECTED);
        }
      );

      it(
        "a binding used only as a type keeps its import, so the companion is defined at run time",
        { timeout: 180_000 },
        () => {
          const { dir, build } = buildConsumer(library(), {
            "src/named.ts": NAMED_TYPE_USE,
            "src/import-type.ts": IMPORT_TYPE_USE,
          });
          expect(build.output).toBe("");
          expect(build.status).toBe(0);
          expect(read(dir, "dist/named.js")).toMatch(/import \{ Point \} from "geo-lib";/);
          expect(read(dir, "dist/import-type.js")).toMatch(
            /import \{ Point as (\w+) \} from "geo-lib";[\s\S]*\1\.Eq\.equals\(a, b\)/
          );
          for (const [file, expected] of [
            ["named.js", "true"],
            ["import-type.js", "false"],
          ]) {
            const run = spawn([path.join(dir, "dist", file)], dir);
            expect(run.status, run.output).toBe(0);
            expect(run.output.trim()).toBe(expected);
          }
        }
      );

      it(
        "a type with only companion derives (Eq, Clone) is re-exported from the index",
        { timeout: 180_000 },
        () => {
          const lib = buildLibrary(builder, VEC_LIBRARY);
          expect(read(lib, "dist/index.js")).toMatch(/\bVec\b/);
          const { dir, build } = buildConsumer(lib, { "src/main.ts": VEC_MAIN });
          expect(build.output).toBe("");
          expect(build.status).toBe(0);
          expect(read(dir, "dist/main.js")).toContain("Vec.Eq.equals(a, b)");
          const run = spawn([path.join(dir, "dist", "main.js")], dir);
          expect(run.status, run.output).toBe(0);
          expect(JSON.parse(run.output)).toEqual([true, { x: 1, y: 2 }]);
        }
      );
    });
  }
});
