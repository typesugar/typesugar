/**
 * `match()` over @typesugar/fp's REAL types (their `.d.ts`, their
 * `Destructure` instances), through the real pipeline with `strictOutput`:
 * the expanded code must type-check, run, and stay free of `@typesugar/std`
 * at runtime when the arms cover the type.
 *
 * - `Some(v)` bound `const v = _o`, typed `Option<number>` (fp's Option is
 *   `@opaque`: to the checker it is an interface, which `_o != null` does
 *   not narrow), so `v * 2` failed strict type-checking. The binding now
 *   has the payload type the instance's `extract` declares.
 * - A match whose extractors cover the type (Some/None, Left/Right,
 *   Cons/Nil, Valid/Invalid, derived union extractors) ended in a dead
 *   `throw new MatchError(...)`, which imported `@typesugar/std` at runtime,
 *   and kept the last arm's test.
 */
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import * as ts from "typescript";
import { transformCode } from "@typesugar/transformer";

const FILE = path.resolve(__dirname, "__match_fp_strict__.ts");

const FP_IMPORTS = `import { match } from "@typesugar/std";
import {
  Some, None, type Option,
  Left, Right, type Either,
  Cons, Nil, type List,
  Valid, Invalid, type Validated,
} from "@typesugar/fp";
`;

function expand(code: string) {
  const r = transformCode(code, { fileName: FILE, strictOutput: true });
  const strict = r.diagnostics.filter((d) => d.message.startsWith("[strictOutput]"));
  const errors = r.diagnostics.filter((d) => d.severity === "error");
  return {
    code: r.code,
    strict: strict.map((d) => d.message),
    errors: errors.map((d) => d.message),
  };
}

/** Run the expanded module; `@typesugar/fp` resolves to the built package. */
function run(code: string): Record<string, unknown> {
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const req = (spec: string) => require(spec);
  new Function("require", "exports", "module", js)(req, mod.exports, mod);
  return mod.exports;
}

type Fn = (...a: unknown[]) => unknown;

describe("fp extractors: the bindings have the payload's type (strictOutput)", () => {
  it("Some(v) binds a number, so `v * 2` type-checks", () => {
    const r = expand(
      FP_IMPORTS +
        `export const f = (o: Option<number>) => match(o).case(Some(v)).then(v * 2).case(None).then(0);`
    );
    expect(r.errors).toEqual([]);
    expect(r.strict).toEqual([]);
    const ex = run(r.code);
    expect((ex.f as Fn)(4)).toBe(8);
    expect((ex.f as Fn)(null)).toBe(0);
  });

  it("Some(v) nested in Some: the inner binding has the inner payload's type", () => {
    const r = expand(
      FP_IMPORTS +
        `export const f = (o: Option<Option<number>>) => match(o).case(Some(Some(v))).then(v * 2).else(-1);`
    );
    expect(r.errors).toEqual([]);
    expect(r.strict).toEqual([]);
  });

  it("Some under Right, and Some(5) as a test, type-check and run", () => {
    const r = expand(
      FP_IMPORTS +
        `export const r = (e: Either<string, Option<number>>) => match(e).case(Right(Some(v))).then(v * 2).else(0);
export const five = (o: Option<number>) => match(o).case(Some(5)).then("five").case(None).then("none").else("other");`
    );
    expect(r.errors).toEqual([]);
    expect(r.strict).toEqual([]);
    expect(r.code).toContain("const v = _e.right as unknown as number;");
    const ex = run(r.code);
    expect((ex.r as Fn)({ right: 4 })).toBe(8);
    expect((ex.r as Fn)({ right: null })).toBe(0);
    expect([5, 3, null].map((x) => (ex.five as Fn)(x))).toEqual(["five", "other", "none"]);
  });

  it("Some(v) in a match: switch binds a number", () => {
    const r = expand(
      `import "@typesugar/std/syntax/match";\n` +
        FP_IMPORTS +
        `export function f(o: Option<number>): number {\n  match: switch (o) {\n    case Some(v):\n      return v * 2;\n    case None:\n      return 0;\n  }\n}`
    );
    expect(r.errors).toEqual([]);
    expect(r.strict).toEqual([]);
  });

  it("Left/Right, Cons/Nil and Valid/Invalid bindings type-check", () => {
    const r = expand(
      FP_IMPORTS +
        `export const e = (x: Either<string, number>) => match(x).case(Left(l)).then(l.length).case(Right(n)).then(n * 2);
export const l = (xs: List<number>) => match(xs).case(Cons(h, t)).then(h * 2).case(Nil).then(0);
export const v = (x: Validated<string, number>) => match(x).case(Valid(a)).then(a * 2).case(Invalid(err)).then(err.length);`
    );
    expect(r.errors).toEqual([]);
    expect(r.strict).toEqual([]);
  });

  it("@derive(Destructure) product and union extractors type-check", () => {
    const r = expand(`import { match } from "@typesugar/std";
/** @derive(Destructure) */
export interface Point { x: number; y: number }
/** @derive(Destructure) */
export type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export const p = (pt: Point) => match(pt).case(Point(x, y)).then(x * y);
export const s = (sh: Shape) => match(sh).case(Circle(r)).then(r * 2).case(Square(side)).then(side * 3);`);
    expect(r.errors).toEqual([]);
    expect(r.strict).toEqual([]);
  });
});

describe("fp extractors: a covering match has no MatchError and no @typesugar/std at runtime", () => {
  const COVERING = {
    option: `export const f = (o: Option<number>) => match(o).case(Some(v)).then(v * 2).case(None).then(0);`,
    either: `export const f = (x: Either<string, number>) => match(x).case(Left(l)).then(l.length).case(Right(n)).then(n * 2);`,
    list: `export const f = (xs: List<number>) => match(xs).case(Cons(h, t)).then(h * 2).case(Nil).then(0);`,
    validated: `export const f = (x: Validated<string, number>) => match(x).case(Valid(a)).then(a * 2).case(Invalid(e)).then(e.length);`,
    noBindings: `export const f = (o: Option<number>) => match(o).case(None).then("none").case(Some(_)).then("some");`,
  };
  for (const [name, code] of Object.entries(COVERING)) {
    it(name, () => {
      const r = expand(FP_IMPORTS + code);
      expect(r.errors).toEqual([]);
      expect(r.strict).toEqual([]);
      expect(r.code).not.toContain("MatchError");
      // The only runtime import left is fp's own (its constructors are values).
      const js = ts.transpileModule(r.code, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText;
      expect(js).not.toContain("@typesugar/std");
    });
  }

  it("arms with no bindings compile to a conditional, not an IIFE", () => {
    const r = expand(FP_IMPORTS + COVERING.noBindings);
    expect(r.code).toContain(
      `export const f = (o: Option<number>) => o == null ? "none" : "some";`
    );
  });

  it("derived union extractors: last arm unconditional, no MatchError", () => {
    const r = expand(`import { match } from "@typesugar/std";
/** @derive(Destructure) */
export type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export const s = (sh: Shape) => match(sh).case(Circle(r)).then(r * 2).case(Square(side)).then(side * 3);`);
    expect(r.errors).toEqual([]);
    expect(r.code).not.toContain("MatchError");
    expect(r.code).not.toContain(`_sh.kind === "square"`);
    const ex = run(r.code);
    expect((ex.s as Fn)({ kind: "circle", r: 2 })).toBe(4);
    expect((ex.s as Fn)({ kind: "square", side: 2 })).toBe(6);
  });
});
