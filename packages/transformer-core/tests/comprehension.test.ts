/**
 * End-to-end tests for `let:`/`yield:` do-notation comprehension handling
 * (PEP-056 Wave 4 parity gap #6), ported from legacy's
 * `visitStatementContainer` fragment-reconstruction + wrapper-flatten +
 * arrow-body/return-statement collapse logic.
 *
 * These drive the real `transformCode()` API end-to-end (not the standalone
 * helpers in transformer-utils.ts) since the logic under test lives entirely
 * inside `MacroTransformer`'s private `visit()`/`visitStatementContainer`
 * methods, with no exported free-function entry point.
 */

import { describe, it, beforeAll, expect } from "vitest";
import * as ts from "typescript";
import { defineLabeledBlockMacro, globalRegistry, type MacroContext } from "@typesugar/core";
import { transformCode } from "../src/transform.js";

const SYNTAX_MODULE = "__test-do-syntax-marker";
/** Every fixture must import this so the label-syntax activation gate opens
 * (matching the real @syntax-labels marker + import-scan mechanism, not a
 * manual bypass) — see `syntax-marker-fallback.ts`'s resolution-free path. */
const ACTIVATE = `import "${SYNTAX_MODULE}";\n`;

/**
 * Test-double `let:`/`yield:` macro: instead of real monadic bind/map
 * semantics, it serializes the received `mainBlock`/`continuation` AST back
 * to text and wraps it in a detectable `__testDoResult(...)` call — this
 * proves the RECONSTRUCTED synthetic `let: { ... }` statement the transformer
 * builds contains every bind/guard fragment in the right shape, without
 * needing a real Effect/Option-style runtime to assert against.
 */
function registerTestDoMacro(): void {
  globalRegistry.register(
    defineLabeledBlockMacro({
      name: "__testDo",
      description: "test-only do-notation macro for comprehension dispatch tests",
      label: ["let", "seq"],
      continuationLabels: ["yield", "pure", "return"],
      valueProducing: true,
      syntaxModule: SYNTAX_MODULE,
      expand(ctx: MacroContext, mainBlock: ts.LabeledStatement, continuation?: ts.LabeledStatement) {
        const printer = ts.createPrinter({ removeComments: true });
        const mainText = printer.printNode(
          ts.EmitHint.Unspecified,
          mainBlock.statement,
          ctx.sourceFile
        );
        const contText = continuation
          ? printer.printNode(ts.EmitHint.Unspecified, continuation.statement, ctx.sourceFile)
          : "";
        return ctx.factory.createExpressionStatement(
          ctx.factory.createCallExpression(ctx.factory.createIdentifier("__testDoResult"), undefined, [
            ctx.factory.createStringLiteral(mainText),
            ctx.factory.createStringLiteral(contText),
          ])
        );
      },
    })
  );
}

beforeAll(() => {
  registerTestDoMacro();
});

describe("expression-level do-notation: const x = let: { ... } yield: { ... }", () => {
  it("reconstructs a single-bind comprehension (2-decl destructuring parse shape)", () => {
    const result = transformCode(
      ACTIVATE +
        [
          "const result =",
          "let: {",
          "  a << e1();",
          "}",
          "yield: { a }",
          "declare function e1(): number;",
        ].join("\n"),
      { fileName: "comp-single-bind.ts" }
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toMatch(/const result = __testDoResult/);
    expect(result.code).toContain("a << e1()");
  });

  it("reconstructs a multi-bind comprehension with intermediate binds/maps", () => {
    const result = transformCode(
      ACTIVATE +
        [
          "const result =",
          "let: {",
          "  a << e1();",
          "  b << e2();",
          "  c = a + b;",
          "}",
          "yield: { c }",
          "declare function e1(): number;",
          "declare function e2(): number;",
        ].join("\n"),
      { fileName: "comp-multi-bind.ts" }
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // All three fragments (the reconstructed first bind + the two trailing
    // fragments collected by the while-loop) must survive into the synthetic
    // block text handed to the macro.
    expect(result.code).toContain("a << e1()");
    expect(result.code).toContain("b << e2()");
    expect(result.code).toContain("c = a + b");
  });

  it("stops fragment collection at the yield: continuation, not past it", () => {
    const result = transformCode(
      ACTIVATE +
        [
          "const result =",
          "let: {",
          "  a << e1();",
          "}",
          "yield: { a }",
          "const untouched = 42;",
          "declare function e1(): number;",
        ].join("\n"),
      { fileName: "comp-stop-at-continuation.ts" }
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toMatch(/const result = __testDoResult/);
    // The statement after the continuation must be left alone, not consumed
    // into the reconstructed block.
    expect(result.code).toContain("const untouched = 42");
  });
});

describe("statement-position do-notation: let: { ... } yield: { ... } (no assignment)", () => {
  it("still dispatches via the plain labeled-block path (pre-existing, not part of this gap)", () => {
    const result = transformCode(
      ACTIVATE +
        ["let: {", "  a << e1();", "}", "yield: { a }", "declare function e1(): number;"].join("\n"),
      { fileName: "comp-statement-position.ts" }
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain("__testDoResult");
  });
});

describe("arrow-body preprocessor wrapper cleanup", () => {
  // Simulates arrow-comprehension-preprocess.ts's own output shape for
  // `(x) => let: {...} yield: {...}` -- transformCode() doesn't run the
  // (Node-only, pipeline.ts-level) text preprocessor itself, so this hand-
  // writes the exact double-nested `{ { const __tag = let: {...} yield: {...};
  // return __tag; } } ` wrapper the preprocessor emits, to prove the
  // transformer-side cleanup (flatten -> reconstruct -> arrow-body collapse)
  // still works without the preprocessor actually running.
  it("flattens the wrapper, reconstructs the comprehension, and collapses the arrow body", () => {
    const result = transformCode(
      ACTIVATE +
        [
          "const fn = (x: number) => { { const __letyield_0 = let: {",
          "  a << e1();",
          "}",
          "yield: { a }; return __letyield_0; } }",
          "declare function e1(): number;",
        ].join("\n"),
      { fileName: "comp-arrow-wrapper.ts" }
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // Collapsed to `(x) => __testDoResult(...)` -- no leftover Block, no
    // leftover `__letyield_0` synthetic name, no bare `return` statement.
    expect(result.code).toMatch(/const fn = \(x: number\) => __testDoResult/);
    expect(result.code).not.toContain("__letyield_");
    expect(result.code).not.toContain("return");
    expect(result.code).toContain("a << e1()");
  });
});
