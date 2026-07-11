/**
 * Tests for @typesugar/fp's macro-time registrations (PEP-055 Phase D).
 *
 * Relocated from `@typesugar/macros`'s `specialize.test.ts`, where these
 * built-in algebras used to be seeded before this package had its own
 * `./macros` entry to host them.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { getResultAlgebra } from "@typesugar/macros";
import { optionResultAlgebra, eitherResultAlgebra } from "./macros.js";

function fakeCtx() {
  return { factory: ts.factory } as unknown as import("@typesugar/core").MacroContext;
}

describe("optionResultAlgebra", () => {
  it("targets Option and discards the error", () => {
    expect(optionResultAlgebra.name).toBe("Option");
    expect(optionResultAlgebra.targetTypes).toContain("Option");
    expect(optionResultAlgebra.preservesError).toBe(false);
  });

  it("rewriteOk passes the value through unchanged", () => {
    const ctx = fakeCtx();
    const value = ts.factory.createNumericLiteral(42);
    expect(optionResultAlgebra.rewriteOk(ctx, value)).toBe(value);
  });

  it("rewriteErr discards the error and produces null", () => {
    const ctx = fakeCtx();
    const error = ts.factory.createStringLiteral("boom");
    const result = optionResultAlgebra.rewriteErr(ctx, error);
    expect(result.kind).toBe(ts.SyntaxKind.NullKeyword);
  });
});

describe("eitherResultAlgebra", () => {
  it("targets Either and preserves the error", () => {
    expect(eitherResultAlgebra.name).toBe("Either");
    expect(eitherResultAlgebra.targetTypes).toContain("Either");
    expect(eitherResultAlgebra.preservesError).toBe(true);
  });

  it("rewriteOk produces a { _tag: 'Right', right: value } object literal", () => {
    const ctx = fakeCtx();
    const value = ts.factory.createNumericLiteral(1);
    const result = eitherResultAlgebra.rewriteOk(ctx, value) as ts.ObjectLiteralExpression;
    const printed = ts
      .createPrinter()
      .printNode(
        ts.EmitHint.Unspecified,
        result,
        ts.createSourceFile("x.ts", "", ts.ScriptTarget.Latest)
      );
    expect(printed).toContain('_tag: "Right"');
    expect(printed).toContain("right: 1");
  });

  it("rewriteErr produces a { _tag: 'Left', left: error } object literal", () => {
    const ctx = fakeCtx();
    const error = ts.factory.createStringLiteral("nope");
    const result = eitherResultAlgebra.rewriteErr(ctx, error) as ts.ObjectLiteralExpression;
    const printed = ts
      .createPrinter()
      .printNode(
        ts.EmitHint.Unspecified,
        result,
        ts.createSourceFile("x.ts", "", ts.ScriptTarget.Latest)
      );
    expect(printed).toContain('_tag: "Left"');
    expect(printed).toContain('left: "nope"');
  });
});

describe("registration", () => {
  it("registers both algebras with the shared registry on import", () => {
    expect(getResultAlgebra("Option")).toBeDefined();
    expect(getResultAlgebra("Option")!.name).toBe("Option");
    expect(getResultAlgebra("Either")).toBeDefined();
    expect(getResultAlgebra("Either")!.name).toBe("Either");
  });
});
