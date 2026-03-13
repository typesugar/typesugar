/**
 * Integration tests for HKT F<_> declaration transformation.
 *
 * Verifies that interface/type declarations using F<_> kind syntax
 * get rewritten so that F<A> usages become Kind<F, A>.
 *
 * NOTE: PEP-001 Wave 1 introduced extension-based routing. Custom syntax
 * like F<_> is only supported in .sts files. These tests use .sts extension.
 */

import { describe, it, expect } from "vitest";
import { transformCode } from "../src/pipeline.js";

function transformHKT(code: string, fileName = "hkt-test.sts") {
  // Use .sts extension for files with custom HKT syntax (PEP-001)
  return transformCode(code, { fileName });
}

describe("HKT F<_> declaration transformation", () => {
  it("rewrites interface with F<_> type parameter", () => {
    const code = `
interface Functor<F<_>> {
  readonly map: <A, B>(fa: F<A>, f: (a: A) => B) => F<B>;
}
    `.trim();

    const result = transformHKT(code);
    // F<_> should be stripped to just F in type params
    expect(result.code).toContain("Functor<F>");
    // F<A> should become Kind<F, A>
    expect(result.code).toContain("Kind<F, A>");
    // F<B> should become Kind<F, B>
    expect(result.code).toContain("Kind<F, B>");
    // Original F<A> syntax should not remain
    expect(result.code).not.toMatch(/\bF<A>/);
    expect(result.code).not.toMatch(/\bF<B>/);
  });

  it("rewrites type alias with F<_> type parameter", () => {
    const code = `
type Apply<F<_>, A> = F<A>;
    `.trim();

    const result = transformHKT(code);
    // Check structure allowing for different formatting
    expect(result.code).toMatch(/type\s+Apply\s*<\s*F\s*,\s*A\s*>/);
    expect(result.code).toContain("Kind<F, A>");
    expect(result.code).not.toMatch(/\bF<A>/);
  });

  it("leaves declarations without <_> annotation alone", () => {
    const code = `
interface Container<T> {
  readonly value: T;
  readonly map: <U>(f: (a: T) => U) => Container<U>;
}
    `.trim();

    // Standard TypeScript without custom syntax can use .ts extension
    const result = transformCode(code, { fileName: "no-hkt.ts" });
    expect(result.code).toContain("Container<T>");
    expect(result.code).toContain("readonly value: T");
    expect(result.code).not.toContain("Kind<");
  });

  it("handles multiple type params where only some are HKT", () => {
    const code = `
interface MapLike<F<_>, K> {
  readonly get: <V>(fa: F<V>, key: K) => V | undefined;
}
    `.trim();

    const result = transformHKT(code);
    // Check structure allowing for different formatting
    expect(result.code).toMatch(/interface\s+MapLike\s*<\s*F\s*,\s*K\s*>/);
    expect(result.code).toContain("Kind<F, V>");
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

    const result = transformHKT(code);
    expect(result.code).toContain("Monad<F>");
    expect(result.code).toContain("Kind<F,");
    expect(result.code).not.toMatch(/\bF<A>/);
    expect(result.code).not.toMatch(/\bF<B>/);
  });

  it("transforms HKT in .sts files correctly", () => {
    const code = `
interface Functor<F<_>> {
  readonly map: <A, B>(fa: F<A>, f: (a: A) => B) => F<B>;
}
    `.trim();

    // .sts files get preprocessed for HKT syntax (PEP-001)
    const result = transformCode(code, { fileName: "hkt.sts" });

    // Should produce results with Kind<F, ...>
    expect(result.code).toContain("Kind<F, A>");
    expect(result.code).toContain("Kind<F, B>");

    // Should not contain raw F<A>
    expect(result.code).not.toMatch(/\bF<A>/);
  });

  it("handles property signatures with HKT types", () => {
    const code = `
interface HasDefault<F<_>> {
  readonly empty: F<never>;
}
    `.trim();

    const result = transformHKT(code);
    expect(result.code).toContain("HasDefault<F>");
    expect(result.code).toContain("Kind<F, never>");
  });
});
