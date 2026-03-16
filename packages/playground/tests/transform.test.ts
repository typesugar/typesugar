import { describe, it, expect, beforeEach } from "vitest";
import { transform, preprocessCode, clearCache, getCacheStats } from "../src/index.js";

describe("playground transform", () => {
  beforeEach(() => {
    clearCache();
  });

  describe("preprocessCode", () => {
    it("should preprocess pipeline operator syntax", () => {
      const result = preprocessCode(`const result = x |> f |> g;`, {
        fileName: "test.sts",
      });
      expect(result.changed).toBe(true);
      expect(result.code).toContain("__binop__");
    });

    it("should preprocess HKT syntax", () => {
      const result = preprocessCode(
        `interface Functor<F<_>> { map: <A, B>(fa: F<A>, f: (a: A) => B) => F<B>; }`,
        {
          fileName: "test.sts",
        }
      );
      expect(result.changed).toBe(true);
    });

    it("should return unchanged for plain TypeScript", () => {
      const code = `const x: number = 1;`;
      const result = preprocessCode(code, { fileName: "test.sts" });
      expect(result.changed).toBe(false);
      expect(result.code).toBe(code);
    });
  });

  describe("transform", () => {
    it("should transform plain TypeScript", () => {
      const result = transform(`const x: number = 1 + 2;`, {
        fileName: "test.ts",
      });
      expect(result.diagnostics).toHaveLength(0);
      expect(result.code).toContain("const x");
    });

    it("should handle .sts files with preprocessing", () => {
      const result = transform(`const result = 1 |> String;`, {
        fileName: "test.sts",
      });
      expect(result.preprocessed).toBe(true);
      expect(result.code).toContain("__binop__");
    });

    it("should cache results", () => {
      const code = `const x = 1;`;
      const fileName = "cached.ts";

      transform(code, { fileName });
      const stats1 = getCacheStats();
      expect(stats1).toContain("0 hits");

      transform(code, { fileName });
      const stats2 = getCacheStats();
      expect(stats2).toContain("1 hits");
    });

    it("should report errors for invalid syntax", () => {
      const result = transform(`const x: = ;`, { fileName: "invalid.ts" });
      expect(result.original).toBe(`const x: = ;`);
    });
  });

  describe("cache", () => {
    it("should clear cache", () => {
      transform(`const x = 1;`, { fileName: "test.ts" });
      clearCache();
      const stats = getCacheStats();
      expect(stats).toContain("0 hits");
      expect(stats).toContain("0 misses");
    });
  });
});
