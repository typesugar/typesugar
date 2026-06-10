/**
 * Tests for the .ts HKT type-reference rewriter (kept after PEP-047).
 *
 * This is the AST-based rewriter that runs on plain `.ts`/`.tsx` files in
 * VirtualCompilerHost, turning `F<A>` (a type parameter F applied to A) into
 * `Kind<F, A>` before the type checker sees it. It is independent of the
 * (removed) `.sts` preprocessor and its lexical `F<_>` form.
 */

import { describe, it, expect } from "vitest";
import { hasHKTPatterns, rewriteHKTTypeReferences } from "../src/hkt-rewriter.js";

describe("hasHKTPatterns", () => {
  it("detects a single-letter type constructor applied to an argument", () => {
    expect(hasHKTPatterns("interface Functor<F> { map(fa: F<A>): F<B> }")).toBe(true);
  });

  it("returns false when there are no angle brackets", () => {
    expect(hasHKTPatterns("const x = 1 + 2;")).toBe(false);
  });

  it("does not match multi-character generics like Array< or Promise<", () => {
    expect(hasHKTPatterns("const xs: Array<number> = [];")).toBe(false);
    expect(hasHKTPatterns("function f(): Promise<void> {}")).toBe(false);
  });
});

describe("rewriteHKTTypeReferences (.ts)", () => {
  it("rewrites F<A>/F<B> to Kind<F, A>/Kind<F, B> for a type parameter F", () => {
    const source = [
      "interface Functor<F> {",
      "  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;",
      "}",
    ].join("\n");

    const result = rewriteHKTTypeReferences(source, "functor.ts");

    expect(result.changed).toBe(true);
    expect(result.code).toContain("Kind<F, A>");
    expect(result.code).toContain("Kind<F, B>");
    // Injects the Kind import
    expect(result.code).toContain("Kind");
  });

  it("rewrites HKT in a type alias", () => {
    const source = "type Apply<F, A> = F<A>;";

    const result = rewriteHKTTypeReferences(source, "apply.ts");

    expect(result.changed).toBe(true);
    expect(result.code).toContain("Kind<F, A>");
  });

  it("leaves concrete generics (Array<string>) untouched", () => {
    const source = "const xs: Array<string> = [];";

    const result = rewriteHKTTypeReferences(source, "plain.ts");

    expect(result.changed).toBe(false);
    expect(result.code).toContain("Array<string>");
    expect(result.code).not.toContain("Kind<");
  });

  it("leaves a non-HKT type parameter (T used as a bare type) untouched", () => {
    const source = ["interface Container<T> {", "  value: T;", "}"].join("\n");

    const result = rewriteHKTTypeReferences(source, "container.ts");

    expect(result.changed).toBe(false);
    expect(result.code).not.toContain("Kind<");
  });

  it("parses .tsx without dropping the rewrite", () => {
    const source = "type Apply<F, A> = F<A>;";

    const result = rewriteHKTTypeReferences(source, "apply.tsx");

    expect(result.changed).toBe(true);
    expect(result.code).toContain("Kind<F, A>");
  });
});
