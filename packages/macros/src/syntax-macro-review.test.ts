/**
 * Deep review macros-other #12 (syntax-macro + quote):
 *  (a) captures are substituted as whole expressions (no precedence bleed);
 *  (b) an arm only matches a call with exactly as many arguments as captures;
 *  (d) pattern text other than the call shape is rejected at definition time
 *      instead of being silently ignored;
 *  plus quote's `${a + b} * 2`.
 * Expansions are EXECUTED (printed, transpiled and evaluated), not grepped.
 * Nested-macro expansion inside captures (c) runs through the real
 * transformer in tests/syntax-macro-nested.test.ts.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as vm from "vm";
import { createMacroContext, globalRegistry, type MacroContext } from "@typesugar/core";
import { defineSyntaxMacro } from "./syntax-macro.js";
import { quote, quoteStatements } from "./quote.js";

let counter = 0;
const uniq = (b: string) => `${b}_${process.pid}_${counter++}`;

function withSource<T>(source: string, fn: (ctx: MacroContext, sf: ts.SourceFile) => T): T {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "syntax-review-"));
  const filePath = path.join(tmpDir, "test.ts");
  fs.writeFileSync(filePath, source);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    strict: true,
    noEmit: true,
  };
  try {
    const program = ts.createProgram([filePath], options, ts.createCompilerHost(options, true));
    const sf = program.getSourceFile(filePath)!;
    let result!: T;
    ts.transform(sf, [
      // Expand inside the per-file visitor, as the real transformer does
      // (lexical-environment operations are illegal during factory init).
      (tctx) => (s) => {
        result = fn(createMacroContext(program, sf, tctx), sf);
        return s;
      },
    ]);
    return result;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function findCall(sf: ts.SourceFile, name: string): ts.CallExpression {
  let found: ts.CallExpression | undefined;
  const visit = (n: ts.Node): void => {
    if (
      !found &&
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === name
    )
      found = n;
    else n.forEachChild(visit);
  };
  visit(sf);
  return found!;
}

/** Expand the (single) call to `name` in `source`; return printed expansion + errors. */
function expandCall(source: string, name: string): { printed: string; errors: string[] } {
  return withSource(source, (ctx, sf) => {
    const call = findCall(sf, name);
    const macro = globalRegistry.getExpression(name)!;
    const out = macro.expand(ctx, call, call.arguments);
    const printer = ts.createPrinter();
    return {
      printed: printer.printNode(ts.EmitHint.Expression, out as ts.Expression, sf),
      errors: ctx
        .getDiagnostics()
        .filter((d) => d.severity === "error")
        .map((d) => d.message),
    };
  });
}

function evaluate(exprText: string, scope: Record<string, unknown> = {}): unknown {
  const js = ts.transpileModule(`(${exprText})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return vm.runInNewContext(js, { ...scope }, { timeout: 2000 });
}

describe("syntax macros #12(a): captures keep their precedence", () => {
  it("sq(1 + 2) evaluates to 9, not 1 + 2 * 1 + 2", () => {
    const name = uniq("sq");
    defineSyntaxMacro(name, { pattern: `${name}($x:expr)`, expand: "$x * $x" });
    const { printed, errors } = expandCall(
      `declare function ${name}(x: number): number; ${name}(1 + 2);`,
      name
    );
    expect(errors).toEqual([]);
    expect(evaluate(printed)).toBe(9);
  });

  it("a conditional capture under a binary operator", () => {
    const name = uniq("plus1");
    defineSyntaxMacro(name, { pattern: "$x", expand: "$x + 1" });
    const { printed } = expandCall(
      `declare function ${name}(x: number): number; declare const c: boolean; ${name}(c ? 10 : 20);`,
      name
    );
    expect(evaluate(printed, { c: false })).toBe(21);
  });

  it("a capture used inside a string/template literal is stringified", () => {
    const name = uniq("show");
    defineSyntaxMacro(name, { pattern: "$e", expand: "`[$e] = ` + String($e)" });
    const { printed, errors } = expandCall(
      `declare function ${name}(x: number): string; ${name}(1 + 2);`,
      name
    );
    expect(errors).toEqual([]);
    expect(evaluate(printed)).toBe("[1 + 2] = 3");
  });
});

describe("syntax macros #12(b): exact argument count", () => {
  it("a one-capture arm does not match a two-argument call (no dropped argument)", () => {
    const name = uniq("one");
    defineSyntaxMacro(name, {
      arms: [
        { pattern: "$a", expand: `"one:" + $a` },
        { pattern: "$a, $b", expand: `"two:" + $a + $b` },
      ],
    });
    const { printed, errors } = expandCall(
      `declare function ${name}(...a: any[]): string; ${name}("x", "y");`,
      name
    );
    expect(errors).toEqual([]);
    expect(evaluate(printed)).toBe("two:xy");
  });

  it("reports no-match instead of silently dropping an argument", () => {
    const name = uniq("only1");
    defineSyntaxMacro(name, { pattern: "$a", expand: "$a" });
    const { errors } = expandCall(
      `declare function ${name}(...a: any[]): any; ${name}(1, sideEffect());`,
      name
    );
    expect(errors.join("\n")).toMatch(/No pattern arm matched/);
  });
});

describe("syntax macros #12(d): pattern text is validated", () => {
  it("rejects a pattern with literal syntax it cannot match (the old docs `unless` example)", () => {
    expect(() =>
      defineSyntaxMacro(uniq("unless"), {
        pattern: "unless($cond:expr) { $body }",
        expand: "if (!($cond)) { $body }",
      })
    ).toThrow(/pattern/i);
  });

  it("rejects a call-shaped pattern whose name differs from the macro", () => {
    expect(() => defineSyntaxMacro(uniq("m"), { pattern: "other($x)", expand: "$x" })).toThrow(
      /pattern/i
    );
  });

  it("rejects an unknown capture kind", () => {
    expect(() => defineSyntaxMacro(uniq("k"), { pattern: "$x:exprr", expand: "$x" })).toThrow(
      /kind/i
    );
  });

  it("rejects stmts captures at definition time", () => {
    expect(() => defineSyntaxMacro(uniq("s"), { pattern: "$s:stmts", expand: "$s" })).toThrow(
      /stmts/
    );
  });

  it("accepts `name($a, $b)` and bare `$a, $b` forms", () => {
    const n1 = uniq("add");
    defineSyntaxMacro(n1, { pattern: `${n1}($a:expr, $b:expr)`, expand: "$a + $b" });
    expect(
      evaluate(
        expandCall(`declare function ${n1}(a: number, b: number): number; ${n1}(2, 3);`, n1).printed
      )
    ).toBe(5);
  });

  it("the corrected docs examples work", () => {
    const unless = uniq("unless");
    defineSyntaxMacro(unless, {
      pattern: `${unless}($cond:expr, $then:expr, $else:expr)`,
      expand: "!($cond) ? $then : $else",
    });
    expect(
      evaluate(
        expandCall(
          `declare function ${unless}(...a: any[]): any; ${unless}(1 > 2, "a", "b");`,
          unless
        ).printed
      )
    ).toBe("a");

    const dbg = uniq("dbg");
    defineSyntaxMacro(dbg, {
      arms: [
        {
          pattern: `${dbg}($e:expr)`,
          expand: "((__dbg_value) => (console.log(`[$e] =`, __dbg_value), __dbg_value))($e)",
        },
      ],
    });
    const logs: unknown[][] = [];
    const dbgOut = expandCall(`declare function ${dbg}(x: number): number; ${dbg}(2 * 3);`, dbg);
    expect(dbgOut.errors).toEqual([]);
    const out = evaluate(dbgOut.printed, { console: { log: (...a: unknown[]) => logs.push(a) } });
    expect(out).toBe(6);
    expect(logs).toEqual([["[2 * 3] =", 6]]);
  });
});

describe("quote #12(a): spliced expressions keep their precedence", () => {
  it("quote`${a + b} * 2` multiplies the sum", () => {
    withSource("export {};", (ctx) => {
      const sum = ts.factory.createBinaryExpression(
        ts.factory.createNumericLiteral(1),
        ts.SyntaxKind.PlusToken,
        ts.factory.createNumericLiteral(2)
      );
      const expr = quote(ctx)`${sum} * 2`;
      const printed = ts.createPrinter().printNode(ts.EmitHint.Expression, expr, ctx.sourceFile);
      expect(evaluate(printed)).toBe(6);
    });
  });

  it("statement splices and identifiers are unchanged", () => {
    withSource("export {};", (ctx) => {
      const name = ts.factory.createIdentifier("x");
      const stmts = quoteStatements(
        ctx
      )`const ${name} = ${ts.factory.createNumericLiteral(3)}; ${name};`;
      const printer = ts.createPrinter();
      const text = stmts
        .map((s) => printer.printNode(ts.EmitHint.Unspecified, s, ctx.sourceFile))
        .join("\n");
      expect(text).toContain("const x = 3;");
    });
  });
});
