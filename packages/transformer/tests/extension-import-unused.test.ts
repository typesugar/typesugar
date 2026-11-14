/**
 * An import used only through extension-method calls is used: the expansion
 * calls it (`users.chunk(25)` → `chunk(users, 25)`). Under `noUnusedLocals`,
 * `typesugar check` and `typesugar build` reported it as unused (TS6133, or
 * TS6192 for a whole declaration), because TypeScript decides that on the
 * source as written (remeda case study F7). They now drop an unused-import
 * diagnostic for a binding the expansion references, and keep it for one it
 * doesn't.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgRoot, "..", "..");
const cliPath = path.join(pkgRoot, "dist", "cli.js");
const hasBuild = fs.existsSync(cliPath);

function makeProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-ext-unused-"));
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noUnusedLocals: true,
        skipLibCheck: true,
        types: [],
        outDir: "out",
      },
      include: ["src"],
    })
  );
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture", private: true, type: "module" })
  );
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

function node(dir: string, args: string[]): { status: number | null; output: string } {
  const r = spawnSync(process.execPath, args, {
    cwd: dir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  return { status: r.status, output: (r.stdout ?? "") + (r.stderr ?? "") };
}

const EXT = `export function chunk<T>(data: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < data.length; i += size) out.push(data.slice(i, i + size));
  return out;
}
export function count<T>(data: readonly T[]): number { return data.length; }
export function sortBy<T>(data: readonly T[], f: (x: T) => number): T[] {
  return [...data].sort((a, b) => f(a) - f(b));
}
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe.skipIf(!hasBuild)("imports used only through extension methods (remeda F7)", () => {
  let dir: string;
  let check = "";
  let build = "";
  beforeAll(() => {
    dir = makeProject({
      "src/ext.ts": EXT,
      // Every binding used only as a method: TS6192 on the declaration.
      "src/all.ts": `import { chunk, count } from "./ext.js";
console.log([1, 2, 3].chunk(2).count());
`,
      // The only binding, used as a method: TS6133 on the declaration.
      "src/one.ts": `import { count } from "./ext.js";
console.log([1, 2, 3].count());
`,
      // One used as a method, one not used at all: TS6133 on the second only.
      "src/some.ts": `import { chunk, sortBy } from "./ext.js";
console.log([1, 2, 3].chunk(2).length);
`,
      // Not used at all: still reported.
      "src/none.ts": `import { count } from "./ext.js";
console.log(1);
`,
    });
    dirs.push(dir);
    check = node(dir, [cliPath, "check"]).output;
    build = node(dir, [cliPath, "build"]).output;
  });

  it.each([
    ["check", () => check],
    ["build", () => build],
  ])("%s: no unused-import error for bindings the expansion calls", (_, out) => {
    expect(out()).not.toMatch(/\/(all|one)\.ts\(\d+,\d+\): error TS6(133|192)/);
    expect(out()).not.toMatch(/'chunk' is declared but/);
  });

  it.each([
    ["check", () => check],
    ["build", () => build],
  ])("%s: still reports the bindings nothing uses", (_, out) => {
    expect(out()).toMatch(/some\.ts\(1,17\): error TS6133: 'sortBy' is declared but/);
    expect(out()).toMatch(/none\.ts\(1,\d+\): error TS6133: 'count' is declared but/);
  });

  it("the built file runs", () => {
    expect(node(dir, [path.join(dir, "out", "all.js")]).output.trim()).toBe("2");
  });
});
