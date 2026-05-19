/**
 * Regression tests for inferTypeConstructor AST-based fallback.
 *
 * Background (PEP-039 follow-up):
 * In .sts mode, the effect module can be unresolvable, which makes
 * TypeScript's checker treat `Effect.succeed(...)` as an error call.
 * When the argument is an object literal, TypeScript's error-recovery
 * path trips a null-ref in getContextualTypeForObjectLiteralElement
 * (reading .escapedName on undefined). This caused the playground's
 * let:/yield: macro to throw on the Effect example in .sts mode.
 *
 * The fix: inferTypeConstructor wraps the TypeChecker call in try/catch
 * and falls back to AST-based detection for common forms like
 * `Effect.succeed(...)`, `Promise.resolve(...)`, `[...]`, `new Promise(...)`.
 */
import * as ts from "typescript";
import { describe, it, expect } from "vitest";
import { inferTypeConstructor } from "../src/macros/comprehension-utils.js";

function firstCallArg(source: string): ts.Expression {
  const sf = ts.createSourceFile("t.ts", source, ts.ScriptTarget.Latest, true);
  const stmt = sf.statements[0] as ts.ExpressionStatement;
  return stmt.expression;
}

/**
 * A TypeChecker stub that always throws — simulates the .sts mode crash
 * in TypeScript's internal contextual-type resolution.
 */
const throwingChecker = {
  getTypeAtLocation: () => {
    throw new TypeError("Cannot read properties of undefined (reading 'escapedName')");
  },
  typeToString: () => "",
} as unknown as ts.TypeChecker;

describe("inferTypeConstructor — AST fallback (TS9210 playground bug fix)", () => {
  it("returns 'Effect' for Effect.succeed(...) when checker throws", () => {
    const expr = firstCallArg(`Effect.succeed({ id: "u1", name: "Alice" });`);
    expect(inferTypeConstructor(expr, throwingChecker)).toBe("Effect");
  });

  it("returns 'Promise' for Promise.resolve(...) when checker throws", () => {
    const expr = firstCallArg(`Promise.resolve(42);`);
    expect(inferTypeConstructor(expr, throwingChecker)).toBe("Promise");
  });

  it("returns 'Option' for Option.some(...) when checker throws", () => {
    const expr = firstCallArg(`Option.some(42);`);
    expect(inferTypeConstructor(expr, throwingChecker)).toBe("Option");
  });

  it("returns 'Array' for array literal when checker throws", () => {
    const expr = firstCallArg(`[1, 2, 3];`);
    expect(inferTypeConstructor(expr, throwingChecker)).toBe("Array");
  });

  it("returns 'Promise' for new Promise(...) when checker throws", () => {
    const expr = firstCallArg(`new Promise(resolve => resolve(42));`);
    expect(inferTypeConstructor(expr, throwingChecker)).toBe("Promise");
  });

  it("returns undefined for unrecognizable expressions when checker throws", () => {
    const expr = firstCallArg(`foo();`); // bare call — no receiver
    expect(inferTypeConstructor(expr, throwingChecker)).toBeUndefined();
  });

  it("does not throw even when the checker throws", () => {
    const expr = firstCallArg(`Effect.succeed({ x: 1 });`);
    expect(() => inferTypeConstructor(expr, throwingChecker)).not.toThrow();
  });
});
