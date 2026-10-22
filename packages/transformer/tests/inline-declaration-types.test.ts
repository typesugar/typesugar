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
});
