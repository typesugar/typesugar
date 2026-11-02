/**
 * `node --import @typesugar/transformer/register` end to end: spawns Node on
 * the BUILT loader (`dist/register.js`) against throwaway projects.
 *
 * What this pins: macros expand in the entry and in modules it imports, a
 * macro error fails the import instead of running raw macro calls, and the
 * loader works alone (Node's own type stripping for unchanged files) and
 * together with tsx, registered before or after it.
 *
 * Build first: `pnpm --filter @typesugar/transformer build`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import * as nodeModule from "module";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgRoot, "..", "..");
const registerUrl = pathToFileURL(path.join(pkgRoot, "dist", "register.js")).href;
const hasBuild = fs.existsSync(fileURLToPath(registerUrl));
/** Node can strip types itself (22.18+ / 23.6+), so the loader works without tsx. */
const nodeStripsTypes =
  typeof (nodeModule as { stripTypeScriptTypes?: unknown }).stripTypeScriptTypes === "function";

const FILES: Record<string, string> = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      skipLibCheck: true,
    },
  }),
  "package.json": JSON.stringify({ name: "fx", private: true, type: "module" }),
  "lib.ts": `import { fieldNames } from "typesugar";
interface Pt { x: number; y: number }
export const names: string[] = fieldNames<Pt>();
`,
  // Unchanged by typesugar: reaches Node (or tsx) untouched.
  "plain.ts": `export const plain: number = 7;\n`,
  "main.ts": `import { names } from "./lib.js";
import { plain } from "./plain.js";
import { comptime } from "typesugar";
const n: number = comptime(() => 40 + 2);
console.log("RESULT", JSON.stringify(names), n, plain);
`,
  "bad.ts": `import { comptime } from "typesugar";
console.log("RAN-BAD");
export const x = comptime(() => { throw new Error("boom-from-comptime"); });
`,
};

function run(args: string[], cwd: string): { status: number | null; output: string } {
  const r = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  return { status: r.status, output: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe.skipIf(!hasBuild)("node --import typesugar register", () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-register-"));
    fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
    for (const [rel, content] of Object.entries(FILES)) {
      fs.writeFileSync(path.join(dir, rel), content);
    }
  });
  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(!nodeStripsTypes)(
    "alone: expands macros in the entry and its imports",
    () => {
      const { status, output } = run(["--import", registerUrl, "main.ts"], dir);
      expect(status, output).toBe(0);
      expect(output).toContain('RESULT ["x","y"] 42 7');
    },
    120_000
  );

  it("with tsx registered after typesugar", () => {
    const { status, output } = run(["--import", registerUrl, "--import", "tsx", "main.ts"], dir);
    expect(status, output).toBe(0);
    expect(output).toContain('RESULT ["x","y"] 42 7');
  }, 120_000);

  it("with tsx registered before typesugar", () => {
    const { status, output } = run(["--import", "tsx", "--import", registerUrl, "main.ts"], dir);
    expect(status, output).toBe(0);
    expect(output).toContain('RESULT ["x","y"] 42 7');
  }, 120_000);

  it("via NODE_OPTIONS under the tsx CLI", () => {
    const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
    const r = spawnSync(process.execPath, [tsxCli, "main.ts"], {
      cwd: dir,
      encoding: "utf-8",
      timeout: 120_000,
      env: { ...process.env, NODE_OPTIONS: `--import=${registerUrl}` },
    });
    const output = (r.stdout ?? "") + (r.stderr ?? "");
    expect(r.status, output).toBe(0);
    expect(output).toContain('RESULT ["x","y"] 42 7');
  }, 120_000);

  it.skipIf(!nodeStripsTypes)(
    "async fallback (module.register, for Node without registerHooks)",
    () => {
      const hooksUrl = pathToFileURL(path.join(pkgRoot, "dist", "register-hooks.js")).href;
      const preload = `data:text/javascript,import{register}from"node:module";register(${JSON.stringify(hooksUrl)})`;
      const { status, output } = run(["--import", preload, "main.ts"], dir);
      expect(status, output).toBe(0);
      expect(output).toContain('RESULT ["x","y"] 42 7');
    },
    120_000
  );

  it("a macro error fails the import; the module body never runs", () => {
    const { status, output } = run(["--import", registerUrl, "--import", "tsx", "bad.ts"], dir);
    expect(output).toContain("boom-from-comptime");
    expect(output).not.toContain("RAN-BAD");
    expect(status, output).not.toBe(0);
  }, 120_000);
});
