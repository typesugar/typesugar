/**
 * Semantic-safety tests for `inlineMethod` and the early-return flattener
 * (deep review 1.0: macros-typeclass #1, #2, #3, #4; core #6).
 *
 * Each case evaluates the plain method call and the inlined expression in the
 * same environment and requires identical results (value, thrown error, and
 * side-effect trace). `inlineMethod` returning `undefined` means "not inlined"
 * — the plain call stays, which is always correct.
 */

import * as ts from "typescript";
import { describe, it, expect } from "vitest";
import {
  extractMethodsFromObjectLiteral,
  inlineMethod,
  flattenReturnsToExpression,
} from "./specialize.js";

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
const ctx = {
  factory: ts.factory,
  transformContext: (ts as unknown as { nullTransformationContext: ts.TransformationContext })
    .nullTransformationContext,
} as unknown as Parameters<typeof inlineMethod>[0];

function parseObject(src: string): ts.ObjectLiteralExpression {
  const sf = ts.createSourceFile("inst.ts", `const inst = ${src};`, ts.ScriptTarget.Latest, true);
  const stmt = sf.statements[0] as ts.VariableStatement;
  return stmt.declarationList.declarations[0].initializer as ts.ObjectLiteralExpression;
}

function parseArgs(src: string): ts.Expression[] {
  const sf = ts.createSourceFile("args.ts", `f(${src});`, ts.ScriptTarget.Latest, true);
  const call = (sf.statements[0] as ts.ExpressionStatement).expression as ts.CallExpression;
  return Array.from(call.arguments);
}

function print(node: ts.Node): string {
  const sf = ts.createSourceFile("o.ts", "", ts.ScriptTarget.Latest);
  return printer.printNode(ts.EmitHint.Expression, node, sf);
}

function evaluate(prelude: string, expr: string): unknown {
  try {
    const value = new Function(
      `"use strict"; const log = []; ${prelude}; const __r = (${expr}); return { value: __r, log: log.join(",") };`
    )();
    return JSON.parse(
      JSON.stringify(value, (_k, v) =>
        v === undefined ? "<undef>" : Number.isNaN(v) ? "<NaN>" : v
      )
    );
  } catch (e) {
    return `THREW ${(e as Error).constructor.name}`;
  }
}

/** Returns the inlined text (or undefined when the inliner declined). */
function check(instSrc: string, method: string, argSrc: string, prelude = ""): string | undefined {
  const methods = extractMethodsFromObjectLiteral(parseObject(instSrc));
  const m = methods.get(method);
  expect(m).toBeDefined();
  const inlined = inlineMethod(ctx, m!, parseArgs(argSrc));
  const text = inlined ? print(inlined) : undefined;
  const plain = evaluate(`${prelude}; const inst = ${instSrc}`, `inst.${method}(${argSrc})`);
  const after = text === undefined ? plain : evaluate(`${prelude}; const inst = ${instSrc}`, text);
  expect({ after, text }).toEqual({ after: plain, text });
  return text;
}

describe("inlineMethod: substitution only at references [tc#1]", () => {
  it("does not rewrite property-access names that match a parameter", () => {
    check(
      "{ equals: (x, y) => x.x === y.x && x.y === y.y }",
      "equals",
      "p1, p2",
      "const p1 = { x: 1, y: 2, p1: 9 }, p2 = { x: 1, y: 3, p2: 9 }"
    );
  });

  it("expands shorthand properties instead of producing `{ foo }`", () => {
    check("{ mk: (x) => ({ x }) }", "mk", "foo", "const foo = 5");
  });

  it("does not rewrite object-literal keys", () => {
    check("{ mk: (x) => ({ x: x }) }", "mk", "foo", "const foo = 5");
  });

  it("does not substitute into a nested arrow that shadows the parameter", () => {
    check(
      "{ map: (fa, f) => fa.map((fa) => f(fa)) }",
      "map",
      "xs, g",
      "const xs = [1, 2], g = (v) => v * 10"
    );
  });

  it("does not let a body local capture an argument identifier", () => {
    check("{ f(a, b) { const t = a + 1; return t * b; } }", "f", "q, t", "const q = 2, t = 5");
  });

  it("does not inline when an argument is missing", () => {
    check("{ f: (a, b) => a + b }", "f", "s", "const s = 's'");
  });

  it("does not inline when a parameter has a default", () => {
    check("{ f: (a, b = 10) => a + b }", "f", "1");
  });

  it("does not inline a spread argument", () => {
    check("{ f: (a, b) => a + b }", "f", "...xs", "const xs = [1, 2]");
  });

  it("parenthesizes arguments to preserve precedence", () => {
    check("{ mul: (a, b) => a * b }", "mul", "x + 1, y + 2", "const x = 1, y = 2");
  });

  it("still inlines simple calls (coverage)", () => {
    const text = check("{ equals: (a, b) => a === b }", "equals", "p, q", "const p = 1, q = 1");
    expect(text).toBe("p === q");
  });
});

describe("inlineMethod: receiver-dependent bodies [tc#2]", () => {
  it("does not inline a method that reads `this`", () => {
    const text = check(
      "{ prefix: 'p', show(a) { return this.prefix + a; } }",
      "show",
      "s",
      "const s = 'x'"
    );
    expect(text).toBeUndefined();
  });

  it("does not inline a method that delegates through `this`", () => {
    check(
      "{ equals(a, b) { return a === b; }, notEquals(a, b) { return !this.equals(a, b); } }",
      "notEquals",
      "1, 2"
    );
  });

  it("does not inline a method that uses `arguments`", () => {
    check("{ count: function (a) { return arguments.length; } }", "count", "1");
  });
});

describe("inlineMethod: argument evaluation [tc#3, core#6]", () => {
  const prelude =
    "let i = 0; const pts = [{x:1,y:1},{x:1,y:1}]; function next() { log.push('n'); return pts[i++]; }" +
    " function f() { log.push('f'); return 'F'; } function g() { log.push('g'); return 'G'; }" +
    " function sideEffect() { log.push('s'); return 1; }";

  it("does not duplicate a side-effecting argument", () => {
    check("{ equals: (a, b) => a.x === b.x && a.y === b.y }", "equals", "next(), next()", prelude);
  });

  it("does not reorder side-effecting arguments", () => {
    check("{ combine: (a, b) => b + a }", "combine", "f(), g()", prelude);
  });

  it("does not drop an unused side-effecting argument", () => {
    check("{ empty: (a) => 0 }", "empty", "sideEffect()", prelude);
  });

  it("does not move a side-effecting argument after a body call", () => {
    check("{ f: (a) => (log.push('body'), a) }", "f", "f()", prelude);
  });

  it("does not move a side-effecting argument into a short-circuit branch", () => {
    check("{ f: (a, b) => a && b }", "f", "0, sideEffect()", prelude);
  });

  it("inlines a single, in-order side-effecting argument (coverage)", () => {
    const text = check("{ show: (a) => String(a) }", "show", "f()", prelude);
    expect(text).toBe("String(f())");
  });
});

describe("early-return flattening [tc#4]", () => {
  it("keeps a binding after its guard (null guard before property access)", () => {
    check(
      "{ f(a) { if (a == null) return 'none'; const n = a.length; return n; } }",
      "f",
      "s",
      "const s = null"
    );
  });

  it("keeps expression statements inside a branch", () => {
    check(
      "{ f(a) { if (a) { log.push('hit'); return 1; } return 2; } }",
      "f",
      "s",
      "const s = true"
    );
  });

  it("flattenReturnsToExpression keeps binding order (direct)", () => {
    const sf = ts.createSourceFile(
      "b.ts",
      "function h(a) { if (a == null) return 'none'; const n = a.length; return n; }",
      ts.ScriptTarget.Latest,
      true
    );
    const fn = sf.statements[0] as ts.FunctionDeclaration;
    const flat = flattenReturnsToExpression(ctx, fn.body!);
    if (flat) {
      const text = printer.printNode(ts.EmitHint.Expression, flat, sf);
      expect(evaluate("const a = null", text)).toEqual(evaluate("", "'none'"));
      expect(evaluate("const a = 'abc'", text)).toEqual(evaluate("", "3"));
    }
  });
});
