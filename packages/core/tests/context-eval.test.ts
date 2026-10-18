/**
 * MacroContextImpl parsing / compile-time evaluation / value→AST regressions
 * (deep review 2026-10: core #29, #30, #31, #45, #48; macros-other #13).
 *
 * Value→AST tests print the produced expression and EVALUATE it, so they check
 * the runtime value the emitted code produces, not just its text.
 */
import { describe, it, expect } from "vitest";
import * as vm from "node:vm";
import * as ts from "typescript";
import { HygieneContext } from "../src/hygiene.js";
import { MacroContextImpl } from "../src/context.js";
import { jsValueToExpression, hasSourceText, isSyntheticNode } from "../src/ast-utils.js";

function contextFor(source: string): MacroContextImpl {
  const sf = ts.createSourceFile("test.ts", source, ts.ScriptTarget.Latest, true);
  const host = ts.createCompilerHost({});
  const origGet = host.getSourceFile.bind(host);
  host.getSourceFile = (name, lang) => (name === "test.ts" ? sf : origGet(name, lang));
  const program = ts.createProgram(["test.ts"], { noLib: true, noResolve: true }, host);
  return new MacroContextImpl(
    program,
    program.getTypeChecker(),
    program.getSourceFile("test.ts") ?? sf,
    ts.factory,
    undefined as unknown as ts.TransformationContext,
    new HygieneContext()
  );
}

const printer = ts.createPrinter();
const dummy = ts.createSourceFile("out.ts", "", ts.ScriptTarget.Latest, false);
const print = (e: ts.Node) => printer.printNode(ts.EmitHint.Expression, e, dummy);
/** Evaluate printed expression text as JS. */
const run = (e: ts.Expression): unknown => new Function(`return (${print(e)});`)();

function valueCtx() {
  const errors: string[] = [];
  return {
    errors,
    ctx: { factory: ts.factory, reportError: (_n: ts.Node, m: string) => void errors.push(m) },
  };
}

/** Evaluate `expr` (a source expression) with the compile-time evaluator. */
function ev(expr: string) {
  const ctx = contextFor(`const __v = ${expr};`);
  const stmt = ctx.sourceFile.statements[0] as ts.VariableStatement;
  return ctx.evaluate(stmt.declarationList.declarations[0].initializer!);
}

describe("core #29: parse helpers report broken code instead of silently truncating", () => {
  const ctx = contextFor(`export {};`);

  it("parseExpression rejects a comma list instead of returning its first element", () => {
    expect(() => ctx.parseExpression("a, b")).toThrow(/Failed to parse expression/);
  });

  it("parseExpression rejects trailing statements", () => {
    expect(() => ctx.parseExpression("x; sideEffect()")).toThrow(/Failed to parse expression/);
  });

  it("parseExpression still parses a single expression", () => {
    expect(print(ctx.parseExpression("a + b"))).toBe("a + b");
  });

  it("parseStatements throws on syntax errors", () => {
    expect(() => ctx.parseStatements("const x = ;\nif (y {")).toThrow(/Failed to parse statements/);
  });

  it("parseStatements still parses valid code", () => {
    expect(ctx.parseStatements("const x = 1; x;")).toHaveLength(2);
  });
});

describe("core #30 / macros-other #13: jsValueToExpression preserves values", () => {
  it.each([
    ["NaN", NaN],
    ["-0", -0],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["-1.5", -1.5],
    ["bigint", 12n],
    ["negative bigint", -12n],
  ])("%s round-trips", (_l, v) => {
    const { ctx, errors } = valueCtx();
    expect(Object.is(run(jsValueToExpression(ctx, v, ts.factory.createNull())), v)).toBe(true);
    expect(errors).toEqual([]);
  });

  it("Map, Set and Date are rebuilt, not turned into {}", () => {
    const { ctx, errors } = valueCtx();
    const n = ts.factory.createNull();
    const m = run(jsValueToExpression(ctx, new Map([[1, "a"]]), n)) as Map<number, string>;
    expect(m).toBeInstanceOf(Map);
    expect([...m]).toEqual([[1, "a"]]);
    const s = run(jsValueToExpression(ctx, new Set([1, 2]), n)) as Set<number>;
    expect([...s]).toEqual([1, 2]);
    const d = run(jsValueToExpression(ctx, new Date(0), n)) as Date;
    expect(d).toBeInstanceOf(Date);
    expect(d.getTime()).toBe(0);
    expect(errors).toEqual([]);
  });

  it("a RegExp from another realm (comptime's vm context) is still a RegExp", () => {
    const { ctx, errors } = valueCtx();
    const re = vm.runInNewContext("/ab+/g");
    const out = run(jsValueToExpression(ctx, re, ts.factory.createNull())) as RegExp;
    expect(out).toBeInstanceOf(RegExp);
    expect(out.source).toBe("ab+");
    expect(out.flags).toBe("g");
    expect(errors).toEqual([]);
  });

  it("plain objects from another realm are still serialised", () => {
    const { ctx, errors } = valueCtx();
    const obj = vm.runInNewContext("({ a: 1, b: [2] })");
    expect(run(jsValueToExpression(ctx, obj, ts.factory.createNull()))).toEqual({ a: 1, b: [2] });
    expect(errors).toEqual([]);
  });

  it("a __proto__ key becomes an own property, not the prototype", () => {
    const { ctx } = valueCtx();
    const value = JSON.parse('{"__proto__": {"x": 1}}');
    const out = run(jsValueToExpression(ctx, value, ts.factory.createNull())) as object;
    expect(Object.prototype.hasOwnProperty.call(out, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it("class instances and cycles are reported, not silently emitted", () => {
    const { ctx, errors } = valueCtx();
    class Foo {
      x = 1;
    }
    jsValueToExpression(ctx, new Foo(), ts.factory.createNull());
    expect(errors.join()).toMatch(/Foo/);
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    jsValueToExpression(ctx, cyc, ts.factory.createNull());
    expect(errors.join()).toMatch(/circular/i);
  });
});

describe("core #31: comptimeValueToExpression handles non-literal numbers", () => {
  const ctx = contextFor(`export {};`);
  it.each([
    ["-1", -1],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-0", -0],
  ])("%s", (_l, v) => {
    expect(Object.is(run(ctx.comptimeValueToExpression({ kind: "number", value: v })), v)).toBe(
      true
    );
  });

  it("bigint keeps its n suffix", () => {
    expect(run(ctx.comptimeValueToExpression({ kind: "bigint", value: -3n }))).toBe(-3n);
  });

  it("evaluates comptime(1 - 2) end to end", () => {
    expect(run(ctx.comptimeValueToExpression(ev("1 - 2")))).toBe(-1);
  });
});

describe("core #45: compile-time evaluator follows JS semantics", () => {
  it("NaN is falsy", () => {
    expect(ev("!(0/0)")).toEqual({ kind: "boolean", value: true });
  });

  it("arrays and objects stringify like JS", () => {
    expect(ev("`${[1, 2]}`")).toEqual({ kind: "string", value: "1,2" });
    expect(ev("`${{ a: 1 }}`")).toEqual({ kind: "string", value: "[object Object]" });
    expect(ev("'x' + 1")).toEqual({ kind: "string", value: "x1" });
  });

  it("arrow functions close over their definition scope", () => {
    // `k` captures x=1; it is called where `x` is bound to 2.
    expect(ev("((x) => { const k = () => x; return ((x) => k())(2); })(1)")).toEqual({
      kind: "number",
      value: 1,
    });
  });
});

describe("core #48: synthetic-node handling", () => {
  it("hasSourceText is false for a factory node that was given a real text range", () => {
    const sf = ts.createSourceFile("a.ts", "foo;", ts.ScriptTarget.Latest, true);
    const real = (sf.statements[0] as ts.ExpressionStatement).expression;
    const synth = ts.setTextRange(ts.factory.createIdentifier("foo"), real);
    expect(isSyntheticNode(synth)).toBe(false); // positions are real…
    expect(() => synth.getText()).toThrow(); // …but there is no source text behind it
    expect(hasSourceText(synth)).toBe(false);
    expect(hasSourceText(real)).toBe(true);
  });

  it("assertTypeReliable does not blame upstream type errors for a synthetic node", () => {
    const ctx = contextFor(`export {};`);
    const node = ts.factory.createPropertyAccessExpression(
      ts.factory.createIdentifier("foo"),
      "bar"
    );
    expect(ctx.assertTypeReliable(node, "inlining")).toBeNull();
    const [d] = ctx.getDiagnostics();
    expect(d.message).toMatch(/macro-generated/);
    expect(d.message).not.toMatch(/Fix upstream type errors/);
  });
});
