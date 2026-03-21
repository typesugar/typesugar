import { describe, it, expect } from "vitest";
import {
  fixed,
  fixedZero,
  fixedOne,
  fixedNumeric,
  fixedIntegral,
  fixedAdd,
  fixedSub,
  fixedMul,
  fixedDiv,
  fixedToNumber,
  fixedToString,
  fixedCompare,
  fixedEquals,
  fixedAbs,
  fixedNegate,
  fixedMin,
  fixedMax,
  fixedClamp,
  fixedRound,
  fixedFormat,
  fixedIsZero,
  fixedIsPositive,
  fixedIsNegative,
  type FixedDecimal,
} from "../types/fixed-decimal.js";

describe("FixedDecimal", () => {
  describe("construction", () => {
    it("creates from number", () => {
      const fd = fixed(12.34, 2);
      expect(fd).toBe(1234n);
    });

    it("creates from string", () => {
      const fd = fixed("12.345", 2);
      // HALF_EVEN: 12.345 -> 12.34 (4 is even, round down)
      expect(fd).toBe(1234n);
    });

    it("creates from bigint", () => {
      const fd = fixed(1234n, 2);
      expect(fd).toBe(1234n);
    });

    it("handles negative values", () => {
      const fd = fixed(-12.34, 2);
      expect(fd).toBe(-1234n);
    });

    it("handles zero", () => {
      const fd = fixed(0, 2);
      expect(fd).toBe(0n);
    });

    it("handles scientific notation", () => {
      const fd = fixed("1.5e2", 2);
      expect(fd).toBe(15000n); // 150.00
    });
  });

  describe("constants", () => {
    it("fixedZero returns 0", () => {
      expect(fixedZero(2)).toBe(0n);
    });

    it("fixedOne returns scale factor", () => {
      expect(fixedOne(2)).toBe(100n);
      expect(fixedOne(4)).toBe(10000n);
    });
  });

  describe("arithmetic", () => {
    it("adds correctly", () => {
      const a = fixed(12.34, 2);
      const b = fixed(5.66, 2);
      expect(fixedAdd(a, b)).toBe(1800n); // 18.00
    });

    it("subtracts correctly", () => {
      const a = fixed(12.34, 2);
      const b = fixed(5.34, 2);
      expect(fixedSub(a, b)).toBe(700n); // 7.00
    });

    it("multiplies with auto-rounding", () => {
      const a = fixed(12.34, 2);
      const b = fixed(0.1, 2);
      // 12.34 * 0.10 = 1.234, rounds to 1.23
      expect(fixedMul(a, b, 2)).toBe(123n);
    });

    it("divides with auto-rounding", () => {
      const a = fixed(10, 2);
      const b = fixed(3, 2);
      // 10.00 / 3.00 = 3.333..., rounds to 3.33
      expect(fixedDiv(a, b, 2)).toBe(333n);
    });

    it("negates correctly", () => {
      const a = fixed(12.34, 2);
      expect(fixedNegate(a)).toBe(-1234n);
    });

    it("takes absolute value", () => {
      const a = fixed(-12.34, 2);
      expect(fixedAbs(a)).toBe(1234n);
    });
  });

  describe("comparison", () => {
    it("compares equal values", () => {
      const a = fixed(12.34, 2);
      const b = fixed(12.34, 2);
      expect(fixedCompare(a, b)).toBe(0);
      expect(fixedEquals(a, b)).toBe(true);
    });

    it("compares less than", () => {
      const a = fixed(12.33, 2);
      const b = fixed(12.34, 2);
      expect(fixedCompare(a, b)).toBe(-1);
    });

    it("compares greater than", () => {
      const a = fixed(12.35, 2);
      const b = fixed(12.34, 2);
      expect(fixedCompare(a, b)).toBe(1);
    });

    it("min/max work correctly", () => {
      const a = fixed(12.34, 2);
      const b = fixed(56.78, 2);
      expect(fixedMin(a, b)).toBe(a);
      expect(fixedMax(a, b)).toBe(b);
    });

    it("clamp works correctly", () => {
      const value = fixed(50, 2);
      const lo = fixed(10, 2);
      const hi = fixed(30, 2);
      expect(fixedClamp(value, lo, hi)).toBe(hi);
      expect(fixedClamp(fixed(5, 2), lo, hi)).toBe(lo);
      expect(fixedClamp(fixed(20, 2), lo, hi)).toBe(fixed(20, 2));
    });
  });

  describe("queries", () => {
    it("isZero", () => {
      expect(fixedIsZero(fixed(0, 2))).toBe(true);
      expect(fixedIsZero(fixed(1, 2))).toBe(false);
    });

    it("isPositive", () => {
      expect(fixedIsPositive(fixed(1, 2))).toBe(true);
      expect(fixedIsPositive(fixed(0, 2))).toBe(false);
      expect(fixedIsPositive(fixed(-1, 2))).toBe(false);
    });

    it("isNegative", () => {
      expect(fixedIsNegative(fixed(-1, 2))).toBe(true);
      expect(fixedIsNegative(fixed(0, 2))).toBe(false);
      expect(fixedIsNegative(fixed(1, 2))).toBe(false);
    });
  });

  describe("conversion", () => {
    it("toNumber", () => {
      const fd = fixed(1234n, 2);
      expect(fixedToNumber(fd, 2)).toBe(12.34);
    });

    it("toString", () => {
      const fd = fixed(1234n, 2);
      expect(fixedToString(fd, 2)).toBe("12.34");
    });

    it("toString with leading zeros in fraction", () => {
      const fd = fixed(5n, 2);
      expect(fixedToString(fd, 2)).toBe("0.05");
    });

    it("toString negative", () => {
      const fd = fixed(-1234n, 2);
      expect(fixedToString(fd, 2)).toBe("-12.34");
    });
  });

  describe("rounding", () => {
    it("rounds to fewer decimal places", () => {
      const fd = fixed(12345n, 3); // 12.345
      const rounded = fixedRound(fd, 3, 2);
      // HALF_EVEN: 12.345 -> 12.34 (4 is even, round down at exactly 0.5)
      expect(rounded).toBe(1234n);
    });

    it("scales up when increasing precision", () => {
      const fd = fixed(1234n, 2); // 12.34
      const scaled = fixedRound(fd, 2, 4);
      expect(scaled).toBe(123400n); // 12.3400
    });
  });

  describe("Numeric typeclass", () => {
    const N = fixedNumeric(2);

    it("add", () => {
      const a = fixed(12.34, 2);
      const b = fixed(5.66, 2);
      expect(N.add(a, b)).toBe(1800n);
    });

    it("sub", () => {
      const a = fixed(12.34, 2);
      const b = fixed(5.34, 2);
      expect(N.sub(a, b)).toBe(700n);
    });

    it("mul", () => {
      const a = fixed(10, 2);
      const b = fixed(0.5, 2);
      expect(N.mul(a, b)).toBe(500n); // 5.00
    });

    it("fromNumber", () => {
      expect(N.fromNumber(12.34)).toBe(1234n);
    });

    it("toNumber", () => {
      expect(N.toNumber(fixed(1234n, 2))).toBe(12.34);
    });

    it("zero and one", () => {
      expect(N.zero()).toBe(0n);
      expect(N.one()).toBe(100n);
    });
  });

  describe("Integral typeclass", () => {
    const I = fixedIntegral(2);

    it("div", () => {
      const a = fixed(10, 2);
      const b = fixed(3, 2);
      expect(I.div(a, b)).toBe(333n); // 3.33
    });

    it("mod", () => {
      const a = fixed(10, 2);
      const b = fixed(3, 2);
      // 1000 mod 300 = 100
      expect(I.mod(a, b)).toBe(100n);
    });
  });

  describe("rounding modes", () => {
    it("HALF_UP rounds away from zero", () => {
      const fd = fixed("2.5", 1);
      const rounded = fixedRound(fd, 1, 0, "HALF_UP");
      expect(rounded).toBe(3n);
    });

    it("HALF_DOWN rounds toward zero", () => {
      const fd = fixed("2.5", 1);
      const rounded = fixedRound(fd, 1, 0, "HALF_DOWN");
      expect(rounded).toBe(2n);
    });

    it("HALF_EVEN rounds to nearest even (banker's)", () => {
      expect(fixedRound(fixed("2.5", 1), 1, 0, "HALF_EVEN")).toBe(2n);
      expect(fixedRound(fixed("3.5", 1), 1, 0, "HALF_EVEN")).toBe(4n);
    });

    it("CEIL rounds toward +infinity", () => {
      expect(fixedRound(fixed("2.1", 1), 1, 0, "CEIL")).toBe(3n);
      expect(fixedRound(fixed("-2.1", 1), 1, 0, "CEIL")).toBe(-2n);
    });

    it("FLOOR rounds toward -infinity", () => {
      expect(fixedRound(fixed("2.9", 1), 1, 0, "FLOOR")).toBe(2n);
      expect(fixedRound(fixed("-2.9", 1), 1, 0, "FLOOR")).toBe(-3n);
    });

    it("TRUNC rounds toward zero", () => {
      expect(fixedRound(fixed("2.9", 1), 1, 0, "TRUNC")).toBe(2n);
      expect(fixedRound(fixed("-2.9", 1), 1, 0, "TRUNC")).toBe(-2n);
    });
  });

  describe("edge cases", () => {
    it("handles very large numbers", () => {
      const big = fixed(999999999999.99, 2);
      expect(fixedToNumber(big, 2)).toBeCloseTo(999999999999.99, 0);
    });

    it("handles division by larger number", () => {
      const a = fixed(1, 2);
      const b = fixed(3, 2);
      expect(fixedDiv(a, b, 2)).toBe(33n); // 0.33
    });

    it("throws on division by zero", () => {
      const a = fixed(10, 2);
      const b = fixed(0, 2);
      expect(() => fixedDiv(a, b, 2)).toThrow("division by zero");
    });
  });
});
