/**
 * std's Semigroup / Monoid / Group / Numeric / Integral / Fractional
 * `/ops` markers rewrite operators (docs review 2026-10, S#4 part 3, B#13).
 *
 * Operator candidates come only from `@op` JSDoc tags on the typeclass
 * declaration (macros/src/typeclass-index.ts); these typeclasses carried none,
 * so `import "@typesugar/std/syntax/semigroup/ops"` did nothing and `a + b`
 * on a Vec2 stayed string concatenation. Every case transforms through the
 * real pipeline and RUNS the output.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as std from "@typesugar/std";

import "@typesugar/macros";
import "@typesugar/std/macros";

import { TransformationPipeline } from "@typesugar/transformer";

const here = path.dirname(fileURLToPath(import.meta.url));
let counter = 0;

function transform(code: string) {
  const fileName = path.resolve(here, `__std_ops_${counter++}.ts`);
  const pipeline = new TransformationPipeline(
    {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      lib: ["lib.es2023.d.ts"],
    },
    [fileName],
    {
      readFile: (f) => (f === fileName ? code : ts.sys.readFile(f)),
      fileExists: (f) => f === fileName || ts.sys.fileExists(f),
    }
  );
  return pipeline.transform(fileName);
}

function run(code: string) {
  const r = transform(code);
  const errors = (r.diagnostics ?? []).filter((d) => d.severity === "error").map((d) => d.message);
  const js = ts.transpileModule(r.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  const req = (spec: string) => {
    if (spec === "@typesugar/std") return std;
    if (spec.startsWith("@typesugar/std/syntax/")) return {};
    throw new Error(`unexpected require(${spec})`);
  };
  new Function("require", "exports", "module", js)(req, mod.exports, mod);
  if (errors.length) throw new Error(`errors: ${errors.join("; ")}\n--- emitted ---\n${r.code}`);
  return { exports: mod.exports, code: r.code };
}

const VEC = `type Vec2 = { x: number; y: number };
const v = (x: number, y: number): Vec2 => ({ x, y });
const a = v(1, 2);
const b = v(10, 20);
`;

describe("std operator syntax markers", () => {
  it("Semigroup: a + b → combine", () => {
    const { exports } = run(`import type { Semigroup } from "@typesugar/std";
import "@typesugar/std/syntax/semigroup/ops";
${VEC}
/** @impl Semigroup<Vec2> */
export const semigroupVec2: Semigroup<Vec2> = { combine: (p, q) => ({ x: p.x + q.x, y: p.y + q.y }) };
export const r = a + b;`);
    expect(exports.r).toEqual({ x: 11, y: 22 });
  });

  it("Monoid: a + b → combine", () => {
    const { exports } = run(`import type { Monoid } from "@typesugar/std";
import "@typesugar/std/syntax/monoid/ops";
${VEC}
/** @impl Monoid<Vec2> */
export const monoidVec2: Monoid<Vec2> = {
  combine: (p, q) => ({ x: p.x + q.x, y: p.y + q.y }),
  empty: () => ({ x: 0, y: 0 }),
};
export const r = a + b;`);
    expect(exports.r).toEqual({ x: 11, y: 22 });
  });

  it("Group: a + b → combine", () => {
    const { exports } = run(`import type { Group } from "@typesugar/std";
import "@typesugar/std/syntax/group/ops";
${VEC}
/** @impl Group<Vec2> */
export const groupVec2: Group<Vec2> = {
  combine: (p, q) => ({ x: p.x + q.x, y: p.y + q.y }),
  empty: () => ({ x: 0, y: 0 }),
  invert: (p) => ({ x: -p.x, y: -p.y }),
};
export const r = a + b;`);
    expect(exports.r).toEqual({ x: 11, y: 22 });
  });

  it("Numeric: + - * (and `/` is left to Fractional/Integral)", () => {
    const { exports } = run(`import type { Numeric } from "@typesugar/std";
import "@typesugar/std/syntax/numeric/ops";
${VEC}
const lift = (f: (m: number, n: number) => number) => (p: Vec2, q: Vec2): Vec2 => ({ x: f(p.x, q.x), y: f(p.y, q.y) });
/** @impl Numeric<Vec2> */
export const numericVec2: Numeric<Vec2> = {
  add: lift((m, n) => m + n),
  sub: lift((m, n) => m - n),
  mul: lift((m, n) => m * n),
  div: lift((m, n) => m / n),
  pow: lift((m, n) => m ** n),
  negate: (p) => ({ x: -p.x, y: -p.y }),
  abs: (p) => ({ x: Math.abs(p.x), y: Math.abs(p.y) }),
  signum: (p) => ({ x: Math.sign(p.x), y: Math.sign(p.y) }),
  fromNumber: (n) => ({ x: n, y: n }),
  toNumber: (p) => p.x,
  zero: () => ({ x: 0, y: 0 }),
  one: () => ({ x: 1, y: 1 }),
};
export const r = [a + b, b - a, a * b];`);
    expect(exports.r).toEqual([
      { x: 11, y: 22 },
      { x: 9, y: 18 },
      { x: 10, y: 40 },
    ]);
  });

  it("Integral: / and %", () => {
    const { exports } = run(`import type { Integral } from "@typesugar/std";
import "@typesugar/std/syntax/integral/ops";
type N = { n: number };
const w = (n: number): N => ({ n });
/** @impl Integral<N> */
export const integralN: Integral<N> = {
  div: (p, q) => w(Math.floor(p.n / q.n)),
  mod: (p, q) => w(((p.n % q.n) + q.n) % q.n),
  divMod: (p, q) => [w(Math.floor(p.n / q.n)), w(p.n % q.n)],
  quot: (p, q) => w(Math.trunc(p.n / q.n)),
  rem: (p, q) => w(p.n % q.n),
  toInteger: (p) => BigInt(p.n),
};
const x = w(-7);
const y = w(2);
export const r = [x / y, x % y];`);
    expect(exports.r).toEqual([{ n: -4 }, { n: 1 }]);
  });

  it("Fractional: /", () => {
    const { exports } = run(`import type { Fractional } from "@typesugar/std";
import "@typesugar/std/syntax/fractional/ops";
type Q = { q: number };
/** @impl Fractional<Q> */
export const fractionalQ: Fractional<Q> = {
  div: (p, r) => ({ q: p.q / r.q }),
  recip: (p) => ({ q: 1 / p.q }),
  fromRational: (n, d) => ({ q: n / d }),
};
const x: Q = { q: 1 };
const y: Q = { q: 4 };
export const r = x / y;`);
    expect(exports.r).toEqual({ q: 0.25 });
  });
});

// TS9804: without the `/ops` import the operator stays native, and typesugar
// now says so, naming std's marker specifier (from std's registered
// syntax-marker fallback) — the docs/examples/math/numeric-typeclass.ts bug.
describe("std operators without their /ops import warn TS9804", () => {
  const NUMERIC_VEC = `import type { Numeric } from "@typesugar/std";
${VEC}
const lift = (f: (m: number, n: number) => number) => (p: Vec2, q: Vec2): Vec2 => ({ x: f(p.x, q.x), y: f(p.y, q.y) });
/** @impl Numeric<Vec2> */
export const numericVec2: Numeric<Vec2> = {
  add: lift((m, n) => m + n),
  sub: lift((m, n) => m - n),
  mul: lift((m, n) => m * n),
  div: lift((m, n) => m / n),
  pow: lift((m, n) => m ** n),
  negate: (p) => ({ x: -p.x, y: -p.y }),
  abs: (p) => ({ x: Math.abs(p.x), y: Math.abs(p.y) }),
  signum: (p) => ({ x: Math.sign(p.x), y: Math.sign(p.y) }),
  fromNumber: (n) => ({ x: n, y: n }),
  toNumber: (p) => p.x,
  zero: () => ({ x: 0, y: 0 }),
  one: () => ({ x: 1, y: 1 }),
};
`;

  it("Numeric: a + b and a * b each get one hint naming @typesugar/std/syntax/numeric/ops", () => {
    const r = transform(`${NUMERIC_VEC}
// @ts-ignore
export const s = a + b;
// @ts-ignore
export const p = a * b;`);
    const hints = (r.diagnostics ?? []).filter((d) => d.code === 9804);
    expect(hints).toHaveLength(2);
    expect(hints[0].message).toContain("Numeric.add");
    expect(hints[1].message).toContain("Numeric.mul");
    for (const h of hints) {
      expect(h.severity).toBe("warning");
      expect(h.message).toContain(`import "@typesugar/std/syntax/numeric/ops";`);
    }
    expect(r.code).toContain("a + b");
  });

  it("the method-tier import alone does not activate operators, so it still warns", () => {
    const r = transform(`${NUMERIC_VEC}
import "@typesugar/std/syntax/numeric";
// @ts-ignore
export const s = a + b;`);
    expect((r.diagnostics ?? []).filter((d) => d.code === 9804)).toHaveLength(1);
  });

  it("no hint once the /ops import is present", () => {
    const r = transform(`${NUMERIC_VEC}
import "@typesugar/std/syntax/numeric/ops";
export const s = a + b;`);
    expect((r.diagnostics ?? []).filter((d) => d.code === 9804)).toEqual([]);
    expect(r.code).not.toContain("a + b");
  });
});
