/**
 * Review finding macros-other #20: pipe/compose evaluation semantics.
 *
 * - `pipe(x, a(), b())` expanded to `b()(a()(x))`, evaluating `b()` before
 *   `a()` (the runtime `pipe` evaluates its arguments left to right).
 * - `compose(memoize(f), g)` expanded to `(x) => memoize(f)(g(x))`,
 *   re-evaluating `memoize(f)` on every call (defeating the memoization).
 *
 * These tests run the expanded code.
 */

import * as ts from "typescript";
import { describe, it, expect } from "vitest";
import type { MacroContext } from "@typesugar/core";
import { pipeMacro, composeMacro } from "./operators.js";

function stubCtx(): MacroContext {
  let n = 0;
  return {
    factory: ts.factory,
    reportError() {},
    generateUniqueName: (p: string) => ts.factory.createIdentifier(`${p}_${++n}`),
  } as unknown as MacroContext;
}

function parseArgs(src: string): ts.Expression[] {
  const sf = ts.createSourceFile("a.ts", `f(${src});`, ts.ScriptTarget.Latest, true);
  const call = (sf.statements[0] as ts.ExpressionStatement).expression as ts.CallExpression;
  return [...call.arguments];
}

/** Expand, print, and evaluate with `env` bound as free variables. */
function run(
  macro: typeof pipeMacro,
  argsSrc: string,
  env: Record<string, unknown>
): { value: unknown; printed: string } {
  const args = parseArgs(argsSrc);
  const call = ts.factory.createCallExpression(ts.factory.createIdentifier("m"), undefined, args);
  const out = macro.expand(stubCtx(), call, args);
  const printed = ts
    .createPrinter()
    .printNode(
      ts.EmitHint.Expression,
      out,
      ts.createSourceFile("o.ts", "", ts.ScriptTarget.Latest)
    );
  const js = ts.transpileModule(`(${printed})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const names = Object.keys(env);
  const value = new Function(...names, `return ${js}`)(...names.map((k) => env[k]));
  return { value, printed };
}

describe("pipe evaluates its arguments left to right, once", () => {
  it("pipe(x(), a(), b())", () => {
    const log: string[] = [];
    const env = {
      x: () => (log.push("x"), 1),
      a: () => (log.push("a"), (v: number) => v + 1),
      b: () => (log.push("b"), (v: number) => v * 10),
    };
    const { value } = run(pipeMacro, "x(), a(), b()", env);
    expect(value).toBe(20);
    expect(log).toEqual(["x", "a", "b"]);
  });

  it("keeps the zero-cost form for plain identifiers", () => {
    const { printed } = run(pipeMacro, "x, f, g", {
      x: 1,
      f: (v: number) => v,
      g: (v: number) => v,
    });
    expect(printed).toBe("g(f(x))");
  });
});

describe("compose evaluates its function arguments once", () => {
  it("compose(memo(), g) does not re-run memo() per call", () => {
    let created = 0;
    const env = {
      memo: () => {
        created++;
        return (v: number) => v + 1;
      },
      g: (v: number) => v * 2,
    };
    const { value } = run(composeMacro, "memo(), g", env);
    const fn = value as (v: number) => number;
    expect(created).toBe(1);
    expect(fn(1)).toBe(3);
    expect(fn(2)).toBe(5);
    expect(created).toBe(1);
  });
});
