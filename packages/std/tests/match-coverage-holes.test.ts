/**
 * Exhaustiveness must agree with the generated tests (review 9).
 *
 * - An arm that binds a field the variant declares OPTIONAL tests that the
 *   field is present (`"extra" in _v`), so it covers only part of the
 *   variant: the check accepted `.case({ k: "b", extra })` as covering `b`,
 *   and `{ k: "b" }` threw MatchError at run time.
 * - `match: switch` destructures below the discriminant (no presence test),
 *   so there the same pattern does cover the variant.
 * - Enum-member discriminants (`{ k: K.A, n }`) were not tested at all
 *   (only `"k" in _e`) and reported "missing variants".
 * - A tuple pattern of the tuple's arity with only bindings can't fail.
 *
 * Every behavioural assertion runs the emitted JavaScript.
 */
import { describe, it, expect } from "vitest";
import { transformAndRun } from "./match-exec-helpers.js";

type Fn = (...args: unknown[]) => unknown;

const STD = `import { match } from "@typesugar/std";\n`;

function run(code: string) {
  const r = transformAndRun(STD + code);
  if (r.runError) {
    throw new Error(
      `emitted code failed to run: ${String(r.runError)}\n--- emitted ---\n${r.code}`
    );
  }
  return r;
}

const V = `type V = { k: "a" } | { k: "b"; extra?: string };\n`;

describe("an arm binding an optional field covers only values that have it", () => {
  it("reports the variant as missing, naming the optional field", () => {
    const r = run(`${V}
export const f = (v: V) => match(v).case({ k: "a" }).then("A").case({ k: "b", extra }).then("B" + extra);`);
    const text = r.errors.join("\n");
    expect(text).toMatch(/TS9226/);
    expect(text).toMatch(/"b"/);
    expect(text).toMatch(/extra/);
    // What the check reports is what runs: `{ k: "b" }` matches no arm.
    const f = r.exports.f as Fn;
    expect(f({ k: "b", extra: "x" })).toBe("Bx");
    expect(() => f({ k: "b" })).toThrow(/MatchError|Non-exhaustive/);
  });

  it("a present-but-undefined field still matches (the test is `in`)", () => {
    const r = run(`${V}
export const f = (v: V) => match(v).case({ k: "b", extra }).then("B:" + String(extra)).else("other");`);
    expect(r.errors).toEqual([]);
    expect((r.exports.f as Fn)({ k: "b", extra: undefined })).toBe("B:undefined");
    expect((r.exports.f as Fn)({ k: "b" })).toBe("other");
  });

  it("a second arm for the variant without the field covers it", () => {
    const r = run(`${V}
export const f = (v: V) => match(v)
  .case({ k: "a" }).then("A")
  .case({ k: "b", extra }).then("B" + extra)
  .case({ k: "b" }).then("B-");`);
    expect(r.errors).toEqual([]);
    const f = r.exports.f as Fn;
    expect(f({ k: "b" })).toBe("B-");
    expect(f({ k: "b", extra: "y" })).toBe("By");
    expect(f({ k: "a" })).toBe("A");
  });

  it("a wildcard on an optional field is a presence test too", () => {
    const r = run(`${V}
export const f = (v: V) => match(v).case({ k: "a" }).then(1).case({ k: "b", extra: _ }).then(2);`);
    expect(r.errors.join("\n")).toMatch(/TS9226/);
  });

  it("a required field's binding still covers its variant", () => {
    const r = run(`type W = { k: "a"; n: number } | { k: "b"; s?: string; t: string };
export const f = (w: W) => match(w).case({ k: "a", n }).then(n).case({ k: "b", t }).then(t.length);`);
    expect(r.errors).toEqual([]);
    expect((r.exports.f as Fn)({ k: "b", t: "xyz" })).toBe(3);
  });

  it("nested: the optional field of a nested object is not assumed present", () => {
    const r = run(`type N = { k: "a"; inner: { x?: number } } | { k: "b" };
export const f = (v: N) => match(v).case({ k: "a", inner: { x } }).then(x).case({ k: "b" }).then(0);`);
    expect(r.errors.join("\n")).toMatch(/TS9226/);
    expect(() => (r.exports.f as Fn)({ k: "a", inner: {} })).toThrow();
  });

  it("match: switch destructures, so the same case covers the variant and runs", () => {
    const r = transformAndRun(`import "@typesugar/std/syntax/match";
${V}
export function f(v: V): string {
  match: switch (v) {
    case { k: "a" }:
      return "A";
    case { k: "b", extra }:
      return "B:" + String(extra);
  }
}`);
    if (r.runError) throw new Error(`${String(r.runError)}\n--- emitted ---\n${r.code}`);
    expect(r.errors).toEqual([]);
    const f = r.exports.f as Fn;
    expect(f({ k: "b" })).toBe("B:undefined");
    expect(f({ k: "b", extra: "q" })).toBe("B:q");
  });

  it("the object-handler form passes the value as it is", () => {
    const r = run(`type V = { kind: "a" } | { kind: "b"; extra?: string };
export const f = (v: V) => match(v, { a: () => "A", b: (x) => "B:" + String(x.extra) });`);
    expect(r.errors).toEqual([]);
    expect((r.exports.f as Fn)({ kind: "b" })).toBe("B:undefined");
  });
});

describe("enum-member discriminants", () => {
  it("string enum: each arm tests its member, and the arms cover the union", () => {
    const r = run(`enum K { A = "A", B = "B" }
type E = { k: K.A; n: number } | { k: K.B; n: number; s: string };
export const g = (e: E) => match(e).case({ k: K.A, n }).then("a" + n).case({ k: K.B, s }).then("b" + s);
export const mk = (k: string, n: number, s?: string) => ({ k, n, s });`);
    expect(r.errors).toEqual([]);
    const g = r.exports.g as Fn;
    expect(g({ k: "A", n: 3 })).toBe("a3");
    // Both variants have `n`: the arm must test the tag, not just the field.
    expect(g({ k: "B", n: 1, s: "x" })).toBe("bx");
  });

  it("numeric enum", () => {
    const r = run(`enum N { One = 1, Two = 2 }
type E = { k: N.One; n: number } | { k: N.Two; n: number };
export const g = (e: E) => match(e).case({ k: N.One, n }).then(n).case({ k: N.Two, n }).then(-n);`);
    expect(r.errors).toEqual([]);
    const g = r.exports.g as Fn;
    expect(g({ k: 1, n: 3 })).toBe(3);
    expect(g({ k: 2, n: 3 })).toBe(-3);
  });

  it("a missing enum member is reported", () => {
    const r = run(`enum K { A = "A", B = "B" }
type E = { k: K.A; n: number } | { k: K.B; s: string };
export const g = (e: E) => match(e).case({ k: K.A, n }).then(n);`);
    const text = r.errors.join("\n");
    expect(text).toMatch(/TS9226/);
    expect(text).toMatch(/"B"/);
    expect(text).not.toMatch(/"A"/);
  });

  it("an enum member as a top-level pattern over the enum", () => {
    const r = run(`enum K { A = "A", B = "B" }
export const g = (k: K) => match(k).case(K.A).then(1).case(K.B).then(2);`);
    expect(r.errors).toEqual([]);
    expect((r.exports.g as Fn)("B")).toBe(2);
  });
});

describe("tuple patterns", () => {
  it("[x, y] covers [number, number]", () => {
    const r = run(`export const t = (p: [number, number]) => match(p).case([x, y]).then(x + y);`);
    expect(r.errors).toEqual([]);
    expect((r.exports.t as Fn)([1, 2])).toBe(3);
  });

  it("[head, ...rest] covers a tuple at least that long", () => {
    const r = run(
      `export const t = (p: [number, string, boolean]) => match(p).case([n, ...rest]).then(n + rest.length);`
    );
    expect(r.errors).toEqual([]);
    expect((r.exports.t as Fn)([1, "a", true])).toBe(3);
  });

  it("the wrong arity, a literal element, or an optional element is not a catch-all", () => {
    for (const src of [
      `export const t = (p: [number, number]) => match(p).case([x]).then(x);`,
      `export const t = (p: [number, number]) => match(p).case([0, y]).then(y);`,
      `export const t = (p: [number, number?]) => match(p).case([x, y]).then(x);`,
      `export const t = (p: number[]) => match(p).case([x, y]).then(x);`,
      `export const t = (p: [number, number] | null) => match(p).case([x, y]).then(x);`,
    ]) {
      expect(run(src).errors.join("\n"), src).toMatch(/TS9226/);
    }
  });
});
