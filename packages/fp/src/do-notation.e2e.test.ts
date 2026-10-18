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
