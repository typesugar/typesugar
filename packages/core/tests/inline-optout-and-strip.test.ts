/**
 * Line opt-out comments (deep review core #17, core side) and non-mutating
 * position stripping (cross-agent: stripPositions/stripCommentsDeep used to
 * mutate the caller's real AST).
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { hasInlineOptOut } from "../src/resolution-scope.js";
import {
  stripPositions,
  stripCommentsDeep,
  cloneWithoutPositions,
  cloneWithoutComments,
} from "../src/ast-utils.js";

function callOnLine(src: string, line: number): { sf: ts.SourceFile; call: ts.CallExpression } {
  const sf = ts.createSourceFile("a.ts", src, ts.ScriptTarget.Latest, true);
  let found: ts.CallExpression | undefined;
  const visit = (n: ts.Node) => {
    if (
      !found &&
      ts.isCallExpression(n) &&
      sf.getLineAndCharacterOfPosition(n.getStart(sf)).line === line
    ) {
      found = n;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { sf, call: found! };
}

describe("core #17: hasInlineOptOut", () => {
  it("the bare marker opts out of every feature", () => {
    const { sf, call } = callOnLine(`const b = pipe(2, f); // @ts-no-typesugar\n`, 0);
    expect(hasInlineOptOut(sf, call)).toBe(true);
    expect(hasInlineOptOut(sf, call, "macros")).toBe(true);
    expect(hasInlineOptOut(sf, call, "extensions")).toBe(true);
  });

  it("a feature-specific marker only opts out of that feature", () => {
    const { sf, call } = callOnLine(`const b = pipe(2, f); // @ts-no-typesugar extensions\n`, 0);
    expect(hasInlineOptOut(sf, call, "extensions")).toBe(true);
    expect(hasInlineOptOut(sf, call, "macros")).toBe(false);
    expect(hasInlineOptOut(sf, call)).toBe(true);
  });

  it("-all still opts out of every feature", () => {
    const { sf, call } = callOnLine(`pipe(2, f); /* @ts-no-typesugar-all */\n`, 0);
    expect(hasInlineOptOut(sf, call, "macros")).toBe(true);
  });

  it("a marker inside a string literal does not count", () => {
    const { sf, call } = callOnLine(`const s = log("// @ts-no-typesugar");\n`, 0);
    expect(hasInlineOptOut(sf, call)).toBe(false);
    expect(hasInlineOptOut(sf, call, "macros")).toBe(false);
  });

  it("a marker on another line does not count", () => {
    const { sf, call } = callOnLine(`// @ts-no-typesugar\nconst b = pipe(2, f);\n`, 1);
    expect(hasInlineOptOut(sf, call, "macros")).toBe(false);
  });
});

describe("cloneWithoutPositions / cloneWithoutComments do not mutate the caller's AST", () => {
  const parse = () => {
    const sf = ts.createSourceFile("a.ts", "foo(a + b, c);", ts.ScriptTarget.Latest, true);
    const call = (sf.statements[0] as ts.ExpressionStatement).expression as ts.CallExpression;
    return { sf, call };
  };

  it("the in-place variants DO mutate (documented; only for nodes you own)", () => {
    const { call } = parse();
    const arg = call.arguments[0];
    stripPositions(arg);
    expect(arg.pos).toBe(-1);
    const { call: call2 } = parse();
    stripCommentsDeep(call2.arguments[0]);
    expect(call2.arguments[0].pos).toBe(-1);
  });

  it.each([
    ["cloneWithoutPositions", cloneWithoutPositions],
    ["cloneWithoutComments", cloneWithoutComments],
  ])("%s leaves the original node's positions intact", (_name, strip) => {
    const { sf, call } = parse();
    const arg = call.arguments[0] as ts.BinaryExpression;
    const before = [arg.pos, arg.end, arg.left.pos];
    const out = strip(arg) as ts.BinaryExpression;
    expect(out).not.toBe(arg);
    expect(out.pos).toBe(-1);
    expect(out.left.pos).toBe(-1);
    expect([arg.pos, arg.end, arg.left.pos]).toEqual(before);
    expect(arg.getText(sf)).toBe("a + b");
    // The copy still leads back to the parse tree (needed by emit substitutions).
    expect(ts.getParseTreeNode(out.left)).toBe(arg.left);
  });
});
