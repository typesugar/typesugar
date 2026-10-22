/**
 * Values a derive declares (`@derive(Destructure)`: the constructor functions
 * and their `Destructure` instances) exist only in the expanded program. The
 * source, checked as written, reported every reference to them, so
 * re-exporting them by name from an index file (`export { Circle } from
 * "./shapes"`) made `emitDeclarations` (tsup's `withTypesugar`) refuse to
 * write anything (TS2305), and importing or calling them failed
 * `typesugar build`.
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

const SHAPES = `import { match } from "@typesugar/std";

/** @derive(Eq, Destructure) */
export interface Point {
  x: number;
  y: number;
}

/** @derive(Destructure) */
export type Shape = { kind: "circle"; r: number } | { kind: "rect"; w: number; h: number };

// In the file that derives them: a call, and an extractor pattern.
export const unit = Circle(1);
export const area = (s: Shape) =>
  match(s)
    .case(Circle(r))
    .then(Math.PI * r * r)
    .case(Rect(w, h))
    .then(w * h);
`;

/** A derived<TC<T>>() const, the other derive output a module exports by name. */
const INSTANCES = `import { derived } from "typesugar";
import type { Clone } from "@typesugar/std";
import type { Shape } from "./shapes.js";
export const cloneShape = derived<Clone<Shape>>();
`;

const INDEX = `export { Point, Circle, Rect, destructurePoint, destructureCircle } from "./shapes.js";
export type { Shape } from "./shapes.js";
export { area } from "./shapes.js";
export { cloneShape } from "./instances.js";
`;

const USE = `import { Point, Circle } from "./index.js";
export const p = Point(1, 2);
export const c = Circle(3);
console.log(JSON.stringify([p, c]));
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function makeProject(compilerOptions: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-reexport-"));
  dirs.push(dir);
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "shapes", private: true, type: "module" }),
    "tsconfig.json": JSON.stringify({
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
    }),
    "src/shapes.ts": SHAPES,
    "src/instances.ts": INSTANCES,
    "src/index.ts": INDEX,
    "src/use.ts": USE,
  };
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), "utf-8");

describe("derived values, imported, called and re-exported by name", () => {
  it("emitDeclarations writes the declarations, with the re-exports", () => {
    const dir = makeProject({});
    const result = emitDeclarations({ cwd: dir, declarationDir: "dts" });
    expect(result.diagnostics.map((d) => `TS${d.code}`)).toEqual([]);
    expect(result.errorCount).toBe(0);
    expect(read(dir, "dts/index.d.ts")).toContain(
      'export { Point, Circle, Rect, destructurePoint, destructureCircle } from "./shapes.js";'
    );
    const shapes = read(dir, "dts/shapes.d.ts");
    expect(shapes).toContain("export declare function Circle(r: number)");
    expect(shapes).toContain("export declare function Point(x: number, y: number): Point;");
    expect(shapes).toContain("export declare const destructureCircle");
    expect(shapes).toContain("/** @impl Eq<Point> */");
    expect(read(dir, "dts/index.d.ts")).toContain('export { cloneShape } from "./instances.js";');
    expect(read(dir, "dts/instances.d.ts")).toContain(
      "export declare const cloneShape: Clone<Shape>;"
    );
  });

  it.skipIf(!fs.existsSync(cliPath))(
    "typesugar build reports nothing, and the program runs",
    () => {
      const dir = makeProject({ declaration: true, outDir: "out" });
      const r = spawnSync(process.execPath, [cliPath, "build"], {
        cwd: dir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      });
      expect((r.stdout ?? "") + (r.stderr ?? "")).toBe("");
      expect(r.status).toBe(0);
      const run = spawnSync(process.execPath, [path.join(dir, "out", "use.js")], {
        cwd: dir,
        encoding: "utf-8",
      });
      expect(run.status, run.stderr).toBe(0);
      expect(JSON.parse(run.stdout)).toEqual([
        { x: 1, y: 2 },
        { kind: "circle", r: 3 },
      ]);
    }
  );

  it.skipIf(!fs.existsSync(cliPath))(
    "a program that imports no typesugar package can @derive(Destructure)",
    () => {
      // @derive is a built-in tag, so a library can use it without importing
      // anything; Destructure comes from @typesugar/std's macros, which were
      // loaded only for a program importing some typesugar package
      // ("Unknown derive: 'Destructure'").
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-reexport-"));
      dirs.push(dir);
      fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
      fs.writeFileSync(path.join(dir, "package.json"), `{"type":"module"}`);
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
            declaration: true,
            outDir: "out",
          },
          include: ["src"],
        })
      );
      fs.mkdirSync(path.join(dir, "src"));
      fs.writeFileSync(
        path.join(dir, "src", "point.ts"),
        `/** @derive(Destructure, Eq) */
export interface Point {
  x: number;
  y: number;
}
export const p = Point(1, 2);
console.log(JSON.stringify([p, Point.Eq.equals(p, Point(1, 2))]));
`
      );
      const r = spawnSync(process.execPath, [cliPath, "build"], {
        cwd: dir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      });
      expect((r.stdout ?? "") + (r.stderr ?? "")).toBe("");
      expect(r.status).toBe(0);
      expect(read(dir, "out/point.d.ts")).toContain(
        "export declare function Point(x: number, y: number): Point;"
      );
      const run = spawnSync(process.execPath, [path.join(dir, "out", "point.js")], {
        encoding: "utf-8",
      });
      expect(run.status, run.stderr).toBe(0);
      expect(JSON.parse(run.stdout)).toEqual([{ x: 1, y: 2 }, true]);
    }
  );

  it("a name the derive does not declare is still an error", () => {
    const dir = makeProject({});
    fs.writeFileSync(
      path.join(dir, "src/index.ts"),
      INDEX + `export { Triangle } from "./shapes.js";\n`
    );
    const result = emitDeclarations({ cwd: dir, declarationDir: "dts" });
    expect(result.diagnostics.map((d) => d.code)).toEqual([2305]);
  });
});
