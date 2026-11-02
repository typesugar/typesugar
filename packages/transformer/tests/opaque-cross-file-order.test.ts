/**
 * An `@opaque` type declared in one file of a project, used in another.
 *
 * Its type rewrite used to be registered only when the DEFINING file was
 * transformed, so a consumer transformed first (`typesugar expand use.ts`,
 * the language service, a bundler that loads the consumer first) got no
 * erasure: `a.map(f)` stayed a method call on a value that is really
 * `number | null`. And when the consumer did get it, the companion
 * functions were imported from the defining file's absolute path, with its
 * `.ts` extension.
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
  "src/opt.ts": `import "typesugar";

/**
 * An optional value.
 *
 * @opaque A | null
 */
export interface Opt<A> {
  map<B>(f: (a: A) => B): Opt<B>;
  getOrElse(d: () => A): A;
}
export function Some<A>(value: A): Opt<A> {
  return value as unknown as Opt<A>;
}
export const None: Opt<never> = null as unknown as Opt<never>;
export function map<A, B>(o: Opt<A>, f: (a: A) => B): Opt<B> {
  return (o == null ? null : f(o as unknown as A)) as unknown as Opt<B>;
}
export function getOrElse<A>(o: Opt<A>, d: () => A): A {
  return o == null ? d() : (o as unknown as A);
}
`,
  // Imports the type's module.
  "src/use.ts": `import { Some, None, type Opt } from "./opt.js";
const a: Opt<number> = Some(2);
const b: Opt<number> = None;
console.log(a.map((x) => x + 1).getOrElse(() => 0), b.getOrElse(() => -1));
`,
  "src/mk.ts": `import { Some, type Opt } from "./opt.js";
export const mk = (n: number): Opt<number> => Some(n);
`,
  // Gets an Opt without importing its module.
  "src/use2.ts": `import { mk } from "./mk.js";
console.log(mk(4).map((x) => x * 10).getOrElse(() => 0));
`,
};

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-opaque-order-"));
  dirs.push(dir);
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "opt-app", private: true, type: "module" }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        skipLibCheck: true,
        types: [],
        outDir: "out",
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

function cli(dir: string, args: string[]) {
  const r = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: dir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe.skipIf(!fs.existsSync(cliPath))("@opaque across the files of one project", () => {
  it("typesugar expand of the consumer alone erases the type", () => {
    const dir = makeProject();
    const use = cli(dir, ["expand", "src/use.ts"]);
    expect(use.stderr).toBe("");
    expect(use.stdout).toContain("const a: Opt<number> = 2;");
    expect(use.stdout).toContain("const b: Opt<number> = null;");
    expect(use.stdout).toContain("getOrElse(map(a, (x) => x + 1), () => 0)");
    expect(use.stdout).toMatch(/import \{ [^}]*\bmap\b[^}]* \} from "\.\/opt\.js";/);

    const use2 = cli(dir, ["expand", "src/use2.ts"]);
    expect(use2.stderr).toBe("");
    expect(use2.stdout).toContain("getOrElse(map(mk(4), (x) => x * 10), () => 0)");
    expect(use2.stdout).toMatch(/import \{ [^}]* \} from "\.\/opt\.js";/);
  });

  it("typesugar build: the companions are imported by relative path, and it runs", () => {
    const dir = makeProject();
    const built = cli(dir, ["build"]);
    expect(built.stdout + built.stderr).toBe("");
    expect(built.status).toBe(0);
    for (const file of ["use.js", "use2.js"]) {
      const js = fs.readFileSync(path.join(dir, "out", file), "utf-8");
      expect(js).not.toContain(dir);
      expect(js).not.toMatch(/from "[^"]*\.ts"/);
    }
    const run = (file: string) =>
      spawnSync(process.execPath, [path.join(dir, "out", file)], { encoding: "utf-8" });
    expect(run("use.js").stdout.trim()).toBe("3 -1");
    expect(run("use2.js").stdout.trim()).toBe("40");
  });
});
