/**
 * Typeclass resolution / summon / derive / implicits regression tests for
 * the 2026-10 deep review (findings-macros-typeclass #5-#7, #10-#15, #17, #20).
 *
 * Every test here transforms real multi-file programs with the transformer
 * core and, wherever the finding was a runtime failure, EXECUTES the emitted
 * JavaScript (transpiled to CommonJS, with an in-memory module map) rather
 * than only grepping the output text.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { transformCode } from "@typesugar/transformer-core";
import {
  summonMacro,
  extendMacro,
  summonAllMacro,
  implMacro,
  typeclassMacro,
  collectTypesMacro,
  moduleIndexMacro,
} from "@typesugar/macros";

const ROOT = "/virtual-tc";

type Files = Record<string, string>;

interface Transformed {
  code: Record<string, string>;
  diagnostics: Record<string, { severity: string; message: string }[]>;
}

/** Build ONE program over all files and transform each of them. */
function transformAll(files: Files, only?: string[]): Transformed {
  const abs = (f: string) => `${ROOT}/${f}`;
  const byAbs: Files = {};
  for (const [k, v] of Object.entries(files)) byAbs[abs(k)] = v;
  const opts: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(opts);
  const orig = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lv, ...r) =>
    byAbs[f] !== undefined ? ts.createSourceFile(f, byAbs[f], lv, true) : orig(f, lv, ...r);
  host.fileExists = (f) => byAbs[f] !== undefined || ts.sys.fileExists(f);
  host.readFile = (f) => byAbs[f] ?? ts.sys.readFile(f);
  host.directoryExists = (d) => d === ROOT || ts.sys.directoryExists(d);
  const program = ts.createProgram(Object.keys(byAbs), opts, host);
  const out: Transformed = { code: {}, diagnostics: {} };
  for (const f of only ?? Object.keys(files)) {
    const r = transformCode(files[f], { fileName: abs(f), program });
    out.code[f] = r.code;
    out.diagnostics[f] = (r.diagnostics ?? []).map((d) => ({
      severity: String(d.severity),
      message: d.message,
    }));
  }
  return out;
}

/**
 * Execute transformed modules. Relative imports resolve within `code`;
 * anything else resolves to an empty module (so a stray runtime import of a
 * compile-time package shows up as `undefined`, not as a crash in the loader).
 */
function run(code: Record<string, string>, entry: string): Record<string, unknown> {
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  const load = (name: string): Record<string, unknown> => {
    const hit = cache.get(name);
    if (hit) return hit.exports;
    const js = ts.transpileModule(code[name], {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const mod = { exports: {} as Record<string, unknown> };
    cache.set(name, mod);
    const req = (spec: string) => {
      if (spec.startsWith("./")) {
        const key = spec.slice(2).replace(/\.(js|ts)$/, "") + ".ts";
        if (code[key] === undefined) throw new Error(`test loader: no module ${spec}`);
        return load(key);
      }
      return {};
    };
    new Function("module", "exports", "require", js)(mod, mod.exports, req);
    return mod.exports;
  };
  return load(entry);
}

function errors(t: Transformed, f: string) {
  return t.diagnostics[f].filter((d) => d.severity === "error");
}

const TC = `export interface Show<A> { show(a: A): string }
export interface Eq<A> { equals(a: A, b: A): boolean }
export interface Point { x: number }`;

// ---------------------------------------------------------------------------
// #5 — scope-dependent expression macros must never be served from a cache
// ---------------------------------------------------------------------------

describe("#5 scope-dependent expression macros are uncacheable", () => {
  it("summon/extend/summonAll/collectTypes/moduleIndex/impl()/typeclass() declare cacheable: false", () => {
    for (const m of [
      summonMacro,
      extendMacro,
      summonAllMacro,
      implMacro,
      typeclassMacro,
      collectTypesMacro,
      moduleIndexMacro,
    ]) {
      expect({ name: m.name, cacheable: m.cacheable }).toEqual({
        name: m.name,
        cacheable: false,
      });
    }
  });

  it("two files with the same summon text resolve to their OWN local instances", () => {
    const local = (name: string, label: string) => `import { summon } from "@typesugar/typeclass";
interface Show<A> { show(a: A): string }
interface Point { x: number }
/** @impl Show<Point> */
const ${name}: Show<Point> = { show: (p) => "${label}" + p.x };
export const s = summon<Show<Point>>();`;
    const t = transformAll({ "a.ts": local("showAlpha", "A"), "b.ts": local("showBeta", "B") });
    const b = run(t.code, "b.ts") as { s: { show(p: { x: number }): string } };
    expect(b.s.show({ x: 1 })).toBe("B1");
    const a = run(t.code, "a.ts") as { s: { show(p: { x: number }): string } };
    expect(a.s.show({ x: 1 })).toBe("A1");
  });
});

// ---------------------------------------------------------------------------
// #6 — derivation caches keyed by declaration (and per program), not by name
// ---------------------------------------------------------------------------

describe("#6 derivation caches don't leak between same-named types", () => {
  const file = (iface: string) => `import { summon } from "@typesugar/typeclass";
interface Eq<A> { equals(a: A, b: A): boolean }
interface Show<A> { show(a: A): string }
${iface}
export const e = summon<Eq<Point>>();
export const s = summon<Show<Point>>();`;

  it("two programs in one process: the second Point gets its own Eq/Show", () => {
    transformAll({ "a.ts": file("interface Point { x: number; y: number }") });
    const t = transformAll({ "b.ts": file("interface Point { lat: string; label: string }") });
    const m = run(t.code, "b.ts") as {
      e: { equals(a: unknown, b: unknown): boolean };
      s: { show(a: unknown): string };
    };
    expect(m.e.equals({ lat: "1", label: "a" }, { lat: "1", label: "b" })).toBe(false);
    expect(m.s.show({ lat: "1", label: "a" })).toBe('Point(lat = "1", label = "a")');
  });

  it("two files in ONE program with different Point types", () => {
    const t = transformAll({
      "a.ts": file("interface Point { x: number }"),
      "b.ts": file("interface Point { name: string }"),
    });
    const m = run(t.code, "b.ts") as { e: { equals(a: unknown, b: unknown): boolean } };
    expect(m.e.equals({ name: "p" }, { name: "q" })).toBe(false);
    expect(m.e.equals({ name: "p" }, { name: "p" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #7 — summon / implicits emit a reference that is actually bound
// ---------------------------------------------------------------------------

describe("#7 summon/implicits reference resolution", () => {
  const inst = `import type { Show, Point } from "./tc";
/** @impl Show<Point> */
export const showPoint: Show<Point> = { show: (p) => "P" + p.x };
export const unrelated = 1;`;

  it("summon: module-scan hit (instance not imported by name) is imported", () => {
    const t = transformAll({
      "tc.ts": TC,
      "inst.ts": inst,
      "main.ts": `import { summon } from "@typesugar/typeclass";
import type { Show, Point } from "./tc";
import { unrelated } from "./inst";
export const s = summon<Show<Point>>();
export const u = unrelated;`,
    });
    expect(errors(t, "main.ts")).toEqual([]);
    const m = run(t.code, "main.ts") as { s: { show(p: { x: number }): string } };
    expect(m.s.show({ x: 2 })).toBe("P2");
  });

  it("summon: an aliased explicit import is referenced by its LOCAL name", () => {
    const t = transformAll({
      "tc.ts": TC,
      "inst.ts": inst,
      "main.ts": `import { summon } from "@typesugar/typeclass";
import type { Show, Point } from "./tc";
import { showPoint as sp } from "./inst";
export const s = summon<Show<Point>>();
export const keep = sp;`,
    });
    expect(t.code["main.ts"]).toMatch(/export const s = sp;/);
    const m = run(t.code, "main.ts") as { s: { show(p: { x: number }): string } };
    expect(m.s.show({ x: 3 })).toBe("P3");
  });

  it("summon: two in-scope instances are reported as ambiguous", () => {
    const t = transformAll({
      "main.ts": `import { summon } from "@typesugar/typeclass";
interface Show<A> { show(a: A): string }
interface Point { x: number }
/** @impl Show<Point> */
const showA: Show<Point> = { show: (p) => "A" };
/** @impl Show<Point> */
const showB: Show<Point> = { show: (p) => "B" };
export const s = summon<Show<Point>>();`,
    });
    const errs = errors(t, "main.ts");
    expect(errs.some((e) => /Ambiguous Show instance/.test(e.message))).toBe(true);
    expect(errs.some((e) => /No instance found/.test(e.message))).toBe(false);
  });

  it("implicits: module-scan hit is imported, and the call runs", () => {
    const t = transformAll({
      "tc.ts": TC,
      "inst.ts": inst,
      "main.ts": `import type { Show, Point } from "./tc";
import { implicit } from "typesugar";
import { unrelated } from "./inst";
function show<A>(a: A, S: Show<A> = implicit()): string { return S.show(a); }
const p: Point = { x: 5 };
export const r = show(p);
export const u = unrelated;`,
    });
    expect(errors(t, "main.ts")).toEqual([]);
    expect((run(t.code, "main.ts") as { r: string }).r).toBe("P5");
  });
});

// ---------------------------------------------------------------------------
// #10 — @impl companion namespace built with ts.factory, only when valid
// ---------------------------------------------------------------------------

describe("#10 @impl companion namespace", () => {
  it("generic / array / union type arguments emit no garbage, with a warning", () => {
    const t = transformAll({
      "main.ts": `interface Eq<A> { equals(a: A, b: A): boolean }
interface Show<A> { show(a: A): string }
interface Pair<A, B> { a: A; b: B }
/** @impl Eq<Pair<number, string>> */
export const eqPair: Eq<Pair<number, string>> = { equals: (l, r) => l.a === r.a && l.b === r.b };
/** @impl Show<number[]> */
export const showArr: Show<number[]> = { show: (xs) => xs.join(",") };
/** @impl Show<string | null> */
export const showOpt: Show<string | null> = { show: (s) => String(s) };`,
    });
    const code = t.code["main.ts"];
    expect(code).not.toMatch(/namespace (Pair|number|string)\b/);
    const m = run(t.code, "main.ts") as { showArr: { show(xs: number[]): string } };
    expect(m.showArr.show([1, 2])).toBe("1,2");
    const warns = t.diagnostics["main.ts"].filter((d) => d.severity === "warning");
    expect(warns.some((w) => /not a plain type name/.test(w.message))).toBe(true);
  });

  it("an imported class keeps working (no `var Point = {}` shadowing the import)", () => {
    const t = transformAll({
      "point.ts": `export class Point { x = 1 }`,
      "main.ts": `import { Point } from "./point";
interface Eq<A> { equals(a: A, b: A): boolean }
/** @impl Eq<Point> */
export const eqPoint: Eq<Point> = { equals: (l, r) => l.x === r.x };
export const p = new Point();`,
    });
    const m = run(t.code, "main.ts") as { p: { x: number } };
    expect(m.p.x).toBe(1);
  });

  it("a type declared in the file gets an (exported) companion; a second @impl warns", () => {
    const t = transformAll({
      "main.ts": `interface Show<A> { show(a: A): string }
export interface Point { x: number }
/** @impl Show<Point> */
const showA: Show<Point> = { show: () => "A" };
/** @impl Show<Point> */
const showB: Show<Point> = { show: () => "B" };`,
    });
    const m = run(t.code, "main.ts") as { Point: { Show: { show(p: unknown): string } } };
    expect(m.Point.Show.show({})).toBe("A");
    expect(
      t.diagnostics["main.ts"].some((d) => /already provided by 'showA'/.test(d.message))
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #11 / #13 — derived field code: optional, arrays, quoted keys, nested derives,
// no runtime import of the compile-time package
// ---------------------------------------------------------------------------

describe("#11/#13 derived field code", () => {
  it("summon<Eq<T>>: optional, array and quoted-key fields", () => {
    const t = transformAll({
      "main.ts": `import { summon } from "@typesugar/typeclass";
interface Eq<A> { equals(a: A, b: A): boolean }
interface T { name?: string; tags: string[]; "content-type": string }
export const e = summon<Eq<T>>();`,
    });
    expect(errors(t, "main.ts")).toEqual([]);
    const { e } = run(t.code, "main.ts") as { e: { equals(a: unknown, b: unknown): boolean } };
    const base = { tags: ["a"], "content-type": "x" };
    expect(e.equals(base, { ...base })).toBe(true);
    expect(e.equals({ ...base, name: "n" }, base)).toBe(false);
    expect(e.equals(base, { ...base, tags: ["b"] })).toBe(false);
    expect(e.equals(base, { ...base, "content-type": "y" })).toBe(false);
  });

  it("@derive(Eq) with a field of another @derive(Eq) type composes companions", () => {
    const t = transformAll({
      "main.ts": `/** @derive(Eq) */
export interface PN { x: number }
/** @derive(Eq) */
export interface LN { a: PN; b?: PN }`,
    });
    expect(errors(t, "main.ts")).toEqual([]);
    const m = run(t.code, "main.ts") as { LN: { Eq: { equals(a: unknown, b: unknown): boolean } } };
    expect(m.LN.Eq.equals({ a: { x: 1 } }, { a: { x: 1 } })).toBe(true);
    expect(m.LN.Eq.equals({ a: { x: 1 } }, { a: { x: 2 } })).toBe(false);
    expect(m.LN.Eq.equals({ a: { x: 1 }, b: { x: 1 } }, { a: { x: 1 } })).toBe(false);
  });

  it("@derive(Show) with an optional field", () => {
    const t = transformAll({
      "main.ts": `/** @derive(Show) */
export interface SO { name?: string; n: number }`,
    });
    expect(errors(t, "main.ts")).toEqual([]);
    const m = run(t.code, "main.ts") as { SO: { Show: { show(a: unknown): string } } };
    expect(m.SO.Show.show({ n: 1 })).toBe("SO(name = undefined, n = 1)");
  });

  it("a failed derive reports the field trace, not 'Unknown derive'", () => {
    const t = transformAll({
      "main.ts": `/** @derive(Eq) */
export interface H { when: Date }`,
    });
    const errs = errors(t, "main.ts");
    expect(errs.some((e) => /Unknown derive/.test(e.message))).toBe(false);
    expect(errs.some((e) => /when/.test(e.message) && /lacks Eq/.test(e.message))).toBe(true);
  });

  it("@derive(Eq)/@derive(Semigroup) don't import @typesugar/macros at runtime", () => {
    const t = transformAll({
      "main.ts": `/** @derive(Eq, Semigroup) */
export interface P { x: number; y: string; ok: boolean; xs: number[] }`,
    });
    expect(errors(t, "main.ts")).toEqual([]);
    expect(t.code["main.ts"]).not.toContain("@typesugar/macros");
    const m = run(t.code, "main.ts") as {
      P: {
        Eq: { equals(a: unknown, b: unknown): boolean };
        Semigroup: { combine(a: unknown, b: unknown): unknown };
      };
    };
    const a = { x: 1, y: "a", ok: true, xs: [1] };
    const b = { x: 2, y: "b", ok: false, xs: [2] };
    expect(m.P.Eq.equals(a, { ...a, xs: [1] })).toBe(true);
    expect(m.P.Semigroup.combine(a, b)).toEqual({ x: 3, y: "ab", ok: false, xs: [1, 2] });
  });

  it("summon<Eq<Point>>() with primitive fields runs (no unbound Eq.number)", () => {
    const t = transformAll({
      "main.ts": `import { summon } from "@typesugar/typeclass";
interface Eq<A> { equals(a: A, b: A): boolean }
interface Point { x: number; y: number }
export const e = summon<Eq<Point>>();
export const r = e.equals({ x: 1, y: 2 }, { x: 1, y: 2 });`,
    });
    expect((run(t.code, "main.ts") as { r: boolean }).r).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #12 / #15 — extend() and summonAll() emit resolved instance references
// ---------------------------------------------------------------------------

describe("#12/#15 extend() and summonAll()", () => {
  it("extend(n).greet() calls the resolved instance (no Greet.summon)", () => {
    const t = transformAll({
      "main.ts": `import { extend } from "@typesugar/typeclass";
/** @typeclass */
export interface Greet<A> { greet(a: A, punct: string): string; }
/** @impl("Greet<number>") */
const greetNumber = { greet: (n: number, p: string) => \`hello \${n}\${p}\` };
const n: number = 3;
export const r = extend(n).greet("!");`,
    });
    expect(errors(t, "main.ts")).toEqual([]);
    expect(t.code["main.ts"]).not.toContain(".summon");
    expect((run(t.code, "main.ts") as { r: string }).r).toBe("hello 3!");
  });

  it("summonAll<[Show<Point>, Eq<Point>]>() (documented tuple form) and the variadic form", () => {
    const t = transformAll({
      "main.ts": `import { summonAll } from "typesugar";
export interface Show<A> { show(a: A): string }
export interface Eq<A> { equals(a: A, b: A): boolean }
export interface Point { x: number }
/** @impl Show<Point> */
export const showP: Show<Point> = { show: (p) => "P" + p.x };
/** @impl Eq<Point> */
export const eqP: Eq<Point> = { equals: (a, b) => a.x === b.x };
export const [s, e] = summonAll<[Show<Point>, Eq<Point>]>();
export const both = summonAll<Show<Point>, Eq<Point>>();`,
    });
    expect(errors(t, "main.ts")).toEqual([]);
    const m = run(t.code, "main.ts") as {
      s: { show(p: unknown): string };
      e: unknown;
      eqP: unknown;
      both: unknown[];
      showP: unknown;
    };
    expect(m.s.show({ x: 1 })).toBe("P1");
    expect(m.e).toBe(m.eqP);
    expect(m.both).toEqual([m.showP, m.eqP]);
  });
});

// ---------------------------------------------------------------------------
// #14 — sum-type derivation without per-variant companions
// ---------------------------------------------------------------------------

describe("#14 sum-type derivation", () => {
  it("@derive(Eq/Ord/Hash) on a union of plain interfaces runs", () => {
    const t = transformAll({
      "main.ts": `interface A { kind: "a"; x: number }
interface B { kind: "b"; y: string }
/** @derive(Eq, Ord, Hash) */
export type U = A | B;`,
    });
    expect(errors(t, "main.ts")).toEqual([]);
    const m = run(t.code, "main.ts") as {
      U: {
        Eq: { equals(a: unknown, b: unknown): boolean; notEquals(a: unknown, b: unknown): boolean };
        Ord: { compare(a: unknown, b: unknown): number };
        Hash: { hash(a: unknown): number };
      };
    };
    expect(m.U.Eq.equals({ kind: "a", x: 1 }, { kind: "a", x: 1 })).toBe(true);
    expect(m.U.Eq.equals({ kind: "a", x: 1 }, { kind: "a", x: 2 })).toBe(false);
    expect(m.U.Eq.notEquals({ kind: "a", x: 1 }, { kind: "b", y: "q" })).toBe(true);
    expect(m.U.Ord.compare({ kind: "a", x: 1 }, { kind: "a", x: 2 })).toBe(-1);
    expect(m.U.Ord.compare({ kind: "b", y: "z" }, { kind: "a", x: 9 })).toBe(1);
    expect(typeof m.U.Hash.hash({ kind: "b", y: "q" })).toBe("number");
  });

  it("inline object-literal variants (no U_a companion referenced)", () => {
    const t = transformAll({
      "main.ts": `/** @derive(Eq) */
export type S = { tag: "c"; r: number } | { tag: "s"; side: number };`,
    });
    expect(errors(t, "main.ts")).toEqual([]);
    expect(t.code["main.ts"]).not.toMatch(/S_c|S_s/);
    const m = run(t.code, "main.ts") as { S: { Eq: { equals(a: unknown, b: unknown): boolean } } };
    expect(m.S.Eq.equals({ tag: "c", r: 1 }, { tag: "c", r: 1 })).toBe(true);
    expect(m.S.Eq.equals({ tag: "c", r: 1 }, { tag: "s", side: 1 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #17 — @impl tag without a type annotation is resolvable by type
// ---------------------------------------------------------------------------

describe("#17 unannotated @impl values", () => {
  it("summon finds `/** @impl Show<Point> */ const showP = {...}`", () => {
    const t = transformAll({
      "main.ts": `import { summon } from "@typesugar/typeclass";
export interface Show<A> { show(a: A): string }
export interface Point { x: number }
/** @impl Show<Point> */
const showP = { show: (p: Point) => "custom" + p.x };
export const s = summon<Show<Point>>();`,
    });
    expect(errors(t, "main.ts")).toEqual([]);
    const m = run(t.code, "main.ts") as { s: { show(p: unknown): string } };
    expect(m.s.show({ x: 4 })).toBe("custom4");
  });
});

// ---------------------------------------------------------------------------
// #20 — partially-discriminated unions are rejected, not half-derived
// ---------------------------------------------------------------------------

describe("#20 partial discriminated unions", () => {
  it("a union member without a literal discriminant is a TS9103 error", () => {
    const t = transformAll({
      "main.ts": `interface A { kind: "a"; x: number }
interface B { kind: string; y: number }
/** @derive(Eq) */
export type U = A | B;`,
    });
    const errs = errors(t, "main.ts");
    expect(errs.some((e) => /discriminant/.test(e.message))).toBe(true);
    expect(t.code["main.ts"]).not.toContain("namespace U");
  });
});
