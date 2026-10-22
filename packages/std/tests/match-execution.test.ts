/**
 * Execution tests for the `match()` macro (deep review 1.0, findings #1-#6,
 * #13-#17, #32).
 *
 * Every test here transforms through the real pipeline AND runs the emitted
 * JavaScript. Each fast path (ternary, 7+ literal switch, discriminant switch,
 * direct emit, generic IIFE) is pinned both by "this path was taken" and by
 * "the result is right" — the earlier tests only grepped for `switch`, which
 * is how findings #1-#3 shipped.
 */
import { describe, it, expect } from "vitest";
import { MatchError, match as runtimeMatch } from "@typesugar/std";
import { transformAndRun } from "./match-exec-helpers.js";

type Fn = (...args: unknown[]) => unknown;

function run(code: string) {
  const r = transformAndRun(`import { match } from "@typesugar/std";\n${code}`);
  if (r.runError) {
    throw new Error(
      `emitted code failed to run: ${String(r.runError)}\n--- emitted ---\n${r.code}`
    );
  }
  return r;
}

const SHAPE = `type Shape = { kind: "circle"; radius: number } | { kind: "ring"; radius: number } | { kind: "sq"; side: number };`;

describe("fast path: ternary", () => {
  it("single literal arm + else", () => {
    const r = run(`export const f = (n: number) => match(n).case(1).then("one").else("other");`);
    expect(r.code).toContain("?");
    expect(r.code).not.toContain("=>  {");
    const f = r.exports.f as Fn;
    expect(f(1)).toBe("one");
    expect(f(2)).toBe("other");
  });

  it("NaN literal uses Number.isNaN, not a binding (#16)", () => {
    const r = run(`export const f = (n: number) => match(n).case(NaN).then("nan").else("num");`);
    expect(r.errors).toEqual([]);
    const f = r.exports.f as Fn;
    expect(f(NaN)).toBe("nan");
    expect(f(1)).toBe("num");
  });

  it("Infinity / -Infinity are literals, not bindings (#16)", () => {
    const r = run(
      `export const f = (n: number) => match(n).case(Infinity).then("+").case(-Infinity).then("-").else("fin");`
    );
    const f = r.exports.f as Fn;
    expect(f(Infinity)).toBe("+");
    expect(f(-Infinity)).toBe("-");
    expect(f(3)).toBe("fin");
  });
});

// Turf case study, Stage 3: flattenEach's multi→single type mapping is a
// literal match on a local. It compiled to an IIFE (a closure per call in a
// hot callback) with a dead `throw new MatchError` after the last arm, which
// pulled a runtime import of @typesugar/std into the library's output. The
// guide documents `x === "ok" ? 200 : 500` for this shape.
describe("fast path: literal conditional chain (no IIFE)", () => {
  const noIIFE = (code: string) => expect(code).not.toMatch(/\}\)\(\)/);

  it("several literal arms + else on an identifier", () => {
    const r = run(`export const f = (t: string) =>
  match(t).case("MultiPoint").then("Point").case("MultiLineString").then("LineString")
    .case("MultiPolygon").then("Polygon").else(undefined);`);
    expect(r.errors).toEqual([]);
    noIIFE(r.code);
    const f = r.exports.f as Fn;
    expect(f("MultiPoint")).toBe("Point");
    expect(f("MultiLineString")).toBe("LineString");
    expect(f("MultiPolygon")).toBe("Polygon");
    expect(f("Point")).toBe(undefined);
  });

  it("a fully covered literal union: no else, no MatchError, no runtime import", () => {
    const r = run(
      `export const f = (x: "ok" | "fail") => match(x).case("ok").then(200).case("fail").then(500);`
    );
    expect(r.errors).toEqual([]);
    expect(r.code).toContain(`x === "ok" ? 200 : 500`);
    expect(r.code).not.toContain("MatchError");
    expect(r.code).not.toContain("@typesugar/std");
    const f = r.exports.f as Fn;
    expect(f("ok")).toBe(200);
    expect(f("fail")).toBe(500);
  });

  it(".or() alternatives and a wildcard arm", () => {
    const r = run(`export const f = (c: "a" | "b" | "c" | "d") =>
  match(c).case("a").or("b").then(1).case("c").then(2).case(_).then(3);`);
    expect(r.errors).toEqual([]);
    noIIFE(r.code);
    expect(r.code).toContain(`c === "a" || c === "b" ? 1 : c === "c" ? 2 : 3`);
    const f = r.exports.f as Fn;
    expect([f("a"), f("b"), f("c"), f("d")]).toEqual([1, 1, 2, 3]);
  });

  it("await in a result stays in the enclosing function (no async IIFE)", async () => {
    const r = run(`async function load(n: number): Promise<string> { return "L" + n; }
export async function f(x: 1 | 2) {
  return match(x).case(1).then(await load(1)).case(2).then(await load(2));
}`);
    noIIFE(r.code);
    const f = r.exports.f as Fn;
    await expect(f(1)).resolves.toBe("L1");
    await expect(f(2)).resolves.toBe("L2");
  });

  it("a property scrutinee is still read once (IIFE kept), with no dead MatchError", () => {
    const r = run(`let reads = 0;
const o = { get t(): "a" | "b" | "c" { reads++; return "c"; } };
export const v = match(o.t).case("a").then(1).case("b").then(2).case("c").then(3);
export const n = () => reads;`);
    expect(r.errors).toEqual([]);
    expect(r.exports.v).toBe(3);
    expect((r.exports.n as Fn)()).toBe(1);
    expect(r.code).not.toContain("MatchError");
  });

  it("with an else, values outside the arms reach it", () => {
    const r = run(
      `export const f = (t: string) => match(t).case("a").then(1).case("b").then(2).else(0);`
    );
    expect(r.errors).toEqual([]);
    noIIFE(r.code);
    const f = r.exports.f as Fn;
    expect([f("a"), f("b"), f("z")]).toEqual([1, 2, 0]);
  });
});

describe("fast path: 7+ pure literal switch", () => {
  it("dispatches each value and falls to else", () => {
    const arms = [1, 2, 3, 4, 5, 6, 7].map((n) => `.case(${n}).then("v${n}")`).join("");
    const r = run(`export const f = (n: number) => match(n)${arms}.else("none");`);
    expect(r.code).toContain("switch");
    const f = r.exports.f as Fn;
    for (const n of [1, 2, 3, 4, 5, 6, 7]) expect(f(n)).toBe(`v${n}`);
    expect(f(8)).toBe("none");
  });

  // The arms cover the literal union, so the last one is the `default:`,
  // as in the conditional chain: no MatchError, no runtime @typesugar/std
  // import. A value outside the type (9) takes the last arm. This used to
  // end in `default: throw new MatchError(_n)`.
  it("covering the literal union: the last arm is the default, no MatchError", () => {
    const arms = [1, 2, 3, 4, 5, 6, 7].map((n) => `.case(${n}).then("v${n}")`).join("");
    const r = run(`export const f = (n: 1|2|3|4|5|6|7) => match(n)${arms};`);
    expect(r.code).toContain("switch");
    expect(r.code).toContain(`default: return "v7";`);
    expect(r.code).not.toContain("MatchError");
    const f = r.exports.f as Fn;
    expect(f(7)).toBe("v7");
    expect(f(9)).toBe("v7");
  });

  it("throws MatchError without else when the type proves nothing (any)", () => {
    const arms = [1, 2, 3, 4, 5, 6, 7].map((n) => `.case(${n}).then("v${n}")`).join("");
    const r = run(`export const f = (n: any) => match(n)${arms};`);
    expect(r.code).toContain("switch");
    const f = r.exports.f as Fn;
    expect(f(7)).toBe("v7");
    expect(() => f(9)).toThrow(MatchError);
  });
});

describe("fast path: discriminant switch", () => {
  it("binds the same name in two arms without redeclaration (#1)", () => {
    const r = run(`${SHAPE}
export const f = (s: Shape) => match(s)
  .case({ kind: "circle", radius: r }).then(r)
  .case({ kind: "ring", radius: r }).then(-r)
  .else(0);`);
    expect(r.code).toContain("switch");
    const f = r.exports.f as Fn;
    expect(f({ kind: "circle", radius: 5 })).toBe(5);
    expect(f({ kind: "ring", radius: 2 })).toBe(-2);
    expect(f({ kind: "sq", side: 1 })).toBe(0);
  });

  it("failing guard falls through to later arms / else (#2)", () => {
    const r = run(`${SHAPE}
export const f = (s: Shape) => match(s)
  .case({ kind: "circle", radius: r }).if(r > 10).then("big")
  .case({ kind: "sq" }).then("sq")
  .else("other");`);
    const f = r.exports.f as Fn;
    expect(f({ kind: "circle", radius: 50 })).toBe("big");
    expect(f({ kind: "circle", radius: 5 })).toBe("other");
    expect(f({ kind: "sq", side: 1 })).toBe("sq");
  });

  it("guarded arm followed by a same-discriminant arm (#2)", () => {
    const r = run(`${SHAPE}
export const f = (s: Shape) => match(s)
  .case({ kind: "circle", radius: r }).if(r > 10).then("big")
  .case({ kind: "circle" }).then("small")
  .case({ kind: "ring" }).then("ring")
  .case({ kind: "sq" }).then("sq");`);
    const f = r.exports.f as Fn;
    expect(f({ kind: "circle", radius: 50 })).toBe("big");
    expect(f({ kind: "circle", radius: 5 })).toBe("small");
  });

  it("nullable scrutinee with guarded catch-all keeps .else() (#2)", () => {
    const r = run(`${SHAPE}
export const f = (t: Shape | null) => match(t)
  .case({ kind: "circle" }).then(1)
  .case({ kind: "ring" }).then(2)
  .case(x).if(x !== null).then(3)
  .else(4);`);
    const f = r.exports.f as Fn;
    expect(f({ kind: "circle", radius: 1 })).toBe(1);
    expect(f({ kind: "ring", radius: 1 })).toBe(2);
    expect(f({ kind: "sq", side: 1 })).toBe(3);
    expect(f(null)).toBe(4);
  });

  it("nullable scrutinee, unguarded: null goes to else", () => {
    const r = run(`${SHAPE}
export const f = (t: Shape | null) => match(t)
  .case({ kind: "circle" }).then(1)
  .case({ kind: "ring" }).then(2)
  .else(9);`);
    const f = r.exports.f as Fn;
    expect(f({ kind: "circle", radius: 1 })).toBe(1);
    expect(f(null)).toBe(9);
    expect(f({ kind: "sq", side: 1 })).toBe(9);
  });

  it("nested literal in an extra prop is TESTED, not just bound (#3)", () => {
    const r = run(`type E = { kind: "a"; inner: { x: number } } | { kind: "b" };
export const f = (e: E) => match(e)
  .case({ kind: "a", inner: { x: 1 } }).then("a1")
  .case({ kind: "a" }).then("a-other")
  .case({ kind: "b" }).then("b");`);
    const f = r.exports.f as Fn;
    expect(f({ kind: "a", inner: { x: 1 } })).toBe("a1");
    expect(f({ kind: "a", inner: { x: 2 } })).toBe("a-other");
    expect(f({ kind: "b" })).toBe("b");
  });

  it("array-length constraint in an extra prop is tested (#3)", () => {
    const r = run(`type L = { kind: "list"; items: number[] } | { kind: "none" };
export const f = (l: L) => match(l)
  .case({ kind: "list", items: [a, b] }).then(a + b)
  .case({ kind: "list" }).then(-1)
  .case({ kind: "none" }).then(0);`);
    const f = r.exports.f as Fn;
    expect(f({ kind: "list", items: [1, 2] })).toBe(3);
    expect(f({ kind: "list", items: [1, 2, 3] })).toBe(-1);
    expect(f({ kind: "none" })).toBe(0);
  });

  it("variable catch-all in the default clause", () => {
    const r = run(`${SHAPE}
export const f = (s: Shape) => match(s)
  .case({ kind: "circle", radius: r }).then(r)
  .case({ kind: "ring", radius: r }).then(r * 2)
  .case(other).then(other.kind);`);
    const f = r.exports.f as Fn;
    expect(f({ kind: "ring", radius: 2 })).toBe(4);
    expect(f({ kind: "sq", side: 1 })).toBe("sq");
  });
});

// A switch whose arms cover every variant can't fall out of it: the
// `throw new MatchError` after it was dead code that kept a runtime import
// of @typesugar/std, and every arm that returns was followed by a dead
// `break;`. Both are dropped only when the switch provably can't fall out:
// each variant of the type the switch reads has an arm with no test left
// and no guard. Otherwise (a guard, an optional field's test, a type that
// may be null or isn't a union of variants) the break and the throw stay.
describe("discriminant switch: no dead code after an exhaustive switch", () => {
  const TWO = `type Shape2 = { kind: "circle"; radius: number } | { kind: "square"; side: number };`;

  it("covering every variant: no break after a returning arm, no MatchError, no runtime import", () => {
    const r = run(`${TWO}
export const f = (s: Shape2) => match(s)
  .case({ kind: "circle", radius }).then(radius * 2)
  .case({ kind: "square", side }).then(side ** 2);`);
    expect(r.errors).toEqual([]);
    expect(r.code).toContain("switch (_s.kind)");
    expect(r.code).not.toMatch(/\bbreak\b/);
    expect(r.code).not.toContain("MatchError");
    expect(r.code).not.toContain("@typesugar/std");
    expect(r.code).toContain(`case "circle": {
            const radius = _s.radius;
            return radius * 2;
        }`);
    const f = r.exports.f as Fn;
    expect(f({ kind: "circle", radius: 3 })).toBe(6);
    expect(f({ kind: "square", side: 3 })).toBe(9);
  });

  it("a guarded arm followed by an unguarded one for the same tag: still exhaustive", () => {
    const r = run(`${TWO}
export const f = (s: Shape2) => match(s)
  .case({ kind: "circle", radius }).if(radius > 10).then("big")
  .case({ kind: "circle" }).then("small")
  .case({ kind: "square" }).then("sq");`);
    expect(r.errors).toEqual([]);
    expect(r.code).not.toMatch(/\bbreak\b/);
    expect(r.code).not.toContain("MatchError");
    const f = r.exports.f as Fn;
    expect(f({ kind: "circle", radius: 50 })).toBe("big");
    expect(f({ kind: "circle", radius: 5 })).toBe("small");
    expect(f({ kind: "square", side: 1 })).toBe("sq");
  });

  it("a tag whose only arm is guarded keeps its break and the throw", () => {
    const r = transformAndRun(`import { match } from "@typesugar/std";
${TWO}
export const f = (s: Shape2) => match(s)
  .case({ kind: "circle", radius }).if(radius > 10).then("big")
  .case({ kind: "square" }).then("sq");`);
    // Not exhaustive (TS9226), but the code is still generated.
    expect(r.code).toMatch(/if \(radius > 10\)\s*return "big";\s*\}\s*break;/);
    expect(r.code).toContain("throw new MatchError(_s)");
    expect(r.code).not.toMatch(/return "sq";\s*\}\s*break;/);
  });

  it("an optional field's test can fall through: the break and the throw stay", () => {
    const r = run(`type P = { kind: "a"; x?: number } | { kind: "b" };
export const f = (p: P) => match(p).case({ kind: "a", x }).then(x).case({ kind: "b" }).then(0);`);
    // `{ kind: "a" }` (no x) matches no arm: TS9226 says so (review 9), and
    // the throw is what runs.
    expect(r.errors.join("\n")).toMatch(/TS9226[\s\S]*"a"[\s\S]*optional field "x"/);
    expect(r.code).toContain(`"x" in _p`);
    expect(r.code).toContain("break;");
    expect(r.code).toContain("throw new MatchError(_p)");
    const f = r.exports.f as Fn;
    expect(f({ kind: "a", x: 1 })).toBe(1);
    expect(() => f({ kind: "a" })).toThrow(MatchError);
  });

  it("a scrutinee that may be null (guarded switch) keeps the throw", () => {
    const r = run(`${TWO}
export const f = (s: any) => match(s)
  .case({ kind: "circle", radius }).then(radius)
  .case({ kind: "square", side }).then(side);`);
    expect(r.code).toContain("throw new MatchError(_s)");
    expect(() => (r.exports.f as Fn)(null)).toThrow(MatchError);
  });
});

describe("if chain: no dead MatchError after an arm that always returns", () => {
  it("a binding catch-all arm ends the chain", () => {
    const r = run(`type S = { kind: "circle"; radius: number } | { kind: "square"; side: number };
export const f = (s: S) => match(s).case({ radius: 1 }).then("unit").case(other).then(other.kind);`);
    expect(r.errors).toEqual([]);
    expect(r.code).not.toContain("MatchError");
    expect(r.code).not.toContain("@typesugar/std");
    const f = r.exports.f as Fn;
    expect(f({ kind: "circle", radius: 1 })).toBe("unit");
    expect(f({ kind: "square", side: 2 })).toBe("square");
  });

  it("a `_` arm with .as() ends the chain", () => {
    const r = run(
      `export const f = (n: number) => match(n).case(1).then(1).case(_).as(v).then(v * 10);`
    );
    expect(r.errors).toEqual([]);
    expect(r.code).not.toContain("MatchError");
    const f = r.exports.f as Fn;
    expect([f(1), f(2)]).toEqual([1, 20]);
  });
});

describe("fast path: direct emit (single-literal scrutinee type) (#5)", () => {
  it("still evaluates a side-effecting scrutinee", () => {
    const r = run(`let calls = 0;
function next(): "a" { calls++; return "a"; }
export const v = match(next()).case("a").then(1);
export const c = () => calls;`);
    expect(r.exports.v).toBe(1);
    expect((r.exports.c as Fn)()).toBe(1);
  });

  it("binds a variable pattern", () => {
    const r = run(`const mode = "dev";
export const v = match(mode).case(m).then(m.length);`);
    expect(r.exports.v).toBe(3);
  });

  it("String(s) type-constructor arm is taken, not else", () => {
    const r = run(`const one = "a" as const;
export const v = match(one).case(String(s)).then(s.length).else(0);`);
    expect(r.exports.v).toBe(1);
  });

  it("literal match on a plain identifier is still a direct emit", () => {
    const r = run(`const mode = "dev" as const;
export const v = match(mode).case("prod").then(1).case("dev").then(2);`);
    expect(r.code).not.toContain("=> {");
    expect(r.exports.v).toBe(2);
  });
});

describe("fast path: generic IIFE", () => {
  it("await inside arms makes the IIFE async and awaited (#4)", async () => {
    const r = run(`async function load(n: number): Promise<string> { return "L" + n; }
export async function f(x: number) {
  return match(x).case(1).then(await load(1)).case(n).then(await load(n));
}`);
    const f = r.exports.f as Fn;
    await expect(f(1)).resolves.toBe("L1");
    await expect(f(7)).resolves.toBe("L7");
  });

  it("yield inside an arm is a compile error, not a SyntaxError (#4)", () => {
    // The guard keeps this off the literal conditional-chain path (which has
    // no IIFE, so a yield there is fine — see the test below).
    const r = transformAndRun(`import { match } from "@typesugar/std";
export function* g(x: number) {
  const v = match(x).case(1).then(yield 1).case(n).if(n > 1).then(2).else(0);
  return v;
}`);
    expect(r.errors.join("\n")).toMatch(/yield/);
  });

  it("yield in a ternary-path arm is fine (no IIFE)", () => {
    const r = run(`export function* g(x: number) {
  const v = match(x).case(1).then((yield 1) as number).else(0);
  return v;
}`);
    const it = (r.exports.g as Fn)(1) as Generator<number, number, number>;
    expect(it.next().value).toBe(1);
    expect(it.next(42)).toEqual({ value: 42, done: true });
  });

  it("Option-like | null scrutinee does not throw on null (#14)", () => {
    const r = run(`type O = { _tag: "Some"; value: number } | { _tag: "None" };
declare function Some(value: number): O;
declare const None: O;
/** @impl Destructure<typeof Some, O, number>
 * @destructure _tag = "Some" -> value */
const destructureSome = { extract: (o: O) => (o._tag === "Some" ? o.value : undefined) };
/** @impl Destructure<typeof None, O, []>
 * @destructure _tag = "None" */
const destructureNone = { extract: (o: O) => (o._tag === "None" ? [] : undefined) };
export const f = (o: O | null) => match(o).case(Some(v)).then(v).case(None).then(0).else(-1);`);
    const f = r.exports.f as Fn;
    expect(f({ _tag: "Some", value: 4 })).toBe(4);
    expect(f({ _tag: "None" })).toBe(0);
    expect(f(null)).toBe(-1);
  });

  it("regex arm on a non-string does not throw (#14)", () => {
    const r = run(
      `export const f = (sn: string | number) => match(sn).case(/^a(b)$/).as([_, g]).then(g).else("none");`
    );
    const f = r.exports.f as Fn;
    expect(f("ab")).toBe("b");
    expect(f(5)).toBe("none");
  });

  it("Array([x, y]) checks the length (#14)", () => {
    const r = run(
      `export const f = (ar: number[] | string) => match(ar).case(Array([x, y])).then(x + y).else(0);`
    );
    const f = r.exports.f as Fn;
    expect(f([1, 2])).toBe(3);
    expect(f([1, 2, 3])).toBe(0);
    expect(f("xy")).toBe(0);
  });

  it(".or() keeps the .as() binding (#15)", () => {
    const r = run(
      `export const f = (st: 200 | 201 | 404) => match(st).case(200).or(201).as(c).then(c).else(0);`
    );
    const f = r.exports.f as Fn;
    expect(f(201)).toBe(201);
    expect(f(404)).toBe(0);
  });

  it(".or() with a variable binding is a compile error (#15)", () => {
    const r = transformAndRun(`import { match } from "@typesugar/std";
type P = { x: number } | { y: number };
export const f = (p: P) => match(p).case({ x }).or({ y: x }).then(x).else(0);`);
    expect(r.errors.join("\n")).toMatch(/\.or\(\)/);
  });
});

describe("exhaustiveness (#13)", () => {
  it(".or() alternatives count for discriminated unions", () => {
    const r = transformAndRun(`import { match } from "@typesugar/std";
type U = { kind: "a" } | { kind: "b" } | { kind: "c" };
export const f = (u: U) => match(u).case({ kind: "a" }).or({ kind: "b" }).then(1).case({ kind: "c" }).then(2);`);
    expect(r.errors).toEqual([]);
    expect((r.exports.f as Fn)({ kind: "b" })).toBe(1);
  });

  it("nullable literal union fully covered is not an error", () => {
    const r = transformAndRun(`import { match } from "@typesugar/std";
export const f = (ou: "a" | "b" | undefined) => match(ou).case("a").then(1).case("b").then(2).case(undefined).then(3);`);
    expect(r.errors).toEqual([]);
    expect((r.exports.f as Fn)(undefined)).toBe(3);
  });

  it("nullable literal union missing undefined IS an error", () => {
    const r = transformAndRun(`import { match } from "@typesugar/std";
export const f = (ou: "a" | "b" | undefined) => match(ou).case("a").then(1).case("b").then(2);`);
    expect(r.errors.join("\n")).toMatch(/undefined/);
  });

  it("String(s) covers a string-literal union", () => {
    const r = transformAndRun(`import { match } from "@typesugar/std";
export const f = (s: "x" | "y") => match(s).case(String(t)).then(t);`);
    expect(r.errors).toEqual([]);
    expect((r.exports.f as Fn)("y")).toBe("y");
  });

  // std showcase (round-2 docs finding): `const circle: Shape = { kind: "circle", ... }`
  // narrows `circle` to the circle variant -- one object type, not a union --
  // and a match over it reported TS9226 "the scrutinee type is not enumerable"
  // although its first arm covers that variant.
  it("a scrutinee narrowed to one variant is covered by that variant's arm", () => {
    const r = transformAndRun(`import { match } from "@typesugar/std";
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };
const circle: Shape = { kind: "circle", radius: 2 };
export const area = match(circle)
  .case({ kind: "circle", radius }).then(radius * 10)
  .case({ kind: "square", side }).then(side * side);
export const only = match(circle).case({ kind: "circle", radius }).then(radius);`);
    if (r.runError) throw new Error(`${String(r.runError)}\n--- emitted ---\n${r.code}`);
    expect(r.errors).toEqual([]);
    expect(r.exports.area).toBe(20);
    expect(r.exports.only).toBe(2);
  });

  it("a scrutinee narrowed to one variant still needs its variant covered", () => {
    const r = transformAndRun(`import { match } from "@typesugar/std";
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };
const circle: Shape = { kind: "circle", radius: 2 };
export const g = match(circle).case({ kind: "circle", radius: 1 }).then(1);`);
    expect(r.errors.join("\n")).toMatch(/Non-exhaustive/);
  });

  // The one-variant treatment is for a scrutinee NARROWED from a
  // discriminated union. A plain object type with a literal-typed field
  // (`version: 1`) isn't a variant of anything: "missing variants: 1
  // (discriminant: \"version\")" for arms on `name` was misleading.
  it("a plain object type with a literal-typed field keeps the object diagnostics", () => {
    const r = transformAndRun(`import { match } from "@typesugar/std";
interface Cfg { version: 1; name: string }
const cfg: Cfg = { version: 1, name: "a" };
export const n = match(cfg).case({ name: "a" }).then(1).case({ name: "b" }).then(2);`);
    const text = r.errors.join("\n");
    expect(text).toMatch(/TS9226/);
    expect(text).not.toMatch(/missing variants|discriminant/);
    const withElse = transformAndRun(`import { match } from "@typesugar/std";
interface Cfg { version: 1; name: string }
type Circle = { kind: "circle"; radius: number };
const cfg: Cfg = { version: 1, name: "a" };
export const n = match(cfg).case({ name: "a" }).then(1).else(0);
export const g = (c: Circle | null) => match(c).case({ kind: "circle", radius }).then(radius).else(-1);`);
    expect(withElse.errors).toEqual([]);
    expect(withElse.exports.n).toBe(1);
    expect((withElse.exports.g as Fn)(null)).toBe(-1);
  });

  it("an arm with an extra literal constraint does not cover its variant", () => {
    const r = transformAndRun(`import { match } from "@typesugar/std";
type V = { kind: "a"; extra: number } | { kind: "b" };
export const f = (v: V) => match(v).case({ kind: "a", extra: 1 }).then(1).case({ kind: "b" }).then(2);`);
    expect(r.errors.join("\n")).toMatch(/Non-exhaustive/);
  });
});

describe("object-handler form (#6)", () => {
  it("boolean scrutinee with true/false keys", () => {
    const r = run(
      `export const f = (flag: boolean) => match(flag, { true: () => "yes", false: () => "no" });`
    );
    const f = r.exports.f as Fn;
    expect(f(true)).toBe("yes");
    expect(f(false)).toBe("no");
  });

  it('string-literal union "1" | "2" compares as strings', () => {
    const r = run(
      `export const f = (code: "1" | "2") => match(code, { 1: () => "one", 2: () => "two" });`
    );
    const f = r.exports.f as Fn;
    expect(f("1")).toBe("one");
    expect(f("2")).toBe("two");
  });

  it("number scrutinee with numeric keys", () => {
    const r = run(
      `export const f = (n: number) => match(n, { 1: () => "one", 2: () => "two", _: () => "many" });`
    );
    const f = r.exports.f as Fn;
    expect(f(1)).toBe("one");
    expect(f(9)).toBe("many");
  });

  it("missing _ handler throws a MatchError (not a TypeError)", () => {
    const r = run(`export const f = (n: number) => match(n, { 1: () => "one" });`);
    const f = r.exports.f as Fn;
    expect(f(1)).toBe("one");
    expect(() => f(2)).toThrow(MatchError);
  });

  // Handlers for every member of a literal union: the last one needs no
  // test, and there is no MatchError (and no runtime @typesugar/std import)
  // after it. A value outside the type takes the last handler, as in the
  // fluent form's covering arm.
  it("handlers covering a literal union: no MatchError, no runtime import", () => {
    const r = run(
      `export const f = (s: "a" | "b" | "c") => match(s, { "a|b": () => 1, c: () => 2 });`
    );
    expect(r.code).not.toContain("MatchError");
    expect(r.code).not.toContain("@typesugar/std");
    expect(r.code).not.toContain(`_m === "c"`);
    const f = r.exports.f as Fn;
    expect([f("a"), f("b"), f("c")]).toEqual([1, 1, 2]);
  });

  it("handlers covering every variant: no non-exhaustive throw", () => {
    const r = run(`type S = { kind: "circle"; r: number } | { kind: "sq"; s: number };
export const f = (sh: S) => match(sh, { circle: (c) => c.r, sq: (q) => q.s });`);
    expect(r.code).not.toContain("Non-exhaustive");
    const f = r.exports.f as Fn;
    expect(f({ kind: "circle", r: 3 })).toBe(3);
    expect(f({ kind: "sq", s: 4 })).toBe(4);
  });

  it("method-shorthand handlers are kept", () => {
    const r = run(`type S = { kind: "circle"; r: number } | { kind: "sq"; s: number };
export const f = (sh: S) => match(sh, { circle(c) { return c.r; }, sq: (q) => q.s });`);
    const f = r.exports.f as Fn;
    expect(f({ kind: "circle", r: 3 })).toBe(3);
    expect(f({ kind: "sq", s: 4 })).toBe(4);
  });

  it("any-typed value defers to the runtime (agrees with it)", () => {
    const r = run(`export const f = (anyv: any) => match(anyv, { a: () => 1, _: () => 0 });`);
    const f = r.exports.f as Fn;
    expect(f("a")).toBe(1);
    expect(f({ kind: "a" })).toBe(1);
    expect(f("b")).toBe(0);
  });

  it("a|b keys on a primitive", () => {
    const r = run(
      `export const f = (s: "a" | "b" | "c") => match(s, { "a|b": () => 1, c: () => 2 });`
    );
    const f = r.exports.f as Fn;
    expect(f("b")).toBe(1);
    expect(f("c")).toBe(2);
  });

  it("ok: true/false discriminant on a result union", () => {
    const r = run(`type R = { ok: true; value: number } | { ok: false; error: string };
export const f = (res: R) => match(res, { true: (r) => 1, false: (r) => 2 });`);
    const f = r.exports.f as Fn;
    expect(f({ ok: true, value: 1 })).toBe(1);
    expect(f({ ok: false, error: "e" })).toBe(2);
  });
});

describe("runtime match (#6, #17)", () => {
  it("splits a|b keys for primitives", () => {
    expect(runtimeMatch("b" as string, { "a|b": () => 1, _: () => 0 } as never)).toBe(1);
  });

  it("does not resolve handlers through the prototype chain", () => {
    expect(runtimeMatch("toString" as string, { _: () => "fallback" } as never)).toBe("fallback");
    expect(
      runtimeMatch({ kind: "constructor" } as { kind: string }, { _: () => "fb" } as never)
    ).toBe("fb");
  });

  it("MatchError.throw exists and throws a MatchError", () => {
    expect(() => (MatchError as unknown as { throw(v: unknown): never }).throw(5)).toThrow(
      MatchError
    );
  });
});
