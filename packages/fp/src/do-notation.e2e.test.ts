/**
 * @typesugar/fp — do-notation (`let:`/`yield:`) over fp types, end-to-end
 * through the REAL transformer, EXECUTING the emitted code against the built
 * `@typesugar/fp` dist.
 *
 * Regression for docs review 2026-10 (guides-a #2): `Some(10)` erases to `10`
 * and `Right(10)` is a plain `{ right }` object, so the old method-style
 * emission (`10..flatMap(...)`, `Right(10).flatMap(...)`) threw a TypeError.
 * The fp FlatMap instances now declare
 * `@do-methods style=static receiver=<instance>`, so comprehensions emit
 * `flatMapOption.flatMap(fa, f)` etc.
 *
 * Needs `pnpm --filter @typesugar/fp build` (the transformer resolves
 * `@typesugar/fp` through its dist `.d.ts`, where the `@do-methods` tags live).
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import * as ts from "typescript";
import { createRequire } from "module";
// @ts-ignore -- the transformer is not a dependency of this package; load its built pipeline directly
import { transformCode } from "../../transformer/dist/pipeline.js";

// Repo root: `@typesugar/fp` and `@typesugar/std` both resolve from here.
const FILE = path.resolve(__dirname, "../../../__fp_do_e2e_input.ts");
const req = createRequire(FILE);

function expand(src: string): { code: string; errors: string[] } {
  const r = transformCode(src, { fileName: FILE });
  const diags: any[] = r.diagnostics ?? [];
  return {
    code: r.code,
    errors: diags
      .filter((d) => d.severity === "error")
      .map((d) => String(d.message ?? d.messageText)),
  };
}

function run(code: string): Record<string, any> {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as Record<string, any> };
  const require = (id: string) => {
    if (id === "@typesugar/fp") return req("@typesugar/fp");
    if (id === "@typesugar/std/syntax/do") return {};
    throw new Error("unexpected require: " + id);
  };
  new Function("require", "module", "exports", js)(require, mod, mod.exports);
  return mod.exports;
}

describe("let: over fp types emits static instance calls (docs review guides-a #2)", () => {
  it("Option: the do-notation guide Quick Start yields 30, not a TypeError", () => {
    const { code, errors } = expand(`
import "@typesugar/std/syntax/do";
import { Option, Some, None, flatMapOption } from "@typesugar/fp";
export const r = let: {
  x << Some(10);
  y << Some(x * 2);
}
yield: {
  x + y;
}
const n: Option<number> = None;
export const none = let: {
  x << n;
  y << Some(x * 2);
}
yield: { x + y; }
`);
    expect(errors).toEqual([]);
    expect(code).toContain("flatMapOption.flatMap(");
    expect(code).not.toMatch(/\.\.flatMap|\)\.flatMap\(/);
    const out = run(code);
    expect(out.r).toBe(30);
    expect(out.none).toBe(null);
  });

  it("Either: Right chains, Left short-circuits", () => {
    const { code, errors } = expand(`
import "@typesugar/std/syntax/do";
import { type Either, Left, Right, isRight, flatMapEitherInstance } from "@typesugar/fp";
export const ok = let: {
  x << Right(10);
  y << Right(x * 2);
}
yield: { x + y; }
const l: Either<string, number> = Left("boom");
export const bad = let: {
  x << l;
  y << Right(x * 2);
}
yield: { x + y; }
`);
    expect(errors).toEqual([]);
    expect(code).toContain("flatMapEitherInstance.flatMap(");
    const out = run(code);
    expect(out.ok.right).toBe(30);
    expect(out.bad.left).toBe("boom");
  });

  it("IO: comprehension builds a runnable IO", () => {
    const { code, errors } = expand(`
import "@typesugar/std/syntax/do";
import { IO, runIOSync, flatMapIO } from "@typesugar/fp";
const io = let: {
  x << IO.pure(10);
  y << IO.pure(x * 2);
}
yield: { x + y; }
export const result = runIOSync(io);
`);
    expect(errors).toEqual([]);
    expect(run(code).result).toBe(30);
  });

  // The doc Quick Start does NOT import `flatMapOption` itself: the
  // comprehension must import its static receiver. That import is added by
  // @typesugar/std's let-yield.ts (it does so today only for std's own
  // Iterable instances) — pending that change, the emitted code references an
  // unimported `flatMapOption`. Flip to `it` once let-yield ensureImports
  // self-receivers from the instance's @do-instance-module.
  it("Option without importing the instance: receiver is auto-imported", () => {
    const { code, errors } = expand(`
import "@typesugar/std/syntax/do";
import { Option, Some, None } from "@typesugar/fp";
export const r = let: {
  x << Some(10);
  y << Some(x * 2);
}
yield: { x + y; }
`);
    expect(errors).toEqual([]);
    expect(run(code).r).toBe(30);
  });
});

// Docs review r3 (guides-a #1): `par:` over fp types used to emit the generic
// `fa.map(a => b => …).ap(fb)` chain — `Some(1)` erases to `1` and `Right(1)`
// is a plain object, so it threw a TypeError at runtime. With no ParCombine
// instance in scope, a static-style FlatMap instance now chains the
// independent binds.
describe("par: over fp types (docs review r3 guides-a #1)", () => {
  it("Either and Option par: blocks run and combine their values", () => {
    const { code, errors } = expand(`
import "@typesugar/std/syntax/do";
import { Some, None, Right, Left, type Option, type Either } from "@typesugar/fp";
export const e = par: { a << Right(1); b << Right(2); } yield: a + b
export const o = par: { a << Some(1); b << Some(2); c = 10; } yield: a + b + c
const n: Option<number> = None;
export const oNone = par: { a << Some(1); b << n; } yield: a + b
const l: Either<string, number> = Left("bad");
export const eLeft = par: { a << Right(1); b << l; } yield: a + b
export const single = par: { a << Some(5); } yield: a * 2
`);
    expect(errors).toEqual([]);
    expect(code).not.toContain(".ap(");
    const out = run(code);
    expect(out.e.right).toBe(3);
    expect(out.o).toBe(13);
    expect(out.oNone).toBe(null);
    expect(out.eLeft.left).toBe("bad");
    expect(out.single).toBe(10);
  });

  it("a nested par: group inside let: over Option runs", () => {
    const { code, errors } = expand(`
import "@typesugar/std/syntax/do";
import { Some } from "@typesugar/fp";
export const r = let: {
  x << Some(1);
  par: {
    a << Some(x + 1);
    b << Some(x + 2);
  }
  y << Some(a * b);
}
yield: { x + y }
`);
    expect(errors).toEqual([]);
    expect(run(code).r).toBe(7);
  });
});

// Docs review r3 (guides-a #2): `v << fa ?? alt` over Option emitted
// `flatMapOption.orElse(...)`, which did not exist (TypeError). Option and
// Either now declare `orElse=orElse` in their @do-methods.
describe("let: fallback (||/??) over fp types (docs review r3 guides-a #2)", () => {
  it("Option ?? and Either || recover through the instance's orElse", () => {
    const { code, errors } = expand(`
import "@typesugar/std/syntax/do";
import { Some, None, Left, Right, type Option, type Either } from "@typesugar/fp";
const parse = (s: string): Option<number> => (isNaN(Number(s)) ? None : Some(Number(s)));
export const v = let: { v << parse("x") ?? Some(0); } yield: { v }
export const w = let: { w << parse("4") ?? Some(0); } yield: { w + 1 }
const bad: Either<string, number> = Left("no");
export const e = let: { x << bad || Right(9); } yield: { x * 2 }
`);
    expect(errors).toEqual([]);
    const out = run(code);
    expect(out.v).toBe(0);
    expect(out.w).toBe(5);
    expect(out.e.right).toBe(18);
  });

  it("a static-style instance with no orElse= gives a clean compile error", () => {
    const { errors } = expand(`
import "@typesugar/std/syntax/do";
import { IO, runIOSync } from "@typesugar/fp";
export const r = let: { x << IO.pure(1) || IO.pure(2); } yield: { x }
`);
    expect(errors.join("\\n")).toMatch(/declares no orElse=/);
  });
});
