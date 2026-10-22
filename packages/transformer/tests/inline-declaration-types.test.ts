/**
 * An exported declaration initialized by an inlined instance call keeps the
 * type the source declares in its `.d.ts` (review 8).
 *
 * The declarations are emitted from the expanded program, where
 * `mapArr.map([1, 2], f)` is `([1, 2] as number[]).map(f)`: `export const r`
 * was declared `number[]`, though the source's `r` is `unknown` (the
 * typeclass member's return type). A consumer then typed code against a type
 * the library never declared, and the declarations changed with whether a
 * call happened to be inlined. As `@opaque` types already were
 * (declaration-annotations.ts), such a declaration is annotated with the
 * source's type on the copy the declarations are emitted from.
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

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-inline-dts-"));
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
        outDir: "out",
        rootDir: "src",
        declaration: true,
      },
      include: ["src"],
    })
  );
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

function cli(dir: string, ...args: string[]): { out: string; status: number | null } {
  const r = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: dir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  return { out: (r.stdout ?? "") + (r.stderr ?? ""), status: r.status };
}

const FM = `/** @typeclass */
export interface Mapper<F> {
  map<A, B>(fa: unknown, f: (a: A) => B): unknown;
}
export interface ArrTag { readonly _tag: "Arr" }
/** @impl Mapper<ArrTag> */
export const mapArr: Mapper<ArrTag> = {
  map: <A, B>(fa: unknown, f: (a: A) => B): unknown => (fa as A[]).map(f),
};
/** @typeclass */
export interface Mk<A> {
  make(n: number): A;
}
export interface P { x: number }
/** @impl Mk<P> */
export const mkP: Mk<P> = {
  make: (n) => ({ x: n }) as P,
};
`;

describe.skipIf(!fs.existsSync(cliPath))("an inlined call's declaration", () => {
  it("keeps the type the source declares", () => {
    const dir = project({
      "src/fm.ts": FM,
      "src/main.ts": `import { mapArr, mkP } from "./fm.js";
export const r = mapArr.map([1, 2], (x: number) => x + 1);
export const nested = { list: mapArr.map([1], (x: number) => x) };
export function mapped() {
  return mapArr.map([3], (x: number) => x * 2);
}
export class Holder {
  value = mapArr.map([4], (x: number) => x);
}
export default mapArr.map([5], (x: number) => x);
export const p = mkP.make(1);
`,
    });
    const build = cli(dir, "build");
    expect(build.out).toBe("");
    expect(build.status).toBe(0);
    const js = fs.readFileSync(path.join(dir, "out", "main.js"), "utf-8");
    expect(js).not.toMatch(/mapArr\.map\(/); // still inlined
    const dts = fs.readFileSync(path.join(dir, "out", "main.d.ts"), "utf-8");
    expect(dts).toMatch(/export declare const r: unknown;/);
    expect(dts).toMatch(/list: unknown;/);
    expect(dts).toMatch(/export declare function mapped\(\): unknown;/);
    expect(dts).toMatch(/value: unknown;/);
    expect(dts).toMatch(/declare const _default: unknown;/);
    // Where the expansion's type is the source's, it is unchanged.
    expect(dts).toMatch(/export declare const p: import\("\.\/fm(\.js)?"\)\.P;/);
    expect(dts).not.toMatch(/number\[\]|\bany\b/);
    // The expansion still type-checks with those annotations.
    const strict = cli(dir, "check", "--strict");
    expect(strict.out).toBe("");
    expect(strict.status).toBe(0);
  });

  // review 9: the source's type was written even where it can't be named at
  // the declaration (a local class: TS4060; a class expression: `typeof Cls`,
  // circular). Those keep the expansion's inference, which was valid.
  it("is not annotated with a type that can't be named at the declaration", () => {
    const dir = project({
      "src/fm.ts":
        FM +
        `/** @impl Mk<number> */
export const mkN: Mk<number> = { make: (n) => n * 2 };
`,
      "src/main.ts": `import { mkN } from "./fm.js";
export function loc() {
  class L { y = mkN.make(1); }
  return new L();
}
export const Cls = class { v = mkN.make(1); };
class Shadow { outer = "outer"; }
export const shadowUse = new Shadow();
export function shadowed() {
  class Shadow { inner = mkN.make(2); }
  return new Shadow();
}
export function Tagged<B extends new (...args: any[]) => object>(Base: B) {
  return class extends Base { tag = mkN.make(3); };
}
export async function later() {
  return mkN.make(4);
}
export function gen<T>(x: T) {
  return { x, n: mkN.make(5) };
}
export class Box<T> {
  constructor(public t: T) {}
  get pair() { return [this.t, mkN.make(6)] as const; }
  wrap<U>(u: U) { return { t: this.t, u, n: mkN.make(7) }; }
}
`,
      "src/use.ts": `import { loc, Cls, shadowed, Tagged, later, gen, Box } from "./main.js";
export const a: number = loc().y;
export const b: number = new Cls().v;
export const c: number = shadowed().inner;
class Base0 { base = "b"; }
export const d: number = new (Tagged(Base0))().tag;
export const e: string = new (Tagged(Base0))().base;
export const f: Promise<number> = later();
export const g: { x: string; n: number } = gen("s");
export const h: readonly [string, number] = new Box("t").pair;
export const i: { t: string; u: boolean; n: number } = new Box("t").wrap(true);
`,
    });
    const build = cli(dir, "build");
    expect(build.out).toBe("");
    expect(build.status).toBe(0);
    const dts = fs.readFileSync(path.join(dir, "out", "main.d.ts"), "utf-8");
    expect(dts).not.toMatch(/typeof Cls/);
    expect(dts).not.toMatch(/\bL\b/);
    expect(dts).not.toMatch(/shadowed\(\): Shadow/);
    expect(dts).toMatch(/export declare function later\(\): Promise<number>;/);
    expect(dts).toMatch(/export declare function gen<T>\(x: T\): \{\s*x: T;\s*n: number;\s*\}/);
    // A consumer compiled against only the declarations sees the right types.
    fs.writeFileSync(
      path.join(dir, "out", "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          types: [],
          module: "ESNext",
          moduleResolution: "Bundler",
          target: "ES2022",
        },
        files: ["consumer.ts"],
      })
    );
    fs.copyFileSync(path.join(dir, "src", "use.ts"), path.join(dir, "out", "consumer.ts"));
    const tsc = spawnSync(
      process.execPath,
      [
        path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
        "-p",
        path.join(dir, "out", "tsconfig.json"),
      ],
      { cwd: dir, encoding: "utf-8" }
    );
    expect((tsc.stdout ?? "") + (tsc.stderr ?? "")).toBe("");
    expect(tsc.status).toBe(0);
  });
});
