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
  let args: string;
  let numeric: string;
  let overloads: string;

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
    // tsc reports only the first failing argument of a call: suppressing the
    // TS2345 on a rewritten `a * b` must not hide the next one (review 6).
    args = makeProject({
      "src/args.ts": `${HEADER}
declare function g(x: Rational, y: string): void;
declare function two(x: Rational, y: Rational): void;
g(a * b, 5);
two(a * b, "x");
two(a * b, a + c);
g(a * b, "fine");
`,
    });
    // TypeScript types a rewritten a * b as number, so a number-typed use of
    // it had no error left once the operand errors were suppressed, and the
    // output threw (review 6).
    numeric = makeProject({
      "src/numeric.ts": `${HEADER}
export const fixed = (a * b).toFixed(2);
export const n: number = a * b;
export const sum: number = a + b;
export function ret(): number { return a / b; }
export const cmp = a * b > 0;
Math.sqrt(a - b);
export const ok1: Rational = a * b;
export const ok2 = rationalToString(a * b + c);
export const ok3 = \`\${rationalToString(a * b)}\`;
console.log(a * b, String(a + b));
`,
    });
    // With overloads, the contextual type is the overload TypeScript chose for
    // the `number` it sees; another may take the rewritten Rational (review 7).
    overloads = makeProject({
      "src/overloads.ts": `${HEADER}
function f(x: number): string;
function f(x: Rational): Rational;
function f(x: number | Rational): string | Rational { return typeof x === "number" ? String(x) : x; }
export const s3: Rational = f(a * b);
function g(x: number): string;
function g(x: string): string;
function g(x: number | string): string { return String(x); }
export const s4 = g(a * b);
function h(x: number): void;
function h(x: Rational, y: string): void;
function h(..._: unknown[]): void {}
h(a * b, "ok");
h(a * b, 5);
console.log(rationalToString(s3), s4);
`,
    });
  });

  afterAll(() => {
    for (const d of [good, bad, args, numeric, overloads]) {
      if (d) fs.rmSync(d, { recursive: true, force: true });
    }
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

  it("an argument after a rewritten operator's is still checked", () => {
    const r = check(args);
    expect(r.status).not.toBe(0);
    const errors = r.output.split("\n").filter((l) => / error TS/.test(l));
    expect(errors).toHaveLength(2);
    expect(r.output).toMatch(
      /args\.ts\(10,10\): error TS2345: Argument of type '5' is not assignable to parameter of type 'string'/
    );
    expect(r.output).toMatch(
      /args\.ts\(11,12\): error TS2345: Argument of type '"x"' is not assignable to parameter of type 'Rational'/
    );
  });

  it("a rewritten value used as a number is an error", () => {
    const r = check(numeric);
    expect(r.status).not.toBe(0);
    const errors = r.output.split("\n").filter((l) => / error TS/.test(l));
    expect(r.output).toMatch(
      /numeric\.ts\(8,30\): error TS2339: Property 'toFixed' does not exist on type 'Rational'/
    );
    expect(r.output).toMatch(
      /numeric\.ts\(9,26\): error TS2322: Type 'Rational' is not assignable to type 'number'/
    );
    expect(r.output).toMatch(/numeric\.ts\(10,28\): error TS2322/);
    expect(r.output).toMatch(/numeric\.ts\(11,\d+\): error TS2322/);
    expect(r.output).toMatch(/numeric\.ts\(12,20\): error TS2365: Operator '>' cannot be applied/);
    expect(r.output).toMatch(/numeric\.ts\(13,11\): error TS2345: Argument of type 'Rational'/);
    expect(r.output).toMatch(/rewritten by typesugar/);
    expect(errors, r.output).toHaveLength(6);
  });

  it("an overloaded callee: an error only when no overload takes the rewritten value", () => {
    const r = check(overloads);
    const errors = r.output.split("\n").filter((l) => / error TS/.test(l));
    // f(a * b): the Rational overload takes it, and returns a Rational (was a
    // false TS2345, and TypeScript's TS2322 for the string overload's result).
    expect(r.output).not.toMatch(/overloads\.ts\(11,/);
    // g(a * b): neither overload takes a Rational.
    expect(r.output).toMatch(
      /overloads\.ts\(15,\d+\): error TS2769: No overload matches this call/
    );
    // h(a * b, "ok") is fine; h(a * b, 5) is not.
    expect(r.output).not.toMatch(/overloads\.ts\(19,/);
    expect(r.output).toMatch(
      /overloads\.ts\(20,10\): error TS2345: Argument of type '5' is not assignable to parameter of type 'string'/
    );
    expect(errors, r.output).toHaveLength(2);
  });
});
