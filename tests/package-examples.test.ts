/**
 * Every `packages/<pkg>/examples/*.ts` compiles and runs with
 * `typesugar run examples/<file>.ts` -- the command the showcases' headers
 * give -- through the BUILT CLI (`packages/transformer/dist/cli.js`), from the
 * package directory, so `@typesugar/*` imports resolve as they do there.
 *
 * Nothing ran these files, so they rotted: std's showcase had a failed
 * typeAssert, a non-exhaustive match and three run-time "is not a function"s
 * (round-2 docs findings). Each example is one test, run one at a time (~1 s
 * and ~350 MB each).
 *
 * KNOWN_BROKEN lists the examples that fail today, with why. They run as
 * `it.fails`, so the suite stays green while they are broken, and a fix shows
 * up as a failure saying to take the file off the list. A NEW failure in any
 * other example fails the suite.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "packages", "transformer", "dist", "cli.js");
const hasBuild = fs.existsSync(cliPath);

const KNOWN_BROKEN: Record<string, string> = {};

function examples(): string[] {
  const out: string[] = [];
  for (const pkg of fs.readdirSync(path.join(repoRoot, "packages")).sort()) {
    const dir = path.join(repoRoot, "packages", pkg, "examples");
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (f.endsWith(".ts") && !f.endsWith(".d.ts")) out.push(`packages/${pkg}/examples/${f}`);
    }
  }
  return out;
}

function runExample(rel: string): { status: number | null; output: string } {
  const pkgDir = path.join(repoRoot, path.dirname(path.dirname(rel)));
  const r = spawnSync(
    process.execPath,
    [cliPath, "run", path.join("examples", path.basename(rel))],
    {
      cwd: pkgDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    }
  );
  return { status: r.status, output: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe.skipIf(!hasBuild)("package examples run with `typesugar run`", () => {
  const all = examples();

  it("every KNOWN_BROKEN entry is an existing example", () => {
    expect(Object.keys(KNOWN_BROKEN).filter((f) => !all.includes(f))).toEqual([]);
  });

  for (const rel of all) {
    const reason = KNOWN_BROKEN[rel];
    if (reason) {
      // Known broken (reason in KNOWN_BROKEN), tracked on PR #83: expected to
      // fail until fixed, then this flips to a failure and the entry goes.
      it.fails(
        `${rel} (known broken: ${reason}; remove it from KNOWN_BROKEN once it runs)`,
        () => {
          const { status, output } = runExample(rel);
          expect(status, output.slice(-3000)).toBe(0);
        },
        120_000
      );
    } else {
      it(
        rel,
        () => {
          const { status, output } = runExample(rel);
          expect(status, output.slice(-3000)).toBe(0);
        },
        120_000
      );
    }
  }
});
