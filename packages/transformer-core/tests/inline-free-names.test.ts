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

/**
 * Type errors in `entry` when every module is the given (transformed) text:
 * what `typesugar check --strict` checks.
 */
function typeErrors(code: Record<string, string>, entry: string): string[] {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "inline-free-names-tc-")));
  try {
    for (const [name, content] of Object.entries(code)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    const program = ts.createProgram([path.join(dir, entry)], {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    });
    return ts
      .getPreEmitDiagnostics(program, program.getSourceFile(path.join(dir, entry)))
      .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
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

describe("a free name must be a value binding at the call site", () => {
  // review 8: `import { isPt, type Pt }` binds `Pt` as a type only; an inlined
  // `new Pt(n)` there is a ReferenceError (only --strict reported TS1361).
  const ORD_PT = `
/** @typeclass */
export interface Is<A> {
  is(x: unknown): boolean;
  make(n: number): A;
}
export class Pt { constructor(public x: number) {} }
/** @impl Is<Pt> */
export const isPt: Is<Pt> = {
  is: (x) => x instanceof Pt,
  make: (n) => new Pt(n),
};
`;

  it.each([
    ["a `type` specifier", `import { isPt, type Pt } from "./ord.js";`],
    [
      "an `import type` declaration",
      `import type { Pt } from "./ord.js";\nimport { isPt } from "./ord.js";`,
    ],
  ])("a name imported with %s is not in scope as a value", (_, imports) => {
    const files: Files = {
      "ord.ts": ORD_PT,
      "main.ts": `
${imports}
export const a: boolean = isPt.is(1);
export const b: Pt = isPt.make(3);
export const bx = b.x;
`,
    };
    const out = transformAll(files, ["ord.ts", "main.ts"]);
    const code = codeOf(out);
    expect(code["main.ts"]).not.toMatch(/new Pt\(|instanceof Pt/);
    expect(run(code, "main.ts")).toMatchObject({ a: false, bx: 3 });
    expect(typeErrors(code, "main.ts")).toEqual([]);
    expect(warningsOf(out["main.ts"]).join("\n")).toMatch(/TS9602.*'Pt'/s);
  });

  it("a name re-exported as a type only is not in scope as a value", () => {
    const files: Files = {
      "ord.ts": ORD_PT,
      "types.ts": `export type { Pt } from "./ord.js";\n`,
      "main.ts": `
import { isPt } from "./ord.js";
import { Pt } from "./types.js";
export const b: Pt = isPt.make(3);
export const bx = b.x;
`,
    };
    const out = transformAll(files, ["ord.ts", "types.ts", "main.ts"]);
    const code = codeOf(out);
    expect(code["main.ts"]).not.toMatch(/new Pt\(/);
    expect(run(code, "main.ts")).toMatchObject({ bx: 3 });
  });

  it("a plain value import is still inlined", () => {
    const files: Files = {
      "ord.ts": ORD_PT,
      "main.ts": `
import { isPt, Pt } from "./ord.js";
export const d: Pt = isPt.make(5);
export const ok = isPt.is(d);
`,
    };
    const out = transformAll(files, ["ord.ts", "main.ts"]);
    const code = codeOf(out);
    expect(code["main.ts"]).toMatch(/new Pt\(5\)/);
    expect(code["main.ts"]).toMatch(/d instanceof Pt/);
    expect(run(code, "main.ts")).toMatchObject({ ok: true });
    expect(warningsOf(out["main.ts"])).toEqual([]);
  });
});

describe("an inlined body type-checks where it is inlined", () => {
  it("an argument narrower than the parameter isn't narrowed to never by the body's test", () => {
    // fp's destructure.test.ts: `destructureCons.extract(Nil)` inlined as
    // `(Nil != null ? [Nil.head, Nil.tail] : undefined)`; `Nil` is typed
    // `null`, so `Nil.head` is a property of `never` (TS2339) — the method's
    // parameter was `List<A>`.
    const files: Files = {
      "list.ts": `
/** @typeclass */
export interface Extract<T> {
  extract(o: T): unknown;
}
export interface Cons<A> { readonly head: A; readonly tail: List<A> }
export type Nil = null;
export type List<A> = Cons<A> | Nil;
export const Nil: Nil = null;
/** @impl Extract<List<unknown>> */
export const extractCons = {
  extract: <A>(l: List<A>): [A, List<A>] | undefined => (l != null ? [l.head, l.tail] : undefined),
};
`,
      "main.ts": `
import { extractCons, Nil } from "./list.js";
export const none = extractCons.extract(Nil);
`,
    };
    const out = transformAll(files, ["list.ts", "main.ts"]);
    const code = codeOf(out);
    expect(code["main.ts"]).not.toContain("extractCons.extract("); // still inlined
    expect(typeErrors(code, "main.ts")).toEqual([]);
    // `List` is not imported here, so the assertion is re-expressed as `any`.
    expect(code["main.ts"]).toMatch(/\(Nil as any\)/);
    expect(run(code, "main.ts").none).toBeUndefined();
  });

  it("an argument of the parameter's own type is substituted as it is", () => {
    const files: Files = {
      "ord.ts": `${ORD}
export interface P { x: number }
/** @impl Ord<P> */
export const ordP: Ord<P> = {
  eqv: (a, b) => a.x === b.x,
  compare: (a, b) => a.x - b.x,
};
`,
      "main.ts": `
import { ordP, type P } from "./ord.js";
export function same(p: P, q: P) { return ordP.eqv(p, q); }
`,
    };
    const out = transformAll(files, ["ord.ts", "main.ts"]);
    expect(out["main.ts"].code).toMatch(/return p\.x === q\.x/);
    expect(typeErrors(codeOf(out), "main.ts")).toEqual([]);
  });
});
