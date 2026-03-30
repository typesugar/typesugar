/**
 * Red Team Tests for Macros (specialize)
 *
 * Attack surfaces:
 * - specialize() inlining edge cases
 *
 * Note: Match macro edge case tests were removed in PEP-025
 * (old API consolidation). Match edge cases are covered by match-v2 tests.
 */
import { describe, it, expect } from "vitest";

// ==========================================================================
// Specialize Macro Edge Cases
// ==========================================================================
describe("Specialize Edge Cases", () => {
  // Test that the runtime fallback works (when macro isn't applied)

  it("Generic function with type parameter", () => {
    interface Functor<F> {
      map<A, B>(fa: F, f: (a: A) => B): F;
    }

    const arrayFunctor: Functor<any[]> = {
      map: <A, B>(fa: A[], f: (a: A) => B) => fa.map(f),
    };

    function double<F>(F: Functor<F>, fa: F): F {
      return F.map(fa, (x: number) => x * 2);
    }

    // Direct call (not specialized)
    const result = double(arrayFunctor, [1, 2, 3]);
    expect(result).toEqual([2, 4, 6]);
  });

  it("Inlining with closures", () => {
    // Does inlining preserve closure captures correctly?
    const captured = 100;

    interface Numeric {
      add(a: number, b: number): number;
    }

    const closureNumeric: Numeric = {
      add: (a, b) => a + b + captured, // Captures `captured`
    };

    function addAll(N: Numeric, xs: number[]): number {
      return xs.reduce((acc, x) => N.add(acc, x), 0);
    }

    // The closure should be preserved during inlining
    const result = addAll(closureNumeric, [1, 2, 3]);
    expect(result).toBe(306); // (0 + 1 + 100) + (101 + 2 + 100) + (203 + 3 + 100)
    // Actually: 0+1+100=101, 101+2+100=203, 203+3+100=306
  });

  it("Dictionary with getters", () => {
    interface Lazy<A> {
      get(): A;
    }

    let callCount = 0;
    const lazyValue: Lazy<number> = {
      get() {
        callCount++;
        return 42;
      },
    };

    function getValue<A>(L: Lazy<A>): A {
      return L.get();
    }

    // Multiple calls to getValue should call get() each time
    expect(getValue(lazyValue)).toBe(42);
    expect(getValue(lazyValue)).toBe(42);
    expect(callCount).toBe(2);
  });
});
