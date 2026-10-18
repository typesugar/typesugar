/**
 * Behavioural tests for @tailrec (deep review macros-other #5, #6, #7, #8).
 *
 * Every case EXECUTES the rewritten function and compares its results with
 * the untransformed recursive function on the same inputs. When the macro
 * declines to rewrite a shape, the test asserts that it reports a diagnostic
 * and returns the function unchanged (so the result is still correct, just
 * not stack-safe). For every rewrite, it also asserts that no self-call
 * remains anywhere in the rewritten body — a self-call left behind would
 * mean the macro claimed to optimise a call it did not.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as vm from "vm";
import { createMacroContext } from "@typesugar/core";
import { tailrecAttribute } from "./tailrec.js";

interface Compiled {
  /** The function after @tailrec, or undefined if the macro declined. */
  transformed: ((...args: any[]) => unknown) | undefined;
  /** The same declaration compiled without the macro. */
  original: (...args: any[]) => unknown;
  errors: string[];
  printed: string;
  /** Self-calls still present in the rewritten body. */
  remainingSelfCalls: number;
}

/**
 * Compile a declaration to a callable. Each call runs inside a vm context with
 * a timeout, so a rewrite that loops forever (finding #5) fails the test
 * instead of hanging the worker.
 */
function toFunction(declText: string, name: string): (...args: any[]) => unknown {
  const js = ts.transpileModule(declText, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
  const context = vm.createContext({});
  vm.runInContext(`"use strict";\n${js}\nglobalThis.__f = ${name};`, context);
  return (...args: any[]) => {
    context.__args = args;
    return vm.runInContext("__f(...__args)", context, { timeout: 2000 });
  };
}

function countSelfCalls(root: ts.Node, name: string): number {
  let n = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      n++;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return n;
}

function compile(source: string, name: string): Compiled {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailrec-sem-"));
  const filePath = path.join(tmpDir, "test.ts");
  fs.writeFileSync(filePath, source);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    strict: true,
    noEmit: true,
  };
  try {
    const program = ts.createProgram([filePath], options, ts.createCompilerHost(options));
    const sf = program.getSourceFile(filePath)!;
    const target = sf.statements.find(
      (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name
    )!;
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    let result: ts.Node = target;
    let errors: string[] = [];
    ts.transform(sf, [
      (tctx) => {
        const ctx = createMacroContext(program, sf, tctx);
        const deco = ts.factory.createDecorator(ts.factory.createIdentifier("tailrec"));
        const out = tailrecAttribute.expand(ctx, deco, target, []);
        result = Array.isArray(out) ? out[0] : out;
        errors = ctx
          .getDiagnostics()
          .filter((d) => d.severity === "error")
          .map((d) => d.message);
        return (s) => s;
      },
    ]);
    const originalText = printer.printNode(ts.EmitHint.Unspecified, target, sf);
    const printed = printer.printNode(ts.EmitHint.Unspecified, result, sf);
    const declined = result === target;
    return {
      transformed: declined ? undefined : toFunction(printed, name),
      original: toFunction(originalText, name),
      errors,
      printed,
      remainingSelfCalls: declined
        ? -1
        : countSelfCalls((result as ts.FunctionDeclaration).body!, name),
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Assert the macro rewrote `name` and it agrees with the original on every input. */
function expectEquivalent(source: string, name: string, inputs: unknown[][]): Compiled {
  const c = compile(source, name);
  expect(c.errors).toEqual([]);
  expect(c.transformed, `macro declined:\n${c.printed}`).toBeDefined();
  expect(c.remainingSelfCalls, c.printed).toBe(0);
  for (const args of inputs) {
    // Deep-copy array/object inputs so mutation by one run can't leak.
    const a1 = structuredClone(args);
    const a2 = structuredClone(args);
    expect(c.transformed!(...a2), `${name}(${JSON.stringify(args)})\n${c.printed}`).toEqual(
      c.original(...a1)
    );
  }
  return c;
}

/** Assert the macro reported an error and left the function unoptimised. */
function expectDeclined(source: string, name: string, messageMatch: RegExp): void {
  const c = compile(source, name);
  expect(c.transformed, c.printed).toBeUndefined();
  expect(c.errors.join("\n")).toMatch(messageMatch);
}

describe("@tailrec #5: functions that fall off the end", () => {
  it("countdown(0) terminates and matches the original", () => {
    const src = `
      function countdown(n: number, log: number[]): void {
        if (n > 0) {
          log.push(n);
          countdown(n - 1, log);
        }
      }`;
    const c = expectEquivalent(src, "countdown", [
      [0, []],
      [3, []],
    ]);
    const log: number[] = [];
    c.transformed!(4, log);
    expect(log).toEqual([4, 3, 2, 1]);
  });

  it("returns the value of a base case reached by fall-through", () => {
    expectEquivalent(
      `function f(n: number): number | undefined {
        if (n === 0) return 7;
        if (n > 5) return f(n - 1);
      }`,
      "f",
      [[0], [3], [8]]
    );
  });

  it("declines a statement-position self-call whose result the original discards", () => {
    // f(1) returns undefined originally (the inner call's 5 is discarded); a
    // naive loop would return 5.
    expectDeclined(
      `function f(n: number): number | undefined {
        if (n === 0) return 5;
        f(n - 1);
      }`,
      "f",
      /discard/
    );
  });
});

describe("@tailrec #6: parameter references and closures", () => {
  it("does not rename property names or shorthand keys that match a parameter", () => {
    expectEquivalent(
      `function build(n: number, acc: { n: number }[]): { n: number }[] {
        if (n === 0) return acc;
        return build(n - 1, [...acc, { n }]);
      }`,
      "build",
      [
        [0, []],
        [3, []],
      ]
    );
  });

  it("does not rename property accesses that match a parameter", () => {
    expectEquivalent(
      `function g(len: number, o: { len: number }): number {
        if (len === 0) return o.len;
        return g(len - 1, o);
      }`,
      "g",
      [[3, { len: 7 }]]
    );
  });

  it("closures created in the loop capture that iteration's parameter values", () => {
    const src = `
      function mk(n: number, fs: (() => number)[]): (() => number)[] {
        if (n === 0) return fs;
        fs.push(() => n);
        return mk(n - 1, fs);
      }`;
    const c = expectEquivalent(src, "mk", []);
    const fns = c.transformed!(3, []) as (() => number)[];
    expect(fns.map((f) => f())).toEqual([3, 2, 1]);
  });

  it("does not collide with user names that look like generated temporaries", () => {
    expectEquivalent(
      `function h(n: number, _n: number, _next_n: number): number {
        if (n === 0) return _n * 100 + _next_n;
        return h(n - 1, _n + n, _next_n + 1);
      }`,
      "h",
      [
        [0, 1, 2],
        [4, 0, 0],
      ]
    );
  });

  it("nested functions that shadow a parameter keep their own binding", () => {
    expectEquivalent(
      `function s(n: number, acc: number[]): number[] {
        if (n === 0) return acc;
        const twice = (n: number) => n * 2;
        return s(n - 1, [...acc, twice(n + 10)]);
      }`,
      "s",
      [[3, []]]
    );
  });

  it("supports a body that reassigns a parameter before the tail call", () => {
    expectEquivalent(
      `function r(n: number, acc: number): number {
        if (n <= 0) return acc;
        acc = acc + n;
        n = n - 2;
        return r(n, acc);
      }`,
      "r",
      [
        [0, 0],
        [7, 0],
      ]
    );
  });
});

describe("@tailrec #7: defaults, optional and rest parameters", () => {
  it("an omitted argument gets the default again, not the previous value", () => {
    expectEquivalent(
      `function d(n: number, flag: string = "default"): string {
        if (n === 0) return flag;
        if (n === 2) return d(n - 1, "set");
        return d(n - 1);
      }`,
      "d",
      [[0], [1], [2], [3], [0, "x"]]
    );
  });

  it("an explicit undefined argument triggers the default", () => {
    expectEquivalent(
      `function d(n: number, flag: string = "default"): string {
        if (n === 0) return flag;
        if (n === 3) return d(n - 1, "set");
        return d(n - 1, undefined);
      }`,
      "d",
      [[1], [3], [4]]
    );
  });

  it("a default that refers to an earlier parameter sees the new value", () => {
    expectEquivalent(
      `function k(n: number, acc: number = n * 10): number {
        if (n === 0) return acc;
        if (n === 2) return k(n - 1);
        return k(n - 1, acc + 1);
      }`,
      "k",
      [[0], [2], [5]]
    );
  });

  it("a default is resolved in parameter scope even if the body declares the same name", () => {
    expectEquivalent(
      `function q(n: number, k: number = Math.floor(1.5)): number {
        const Math = { floor: (_x: number) => 99 };
        if (n === 0) return k + Math.floor(0);
        return q(n - 1);
      }`,
      "q",
      [[0], [3]]
    );
  });

  it("an omitted optional argument becomes undefined", () => {
    expectEquivalent(
      `function o(n: number, x?: number): number | undefined {
        if (n === 0) return x;
        if (n === 3) return o(n - 1, 5);
        return o(n - 1);
      }`,
      "o",
      [[0], [2], [4], [1, 9]]
    );
  });

  it("rest parameters are rebuilt as an array (with spreads preserved)", () => {
    expectEquivalent(
      `function sum(acc: number, ...xs: number[]): number {
        if (xs.length === 0) return acc;
        return sum(acc + xs[0], ...xs.slice(1));
      }`,
      "sum",
      [[0], [0, 1, 2, 3], [10, 5]]
    );
  });

  it("rest parameters receive individual trailing arguments", () => {
    expectEquivalent(
      `function tag(n: number, ...xs: string[]): string {
        if (n === 0) return xs.join(",");
        return tag(n - 1, "a" + n, "b");
      }`,
      "tag",
      [[0], [2], [0, "x", "y"]]
    );
  });

  it("extra arguments are still evaluated (side effects kept)", () => {
    expectEquivalent(
      `function x(n: number, log: number[]): number[] {
        if (n === 0) return log;
        // @ts-ignore extra argument
        return x(n - 1, log, log.push(n));
      }`,
      "x",
      [[3, []]]
    );
  });

  it("declines destructured parameters with a diagnostic", () => {
    expectDeclined(
      `function p({ n }: { n: number }, acc: number): number {
        if (n === 0) return acc;
        return p({ n: n - 1 }, acc + n);
      }`,
      "p",
      /destructur/
    );
  });

  it("declines a spread argument in a non-rest position", () => {
    expectDeclined(
      `function sp(a: number, b: number): number {
        if (a === 0) return b;
        const next = [a - 1, b + 1] as [number, number];
        return sp(...next);
      }`,
      "sp",
      /spread/
    );
  });

  it("declines bodies that read `arguments`", () => {
    expectDeclined(
      `function ar(n: number): number {
        if (n === 0) return arguments.length;
        return ar(n - 1);
      }`,
      "ar",
      /arguments/
    );
  });

  it("declines bodies with `var` declarations", () => {
    expectDeclined(
      `function v(n: number): number {
        var seen;
        if (n === 0) return 1;
        return v(n - 1);
      }`,
      "v",
      /var/
    );
  });
});

describe("@tailrec #8: every accepted tail shape is really rewritten", () => {
  it("`a || f(...)` is rewritten into a loop (stack safe)", () => {
    const c = expectEquivalent(
      `function e(n: number): boolean {
        return n === 0 || e(n - 1);
      }`,
      "e",
      [[0], [5]]
    );
    expect(c.transformed!(200000)).toBe(true);
  });

  it("`a && f(...)` preserves the falsy short-circuit value", () => {
    expectEquivalent(
      `function a(n: number, xs: (number | string)[]): number | string | boolean {
        return xs[n] !== undefined && (n === xs.length - 1 ? xs[n] : a(n + 1, xs));
      }`,
      "a",
      [
        [0, [1, 2, 3]],
        [0, []],
        [0, [0, "x", ""]],
      ]
    );
  });

  it("`a ?? f(...)` returns the left side when not nullish", () => {
    expectEquivalent(
      `function nn(n: number, xs: (number | null)[]): number | null {
        if (n >= xs.length) return -1;
        return xs[n] ?? nn(n + 1, xs);
      }`,
      "nn",
      [
        [0, [null, null, 0]],
        [0, [null]],
        [0, [4]],
      ]
    );
  });

  it("comma expressions and nested ternaries", () => {
    const c = expectEquivalent(
      `function t(n: number, log: number[]): number[] {
        return n === 0 ? log : n % 2 === 0 ? (log.push(n), t(n - 1, log)) : t(n - 1, log);
      }`,
      "t",
      [
        [0, []],
        [6, []],
      ]
    );
    expect(c.transformed!(100000, []) as number[]).toHaveLength(50000);
  });

  it("parenthesised / as / non-null wrappers", () => {
    expectEquivalent(
      `function w(n: number): number {
        if (n === 0) return 42;
        return (w(n - 1) as number)!;
      }`,
      "w",
      [[0], [3]]
    );
  });

  it("returns inside loops and switch clauses", () => {
    expectEquivalent(
      `function lp(xs: number[], acc: number): number {
        for (const x of xs) {
          if (x < 0) return lp(xs.filter((y) => y !== x), acc + 1);
        }
        switch (xs.length) {
          case 0:
            return acc;
          case 1:
            return lp([], acc + xs[0]);
          default:
            return lp(xs.slice(1), acc + xs[0]);
        }
      }`,
      "lp",
      [
        [[], 0],
        [[1, -2, 3, -4, 5], 0],
      ]
    );
  });

  it("a ternary inside a switch case", () => {
    expectEquivalent(
      `function sw(n: number): string {
        switch (n % 3) {
          case 0:
            return n === 0 ? "done" : sw(n - 1);
          default:
            return sw(n - 1);
        }
      }`,
      "sw",
      [[0], [7]]
    );
  });

  it("declines a recursive call that is not in tail position", () => {
    expectDeclined(
      `function fac(n: number): number {
        if (n <= 1) return 1;
        return n * fac(n - 1);
      }`,
      "fac",
      /not in tail position/
    );
  });

  it("declines `await f(...)` in an async function", () => {
    expectDeclined(
      `async function aw(n: number): Promise<number> {
        if (n === 0) return 0;
        return await aw(n - 1);
      }`,
      "aw",
      /not in tail position/
    );
  });

  it("declines generator functions", () => {
    expectDeclined(
      `function* gen(n: number): Generator<number> {
        if (n === 0) return;
        yield n;
        return gen(n - 1);
      }`,
      "gen",
      /generator/
    );
  });
});
