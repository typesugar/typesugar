/**
 * An import whose every use was inlined away is not emitted (review 8).
 *
 * `mkP.make(1)` on an `@impl` instance is inlined to `({ x: 1 })`, but the
 * JavaScript kept `import { mkP } from "./ord.js"`: TypeScript decides import
 * elision from the source as written, where `mkP` is a value reference. That
 * is a module load the code no longer needs, so the call wasn't zero-cost.
 * A binding something still references (a use that wasn't inlined, a
 * re-export), a side-effect import, and the other bindings of the same
 * declaration stay.
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

function build(files: Record<string, string>): { dir: string; out: string; status: number | null } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-dead-import-"));
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
      },
      include: ["src"],
    })
  );
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  const r = spawnSync(process.execPath, [cliPath, "build"], {
    cwd: dir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  return { dir, out: (r.stdout ?? "") + (r.stderr ?? ""), status: r.status };
}

function run(dir: string, file: string): string {
  const r = spawnSync(process.execPath, [path.join(dir, "out", file)], { encoding: "utf-8" });
  return (r.stdout ?? "").trim() + (r.stderr ? `\n${r.stderr}` : "");
}

const ORD = `/** @typeclass */
export interface Mk<A> {
  make(n: number): A;
  pair(a: A, b: A): A[];
}
export interface P { x: number }
/** @impl Mk<P> */
export const mkP: Mk<P> = {
  make: (n) => ({ x: n }) as P,
  pair: (a, b) => new Array<P>(a, b),
};
export const label = (p: P): string => "P" + p.x;
console.log("ord loaded");
`;

describe.skipIf(!fs.existsSync(cliPath))("an import whose every use was inlined", () => {
  it("is not emitted", () => {
    const { dir, out, status } = build({
      "src/ord.ts": ORD,
      "src/main.ts": `import { mkP } from "./ord.js";
export const p = mkP.make(1);
export const ps = mkP.pair(p, p);
console.log(JSON.stringify(ps));
`,
    });
    expect(out).toBe("");
    expect(status).toBe(0);
    const js = fs.readFileSync(path.join(dir, "out", "main.js"), "utf-8");
    expect(js).not.toMatch(/mkP/);
    expect(js).not.toMatch(/import/);
    // Nothing loads ord.js any more.
    expect(run(dir, "main.js")).toBe(`[{"x":1},{"x":1}]`);
  });

  it("keeps a binding something still references, the declaration's other bindings, and side-effect imports", () => {
    const { dir, out, status } = build({
      "src/ord.ts": ORD,
      "src/side.ts": `console.log("side loaded");\nexport {};\n`,
      // `label` is still called; `mkP` is only inlined.
      "src/partial.ts": `import "./side.js";
import { mkP, label } from "./ord.js";
console.log(label(mkP.make(2)));
`,
      // `mkP` is inlined in one place and passed as a value in another.
      "src/value.ts": `import { mkP } from "./ord.js";
const p = mkP.make(3);
const inst = mkP;
console.log(p.x, inst.make(4).x);
`,
      // A re-export references the binding too.
      "src/reexport.ts": `import { mkP } from "./ord.js";
export { mkP };
console.log(mkP.make(5).x);
`,
    });
    expect(out).toBe("");
    expect(status).toBe(0);
    const partial = fs.readFileSync(path.join(dir, "out", "partial.js"), "utf-8");
    expect(partial).toMatch(/import "\.\/side\.js";/);
    expect(partial).toMatch(/import \{ label \} from "\.\/ord\.js";/);
    expect(partial).not.toMatch(/mkP/);
    expect(run(dir, "partial.js")).toBe("side loaded\nord loaded\nP2");

    const value = fs.readFileSync(path.join(dir, "out", "value.js"), "utf-8");
    expect(value).toMatch(/import \{ mkP \} from "\.\/ord\.js";/);
    expect(run(dir, "value.js")).toBe("ord loaded\n3 4");

    const reexport = fs.readFileSync(path.join(dir, "out", "reexport.js"), "utf-8");
    expect(reexport).toMatch(/import \{ mkP \} from "\.\/ord\.js";/);
    expect(reexport).toMatch(/export \{ mkP \}/);
    expect(run(dir, "reexport.js")).toBe("ord loaded\n5");
  });
});
