/**
 * Backend performance benchmark tests
 *
 * Compares TypeScript vs oxc backend performance for various code patterns.
 * These tests verify that the oxc backend provides expected performance improvements.
 *
 * Note: These tests are skipped by default due to timing variability.
 * Run manually with: pnpm test -- benchmark.test.ts --run
 */

import { describe, it, expect } from "vitest";
import { transformCode, type TransformBackend } from "../src/pipeline.js";

interface BenchmarkResult {
  backend: TransformBackend;
  iterations: number;
  totalMs: number;
  avgMs: number;
  opsPerSec: number;
}

function benchmark(
  backend: TransformBackend,
  code: string,
  fileName: string,
  iterations: number
): BenchmarkResult {
  // Warmup
  transformCode(code, { fileName, backend });

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    transformCode(code, { fileName, backend });
  }
  const totalMs = performance.now() - start;

  return {
    backend,
    iterations,
    totalMs,
    avgMs: totalMs / iterations,
    opsPerSec: (iterations / totalMs) * 1000,
  };
}

// Skip these tests by default - they're for manual performance analysis
describe.skip("Backend Performance Benchmarks", () => {
  describe("passthrough (no macros)", () => {
    const code = `
      interface User {
        id: number;
        name: string;
        email: string;
      }
      
      class UserService {
        private users: User[] = [];
        
        add(user: User): void {
          this.users.push(user);
        }
        
        find(id: number): User | undefined {
          return this.users.find(u => u.id === id);
        }
        
        all(): User[] {
          return [...this.users];
        }
      }
    `;

    it("oxc should be faster than typescript for passthrough", () => {
      const iterations = 10;
      const tsResult = benchmark("typescript", code, "test.ts", iterations);
      const oxcResult = benchmark("oxc", code, "test.ts", iterations);

      console.log(`Passthrough (no macros) - ${iterations} iterations:`);
      console.log(`  TypeScript: ${tsResult.avgMs.toFixed(2)}ms avg`);
      console.log(`  oxc: ${oxcResult.avgMs.toFixed(2)}ms avg`);
      console.log(`  Speedup: ${(tsResult.avgMs / oxcResult.avgMs).toFixed(2)}x`);

      // oxc should be faster for passthrough
      expect(oxcResult.avgMs).toBeLessThan(tsResult.avgMs);
    });
  });

  describe("syntax-only macros", () => {
    const code = `
      // @cfg(debug)
      const DEBUG_MODE = true;
      
      // Multiple cfg blocks
      // @cfg(!production)
      function devOnly() {
        console.log("dev mode");
      }
      
      staticAssert(1 + 1 === 2, "math works");
      staticAssert(true || false, "logic works");
    `;

    it("oxc should be faster than typescript for syntax-only macros", () => {
      const iterations = 10;
      const tsResult = benchmark("typescript", code, "test.ts", iterations);
      const oxcResult = benchmark("oxc", code, "test.ts", iterations);

      console.log(`Syntax-only macros - ${iterations} iterations:`);
      console.log(`  TypeScript: ${tsResult.avgMs.toFixed(2)}ms avg`);
      console.log(`  oxc: ${oxcResult.avgMs.toFixed(2)}ms avg`);
      console.log(`  Speedup: ${(tsResult.avgMs / oxcResult.avgMs).toFixed(2)}x`);

      // oxc should be faster for syntax-only macros
      expect(oxcResult.avgMs).toBeLessThan(tsResult.avgMs);
    });
  });

  describe("pipe operator expansion (.sts)", () => {
    const code = `
      const double = (x: number) => x * 2;
      const square = (x: number) => x ** 2;
      const addOne = (x: number) => x + 1;
      
      const result1 = 1 |> double;
      const result2 = 2 |> double |> square;
      const result3 = 3 |> double |> square |> addOne;
      const result4 = 4 |> double |> square |> addOne |> double;
    `;

    it("oxc expands __binop__ while typescript leaves it", () => {
      const iterations = 10;
      const tsResult = benchmark("typescript", code, "test.sts", iterations);
      const oxcResult = benchmark("oxc", code, "test.sts", iterations);

      console.log(`Pipe operator (.sts) - ${iterations} iterations:`);
      console.log(`  TypeScript: ${tsResult.avgMs.toFixed(2)}ms avg`);
      console.log(`  oxc: ${oxcResult.avgMs.toFixed(2)}ms avg`);
      console.log(`  Speedup: ${(tsResult.avgMs / oxcResult.avgMs).toFixed(2)}x`);

      // Verify output difference - oxc expands __binop__
      const tsOutput = transformCode(code, { fileName: "test.sts", backend: "typescript" });
      const oxcOutput = transformCode(code, { fileName: "test.sts", backend: "oxc" });

      // TS backend leaves __binop__ for runtime resolution
      expect(tsOutput.code).toContain("__binop__");
      // oxc backend expands __binop__ to function calls
      expect(oxcOutput.code).not.toContain("__binop__");
      expect(oxcOutput.code).toContain("double(1)");
    });
  });

  describe("type-aware macros (fallback)", () => {
    const code = `
      /** @typeclass */
      interface Show<T> {
        show(value: T): string;
      }
    `;

    it("oxc falls back to typescript for type-aware macros", () => {
      const iterations = 5;
      const tsResult = benchmark("typescript", code, "test.ts", iterations);
      const oxcResult = benchmark("oxc", code, "test.ts", iterations);

      console.log(`Type-aware macros (fallback) - ${iterations} iterations:`);
      console.log(`  TypeScript: ${tsResult.avgMs.toFixed(2)}ms avg`);
      console.log(`  oxc (with fallback): ${oxcResult.avgMs.toFixed(2)}ms avg`);

      // When fallback is triggered, oxc should have similar performance
      // (slight overhead from fallback detection)
      // We just verify both produce valid output
      const tsOutput = transformCode(code, { fileName: "test.ts", backend: "typescript" });
      const oxcOutput = transformCode(code, { fileName: "test.ts", backend: "oxc" });

      expect(tsOutput.code).toBeTruthy();
      expect(oxcOutput.code).toBeTruthy();
    });
  });
});

// Quick sanity check that always runs
describe("Backend sanity checks", () => {
  it("both backends produce valid output for passthrough", () => {
    const code = `const x: number = 42;`;

    const tsResult = transformCode(code, { fileName: "test.ts", backend: "typescript" });
    const oxcResult = transformCode(code, { fileName: "test.ts", backend: "oxc" });

    expect(tsResult.code).toContain("42");
    expect(oxcResult.code).toContain("42");
  });

  it("oxc expands __binop__ for pipe operator in .sts files", () => {
    const code = `
      const double = (x: number) => x * 2;
      const result = 1 |> double;
    `;

    const oxcResult = transformCode(code, { fileName: "test.sts", backend: "oxc" });

    expect(oxcResult.code).toContain("double(1)");
    expect(oxcResult.code).not.toContain("__binop__");
  });
});
