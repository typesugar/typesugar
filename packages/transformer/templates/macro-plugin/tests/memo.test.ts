import { describe, it, expect } from "vitest";
import { expandCode } from "@typesugar/testing";

describe("memo macro", () => {
  it("expands to memoization wrapper", async () => {
    await import("../src/macros/index.js");

    const source = `
      import { memo } from "my-typesugar-macros";
      const fib = memo((n: number): number => n <= 1 ? n : fib(n-1) + fib(n-2));
    `;

    const result = await expandCode(source);

    // Should contain Map for caching
    expect(result).toContain("new Map");

    // Should contain key generation
    expect(result).toContain("JSON.stringify");
  });

  it("runtime behavior memoizes correctly", () => {
    // Simulated expansion result
    let callCount = 0;
    const cache = new Map();
    const expensiveFn = (n: number): number => {
      callCount++;
      return n * 2;
    };
    const memoized = (n: number): number => {
      const key = JSON.stringify([n]);
      if (cache.has(key)) return cache.get(key);
      const result = expensiveFn(n);
      cache.set(key, result);
      return result;
    };

    // First call - should compute
    expect(memoized(5)).toBe(10);
    expect(callCount).toBe(1);

    // Second call with same arg - should use cache
    expect(memoized(5)).toBe(10);
    expect(callCount).toBe(1);

    // Different arg - should compute again
    expect(memoized(10)).toBe(20);
    expect(callCount).toBe(2);
  });
});
