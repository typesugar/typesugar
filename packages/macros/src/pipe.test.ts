/**
 * PEP-033 4A: the public `pipe` has value-first overloads so the result type is
 * inferred through each step instead of collapsing to `unknown`.
 */
import { describe, it, expect, expectTypeOf } from "vitest";
import { pipe } from "./runtime-stubs.js";

describe("pipe", () => {
  it("threads values left to right at runtime", () => {
    const result = pipe(
      5,
      (x) => x * 2,
      (x) => x + 1,
      (x) => `n=${x}`
    );
    expect(result).toBe("n=11");
  });

  it("infers the return type through each step (not unknown)", () => {
    const result = pipe(
      5,
      (x) => x * 2,
      (x) => `${x}`
    );
    expectTypeOf(result).toEqualTypeOf<string>();
  });

  it("infers intermediate parameter types without annotations", () => {
    pipe(
      { count: 1 },
      (o) => {
        expectTypeOf(o).toEqualTypeOf<{ count: number }>();
        return o.count;
      },
      (n) => {
        expectTypeOf(n).toEqualTypeOf<number>();
        return n > 0;
      }
    );
  });

  it("returns the value unchanged with no functions", () => {
    expect(pipe(42)).toBe(42);
    expectTypeOf(pipe(42)).toEqualTypeOf<number>();
  });
});
