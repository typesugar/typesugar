/**
 * `typesugar check` on typeclass operators other than `+` (review 5, item 6).
 *
 * TypeScript reports `a * b` on two objects as TS2362 (left operand) and
 * TS2363 (right operand), not TS2365, and the OperatorOverload suppression
 * rule covered only TS2365: the operators guide's headline example
 * (`a * b; a / b; a - b` on rationals) made `typesugar check` exit 1 although
 * the emitted `numericRational.mul(a, b)` is correct. TypeScript also types
 * `a * b` as `number`, so passing it on (`rationalToString(product)`) was a
 * TS2345. Each is suppressed exactly when the operator is rewritten; a real
 * error next to it is still reported.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-op-check-"));
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
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

function check(dir: string): { status: number | null; output: string } {
  const r = spawnSync(process.execPath, [cliPath, "check"], {
    cwd: dir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  return { status: r.status, output: (r.stdout ?? "") + (r.stderr ?? "") };
}

const HEADER = `import "@typesugar/std/syntax/numeric/ops";
import "@typesugar/std/syntax/fractional/ops";
import { rational, rationalToString, type Rational } from "@typesugar/math";
const a = rational(1n, 2n);
const b = rational(1n, 3n);
const c = rational(1n, 4n);
`;

describe.skipIf(!hasBuild)("typesugar check: rewritten *, /, - and their results", () => {
  let good: string;
  let bad: string;

  beforeAll(() => {
    good = makeProject({
      // The operators guide's headline example.
      "src/guide.ts": `${HEADER}
export const product = a * b;
export const quotient = a / b;
export const diff = a - b;
console.log(rationalToString(product), rationalToString(quotient), rationalToString(diff));
`,
      "src/chains.ts": `${HEADER}
export const r1 = a + b * c;
export const r2 = a - (b - c);
export const r3 = a * b - c / a;
const typed: Rational = a * b;
function half(x: Rational): Rational { return x / rational(2n, 1n); }
console.log(rationalToString(a * b), rationalToString(typed), rationalToString(half(r3)));
console.log(rationalToString(r1), rationalToString(r2));
`,
    });
    bad = makeProject({
      "src/bad.ts": `${HEADER}
interface V { x: number }
const v: V = { x: 1 };
export const notRewritten = v * v;
export const wrongTarget: string = a * b;
export const notARational = rationalToString(a < b);
`,
    });
  });

  afterAll(() => {
    for (const d of [good, bad]) if (d) fs.rmSync(d, { recursive: true, force: true });
  });

  it("the headline example and chains check clean", () => {
    const r = check(good);
    expect(r.output).not.toMatch(/error TS/);
    expect(r.status, r.output).toBe(0);
  });

  it("an operator that isn't rewritten, or a result that doesn't fit, is still an error", () => {
    const r = check(bad);
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/bad\.ts\(10,\d+\): error TS2362/);
    expect(r.output).toMatch(/bad\.ts\(10,\d+\): error TS2363/);
    expect(r.output).toMatch(/bad\.ts\(11,\d+\): error TS2322/);
    expect(r.output).toMatch(/bad\.ts\(12,\d+\): error TS2345/);
  });
});
