/**
 * Integration tests for HKT F<_> declaration transformation.
 *
 * Verifies that interface/type declarations using F<_> kind syntax
 * get rewritten so that F<A> usages become $<F, A>.
 *
 * The AST-level transform is a fallback for the ts-patch path where
 * the preprocessor may not have run. Tests use extensions: [] to
 * disable preprocessing and exercise the AST transform directly.
 */

import { describe, it, expect } from "vitest";
import { transformCode } from "../src/pipeline.js";

function transformWithoutPreprocessor(code: string, fileName = "hkt-test.ts") {
  return transformCode(code, { fileName, extensions: [] });
}

describe("HKT F<_> declaration transformation", () => {
  it("rewrites interface with F<_> type parameter", () => {
    const code = `
interface Functor<F<_>> {
  readonly map: <A, B>(fa: F<A>, f: (a: A) => B) => F<B>;
}
    `.trim();

    const result = transformWithoutPreprocessor(code);
    // F<_> should be stripped to just F in type params
    expect(result.code).toContain("Functor<F>");
    // F<A> should become $<F, A>
    expect(result.code).toContain("$<F, A>");
    // F<B> should become $<F, B>
    expect(result.code).toContain("$<F, B>");
    // Original F<A> syntax should not remain
    expect(result.code).not.toMatch(/\bF<A>/);
    expect(result.code).not.toMatch(/\bF<B>/);
  });

  it("rewrites type alias with F<_> type parameter", () => {
    const code = `
type Apply<F<_>, A> = F<A>;
    `.trim();

    const result = transformWithoutPreprocessor(code);
    expect(result.code).toContain("Apply<F, A>");
    expect(result.code).toContain("$<F, A>");
    expect(result.code).not.toMatch(/\bF<A>/);
  });

  it("leaves declarations without <_> annotation alone", () => {
    const code = `
interface Container<T> {
  readonly value: T;
  readonly map: <U>(f: (a: T) => U) => Container<U>;
}
    `.trim();

    const result = transformWithoutPreprocessor(code);
    expect(result.code).toContain("Container<T>");
    expect(result.code).toContain("readonly value: T");
    expect(result.code).not.toContain("$<");
  });

  it("handles multiple type params where only some are HKT", () => {
    const code = `
interface MapLike<F<_>, K> {
  readonly get: <V>(fa: F<V>, key: K) => V | undefined;
}
    `.trim();

    const result = transformWithoutPreprocessor(code);
    expect(result.code).toContain("MapLike<F, K>");
    expect(result.code).toContain("$<F, V>");
    expect(result.code).not.toMatch(/\bF<V>/);
    // K is not HKT, so K references should remain unchanged
    expect(result.code).toContain("key: K");
  });

  it("handles method signatures with HKT parameters", () => {
    const code = `
interface Monad<F<_>> {
  pure<A>(a: A): F<A>;
  flatMap<A, B>(fa: F<A>, f: (a: A) => F<B>): F<B>;
}
    `.trim();

    const result = transformWithoutPreprocessor(code);
    expect(result.code).toContain("Monad<F>");
    expect(result.code).toContain("$<F,");
    expect(result.code).not.toMatch(/\bF<A>/);
    expect(result.code).not.toMatch(/\bF<B>/);
  });

  it("works alongside preprocessor without double-rewrite", () => {
    const code = `
interface Functor<F<_>> {
  readonly map: <A, B>(fa: F<A>, f: (a: A) => B) => F<B>;
}
    `.trim();

    // With preprocessor enabled (default extensions)
    const resultWithPreproc = transformCode(code, {
      fileName: "hkt-preproc.ts",
    });

    // With preprocessor disabled (AST transform only)
    const resultASTOnly = transformWithoutPreprocessor(code, "hkt-ast.ts");

    // Both should produce equivalent results with $<F, ...>
    expect(resultWithPreproc.code).toContain("$<F, A>");
    expect(resultWithPreproc.code).toContain("$<F, B>");
    expect(resultASTOnly.code).toContain("$<F, A>");
    expect(resultASTOnly.code).toContain("$<F, B>");

    // Neither should contain raw F<A>
    expect(resultWithPreproc.code).not.toMatch(/\bF<A>/);
    expect(resultASTOnly.code).not.toMatch(/\bF<A>/);
  });

  it("handles property signatures with HKT types", () => {
    const code = `
interface HasDefault<F<_>> {
  readonly empty: F<never>;
}
    `.trim();

    const result = transformWithoutPreprocessor(code);
    expect(result.code).toContain("HasDefault<F>");
    expect(result.code).toContain("$<F, never>");
  });
});
