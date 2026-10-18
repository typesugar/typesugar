/**
 * Built-in Some/None/Left/Right/Cons/Nil extractors over @typesugar/fp's REAL
 * runtime representations (docs review 2026-10, B#1): Option<A> is `A | null`,
 * Either<E, A> is `{ left } | { right }`, List<A> is `{ head, tail } | null`.
 * They used to test `_tag`/`.value`, so no arm ever matched (silent wrong arm).
 *
 * The fp declarations below mirror packages/fp/src/data/{option,either,list}.ts
 * (std's tests cannot load @typesugar/fp at runtime). `_tag` unions keep the
 * tagged scheme — see match-execution.test.ts "Option-like | null scrutinee".
 */
import { describe, it, expect } from "vitest";
import { transformAndRun } from "./match-exec-helpers.js";

type Fn = (...args: unknown[]) => unknown;

const FP = `import { match } from "@typesugar/std";
type Option<A> = A | null;
function Some<A>(value: A): Option<A> { return value; }
const None: Option<never> = null;
interface Left<E> { readonly left: E; readonly right?: undefined }
interface Right<A> { readonly left?: undefined; readonly right: A }
type Either<E, A> = Left<E> | Right<A>;
function Left<E, A = never>(left: E): Either<E, A> { return { left }; }
function Right<E = never, A = unknown>(right: A): Either<E, A> { return { right }; }
interface Cons<A> { readonly head: A; readonly tail: List<A> }
type List<A> = Cons<A> | null;
function Cons<A>(head: A, tail: List<A>): List<A> { return { head, tail }; }
const Nil: List<never> = null;
`;

function run(code: string) {
  const r = transformAndRun(FP + code);
  if (r.runError || r.errors.length) {
    throw new Error(
      `errors: ${r.errors.join("; ")} run: ${String(r.runError)}\n--- emitted ---\n${r.code}`
    );
  }
  return r.exports;
}

describe("fp Option extractors", () => {
  it("the doc example: match(Some(5)).case(Some(v)).then(v * 2).else(-1)", () => {
    const ex = run(`export const r = match(Some(5)).case(Some(v)).then(v * 2).else(-1);`);
    expect(ex.r).toBe(10);
  });

  it("Some / None arms over an Option variable", () => {
    const ex = run(
      `export const f = (o: Option<number>) => match(o).case(Some(v)).then(v + 1).case(None).then(0).else(-1);`
    );
    expect((ex.f as Fn)(4)).toBe(5);
    expect((ex.f as Fn)(0)).toBe(1);
    expect((ex.f as Fn)(null)).toBe(0);
  });
});

describe("fp Either extractors", () => {
  it("the doc example: match(Right(3)).case(Right(val))", () => {
    const ex = run(
      `export const r = match(Right<string, number>(3)).case(Right(val)).then(val * 10).else("fallback");`
    );
    expect(ex.r).toBe(30);
  });

  it("Left / Right arms", () => {
    const ex = run(
      `export const f = (e: Either<string, number>) => match(e).case(Left(err)).then("L:" + err).case(Right(v)).then("R:" + v).else("?");`
    );
    expect((ex.f as Fn)({ right: 2 })).toBe("R:2");
    expect((ex.f as Fn)({ left: "boom" })).toBe("L:boom");
  });
});

describe("fp List extractors", () => {
  it("Cons(h, t) / Nil arms", () => {
    const ex = run(
      `export const f = (l: List<number>) => match(l).case(Cons(h, Nil)).then("one:" + h).case(Cons(h, t)).then("many:" + h).case(Nil).then("empty").else("?");`
    );
    expect((ex.f as Fn)(null)).toBe("empty");
    expect((ex.f as Fn)({ head: 1, tail: null })).toBe("one:1");
    expect((ex.f as Fn)({ head: 1, tail: { head: 2, tail: null } })).toBe("many:1");
  });
});

describe("exhaustiveness over fp representations", () => {
  it("Some + None needs no .else()", () => {
    const ex = run(
      `export const f = (o: Option<number>) => match(o).case(Some(v)).then(v).case(None).then(0);`
    );
    expect((ex.f as Fn)(3)).toBe(3);
    expect((ex.f as Fn)(null)).toBe(0);
  });

  it("Left + Right needs no .else()", () => {
    const ex = run(
      `export const f = (e: Either<string, number>) => match(e).case(Right(v)).then(v).case(Left(x)).then(-1);`
    );
    expect((ex.f as Fn)({ right: 3 })).toBe(3);
    expect((ex.f as Fn)({ left: "x" })).toBe(-1);
  });

  it("Some alone still requires .else()", () => {
    const r = transformAndRun(
      FP + `export const f = (o: Option<number>) => match(o).case(Some(v)).then(v);`
    );
    expect(r.errors.join("\n")).toMatch(/Non-exhaustive/);
  });
});
