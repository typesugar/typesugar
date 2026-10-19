/**
 * Docs review r3 #5 (authoring #2): nodes from `createMacroTestContext`'s
 * parseExpression/parseStatements (and so from `quote()`) kept positions in a
 * temporary parse file. Printing them against `ctx.sourceFile` — what the
 * testing-macros guide does — read literal text at those offsets from the
 * WRONG file: `quote(ctx)\`1 + 2\`` printed as ` + `.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { quote, quoteStatements } from "@typesugar/macros";
import { createMacroTestContext } from "../src/macro-context.js";

const print = (node: ts.Node, sf: ts.SourceFile) =>
  ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, sf);

function firstCall(sourceFile: ts.SourceFile): ts.CallExpression {
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (!found && ts.isCallExpression(node)) found = node;
    else ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found!;
}

describe("createMacroTestContext: parsed nodes print against ctx.sourceFile", () => {
  it("quote(ctx)`1 + 2` prints as 1 + 2", () => {
    const ctx = createMacroTestContext(`double(n * 2); // a comment here`);
    expect(print(quote(ctx)`1 + 2`, ctx.sourceFile)).toBe("1 + 2");
  });

  it("string and numeric literals survive, with no comments from the user file", () => {
    const ctx = createMacroTestContext(`/* user comment */ const x = 1;\n// another\nfoo();`);
    const out = print(ctx.parseExpression(`"hello" + 42 === "x" && 1.5`), ctx.sourceFile);
    expect(out).toBe(`"hello" + 42 === "x" && 1.5`);
  });

  it("a quote() splicing a real call-site argument prints the argument", () => {
    const ctx = createMacroTestContext(`double(n * 2);`);
    const arg = firstCall(ctx.sourceFile).arguments[0];
    expect(print(quote(ctx)`${arg} + ${arg}`, ctx.sourceFile)).toBe("(n * 2) + (n * 2)");
  });

  it("parseStatements / quoteStatements print correctly", () => {
    const ctx = createMacroTestContext(`// leading user comment that must not leak\nlet y = 0;`);
    const stmts = quoteStatements(ctx)`const total = 10 + 20;\nconsole.log("total", total);`;
    expect(stmts.map((s) => print(s, ctx.sourceFile))).toEqual([
      "const total = 10 + 20;",
      'console.log("total", total);',
    ]);
  });
});
