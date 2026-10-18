/**
 * CLI exit-code integration tests (deep review, transformer findings #1, #8,
 * #10, #13).
 *
 * These spawn the BUILT CLI (`dist/cli.js`) against throwaway fixture
 * projects, because the bugs they pin only exist at the process boundary:
 * macro errors that printed nothing and exited 0, a `check` that never ran
 * macro expansion, a `run` that only expanded its entry file and exited 0
 * when the child was killed, a watch that skipped HKT preprocessing, and a
 * dts-transform bin that did nothing.
 *
 * Build first: `pnpm --filter @typesugar/transformer build`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgRoot, "..", "..");
const cliPath = path.join(pkgRoot, "dist", "cli.js");
const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf-8")) as {
  bin: Record<string, string>;
};
const hasBuild = fs.existsSync(cliPath);

const TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "Bundler",
    strict: true,
    skipLibCheck: true,
    outDir: "out",
  },
  include: ["src"],
};

function makeProject(prefix: string, files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  // Resolve `typesugar` & friends from the workspace.
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(TSCONFIG, null, 2));
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

function runCli(args: string[], cwd: string): { status: number | null; output: string } {
  const r = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  return { status: r.status, output: (r.stdout ?? "") + (r.stderr ?? "") };
}

const BAD_FILES = {
  "src/bad.ts": `import { comptime } from "typesugar";
console.log("RAN-BAD");
export const x = comptime(() => { throw new Error("boom-from-comptime"); });
`,
};

const GOOD_FILES = {
  "src/lib.ts": `import { fieldNames } from "typesugar";
interface Pt { x: number; y: number }
export const names = fieldNames<Pt>();
`,
  "src/main.ts": `import { names } from "./lib";
import { comptime } from "typesugar";
const n = comptime(() => 40 + 2);
console.log("RESULT", JSON.stringify(names), n);
`,
  // HKT F<A> syntax: only valid after the HKT preprocessor runs.
  "src/hkt.ts": `export interface Functor<F> { map<A, B>(fa: F<A>, f: (a: A) => B): F<B>; }
`,
};

describe.skipIf(!hasBuild)("typesugar CLI exit codes", () => {
  let bad: string;
  let good: string;

  beforeAll(() => {
    bad = makeProject("typesugar-cli-bad-", BAD_FILES);
    good = makeProject("typesugar-cli-good-", {
      ...GOOD_FILES,
      "src/kill.ts": `process.kill(process.pid, "SIGKILL");\n`,
    });
  });

  afterAll(() => {
    for (const d of [bad, good]) {
      if (d) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("build: a macro error is reported and exits non-zero", () => {
    const { status, output } = runCli(["build"], bad);
    expect(output).toContain("boom-from-comptime");
    expect(status, output).not.toBe(0);
  }, 120_000);

  it("check: runs macro expansion, reports the macro error, exits non-zero", () => {
    const { status, output } = runCli(["check"], bad);
    expect(output).toContain("boom-from-comptime");
    expect(status, output).not.toBe(0);
  }, 120_000);

  it("run: a macro error is reported, the program is not run, exits non-zero", () => {
    const { status, output } = runCli(["run", "src/bad.ts"], bad);
    expect(output).toContain("boom-from-comptime");
    expect(output).not.toContain("RAN-BAD");
    expect(status, output).not.toBe(0);
  }, 120_000);

  it("build: a clean project (incl. HKT syntax) exits 0", () => {
    const { status, output } = runCli(["build"], good);
    expect(status, output).toBe(0);
    const emitted = fs.readFileSync(path.join(good, "out", "lib.js"), "utf-8");
    expect(emitted).not.toContain("fieldNames(");
  }, 120_000);

  it("check: a clean project exits 0", () => {
    const { status, output } = runCli(["check"], good);
    expect(status, output).toBe(0);
  }, 120_000);

  it("run: expands macros in IMPORTED modules too, and exits 0", () => {
    const { status, output } = runCli(["run", "src/main.ts"], good);
    expect(status, output).toBe(0);
    expect(output).toContain('RESULT ["x","y"] 42');
  }, 120_000);

  it("run: a child killed by a signal is a failure, not exit 0", () => {
    const { status, output } = runCli(["run", "src/kill.ts"], good);
    expect(status, output).not.toBe(0);
    expect(status, output).not.toBeNull();
  }, 120_000);

  it("watch: HKT syntax is preprocessed and macro errors are reported", async () => {
    const project = makeProject("typesugar-cli-watch-", {
      ...BAD_FILES,
      "src/hkt.ts": GOOD_FILES["src/hkt.ts"],
    });
    try {
      const child = spawn(process.execPath, [cliPath, "watch"], {
        cwd: project,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      const done = new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 90_000);
        const onData = (chunk: Buffer): void => {
          output += chunk.toString();
          if (/Watching for file changes/.test(output)) {
            clearTimeout(timer);
            resolve();
          }
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
      });
      await done;
      const exited = new Promise((resolve) => child.on("close", resolve));
      child.kill("SIGTERM");
      await exited;

      expect(output).toMatch(/Watching for file changes/);
      expect(output).not.toContain("TS2315");
      expect(output).toContain("boom-from-comptime");
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  }, 120_000);

  it("typesugar-dts-transform bin rewrites @opaque interfaces", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-dts-bin-"));
    try {
      const dts = path.join(dir, "opt.d.ts");
      fs.writeFileSync(
        dts,
        `/** @opaque A | null */\nexport interface Option<A> {\n  map<B>(f: (a: A) => B): Option<B>;\n}\n`
      );
      const bin = path.join(pkgRoot, pkgJson.bin["typesugar-dts-transform"]);
      expect(fs.readFileSync(bin, "utf-8").startsWith("#!/usr/bin/env node")).toBe(true);
      const r = spawnSync(process.execPath, [bin, dts], { encoding: "utf-8", timeout: 60_000 });
      expect(r.status, (r.stdout ?? "") + (r.stderr ?? "")).toBe(0);
      expect(fs.readFileSync(dts, "utf-8")).toContain("export type Option<A> = A | null;");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
