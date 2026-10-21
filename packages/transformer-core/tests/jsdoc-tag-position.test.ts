/**
 * JSDoc macro dispatch must only fire on a tag that is a real tag position.
 *
 * TypeScript's JSDoc parser treats any whitespace-preceded `@word` as a tag,
 * including prose mid-line ("Parsed from @adt tag."), a nested example
 * comment (` * /** @hkt *\/`), and lines inside a ``` fenced example. Those
 * used to dispatch the macro (errors were silently dropped until the
 * unplugin started surfacing macro errors), which broke builds of files whose
 * docs merely MENTION a macro. Only a tag that starts its comment line, outside
 * a code fence, is a macro trigger.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import "@typesugar/macros";

import { hasJSDocMacroTags, isJSDocTagAtLineStart } from "../src/macro-helpers.js";
import { transformCode } from "../src/transform.js";

function firstStatement(code: string): ts.Statement {
  const sf = ts.createSourceFile("t.ts", code, ts.ScriptTarget.Latest, true);
  return sf.statements[0];
}

const FENCE = "```";

describe("JSDoc macro tags only dispatch at a real tag position", () => {
  it("prose mention mid-line does not dispatch", () => {
    const code = `/**\n * Parsed null-representation map from @adt tag.\n */\ntype M = Map<string, string>;\n`;
    expect(hasJSDocMacroTags(firstStatement(code))).toBe(false);
    const out = transformCode(code, { fileName: "/virtual/prose.ts" });
    expect(out.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("a tag inside a ``` fenced example does not dispatch", () => {
    const code = [
      "/**",
      " * @example",
      ` * ${FENCE}typescript`,
      " * @derive(Read)",
      " * interface User { id: number }",
      ` * ${FENCE}`,
      " */",
      "export type Row = Record<string, unknown>;",
      "",
    ].join("\n");
    expect(hasJSDocMacroTags(firstStatement(code))).toBe(false);
    const out = transformCode(code, { fileName: "/virtual/fenced.ts" });
    expect(out.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("a nested `/** @x *\\/` example comment does not dispatch", () => {
    const code = [
      "/**",
      " * Marker type.",
      " *",
      " * /** @hkt *\\/",
      " * type ArrayF = Array<_>;",
      " */",
      "export type _ = never;",
      "",
    ].join("\n");
    expect(hasJSDocMacroTags(firstStatement(code))).toBe(false);
    const out = transformCode(code, { fileName: "/virtual/nested.ts" });
    expect(out.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("a tag at the start of its line (after the `*`) dispatches", () => {
    const code = `/**\n * Doc.\n * @adt\n */\ntype M = Map<string, string>;\n`;
    expect(hasJSDocMacroTags(firstStatement(code))).toBe(true);
    const out = transformCode(code, { fileName: "/virtual/real.ts" });
    const errors = out.diagnostics.filter((d) => d.severity === "error");
    expect(errors.map((e) => e.message).join("\n")).toMatch(/@adt requires a union type/);
  });

  it("a tag right after `/**` on a single-line comment dispatches", () => {
    const stmt = firstStatement(
      `/** @typeclass */\ninterface Eq<A> { equals(a: A, b: A): boolean; }\n`
    );
    expect(hasJSDocMacroTags(stmt)).toBe(true);
  });

  it("a tag after a closed fence dispatches", () => {
    const code = [
      "/**",
      ` * ${FENCE}ts`,
      " * @derive(Eq)",
      ` * ${FENCE}`,
      " * @typeclass",
      " */",
      "interface Eq<A> { equals(a: A, b: A): boolean; }",
      "",
    ].join("\n");
    const tags = ts.getJSDocTags(firstStatement(code));
    const positions = tags.map((t) => [t.tagName.text, isJSDocTagAtLineStart(t)]);
    expect(positions).toEqual([
      ["derive", false],
      ["typeclass", true],
    ]);
  });
  // JSDoc's @example content ends at the next line-start tag (that's how
  // TypeScript parses it and how an IDE renders it); only a code fence makes
  // a line-start `@tag` example code. A real tag after an @example used to be
  // ignored, so `@typeclass` under a fenced @example registered nothing.
  it("a line-start tag after an @example's plain lines is a real tag", () => {
    const code = [
      "/**",
      " * A point.",
      " * @example",
      " * const p: Point = { x: 1, y: 2 };",
      " * @derive(Eq)",
      " */",
      "interface Point { x: number; y: number }",
      "",
    ].join("\n");
    const tags = ts.getJSDocTags(firstStatement(code));
    expect(tags.map((t) => [t.tagName.text, isJSDocTagAtLineStart(t)])).toEqual([
      ["example", true],
      ["derive", true],
    ]);
  });

  it("a tag after a fenced @example is a real tag; one inside the fence is not", () => {
    const code = [
      "/**",
      " * Group.",
      " * @example",
      ` * ${FENCE}typescript`,
      " * @derive(Eq)",
      " * interface Other { x: number }",
      ` * ${FENCE}`,
      " *",
      " * @typeclass",
      " */",
      "interface Group<A> { invert(a: A): A; }",
      "",
    ].join("\n");
    const tags = ts.getJSDocTags(firstStatement(code));
    expect(tags.map((t) => [t.tagName.text, isJSDocTagAtLineStart(t)])).toEqual([
      ["example", true],
      ["derive", false],
      ["typeclass", true],
    ]);
  });
});
