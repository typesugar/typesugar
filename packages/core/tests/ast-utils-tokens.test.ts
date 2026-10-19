/**
 * stripPositions / stripCommentsDeep / cloneNodeDeep must reach TOKEN children
 * (operator tokens, `?`, `=>`, ...). visitEachChild without a tokenVisitor
 * skips them, so a node parsed in a temporary file kept token offsets from
 * that file, and printing it into the user's file emitted whatever comment the
 * user had at the same offset (docs review r3-macros).
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { stripPositions, stripCommentsDeep, cloneNodeDeep } from "../src/ast-utils.js";

/** Parse `code` in a throwaway file and return its single expression. */
function parseTemp(code: string): ts.Expression {
  const sf = ts.createSourceFile("__temp__.ts", code, ts.ScriptTarget.Latest, true);
  return (sf.statements[0] as ts.ExpressionStatement).expression;
}

// The user's file has a comment starting at every early offset, so whatever
// offset a temp-file token kept, the printer finds a comment there.
const USER = ts.createSourceFile(
  "user.ts",
  Array.from({ length: 40 }, (_, i) => `/*${i}*/`).join("\n"),
  ts.ScriptTarget.Latest,
  true
);
const printer = ts.createPrinter();
const print = (e: ts.Expression) => printer.printNode(ts.EmitHint.Expression, e, USER);

describe("AST position/comment stripping reaches tokens", () => {
  for (const [name, fn] of [
    ["stripPositions", stripPositions],
    ["stripCommentsDeep", stripCommentsDeep],
    ["cloneNodeDeep", cloneNodeDeep],
  ] as const) {
    it(`${name}: printing into another file emits none of its comments`, () => {
      const out = print(fn(parseTemp("x ? 1 : (a) => a + b")));
      expect(out).not.toMatch(/\/\*/);
      expect(out.replace(/\s+/g, " ")).toBe("x ? 1 : a => a + b");
    });
  }
});
