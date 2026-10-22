/**
 * Instance-call inlining across modules keeps every name the inlined body
 * uses resolvable (turf case study, round 2, item 1).
 *
 * `typesugar check --strict` in @typesugar/fp found three shapes where an
 * `@impl` instance's method body was copied into another module without the
 * names it uses:
 *
 * - `ordNumber.eqv(NaN, NaN)` became `compareNumber(NaN, NaN) === EQ`, where
 *   `compareNumber` is private to eq.ts and neither name is imported at the
 *   call site: a ReferenceError at run time.
 * - `arrayTraverse.traverse(G)` became a body using `snoc`, `emptyAcc` and
 *   `accToArray`, which instances.ts imports but the caller does not.
 * - `destructureSome.extract(x)` became `(o as unknown as A)`, where `A` is
 *   the method's own type parameter, unbound once the body is inlined.
 *
 * `@impl` registered its methods without the symbols their free names
 * resolve to, and the call-site check accepted any name that resolved to
 * nothing there. Each test transforms a real two-module program, in program
 * order, and executes the output.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import { clearTypeRewrites, standaloneExtensionRegistry } from "@typesugar/core";
import "@typesugar/macros";

import { transformCode, type TransformCodeResult } from "../src/transform.js";
import { resetDtsDiscovery } from "../src/dts-opaque-discovery.js";

type Files = Record<string, string>;

/** Transform every file of one on-disk program, dependencies first. */
function transformAll(files: Files, order: string[]): Record<string, TransformCodeResult> {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "inline-free-names-")));
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    };
    const program = ts.createProgram(
      order.map((n) => path.join(dir, n)),
      options
    );
    const out: Record<string, TransformCodeResult> = {};
    for (const name of order) {
      const fileName = path.join(dir, name);
      out[name] = transformCode(program.getSourceFile(fileName)!.text, { program, fileName });
    }
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Transpile each module to CJS and run `entry`, resolving `./x` between them. */
function run(code: Record<string, string>, entry: string): Record<string, unknown> {
  const cache = new Map<string, Record<string, unknown>>();
  const load = (name: string): Record<string, unknown> => {
    const hit = cache.get(name);
    if (hit) return hit;
    const js = ts.transpileModule(code[name], {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const exports: Record<string, unknown> = {};
    cache.set(name, exports);
    const req = (spec: string): unknown => {
      const m = /^\.\/(.+?)(\.js)?$/.exec(spec);
      if (!m) throw new Error(`unexpected runtime import of '${spec}'`);
      return load(`${m[1]}.ts`);
    };
    new Function("exports", "require", js)(exports, req);
    return exports;
  };
  return load(entry);
}

const codeOf = (r: Record<string, TransformCodeResult>): Record<string, string> =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.code]));

const warningsOf = (r: TransformCodeResult): string[] =>
  r.diagnostics.filter((d) => d.severity === "warning").map((d) => d.message);

beforeEach(() => {
  clearTypeRewrites();
  resetDtsDiscovery();
  standaloneExtensionRegistry.length = 0;
});

afterEach(() => {
  clearTypeRewrites();
  resetDtsDiscovery();
  standaloneExtensionRegistry.length = 0;
});

const ORD = `
/** @typeclass */
export interface Ord<A> {
  eqv(x: A, y: A): boolean;
  compare(x: A, y: A): number;
}
`;

describe("an @impl method body is inlined only where its free names resolve", () => {
  it("a module-private helper is not copied to another module (no ReferenceError)", () => {
    const files: Files = {
      "ord.ts": `${ORD}
const compareNumber = (x: number, y: number): number =>
  Number.isNaN(x) ? (Number.isNaN(y) ? 0 : 1) : Number.isNaN(y) ? -1 : x < y ? -1 : x > y ? 1 : 0;
const EQ = 0;
/** @impl Ord<number> */
export const ordNumber: Ord<number> = {
  eqv: (x, y) => compareNumber(x, y) === EQ,
  compare: (x, y) => compareNumber(x, y),
};
`,
      "main.ts": `
import { ordNumber } from "./ord.js";
export const same = ordNumber.eqv(NaN, NaN);
export const order = ordNumber.compare(1, NaN);
`,
    };
    const out = transformAll(files, ["ord.ts", "main.ts"]);
    expect(out["main.ts"].code).not.toContain("compareNumber");
    expect(run(codeOf(out), "main.ts")).toMatchObject({ same: true, order: -1 });
    expect(warningsOf(out["main.ts"]).join("\n")).toMatch(/TS9602.*compareNumber/s);
  });

  it("a name the instance's module imports but the call site does not is not copied", () => {
    const files: Files = {
      "acc.ts": `
export const emptyAcc: number[] = [];
export const snoc = (xs: number[], x: number): number[] => [...xs, x];
`,
      "ord.ts": `${ORD}
import { snoc, emptyAcc } from "./acc.js";
/** @impl Ord<number> */
export const ordViaAcc: Ord<number> = {
  eqv: (x, y) => snoc(emptyAcc, x)[0] === y,
  compare: (x, y) => snoc(emptyAcc, x)[0] - y,
};
`,
      "main.ts": `
import { ordViaAcc } from "./ord.js";
export const same = ordViaAcc.eqv(1, 1);
`,
    };
    const out = transformAll(files, ["acc.ts", "ord.ts", "main.ts"]);
    expect(out["main.ts"].code).not.toMatch(/\bsnoc\b/);
    expect(run(codeOf(out), "main.ts")).toMatchObject({ same: true });
    expect(warningsOf(out["main.ts"]).join("\n")).toMatch(/TS9602.*'(snoc|emptyAcc)'/s);
  });

  it("a body whose free names resolve at the call site is still inlined", () => {
    const files: Files = {
      "ord.ts": `${ORD}
/** @impl Ord<number> */
export const ordAbs: Ord<number> = {
  eqv: (x, y) => Math.abs(x) === Math.abs(y),
  compare: (x, y) => Math.abs(x) - Math.abs(y),
};
`,
      "main.ts": `
import { ordAbs } from "./ord.js";
export function same(a: number, b: number) { return ordAbs.eqv(a, b); }
export const r = same(-2, 2);
`,
    };
    const out = transformAll(files, ["ord.ts", "main.ts"]);
    expect(out["main.ts"].code).toMatch(/Math\.abs\(a\) === Math\.abs\(b\)/);
    expect(run(codeOf(out), "main.ts")).toMatchObject({ r: true });
  });

  it("an inlined body does not carry the method's own type parameter", () => {
    const files: Files = {
      "ext.ts": `
/** @typeclass */
export interface Extract<T> {
  extract(o: T): unknown;
}
export type Opt<A> = A | null;
/** @impl Extract<Opt<unknown>> */
export const extractSome = {
  extract: <A>(o: Opt<A>): A | undefined => (o != null ? (o as unknown as A) : undefined),
};
`,
      "main.ts": `
import { extractSome } from "./ext.js";
export function get(x: number | null) { return extractSome.extract(x); }
export const r = get(3);
`,
    };
    const out = transformAll(files, ["ext.ts", "main.ts"]);
    // Inlined or not, no type name the call site cannot see survives.
    expect(out["main.ts"].code).not.toMatch(/\bas A\b/);
    expect(run(codeOf(out), "main.ts")).toMatchObject({ r: 3 });
  });

  it("keeps the type names that do resolve, and a nested generic's own type parameters", () => {
    const files: Files = {
      "ext.ts": `
/** @typeclass */
export interface Extract<T> {
  extract(o: T): unknown;
}
export type Opt<A> = A | null;
/** @impl Extract<Opt<unknown>> */
export const extractBoth = {
  extract: <A>(o: Opt<A>) => (<B>(b: B): Array<B> => [b])(o as Opt<A>),
};
`,
      "main.ts": `
import { extractBoth, type Opt } from "./ext.js";
export function get(x: number | null) { return extractBoth.extract(x); }
export const r = get(3);
`,
    };
    const out = transformAll(files, ["ext.ts", "main.ts"]);
    const code = out["main.ts"].code;
    expect(code).toMatch(/<B>\(b: B\): Array<B>/);
    expect(code).toMatch(/as Opt<any>/);
    expect(run(codeOf(out), "main.ts")).toMatchObject({ r: [3] });
  });
});
