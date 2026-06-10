/**
 * Red Team Tests for Preprocessor
 *
 * Attack surfaces (post-PEP-047 — the preprocessor now only handles HKT `F<_>`
 * type syntax; the `|>`/`::`/`| pattern =>` custom operators were removed):
 * - HKT F<_> syntax edge cases
 * - Token scanner ambiguities (JSX, regex vs division)
 */
import { describe, it, expect } from "vitest";
import { preprocess, tokenize } from "../packages/preprocessor/src/index.js";

describe("Preprocessor Edge Cases", () => {
  // ==========================================================================
  // HKT syntax edge cases
  // ==========================================================================
  describe("HKT F<_> syntax edge cases", () => {
    it("F<_> in interface declaration", () => {
      const source = `interface Functor<F<_>> { map: <A, B>(fa: F<A>) => F<B>; }`;
      const { changed } = preprocess(source);

      // F<_> should become F, and F<A> should become Kind<F, A>
      expect(changed).toBe(true);
    });

    it("F<_> vs comparison", () => {
      // F<_> where _ is a valid identifier vs F < _
      const source = `const _ = 1; const cmp = F < _;`;
      preprocess(source);

      // This should NOT be HKT syntax - it's a comparison
      // But distinguishing this requires context
    });

    it("Nested type parameters", () => {
      const source = `interface Nested<F<_>, G<_>> { fg: <A>(fa: F<G<A>>) => G<F<A>>; }`;

      const { code, changed } = preprocess(source);

      expect(changed).toBe(true);
      // F<_> and G<_> declarations should be stripped
      // F<G<A>> should become Kind<F, Kind<G, A>> (nested composition)
      // G<F<A>> should become Kind<G, Kind<F, A>>
      expect(code).toContain("Kind<F, Kind<G, A>>");
      expect(code).toContain("Kind<G, Kind<F, A>>");
      expect(code).not.toContain("F<_>");
      expect(code).not.toContain("G<_>");
    });

    it("F<_> with constraints", () => {
      const source = `interface Bounded<F<_> extends Functor<F>> {}`;
      preprocess(source);

      // This is tricky syntax
    });
  });
});

// ==========================================================================
// Token scanner tests
// ==========================================================================
describe("Token Scanner Edge Cases", () => {
  it("Tokenizes JSX-like syntax", () => {
    const source = `const el = <div>{x}</div>;`;

    // Note: proper handling requires knowing file is .tsx
    const tokens = tokenize(source);
    expect(tokens.length).toBeGreaterThan(0);
  });

  it("Tokenizes regex", () => {
    const source = `const re = /a|b/g;`; // | in regex

    const tokens = tokenize(source);
    expect(tokens.length).toBeGreaterThan(0);
  });

  it("Division vs regex ambiguity", () => {
    // Classic JS ambiguity
    const source1 = `const a = b / c / d;`; // Division
    const source2 = `const re = /c/;`; // Regex

    // Both should tokenize correctly
    const t1 = tokenize(source1);
    const t2 = tokenize(source2);

    expect(t1.length).toBeGreaterThan(0);
    expect(t2.length).toBeGreaterThan(0);
  });
});
