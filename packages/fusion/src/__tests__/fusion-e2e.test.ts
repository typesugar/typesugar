/**
 * End-to-end tests for the `fused()` macro: run the real transformer over a
 * source file, then EXECUTE the emitted code and compare against the unfused
 * (plain Array / LazyPipeline) semantics.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import * as ts from "typescript";
import "../macros.js";
import * as fusionRuntime from "../index.js";
// @ts-ignore -- the transformer is not a dependency of this package; load its built pipeline directly
import { transformCode } from "../../../transformer/dist/pipeline.js";

const FILE = path.resolve(__dirname, "../../__fusion_e2e_input.ts");

interface Expanded {
  code: string;
  diagnostics: { message: string; severity: string }[];
}

function expand(src: string): Expanded {
  const r = transformCode(src, { fileName: FILE });
  return {
    code: r.code,
    diagnostics: (r.diagnostics ?? []).map((d: any) => ({
      message: String(d.message),
      severity: String(d.severity),
    })),
  };
}

function run(code: string, globals: Record<string, unknown> = {}): Record<string, any> {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} as Record<string, any> };
  const req = (id: string) => {
    if (id === "@typesugar/fusion") return fusionRuntime;
    throw new Error("unexpected require: " + id);
  };
  const names = Object.keys(globals);
  new Function("require", "module", "exports", ...names, js)(
    req,
    mod,
    mod.exports,
    ...names.map((n) => globals[n])
  );
  return mod.exports;
}

const HEADER = `import { fused, lazy } from "@typesugar/fusion";\n`;

/** Expand, assert the fused() call was rewritten (no fused( left), and run. */
function expandAndRun(body: string, globals: Record<string, unknown> = {}) {
  const e = expand(HEADER + body);
  return { ...e, out: run(e.code, globals) };
}

describe("fused() on arrays keeps Array callback semantics (FMG-3)", () => {
  it("passes the element index to map callbacks", () => {
    const { out, code } = expandAndRun(`
const arr: number[] = [1, 2, 3];
export const r = fused(arr.map((x, i) => x * i).reduce((a, b) => a + b, 0));
`);
    expect(code).not.toMatch(/\bfused\(/);
    expect(out.r).toBe([1, 2, 3].map((x, i) => x * i).reduce((a, b) => a + b, 0));
  });

  it("passes the element index to reduce callbacks", () => {
    const { out } = expandAndRun(`
const arr: number[] = [1, 2, 3];
export const r = fused(arr.reduce((a, b, i) => a + b * i, 0));
`);
    expect(out.r).toBe(8);
  });

  it("indexes each stage by the elements that reached it (map after filter)", () => {
    const { out } = expandAndRun(`
const arr: number[] = [5, 6, 7, 8];
export const r = fused(arr.filter((x) => x % 2 === 0).map((x, i) => i).reduce((a, b) => a + b * 10, 0));
`);
    expect(out.r).toBe(
      [5, 6, 7, 8]
        .filter((x) => x % 2 === 0)
        .map((_x, i) => i)
        .reduce((a, b) => a + b * 10, 0)
    );
  });

  it("calls a function-reference callback with (value, index, array) like Array.map", () => {
    const { out } = expandAndRun(`
const strs: string[] = ["1", "2", "3"];
export const r = fused(strs.map(parseInt).some((n) => Number.isNaN(n)));
`);
    expect(out.r).toBe(["1", "2", "3"].map(parseInt).some((n) => Number.isNaN(n)));
    expect(out.r).toBe(true);
  });

  it("evaluates a callback expression once, and does not rebind this", () => {
    const { out } = expandAndRun(`
let made = 0;
function makeMapper() { made++; return (x: number) => x + 1; }
const obj = { k: 10, m(this: any, x: number) { return this === undefined ? x : -1; } };
const arr: number[] = [1, 2, 3];
export const r1 = fused(arr.map(makeMapper()).reduce((a, b) => a + b, 0));
export const madeCount = made;
export const r2 = fused(arr.map(obj.m).reduce((a, b) => a + b, 0));
`);
    expect(out.r1).toBe(9);
    expect(out.madeCount).toBe(1);
    // Array.prototype.map calls obj.m with this === undefined (strict mode)
    expect(out.r2).toBe(6);
  });

  it("passes the source array to a first-stage callback that declares it", () => {
    const { out } = expandAndRun(`
const arr: number[] = [1, 2, 3];
export const r = fused(arr.map((x, i, a) => a.length).reduce((s, n) => s + n, 0));
`);
    expect(out.r).toBe(9);
  });

  it("does not fuse when a later stage needs the intermediate array", () => {
    const { out, code } = expandAndRun(`
const arr: number[] = [1, 2, 3, 4];
export const r = fused(arr.filter((x) => x > 1).map((x, i, a) => a.length).reduce((s, n) => s + n, 0));
`);
    expect(code).not.toMatch(/\bfused\(/);
    expect(out.r).toBe(9);
  });
});

describe("fused() with await / yield in moved expressions (FMG-4)", () => {
  it("does not move an await into a sync IIFE; reports a warning and leaves it unfused", async () => {
    const e = expand(
      HEADER +
        `
async function load(): Promise<number[]> { return [1, 2, 3]; }
export async function f() { return fused((await load()).map((x) => x * 2).reduce((a, b) => a + b, 0)); }
`
    );
    expect(e.diagnostics.some((d) => d.severity === "warning" && /await/.test(d.message))).toBe(
      true
    );
    const out = run(e.code);
    await expect(out.f()).resolves.toBe(12);
  });

  it("handles yield in the reduce init", () => {
    const e = expand(
      HEADER +
        `
const arr: number[] = [1, 2, 3];
export function* g(): Generator<number, number, number> { return fused(arr.reduce((a, b) => a + b, yield 0)); }
`
    );
    expect(e.diagnostics.some((d) => /yield/.test(d.message))).toBe(true);
    const out = run(e.code);
    const it = out.g();
    it.next();
    expect(it.next(100).value).toBe(106);
  });
});

describe("fused() receiver checks (FMG-11)", () => {
  it("fuses a lazy(x) root over the underlying iterable", () => {
    const { out, code } = expandAndRun(`
const arr: number[] = [1, 2, 3, 4];
export const r = fused(lazy(arr).map((x) => x * 2).filter((x) => x > 2).toArray());
export const s = fused(lazy(arr).map((x) => x * x).sum());
export const n = fused(lazy(arr).filter((x) => x > 1).count());
export const f = fused(lazy(arr).filter((x) => x > 10).first());
`);
    expect(code).not.toMatch(/\bfused\(/);
    expect(out.r).toEqual([4, 6, 8]);
    expect(out.s).toBe(30);
    expect(out.n).toBe(3);
    // LazyPipeline.first() returns null for an empty result; fusion keeps that.
    expect(out.f).toBe(null);
  });

  it("leaves non-array receivers alone (their own map/reduce semantics apply)", () => {
    const { out } = expandAndRun(`
class Box { constructor(public v: number) {} map(f: (x: number) => number) { return new Box(f(this.v)); } reduce(f: (a: number, b: number) => number, init: number) { return f(init, this.v) * 100; } }
export const r = fused(new Box(2).map((x) => x + 1).reduce((a, b) => a + b, 1));
`);
    expect(out.r).toBe(400);
  });

  it("array find returns undefined (not null) when nothing matches", () => {
    const { out } = expandAndRun(`
const arr: number[] = [1, 2, 3];
export const r = fused(arr.map((x) => x * 2).find((x) => x > 100));
export const hit = fused(arr.map((x) => x * 2).find((x) => x > 3));
`);
    expect(out.r).toBe(undefined);
    expect(out.hit).toBe(4);
  });
});

describe("fused() take does not over-pull (FMG-14)", () => {
  it("pulls exactly n source elements and runs upstream effects n times", () => {
    const pulled: number[] = [];
    const logged: number[] = [];
    function* gen() {
      for (let i = 0; i < 10; i++) {
        pulled.push(i);
        yield i;
      }
    }
    const { out } = expandAndRun(
      `
declare const gen: () => Iterable<number>;
declare const log: (x: number) => number;
export const r = fused(lazy(gen()).map(log).take(2).toArray());
`,
      { gen, log: (x: number) => (logged.push(x), x) }
    );
    expect(out.r).toEqual([0, 1]);
    expect(logged).toEqual([0, 1]);
    expect(pulled).toEqual([0, 1]);
  });

  it("take(0) pulls nothing", () => {
    const pulled: number[] = [];
    function* gen() {
      for (let i = 0; i < 3; i++) {
        pulled.push(i);
        yield i;
      }
    }
    const { out } = expandAndRun(
      `
declare const gen: () => Iterable<number>;
export const r = fused(lazy(gen()).take(0).toArray());
`,
      { gen }
    );
    expect(out.r).toEqual([]);
    expect(pulled).toEqual([]);
  });

  it("take after a filter still counts only passing elements", () => {
    const { out } = expandAndRun(`
const arr: number[] = [1, 2, 3, 4, 5, 6];
export const r = fused(lazy(arr).filter((x) => x % 2 === 0).take(2).toArray());
`);
    expect(out.r).toEqual([2, 4]);
  });
});

describe("fused() names are per-file and reproducible (FMG-16)", () => {
  it("expanding the same file twice yields identical output", () => {
    const src =
      HEADER +
      `
const arr: number[] = [1, 2, 3];
export const r = fused(arr.map((x) => x * 2).reduce((a, b) => a + b, 0));
`;
    const a = expand(src).code;
    const b = expand(src).code;
    expect(a).toBe(b);
  });
});

// Coverage formerly in fusion-macro.test.ts (which grepped printed output from a
// stub context with no type checker): every supported chain shape, executed and
// compared with the unfused result.
describe("fused() supported chains execute like the unfused chain", () => {
  const arrayCases: [string, unknown][] = [
    ["arr.map((x) => x * 2).reduce((a, b) => a + b, 0)", 20],
    ["arr.map((x) => x * 2).filter((x) => x > 5).reduce((a, b) => a + b, 0)", 14],
    [
      "arr.map((x) => x + 1).map((x) => x * 2).reduce((a, b) => a.concat([b]), [] as number[])",
      [4, 6, 8, 10],
    ],
    [
      "arr.filter((x) => x > 1).map((x) => x * 2).filter((x) => x < 8).reduce((a, b) => a + b, 0)",
      10,
    ],
    ["arr.map((x) => x * 2).find((x) => x > 5)", 6],
    ["arr.filter((x) => x > 0).some((x) => x === 3)", true],
    ["arr.map((x) => x > 0).every((x) => x)", true],
    ["arr.map((x) => x > 2).every((x) => x)", false],
  ];
  for (const [chain, expected] of arrayCases) {
    it(`array: ${chain}`, () => {
      const { out, code } = expandAndRun(`
const arr: number[] = [1, 2, 3, 4];
export const r = fused(${chain});
`);
      expect(code).not.toMatch(/\bfused\(/);
      expect(code).toContain("for (const");
      expect(out.r).toEqual(expected);
    });
  }

  it("array: forEach", () => {
    const seen: number[] = [];
    const { out } = expandAndRun(
      `
declare const sink: (x: number) => void;
const arr: number[] = [1, 2, 3, 4];
fused(arr.filter((x) => x > 2).forEach((x) => sink(x)));
export const done = true;
`,
      { sink: (x: number) => seen.push(x) }
    );
    expect(out.done).toBe(true);
    expect(seen).toEqual([3, 4]);
  });

  const lazyCases: [string, unknown][] = [
    ["lazy(arr).filter((x) => x > 0).toArray()", [1, 2, 3, 4]],
    ["lazy(arr).map((x) => x * x).sum()", 30],
    ["lazy(arr).filter((x) => x % 2 === 0).count()", 2],
    ["lazy(arr).filter((x) => x > 1).first()", 2],
    ["lazy(arr).map((x) => x * 2).last()", 8],
    ["lazy(arr).filter((x) => x > 9).last()", null],
    ["lazy(arr).map((x) => x * 2).find((x) => x > 100)", null],
    ["lazy(arr).map((x) => x * 2).take(3).toArray()", [2, 4, 6]],
    ["lazy(arr).filter((x) => x > 1).take(2).reduce((a, b) => a + b, 0)", 5],
    ["lazy(arr).take(10).map((x) => x * x).sum()", 30],
    ["lazy(arr).take(3).take(2).toArray()", [1, 2]],
  ];
  for (const [chain, expected] of lazyCases) {
    it(`lazy: ${chain} (matches LazyPipeline)`, () => {
      const { out, code } = expandAndRun(`
const arr: number[] = [1, 2, 3, 4];
export const r = fused(${chain});
export const runtime = ${chain};
`);
      expect(code).toContain("for (const");
      expect(out.r).toEqual(expected);
      expect(out.r).toEqual(out.runtime);
    });
  }

  it("leaves unsupported shapes unfused but correct", () => {
    const { out, code } = expandAndRun(`
const arr: number[] = [1, 2, 3];
export const a = fused(arr.flatMap((x) => [x, x]).reduce((s, n) => s + n, 0));
export const b = fused(42);
export const c = fused(arr.reduce((s, n) => s + n));
export const d = fused(lazy(arr).map((x) => x + 1).toArray());
`);
    expect(code).not.toMatch(/\bfused\(/);
    expect(out.a).toBe(12);
    expect(out.b).toBe(42);
    expect(out.c).toBe(6);
    expect(out.d).toEqual([2, 3, 4]);
  });

  it("does not leave the lazy import dangling when lazy() is used outside fused()", () => {
    const { out } = expandAndRun(`
export const r = lazy([1, 2, 3]).map((x) => x * 2).toArray();
`);
    expect(out.r).toEqual([2, 4, 6]);
  });
});
