/**
 * Red Team Tests for Preprocessor
 *
 * Attack surfaces:
 * - Pipeline operator |> in strings/comments/templates
 * - HKT F<_> syntax edge cases
 * - Mixed custom operators
 * - Invalid/malformed syntax
 */
import { describe, it, expect } from "vitest";
import { preprocess, tokenize } from "../packages/preprocessor/src/index.js";

describe("Preprocessor Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Pipeline operator in strings
  // ==========================================================================
  describe("Pipeline in string literals", () => {
    it("Pipeline in single-quoted string should not transform", () => {
      const source = `const regex = 'a |> b';`;
      const { code, changed } = preprocess(source);

      // Should NOT transform - it's inside a string
      expect(code).toBe(source);
      expect(changed).toBe(false);
    });

    it("Pipeline in double-quoted string should not transform", () => {
      const source = `const str = "x |> y |> z";`;
      const { code, changed } = preprocess(source);

      expect(code).toBe(source);
      expect(changed).toBe(false);
    });

    it("Pipeline in template literal should not transform", () => {
      const source = "const tpl = `value |> transform`;";
      const { code, changed } = preprocess(source);

      expect(code).toBe(source);
      expect(changed).toBe(false);
    });

    it("Pipeline in template expression should transform", () => {
      const source = "const result = `${x |> f}`;";
      const { code, changed } = preprocess(source);

      // Inside ${...} should be transformed
      expect(code).toContain("__binop__");
      expect(changed).toBe(true);
    });

    it("Escaped backtick in template", () => {
      const source = "const x = `\\`${a |> b}\\``;";
      const { code, changed } = preprocess(source);

      // Should still transform inside ${}
      expect(code).toContain("__binop__");
    });
  });

  // ==========================================================================
  // Attack 2: Pipeline in comments
  // ==========================================================================
  describe("Pipeline in comments", () => {
    it("Pipeline in line comment should not transform", () => {
      const source = `// this is x |> y\nconst a = 1;`;
      const { code, changed } = preprocess(source);

      expect(code).toBe(source);
      expect(changed).toBe(false);
    });

    it("Pipeline in block comment should not transform", () => {
      const source = `/* a |> b |> c */ const a = 1;`;
      const { code, changed } = preprocess(source);

      expect(code).toBe(source);
      expect(changed).toBe(false);
    });

    it("Pipeline after line comment on same line", () => {
      const source = `const a = 1; // comment\nconst b = x |> f;`;
      const { code, changed } = preprocess(source);

      // Second line should transform
      expect(code).toContain("__binop__");
      expect(changed).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 3: Edge cases in operator parsing
  // ==========================================================================
  describe("Operator parsing edge cases", () => {
    it("Pipeline followed by comparison", () => {
      // |> followed by > could be ambiguous
      const source = `const result = (a |> b) > 0;`;
      const { code, changed } = preprocess(source);

      // Should transform |> but not >
      expect(code).toContain("__binop__");
      expect(code).toContain("> 0");
    });

    it("Bitwise OR vs pipeline (| vs |>)", () => {
      const source = `const a = x | y; const b = x |> f;`;
      const { code } = preprocess(source);

      // First | should not transform
      expect(code).toContain("x | y");
      // Second |> should transform
      expect(code).toContain("__binop__");
    });

    it("Logical OR vs pipeline (|| vs |>)", () => {
      const source = `const a = x || y; const b = x |> f;`;
      const { code } = preprocess(source);

      expect(code).toContain("x || y");
      expect(code).toContain("__binop__");
    });

    it("Nullish coalescing vs pipeline (?? and |>)", () => {
      const source = `const a = x ?? y; const b = x |> f;`;
      const { code } = preprocess(source);

      expect(code).toContain("x ?? y");
      expect(code).toContain("__binop__");
    });

    it("Empty pipeline operands", () => {
      // What happens with invalid syntax?
      const source = `const a = |> f;`; // Missing left operand

      // This should either error or pass through unchanged
      const { code } = preprocess(source);
      // Implementation-dependent
    });

    it("Consecutive pipelines", () => {
      const source = `const a = x |> f |> g |> h;`;
      const { code, changed } = preprocess(source);

      expect(changed).toBe(true);
      // Should nest left-to-right
      expect(code).toMatch(/__binop__.*__binop__.*__binop__/);
    });

    it("Pipeline with arrow function", () => {
      const source = `const result = x |> (y => y + 1);`;
      const { code, changed } = preprocess(source);

      expect(changed).toBe(true);
      expect(code).toContain("__binop__");
      expect(code).toContain("y => y + 1");
    });

    it("Pipeline in expression position", () => {
      const cases = [
        `return x |> f;`,
        `throw x |> f;`,
        `if (x |> f) {}`,
        `while (x |> f) {}`,
        `const a = [x |> f];`,
        `fn(x |> f)`,
      ];

      for (const source of cases) {
        const { changed } = preprocess(source);
        expect(changed).toBe(true);
      }
    });
  });

  // ==========================================================================
  // Attack 4: HKT syntax edge cases
  // ==========================================================================
  describe("HKT F<_> syntax edge cases", () => {
    it("F<_> in interface declaration", () => {
      const source = `interface Functor<F<_>> { map: <A, B>(fa: F<A>) => F<B>; }`;
      const { code, changed } = preprocess(source);

      // F<_> should become F, and F<A> should become $<F, A>
      expect(changed).toBe(true);
    });

    it("F<_> vs comparison", () => {
      // F<_> where _ is a valid identifier vs F < _
      const source = `const _ = 1; const cmp = F < _;`;
      const { code, changed } = preprocess(source);

      // This should NOT be HKT syntax - it's a comparison
      // But distinguishing this requires context
    });

    it("Nested type parameters", () => {
      // FIXED: Nested HKT types no longer crash the preprocessor
      // See Finding #8 in FINDINGS.md
      const source = `interface Nested<F<_>, G<_>> { fg: <A>(fa: F<G<A>>) => G<F<A>>; }`;

      const { code, changed } = preprocess(source);

      expect(changed).toBe(true);
      // F<_> and G<_> declarations should be stripped
      // F<G<A>> should become $<F, $<G, A>> (nested composition)
      // G<F<A>> should become $<G, $<F, A>>
      expect(code).toContain("$<F, $<G, A>>");
      expect(code).toContain("$<G, $<F, A>>");
      expect(code).not.toContain("F<_>");
      expect(code).not.toContain("G<_>");
    });

    it("F<_> with constraints", () => {
      const source = `interface Bounded<F<_> extends Functor<F>> {}`;
      const { code, changed } = preprocess(source);

      // This is tricky syntax
    });
  });

  // ==========================================================================
  // Attack 5: Cons operator edge cases
  // ==========================================================================
  describe("Cons :: operator edge cases", () => {
    it(":: in type annotation (TypeScript)", () => {
      // TypeScript doesn't use :: but this could confuse the parser
      const source = `const x: number = 1; head :: tail;`;
      const { code, changed } = preprocess(source);

      // Should transform the cons, not the type annotation
    });

    it(":: vs ::", () => {
      // What if someone uses :: in a string?
      const source = `const s = "a::b::c";`;
      const { code, changed } = preprocess(source);

      expect(code).toBe(source); // No change in strings
    });

    it(":: with method call", () => {
      const source = `const list = head :: tail.slice(1);`;
      const { code, changed } = preprocess(source);

      expect(changed).toBe(true);
      expect(code).toContain("__binop__");
    });
  });

  // ==========================================================================
  // Attack 6: Mixed operators
  // ==========================================================================
  describe("Mixed operators", () => {
    it("Pipeline and cons together", () => {
      const source = `const list = x :: xs |> reverse;`;
      const { code, changed } = preprocess(source);

      // Precedence matters here
      expect(changed).toBe(true);
    });

    it("All custom operators in one expression", () => {
      const source = `const result = head :: (list |> map(f));`;
      const { code, changed } = preprocess(source);

      expect(changed).toBe(true);
      // Should have multiple __binop__ calls
    });
  });

  // ==========================================================================
  // Attack 7: Unicode and special characters
  // ==========================================================================
  describe("Unicode and special characters", () => {
    it("Unicode identifiers", () => {
      const source = `const λ = x => x; const result = data |> λ;`;
      const { code, changed } = preprocess(source);

      expect(changed).toBe(true);
      expect(code).toContain("λ");
    });

    it("Emoji in strings near operators", () => {
      const source = `const s = "🎉"; const r = x |> f;`;
      const { code, changed } = preprocess(source);

      expect(changed).toBe(true);
      expect(code).toContain("🎉");
    });

    it("Line continuation", () => {
      const source = `const result = x\n  |> f\n  |> g;`;
      const { code, changed } = preprocess(source);

      expect(changed).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 8: Edge cases that might break source maps
  // ==========================================================================
  describe("Source map edge cases", () => {
    it("Empty file", () => {
      const source = ``;
      const { code, changed, sourceMap } = preprocess(source);

      expect(code).toBe("");
      expect(changed).toBe(false);
    });

    it("File with only whitespace", () => {
      const source = `   \n\n\t  `;
      const { code, changed } = preprocess(source);

      expect(code).toBe(source);
      expect(changed).toBe(false);
    });

    it("Very long line", () => {
      const source = `const x = ${"a |> f ".repeat(100)};`;
      const { code, changed } = preprocess(source);

      expect(changed).toBe(true);
    });

    it("Multiline with mixed operators", () => {
      // Related to Finding #9: Source maps not always generated
      // See FINDINGS.md
      // Use string concat to avoid prettier transforming the operators
      const pipe = "|" + ">";
      const source =
        "const pipeline1 = x " +
        pipe +
        " f " +
        pipe +
        " g;\n\nconst pipeline2 = y " +
        pipe +
        " h " +
        pipe +
        " i;";
      const { code, changed, sourceMap } = preprocess(source);

      expect(changed).toBe(true);
      expect(code).toContain("__binop__");
      // Source map may be undefined due to the operator rewriting path
      // This is a known limitation documented in Finding #9
    });
  });
});

// ==========================================================================
// Token scanner tests
// ==========================================================================
describe("Token Scanner Edge Cases", () => {
  it("Tokenizes JSX-like syntax", () => {
    // The scanner might confuse < > in JSX vs generics
    const source = `const el = <div>{__binop__(x, "|>", f)}</div>;`;

    // Note: proper handling requires knowing file is .tsx
    const tokens = tokenize(source);
    expect(tokens.length).toBeGreaterThan(0);
  });

  it("Tokenizes regex", () => {
    const source = `const re = /a|b/g;`; // | in regex, not operator

    const tokens = tokenize(source);
    // Should not confuse | in regex with pipe
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
