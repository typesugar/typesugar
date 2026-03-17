/**
 * Type-level test for readonly discriminated union support.
 * This verifies the fix for Wave 9 blocker.
 */
import { describe, it, expect } from "vitest";
import { match } from "../packages/std/src/macros/match.js";

// Simulating the Expression type with readonly properties
interface Constant {
  readonly kind: "constant";
  readonly value: number;
}

interface Variable {
  readonly kind: "variable";
  readonly name: string;
}

interface Binary {
  readonly kind: "binary";
  readonly op: string;
  readonly left: Expression;
  readonly right: Expression;
}

type Expression = Constant | Variable | Binary;

describe("match() with readonly discriminated unions", () => {
  it("should accept readonly interfaces", () => {
    const expr: Expression = { kind: "constant", value: 42 };

    const result = match(expr, {
      constant: ({ value }) => value,
      variable: ({ name }) => name.length,
      binary: ({ op }) => op.length,
    });

    expect(result).toBe(42);
  });

  it("should destructure readonly fields correctly", () => {
    const expr: Expression = { kind: "variable", name: "x" };

    const result = match(expr, {
      constant: ({ value }) => `const:${value}`,
      variable: ({ name }) => `var:${name}`,
      binary: ({ op, left, right }) => `binary:${op}`,
    });

    expect(result).toBe("var:x");
  });

  it("should handle nested readonly unions", () => {
    const expr: Expression = {
      kind: "binary",
      op: "+",
      left: { kind: "constant", value: 1 },
      right: { kind: "constant", value: 2 },
    };

    function evaluate(e: Expression): number {
      return match(e, {
        constant: ({ value }) => value,
        variable: () => 0,
        binary: ({ op, left, right }) => {
          const l = evaluate(left);
          const r = evaluate(right);
          return op === "+" ? l + r : l - r;
        },
      });
    }

    expect(evaluate(expr)).toBe(3);
  });
});
