/**
 * Tests for @typesugar/std's promiseResultAlgebra registration (PEP-055
 * Phase D).
 *
 * Relocated from `@typesugar/macros`'s `specialize.test.ts`, where this
 * built-in algebra used to be seeded before this package's own `./macros`
 * entry hosted it.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { getResultAlgebra } from "@typesugar/macros";
import { promiseResultAlgebra } from "../src/macros/index.js";

function fakeCtx() {
  return { factory: ts.factory } as unknown as import("@typesugar/core").MacroContext;
}

function print(node: ts.Node): string {
  return ts
    .createPrinter()
    .printNode(
      ts.EmitHint.Unspecified,
      node,
      ts.createSourceFile("x.ts", "", ts.ScriptTarget.Latest)
    );
}

describe("promiseResultAlgebra", () => {
  it("targets Promise and preserves the error", () => {
    expect(promiseResultAlgebra.name).toBe("Promise");
    expect(promiseResultAlgebra.targetTypes).toContain("Promise");
    expect(promiseResultAlgebra.preservesError).toBe(true);
  });

  it("rewriteOk produces Promise.resolve(value)", () => {
    const ctx = fakeCtx();
    const value = ts.factory.createNumericLiteral(7);
    const result = promiseResultAlgebra.rewriteOk(ctx, value);
    expect(print(result)).toBe("Promise.resolve(7)");
  });

  it("rewriteErr produces Promise.reject(error)", () => {
    const ctx = fakeCtx();
    const error = ts.factory.createStringLiteral("failure");
    const result = promiseResultAlgebra.rewriteErr(ctx, error);
    expect(print(result)).toBe('Promise.reject("failure")');
  });

  it("registers with the shared registry on import", () => {
    expect(getResultAlgebra("Promise")).toBeDefined();
    expect(getResultAlgebra("Promise")!.name).toBe("Promise");
  });
});
