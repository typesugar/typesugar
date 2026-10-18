/**
 * Semantic-safety tests for always-on instance-call inlining and
 * auto-specialization (deep review 1.0: macros-typeclass #1-#4, #8, #9, #18;
 * core #4, #5, #6, #9).
 *
 * Every test here EXECUTES both the untransformed and the transformed module
 * and compares results — the inliner is allowed to decline (falling back to
 * the plain call is always correct), never to change behaviour.
 */

import * as ts from "typescript";
import { describe, it, expect } from "vitest";
import { transformCode } from "../src/transform.js";

const OPTS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: false,
  noEmit: true,
  skipLibCheck: true,
};

let projectCounter = 0;

/** Build one program over in-memory files under a unique virtual root. */
function makeProgram(files: Record<string, string>): {
  program: ts.Program;
  paths: Record<string, string>;
} {
  const root = `/virtual/specsafety${projectCounter++}`;
  const abs: Record<string, string> = {};
  const paths: Record<string, string> = {};
  for (const [name, text] of Object.entries(files)) {
    const p = `${root}/${name}`;
    abs[p] = text;
    paths[name] = p;
  }
  const host = ts.createCompilerHost(OPTS);
  const orig = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lv, ...rest) =>
    abs[f] !== undefined ? ts.createSourceFile(f, abs[f], lv, true) : orig(f, lv, ...rest);
  const origExists = host.fileExists.bind(host);
  host.fileExists = (f) => abs[f] !== undefined || origExists(f);
  const origRead = host.readFile.bind(host);
  host.readFile = (f) => abs[f] ?? origRead(f);
  const origDirExists = host.directoryExists?.bind(host);
  host.directoryExists = (d) => d.startsWith(root) || (origDirExists ? origDirExists(d) : false);
  const program = ts.createProgram(Object.values(paths), OPTS, host);
  return { program, paths };
}

/** Transform every file (in the given order) with one shared program. */
function transformAll(files: Record<string, string>): Record<string, string> {
  const { program, paths } = makeProgram(files);
  const out: Record<string, string> = {};
  for (const name of Object.keys(files)) {
    const r = transformCode(files[name], { fileName: paths[name], program });
    out[name] = r.code;
  }
  return out;
}

/** Transpile each file to CJS and run `entry`, resolving `./x` between files. */
function run(files: Record<string, string>, entry: string): Record<string, unknown> {
  const cache = new Map<string, Record<string, unknown>>();
  const load = (name: string): Record<string, unknown> => {
    const hit = cache.get(name);
    if (hit) return hit;
    const src = files[name];
    if (src === undefined) throw new Error(`no module ${name}`);
    const js = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports: Record<string, unknown> = {};
    cache.set(name, exports);
    const req = (spec: string): unknown => {
      const m = /^\.\/(.+)$/.exec(spec);
      if (!m) throw new Error(`unexpected import ${spec}`);
      return load(m[1].endsWith(".ts") ? m[1] : `${m[1]}.ts`);
    };
    new Function("exports", "require", js)(exports, req);
    return exports;
  };
  return load(entry);
}

/** Result of running a module, or the thrown error's constructor name + message. */
function outcome(files: Record<string, string>, entry: string): unknown {
  try {
    const exp = run(files, entry);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(exp)) {
      out[k] = JSON.parse(
        JSON.stringify(v === undefined ? null : v, (_key, x) =>
          typeof x === "function" ? "<fn>" : x
        )
      );
    }
    return out;
  } catch (e) {
    return `THREW ${(e as Error).constructor.name}: ${(e as Error).message}`;
  }
}

function expectSameSemantics(files: Record<string, string>, entry: string): string {
  const transformed = transformAll(files);
  const before = outcome(files, entry);
  const after = outcome(transformed, entry);
  expect({ after, code: transformed[entry] }).toEqual({ after: before, code: transformed[entry] });
  return transformed[entry];
}

describe("instance-call inlining preserves semantics", () => {
  it("does not inline method bodies that use `this` (and does not delete the object) [tc#2]", () => {
    const code = expectSameSemantics(
      {
        "main.ts": `
interface Store<T> { get(): T }
const store: Store<number> = { state: 7, get() { return this.state; } } as any;
export const r = store.get();
`,
      },
      "main.ts"
    );
    expect(code).toContain("store");
  });

  it("does not inline `notEquals` that delegates through `this` [tc#2]", () => {
    expectSameSemantics(
      {
        "main.ts": `
interface Eq<A> { equals(a: A, b: A): boolean; notEquals(a: A, b: A): boolean }
const eqN: Eq<number> = {
  equals(a, b) { return a === b; },
  notEquals(a, b) { return !this.equals(a, b); },
};
export const r = eqN.notEquals(1, 2);
`,
      },
      "main.ts"
    );
  });

  it("substitutes params only at references, not property names [tc#1]", () => {
    expectSameSemantics(
      {
        "main.ts": `
interface Eq<A> { equals(a: A, b: A): boolean }
type P = { x: number; y: number; p1?: number };
const eqPoint: Eq<P> = { equals: (x, y) => x.x === y.x && x.y === y.y };
const p1: P = { x: 1, y: 2 };
const p2: P = { x: 1, y: 3 };
export const r = eqPoint.equals(p1, p2);
`,
      },
      "main.ts"
    );
  });

  it("evaluates side-effecting arguments exactly once, in order [tc#3, core#6]", () => {
    expectSameSemantics(
      {
        "main.ts": `
interface Eq<A> { equals(a: A, b: A): boolean }
interface Semi<A> { combine(a: A, b: A): A }
type P = { x: number; y: number };
const eqPoint: Eq<P> = { equals: (a, b) => a.x === b.x && a.y === b.y };
const semi: Semi<string> = { combine: (a, b) => b + a };
const log: string[] = [];
let i = 0;
const pts: P[] = [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 2 }];
function next(): P { log.push("next" + i); return pts[i++]; }
function f(): string { log.push("f"); return "F"; }
function g(): string { log.push("g"); return "G"; }
export const eq = eqPoint.equals(next(), next());
export const c = semi.combine(f(), g());
export const trace = log.join(",");
export const count = i;
`,
      },
      "main.ts"
    );
  });

  it("an unrelated same-named local in another file gets its own body [tc#8, core#4]", () => {
    const files = {
      "a.ts": `
interface Eq<A> { equals(a: A, b: A): boolean }
function helperA(a: number, b: number) { return Math.abs(a - b) < 0.01; }
export const eqApprox: Eq<number> = { equals: (a, b) => helperA(a, b) };
export const ra = eqApprox.equals(1, 1.001);
`,
      "b.ts": `
const eqApprox = { equals: (a: number, b: number) => a === b, label: "strict" };
export function f(x: number, y: number) { return eqApprox.equals(x, y); }
export const rb = f(1, 1.001);
`,
    };
    const out = transformAll(files);
    expect(outcome(out, "b.ts")).toEqual(outcome(files, "b.ts"));
    expect(outcome(out, "a.ts")).toEqual(outcome(files, "a.ts"));
  });

  it("an unannotated same-named object in another file is not inlined or deleted [core#4]", () => {
    const files = {
      "a.ts": `
interface Eq<A> { equals(a: A, b: A): boolean }
export const eqPoint: Eq<any> = { equals: (a, b) => a.x === b.x };
export const ra = eqPoint.equals({ x: 1 }, { x: 1 });
`,
      "b.ts": `
const eqPoint = { equals: (a: number, b: number) => false };
export const r = eqPoint.equals(1, 2);
`,
    };
    const out = transformAll(files);
    expect(outcome(out, "b.ts")).toEqual(outcome(files, "b.ts"));
    expect(out["b.ts"]).toContain("eqPoint");
  });

  it("a call-site local does not capture a module-level helper the body references [tc#18]", () => {
    expectSameSemantics(
      {
        "main.ts": `
interface Show<A> { show(a: A): string }
function helper(n: number) { return "h" + n; }
const showN: Show<number> = { show: (n) => helper(n) };
export function outer() {
  const helper = (n: number) => "LOCAL" + n;
  return showN.show(1) + helper(2);
}
export const r = outer();
`,
      },
      "main.ts"
    );
  });

  it("does not inline methods whose instance object is mutated", () => {
    expectSameSemantics(
      {
        "main.ts": `
interface Show<A> { show(a: A): string }
const showN: Show<number> = { show: (n) => "orig" + n };
showN.show = (n) => "patched" + n;
export const r = showN.show(1);
`,
      },
      "main.ts"
    );
  });

  it("never rewrites a native array method call to an instance call", () => {
    const code = expectSameSemantics(
      {
        "main.ts": `
interface ParCombine<F> { map(fa: any, f: (a: any) => any): any }
export const parCombinePromise: ParCombine<Promise<any>> = { map: (fa, f) => fa.then(f) };
const bindSteps: number[] = [1, 2, 3];
export const r = bindSteps.map((s) => s * 2);
`,
      },
      "main.ts"
    );
    expect(code).toContain("bindSteps.map(");
    expect(code).not.toContain("parCombinePromise.map(bindSteps");
  });

  it("inlining still happens for simple, safe calls (coverage)", () => {
    const code = expectSameSemantics(
      {
        "main.ts": `
interface Eq<A> { equals(a: A, b: A): boolean }
type P = { x: number; y: number };
const eqPoint: Eq<P> = { equals: (a, b) => a.x === b.x && a.y === b.y };
export function same(p: P, q: P) { return eqPoint.equals(p, q); }
export const r = same({ x: 1, y: 2 }, { x: 1, y: 2 });
`,
      },
      "main.ts"
    );
    expect(code).toMatch(/p\.x === q\.x/);
  });
});

describe("dead-instance elimination [core#5]", () => {
  it("keeps exported instances and sibling declarators", () => {
    const files = {
      "main.ts": `
interface Eq<A> { equals(a: A, b: A): boolean }
type P = { x: number };
export const eqPoint: Eq<P> = { equals: (a, b) => a.x === b.x }, VERSION = 3;
const p1: P = { x: 1 };
export const same = eqPoint.equals(p1, p1);
`,
    };
    const out = transformAll(files);
    const res = outcome(out, "main.ts") as Record<string, unknown>;
    expect(res).toEqual(outcome(files, "main.ts"));
    expect(res.VERSION).toBe(3);
    expect(res.eqPoint).toBeDefined();
  });
});

describe("auto-specialization preserves semantics", () => {
  it("different instances of the same type get different specializations [tc#9]", () => {
    expectSameSemantics(
      {
        "main.ts": `
interface Show<A> { show(a: A): string }
type P = { x: number };
const showShort: Show<P> = { show: (p) => "s" + p.x };
const showLong: Show<P> = { show: (p) => "long(" + p.x + ")" };
function display(S: Show<P>, p: P): string { return S.show(p); }
const p: P = { x: 1 };
export const a = display(showShort, p);
export const b = display(showLong, p);
`,
      },
      "main.ts"
    );
  });

  it("argument order of two dictionaries matters [tc#9]", () => {
    expectSameSemantics(
      {
        "main.ts": `
interface Show<A> { show(a: A): string }
const sa: Show<number> = { show: (n) => "A" + n };
const sb: Show<number> = { show: (n) => "B" + n };
function pair(X: Show<number>, Y: Show<number>, n: number): string { return X.show(n) + Y.show(n); }
export const r1 = pair(sa, sb, 1);
export const r2 = pair(sb, sa, 1);
`,
      },
      "main.ts"
    );
  });

  it("a caller-local does not capture the callee's free identifiers [core#9]", () => {
    expectSameSemantics(
      {
        "main.ts": `
interface Num<A> { add(a: A, b: A): A }
const numInst: Num<number> = { add: (a, b) => a + b };
const n = 10;
const addN = (E: Num<number>, x: number) => E.add(x, n);
export function g() { const n = 99; return addN(numInst, 1) + n * 0; }
export const r = g();
`,
      },
      "main.ts"
    );
  });

  it("drops explicit type arguments on the rewritten call [core#9]", () => {
    const out = transformAll({
      "main.ts": `
interface Show<A> { show(a: A): string }
const showN: Show<number> = { show: (n) => "n" + n };
function disp<T>(S: Show<T>, x: T): string { return S.show(x); }
export const r = disp<number>(showN, 1);
`,
    });
    expect(out["main.ts"]).not.toMatch(/__\w*disp\w*<number>/);
  });

  it("does not specialize when the dictionary escapes the callee", () => {
    expectSameSemantics(
      {
        "main.ts": `
interface Show<A> { show(a: A): string }
const showN: Show<number> = { show: (n) => "n" + n };
function keep(S: Show<number>) { return S; }
function disp(S: Show<number>, x: number): string { return keep(S).show(x) + S.show(x); }
export const r = disp(showN, 1);
`,
      },
      "main.ts"
    );
  });
});
