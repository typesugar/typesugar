/**
 * `typesugar check` / `build` on code that names a derived companion directly
 * (`Point.Eq.equals(a, b)`, `Point.Debug.debug(p)`), the form docs/guides/derive.md
 * documents and `examples/standalone/hello-world` uses.
 *
 * The CLI reports the diagnostics of the program BEFORE expansion, filtered by
 * the suppression rules, and there `Point.Eq` does not exist yet: TS2339
 * ("Property 'Eq' does not exist on type 'typeof P'") for a class, TS2693
 * ("'Q' only refers to a type") for an interface or type alias. Nothing
 * suppressed them, so `check` failed on correct code (the expanded program
 * type-checks). A reference to a typeclass the declaration does NOT derive is
 * still an error.
 *
 * Build first: `pnpm --filter @typesugar/transformer build`.
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
const hasBuild = fs.existsSync(cliPath);

const dirs: string[] = [];

function check(files: Record<string, string>): { status: number | null; output: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-companion-"));
  dirs.push(dir);
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        experimentalDecorators: true,
      },
      include: ["src"],
    })
  );
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture", private: true, type: "module" })
  );
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  const r = spawnSync(process.execPath, [cliPath, "check"], {
    cwd: dir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  return { status: r.status, output: (r.stdout ?? "") + (r.stderr ?? "") };
}

afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe.skipIf(!hasBuild)("typesugar check: direct access to a derived companion", () => {
  it("a class, an interface and a type alias: Type.TC is not an error", () => {
    const { status, output } = check({
      "src/shapes.ts": `import { derive, Eq } from "typesugar";
import { Debug } from "@typesugar/std";

@derive(Eq)
class P {
  constructor(public x: number) {}
}
export const s = P.Eq.equals(new P(1), new P(1));

/** @derive(Eq, Debug) */
export interface Q {
  x: number;
}
export const t: boolean = Q.Eq.equals({ x: 1 }, { x: 1 });
export const d: string = Q.Debug.debug({ x: 1 });

/** @derive(Eq) */
export type R = { x: number };
export const u = R.Eq.equals({ x: 1 }, { x: 1 });
`,
      "src/use.ts": `import { Q } from "./shapes";
export const v = Q.Eq.equals({ x: 1 }, { x: 2 });
`,
    });
    expect(output).not.toMatch(/TS2339|TS2693/);
    expect(status, output).toBe(0);
  }, 120_000);

  it("a typeclass the type does not derive, or a type with no @derive, is still an error", () => {
    const { status, output } = check({
      "src/bad.ts": `import { derive, Eq } from "typesugar";
import "@typesugar/std";

/** @derive(Eq) */
export interface Q {
  x: number;
}
export const a = Q.Ord.compare({ x: 1 }, { x: 1 });

export interface Plain {
  x: number;
}
export const b = Plain.Eq.equals({ x: 1 }, { x: 1 });

@derive(Eq)
class P {
  constructor(public x: number) {}
}
export const c = P.Clone.clone(new P(1));
`,
    });
    expect(output).toMatch(/bad\.ts\(8,18\).*TS2693/);
    expect(output).toMatch(/bad\.ts\(13,18\).*TS2693/);
    expect(output).toMatch(/bad\.ts\(19,20\).*TS2339/);
    expect(status, output).not.toBe(0);
  }, 120_000);
});
