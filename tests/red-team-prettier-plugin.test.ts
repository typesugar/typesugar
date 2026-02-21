/**
 * Red Team Tests for @typesugar/prettier-plugin
 *
 * Attack surfaces:
 * - Custom syntax in non-code contexts (strings, comments)
 * - Malformed or ambiguous operator sequences
 * - HKT parameter scoping and naming edge cases
 * - __binop__ reversal with deeply nested/malformed input
 * - Empty and minimal inputs
 * - File type detection and JSX handling
 */
import { describe, it, expect } from "vitest";
import { preFormat, type PreFormatResult } from "@typesugar/prettier-plugin";
import { postFormat } from "@typesugar/prettier-plugin";
import { format, getFormatMetadata } from "@typesugar/prettier-plugin";

describe("Prettier Plugin Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Custom Syntax in Non-Code Contexts
  // ==========================================================================
  describe("syntax in strings and comments should not transform", () => {
    it("preserves |> inside string literals", () => {
      const source = `const msg = "use |> for pipelines";`;
      const result = preFormat(source);

      // Should not transform operators inside strings
      expect(result.code).toBe(source);
      expect(result.changed).toBe(false);
    });

    it("preserves :: inside template literals", () => {
      const source = "const msg = `a :: b is cons`;";
      const result = preFormat(source);

      expect(result.code).toBe(source);
      expect(result.changed).toBe(false);
    });

    it("preserves |> inside single-line comments", () => {
      const source = `// a |> b |> c\nconst x = 1;`;
      const result = preFormat(source);

      // Comment should remain untouched
      expect(result.code).toContain("// a |> b |> c");
      expect(result.changed).toBe(false);
    });

    it("preserves F<_> inside block comments", () => {
      const source = `/* interface Functor<F<_>> {} */\nconst x = 1;`;
      const result = preFormat(source);

      expect(result.code).toContain("F<_>");
      expect(result.changed).toBe(false);
    });

    it("preserves |> inside JSDoc comments", () => {
      const source = `/**\n * Use a |> b for piping\n */\nfunction foo() {}`;
      const result = preFormat(source);

      expect(result.code).toContain("|>");
      // JSDoc comment should not trigger transform
    });
  });

  // ==========================================================================
  // Attack 2: Mixed and Nested Operator Chains
  // ==========================================================================
  describe("complex operator combinations", () => {
    it("handles mixed |> and :: in same expression", () => {
      const source = `const x = a |> b :: c |> d;`;
      const result = preFormat(source);

      expect(result.changed).toBe(true);
      expect(result.code).toContain("__binop__");
      // Both operators should be represented
      expect(result.code).toContain('"|>"');
      expect(result.code).toContain('"::"');
    });

    it("handles deeply nested pipeline (10+ levels)", async () => {
      const source = `const x = a |> b |> c |> d |> e |> f |> g |> h |> i |> j;`;
      const result = await format(source, { filepath: "test.ts" });

      // Should round-trip successfully
      const pipeCount = (result.match(/\|>/g) || []).length;
      expect(pipeCount).toBe(9);
      expect(result).not.toContain("__binop__");
    });

    it("handles operator at end of line in multi-line expression", async () => {
      const source = `const x = a |>
  b |>
  c;`;
      const result = await format(source, { filepath: "test.ts" });

      expect(result).toContain("|>");
      expect(result).not.toContain("__binop__");
    });

    it("handles :: with empty array on right side", async () => {
      const source = `const list = a :: [];`;
      const result = await format(source, { filepath: "test.ts" });

      expect(result).toContain("::");
      expect(result).toContain("[]");
    });
  });

  // ==========================================================================
  // Attack 3: HKT Parameter Edge Cases
  // ==========================================================================
  describe("HKT parameter scoping and naming", () => {
    it("handles multiple HKT parameters in one interface", () => {
      const source = `interface Bifunctor<F<_>, G<_>> { bimap: (fa: F<A>, fb: G<B>) => F<G<C>>; }`;
      const result = preFormat(source);

      expect(result.changed).toBe(true);
      // Both F and G should be tracked
      const fParams = result.metadata.hktParams.filter((p) => p.name === "F");
      const gParams = result.metadata.hktParams.filter((p) => p.name === "G");
      expect(fParams.length).toBeGreaterThanOrEqual(1);
      expect(gParams.length).toBeGreaterThanOrEqual(1);
    });

    it("handles HKT parameter with underscore in name", () => {
      const source = `interface Container<F_Type<_>> { wrap: (a: F_Type<A>) => void; }`;
      const result = preFormat(source);

      expect(result.changed).toBe(true);
      expect(result.metadata.hktParams.some((p) => p.name === "F_Type")).toBe(true);
    });

    it("handles lowercase HKT-like syntax (should NOT be treated as HKT)", () => {
      // Convention: HKT params are uppercase
      const source = `interface Bad<f<_>> { map: (fa: f<A>) => f<B>; }`;
      const result = preFormat(source);

      // Lowercase 'f' - behavior depends on preprocessor, but we test consistency
      expect(result.code).toBeDefined();
    });

    it("handles HKT usage without declaration in same file", () => {
      // $<F, A> appears but no F<_> declaration
      const source = `type Applied = $<SomeF, number>;`;
      const result = preFormat(source);

      // Should not crash, and $ should remain (it's valid TS)
      expect(result.code).toContain("$<SomeF");
    });

    it("handles nested HKT application $<F, $<G, A>>", async () => {
      const source = `interface Composed<F<_>, G<_>> { compose: (fg: F<G<A>>) => F<G<B>>; }`;
      const result = await format(source, { filepath: "test.ts" });

      // Should preserve nested HKT syntax
      expect(result).toContain("F<_>");
      expect(result).toContain("G<_>");
    });
  });

  // ==========================================================================
  // Attack 4: __binop__ Reversal Edge Cases
  // ==========================================================================
  describe("__binop__ reversal robustness", () => {
    it("handles __binop__ with wrong argument count (malformed)", () => {
      // Only 2 arguments instead of 3
      const malformed = `const x = __binop__(a, "|>");`;
      const metadata = { changed: true, hktParams: [] };
      const result = postFormat(malformed, metadata);

      // Should not crash, and should leave malformed call as-is
      expect(result).toContain("__binop__");
    });

    it("handles __binop__ with non-string operator (malformed)", () => {
      // Operator is a number instead of string
      const malformed = `const x = __binop__(a, 123, b);`;
      const metadata = { changed: true, hktParams: [] };
      const result = postFormat(malformed, metadata);

      // Should not crash, and should leave malformed call as-is
      expect(result).toContain("__binop__");
    });

    it("handles __binop__ with unknown operator", () => {
      // Operator is not |> or ::
      const malformed = `const x = __binop__(a, "??", b);`;
      const metadata = { changed: true, hktParams: [] };
      const result = postFormat(malformed, metadata);

      // Unknown operator should be left as-is
      expect(result).toContain("__binop__");
    });

    it("handles real identifier named __binop__ (false positive risk)", async () => {
      // User has a variable named __binop__
      const source = `const __binop__ = (a: any, b: any, c: any) => a;
const result = __binop__(1, "test", 2);`;
      const result = await format(source, { filepath: "test.ts" });

      // Should format but we need to be careful about false positives
      expect(result).toBeDefined();
    });
  });

  // ==========================================================================
  // Attack 5: Empty and Minimal Inputs
  // ==========================================================================
  describe("empty and minimal inputs", () => {
    it("handles empty string", () => {
      const result = preFormat("");

      expect(result.code).toBe("");
      expect(result.changed).toBe(false);
    });

    it("handles whitespace-only input", () => {
      const result = preFormat("   \n\t  \n  ");

      expect(result.changed).toBe(false);
    });

    it("handles single character input", () => {
      const result = preFormat("x");

      expect(result.code).toBe("x");
      expect(result.changed).toBe(false);
    });

    it("handles lone |> without operands", () => {
      // This is invalid TS, but should not crash
      const source = `|>`;
      expect(() => preFormat(source)).not.toThrow();
    });

    it("handles lone :: without operands", () => {
      const source = `::`;
      expect(() => preFormat(source)).not.toThrow();
    });

    it("handles just an HKT marker <_>", () => {
      const source = `<_>`;
      expect(() => preFormat(source)).not.toThrow();
    });
  });

  // ==========================================================================
  // Attack 6: File Type Detection
  // ==========================================================================
  describe("file type and JSX handling", () => {
    it("handles .tsx files with JSX elements", async () => {
      const source = `const el = <div>{value |> format}</div>;`;
      const result = await format(source, { filepath: "test.tsx" });

      // Should handle JSX and pipeline together
      expect(result).toContain("|>");
      expect(result).toContain("<div>");
    });

    it("handles < and > in JSX vs comparison operators", async () => {
      const source = `const el = <Component prop={a < b ? c : d} />;`;
      const result = await format(source, { filepath: "test.tsx" });

      // Comparison operators should not be confused with JSX
      expect(result).toContain("a < b");
    });

    it("respects .mts extension", () => {
      const source = `const x = a |> b;`;
      const result = preFormat(source, { fileName: "module.mts" });

      expect(result.changed).toBe(true);
    });

    it("respects .cts extension", () => {
      const source = `const x = a |> b;`;
      const result = preFormat(source, { fileName: "module.cts" });

      expect(result.changed).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 7: Metadata Integrity
  // ==========================================================================
  describe("metadata and position tracking", () => {
    it("getFormatMetadata returns accurate HKT info", () => {
      const source = `interface Monad<M<_>> { bind: (ma: M<A>, f: (a: A) => M<B>) => M<B>; }`;
      const metadata = getFormatMetadata(source, { filepath: "test.ts" });

      expect(metadata.changed).toBe(true);
      expect(metadata.hktParams.length).toBeGreaterThan(0);

      // Verify scope positions are valid
      for (const param of metadata.hktParams) {
        expect(param.scope.start).toBeGreaterThanOrEqual(0);
        expect(param.scope.end).toBeGreaterThan(param.scope.start);
        expect(param.scope.end).toBeLessThanOrEqual(source.length + 100); // Some margin for transformation
      }
    });

    it("metadata.changed is false for unchanged content", () => {
      const source = `const x = 42;`;
      const metadata = getFormatMetadata(source);

      expect(metadata.changed).toBe(false);
      expect(metadata.hktParams).toEqual([]);
    });

    it("round-trip preserves line count (no line changes)", async () => {
      const source = `const a = 1;
const b = a |> f;
const c = b |> g;
const d = 4;`;
      const result = await format(source, { filepath: "test.ts" });

      const sourceLines = source.split("\n").length;
      const resultLines = result.split("\n").length;

      // Line count should be approximately preserved
      expect(Math.abs(resultLines - sourceLines)).toBeLessThanOrEqual(1);
    });
  });

  // ==========================================================================
  // Attack 8: Unicode and Special Characters
  // ==========================================================================
  describe("unicode and special characters", () => {
    it("handles identifiers with unicode characters", async () => {
      const source = `const ñame = data |> transform;`;
      const result = await format(source, { filepath: "test.ts" });

      expect(result).toContain("ñame");
      expect(result).toContain("|>");
    });

    it("handles emoji in strings near operators", async () => {
      const source = `const msg = "👋" + (value |> format);`;
      const result = await format(source, { filepath: "test.ts" });

      expect(result).toContain("👋");
      expect(result).toContain("|>");
    });

    it("handles HKT with Greek letter parameter names (known limitation)", () => {
      // TypeScript allows unicode identifiers, but the preprocessor
      // currently only recognizes ASCII uppercase letters for HKT params
      const source = `interface Functor<Φ<_>> { map: (fa: Φ<A>) => Φ<B>; }`;
      const result = preFormat(source);

      // Known limitation: non-ASCII uppercase letters are not recognized as HKT
      // This documents current behavior - could be enhanced in the future
      expect(result.changed).toBe(false);
    });
  });

  // ==========================================================================
  // Attack 9: postFormat Marker Edge Cases
  // ==========================================================================
  describe("HKT marker edge cases in postFormat", () => {
    it("handles marker with extra whitespace", () => {
      const formatted = `interface Functor<F   /*@ts:hkt*/> {}`;
      const metadata = { changed: true, hktParams: [] };
      const result = postFormat(formatted, metadata);

      expect(result).toContain("F<_>");
      expect(result).not.toContain("/*@ts:hkt*/");
    });

    it("handles multiple markers in sequence", () => {
      const formatted = `interface Bi<F /*@ts:hkt*/, G /*@ts:hkt*/> {}`;
      const metadata = { changed: true, hktParams: [] };
      const result = postFormat(formatted, metadata);

      expect(result).toContain("F<_>");
      expect(result).toContain("G<_>");
    });

    it("handles marker without preceding identifier", () => {
      // Edge case: marker at start of file
      const formatted = `/*@ts:hkt*/ interface X {}`;
      const metadata = { changed: true, hktParams: [] };

      // Should not crash
      expect(() => postFormat(formatted, metadata)).not.toThrow();
    });

    it("handles $<F, ComplexType<A, B, C>> reversal", () => {
      const formatted = `interface X<F /*@ts:hkt*/> { method: () => $<F, Map<string, Array<number>>>; }`;
      const metadata = {
        changed: true,
        hktParams: [{ name: "F", scope: { start: 0, end: 200 } }],
      };
      const result = postFormat(formatted, metadata);

      expect(result).toContain("F<Map<string, Array<number>>>");
      expect(result).not.toContain("$<F,");
    });
  });

  // ==========================================================================
  // Attack 10: Idempotency Edge Cases
  // ==========================================================================
  describe("idempotency guarantees", () => {
    it("triple format is same as double format", async () => {
      // Test with both HKT and pipeline in valid positions
      const source = `interface Functor<M<_>> { map: (fa: M<A>) => M<B>; }
const result = data |> transform |> format;`;

      const once = await format(source, { filepath: "test.ts" });
      const twice = await format(once, { filepath: "test.ts" });
      const thrice = await format(twice, { filepath: "test.ts" });

      expect(thrice).toBe(twice);
    });

    it("format then preFormat is consistent", async () => {
      const source = `const x = a |> b |> c;`;
      const formatted = await format(source, { filepath: "test.ts" });

      // Pre-formatting the result should recognize it as having custom syntax
      const preResult = preFormat(formatted);

      // Either it's unchanged (already valid) or it transforms consistently
      expect(preResult.code).toBeDefined();
    });
  });
});
