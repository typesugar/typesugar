import { describe, it, expect } from "vitest";
import {
  bigDecimal,
  fromString,
  toNumber,
  toFixed,
  toString,
  divWithScale,
  round,
  equals,
  isZero,
  isPositive,
  isNegative,
  isInteger,
  integerPart,
  fractionalPart,
  pow,
  compareMagnitude,
  min,
  max,
  numericBigDecimal,
  ordBigDecimal,
  ZERO,
  ONE,
  TEN,
  type BigDecimal,
} from "../types/bigdecimal.js";

describe("BigDecimal", () => {
  describe("construction", () => {
    it("creates from bigint with scale", () => {
      const bd = bigDecimal(123n, 2);
      expect(bd.unscaled).toBe(123n);
      expect(bd.scale).toBe(2);
      expect(toNumber(bd)).toBeCloseTo(1.23);
    });

    it("creates from string", () => {
      const bd = bigDecimal("123.456");
      expect(bd.unscaled).toBe(123456n);
      expect(bd.scale).toBe(3);
    });

    it("creates from number", () => {
      const bd = bigDecimal(123.456);
      expect(toNumber(bd)).toBeCloseTo(123.456);
    });

    it("defaults scale to 0 for bigint", () => {
      const bd = bigDecimal(100n);
      expect(bd.scale).toBe(0);
    });
  });

  describe("fromString", () => {
    it("parses integers", () => {
      const bd = fromString("42");
      expect(bd.unscaled).toBe(42n);
      expect(bd.scale).toBe(0);
    });

    it("parses decimals", () => {
      const bd = fromString("123.456");
      expect(bd.unscaled).toBe(123456n);
      expect(bd.scale).toBe(3);
    });

    it("parses negative numbers", () => {
      const bd = fromString("-123.456");
      expect(bd.unscaled).toBe(-123456n);
      expect(bd.scale).toBe(3);
    });

    it("parses leading zeros", () => {
      const bd = fromString("0.001");
      expect(bd.unscaled).toBe(1n);
      expect(bd.scale).toBe(3);
    });

    it("parses scientific notation", () => {
      const bd = fromString("1.5e2");
      expect(toNumber(bd)).toBeCloseTo(150);
    });

    it("parses negative exponent", () => {
      const bd = fromString("150e-2");
      expect(toNumber(bd)).toBeCloseTo(1.5);
    });
  });

  describe("toNumber", () => {
    it("converts to number", () => {
      expect(toNumber(bigDecimal("123.456"))).toBeCloseTo(123.456);
      expect(toNumber(bigDecimal("-0.001"))).toBeCloseTo(-0.001);
      expect(toNumber(bigDecimal(100n, 0))).toBe(100);
    });

    it("handles negative scale", () => {
      const bd = { unscaled: 5n, scale: -2 };
      expect(toNumber(bd)).toBe(500);
    });
  });

  describe("toString", () => {
    it("formats integers", () => {
      expect(toString(bigDecimal(42n, 0))).toBe("42");
    });

    it("formats decimals", () => {
      expect(toString(bigDecimal(123456n, 3))).toBe("123.456");
    });

    it("formats with leading zeros", () => {
      expect(toString(bigDecimal(1n, 3))).toBe("0.001");
    });

    it("formats negative numbers", () => {
      expect(toString(bigDecimal(-123456n, 3))).toBe("-123.456");
    });

    it("normalizes trailing zeros", () => {
      expect(toString(bigDecimal(12300n, 2))).toBe("123");
    });
  });

  describe("toFixed", () => {
    it("formats with exact decimal places", () => {
      expect(toFixed(bigDecimal("123.456"), 2)).toBe("123.45");
      expect(toFixed(bigDecimal("123.4"), 3)).toBe("123.400");
      expect(toFixed(bigDecimal(123n, 0), 2)).toBe("123.00");
    });
  });

  describe("constants", () => {
    it("ZERO is 0", () => {
      expect(ZERO.unscaled).toBe(0n);
      expect(toNumber(ZERO)).toBe(0);
    });

    it("ONE is 1", () => {
      expect(ONE.unscaled).toBe(1n);
      expect(toNumber(ONE)).toBe(1);
    });

    it("TEN is 10", () => {
      expect(TEN.unscaled).toBe(10n);
      expect(toNumber(TEN)).toBe(10);
    });
  });

  describe("predicates", () => {
    it("isZero", () => {
      expect(isZero(ZERO)).toBe(true);
      expect(isZero(bigDecimal(0n, 5))).toBe(true);
      expect(isZero(ONE)).toBe(false);
    });

    it("isPositive", () => {
      expect(isPositive(ONE)).toBe(true);
      expect(isPositive(bigDecimal(-1n, 0))).toBe(false);
      expect(isPositive(ZERO)).toBe(false);
    });

    it("isNegative", () => {
      expect(isNegative(bigDecimal(-1n, 0))).toBe(true);
      expect(isNegative(ONE)).toBe(false);
      expect(isNegative(ZERO)).toBe(false);
    });

    it("isInteger", () => {
      expect(isInteger(bigDecimal(5n, 0))).toBe(true);
      expect(isInteger(bigDecimal(500n, 2))).toBe(true); // 5.00
      expect(isInteger(bigDecimal(501n, 2))).toBe(false); // 5.01
    });
  });

  describe("numericBigDecimal", () => {
    const N = numericBigDecimal;

    describe("add", () => {
      it("adds with same scale", () => {
        const a = bigDecimal("1.23");
        const b = bigDecimal("4.56");
        const result = N.add(a, b);
        expect(toNumber(result)).toBeCloseTo(5.79);
      });

      it("adds with different scales", () => {
        const a = bigDecimal("1.2");
        const b = bigDecimal("3.45");
        const result = N.add(a, b);
        expect(toNumber(result)).toBeCloseTo(4.65);
      });

      it("adds negative numbers", () => {
        const a = bigDecimal("5.0");
        const b = bigDecimal("-3.0");
        const result = N.add(a, b);
        expect(toNumber(result)).toBeCloseTo(2.0);
      });
    });

    describe("sub", () => {
      it("subtracts", () => {
        const a = bigDecimal("5.75");
        const b = bigDecimal("3.25");
        const result = N.sub(a, b);
        expect(toNumber(result)).toBeCloseTo(2.5);
      });
    });

    describe("mul", () => {
      it("multiplies", () => {
        const a = bigDecimal("1.5");
        const b = bigDecimal("2.0");
        const result = N.mul(a, b);
        expect(toNumber(result)).toBeCloseTo(3.0);
      });

      it("multiplies with different scales", () => {
        const a = bigDecimal("0.01");
        const b = bigDecimal("100");
        const result = N.mul(a, b);
        expect(toNumber(result)).toBeCloseTo(1.0);
      });
    });

    describe("negate", () => {
      it("negates", () => {
        const result = N.negate(bigDecimal("5.5"));
        expect(toNumber(result)).toBeCloseTo(-5.5);
      });
    });

    describe("abs", () => {
      it("returns absolute value", () => {
        expect(toNumber(N.abs(bigDecimal("-5.5")))).toBeCloseTo(5.5);
        expect(toNumber(N.abs(bigDecimal("5.5")))).toBeCloseTo(5.5);
      });
    });

    describe("signum", () => {
      it("returns sign", () => {
        expect(N.signum(bigDecimal(5n, 0)).unscaled).toBe(1n);
        expect(N.signum(bigDecimal(-5n, 0)).unscaled).toBe(-1n);
        expect(N.signum(ZERO).unscaled).toBe(0n);
      });
    });

    describe("zero and one", () => {
      it("zero is 0", () => {
        const z = N.zero();
        expect(z.unscaled).toBe(0n);
      });

      it("one is 1", () => {
        const o = N.one();
        expect(o.unscaled).toBe(1n);
        expect(o.scale).toBe(0);
      });
    });
  });

  describe("divWithScale", () => {
    it("divides with explicit scale", () => {
      const a = bigDecimal(10n, 0);
      const b = bigDecimal(3n, 0);
      const result = divWithScale(a, b, 4);
      expect(toString(result)).toBe("3.3333");
    });

    it("handles decimal divisors", () => {
      const a = bigDecimal("1");
      const b = bigDecimal("0.3");
      const result = divWithScale(a, b, 2);
      expect(toNumber(result)).toBeCloseTo(3.33, 1);
    });

    it("throws on division by zero", () => {
      expect(() => divWithScale(ONE, ZERO, 2)).toThrow("division by zero");
    });
  });

  describe("round", () => {
    const bd = bigDecimal("123.456");

    it("rounds with mode=round (default)", () => {
      expect(toString(round(bd, 2))).toBe("123.46");
      expect(toString(round(bigDecimal("1.5"), 0))).toBe("2");
      expect(toString(round(bigDecimal("2.5"), 0))).toBe("2"); // banker's rounding
    });

    it("rounds with mode=floor", () => {
      expect(toString(round(bd, 2, "floor"))).toBe("123.45");
      expect(toString(round(bigDecimal("-1.1"), 0, "floor"))).toBe("-2");
    });

    it("rounds with mode=ceil", () => {
      expect(toString(round(bd, 2, "ceil"))).toBe("123.46");
      expect(toString(round(bigDecimal("1.1"), 0, "ceil"))).toBe("2");
    });

    it("does nothing when already at target scale", () => {
      expect(toString(round(bd, 3))).toBe("123.456");
    });
  });

  describe("ordBigDecimal", () => {
    const O = ordBigDecimal;

    it("compares equal values", () => {
      expect(O.compare(bigDecimal("1.0"), bigDecimal("1.00"))).toBe(0);
    });

    it("compares less than", () => {
      expect(O.compare(bigDecimal("1.5"), bigDecimal("2.0"))).toBe(-1);
    });

    it("compares greater than", () => {
      expect(O.compare(bigDecimal("2.5"), bigDecimal("2.0"))).toBe(1);
    });

    it("handles negatives", () => {
      expect(O.compare(bigDecimal("-1.0"), bigDecimal("1.0"))).toBe(-1);
    });
  });

  describe("equals", () => {
    it("detects equal values", () => {
      expect(equals(bigDecimal("1.0"), bigDecimal("1.00"))).toBe(true);
      expect(equals(bigDecimal("1.5"), bigDecimal("1.50"))).toBe(true);
    });

    it("detects unequal values", () => {
      expect(equals(bigDecimal("1.0"), bigDecimal("1.1"))).toBe(false);
    });
  });

  describe("integerPart and fractionalPart", () => {
    it("extracts integer part", () => {
      expect(integerPart(bigDecimal("123.456"))).toBe(123n);
      expect(integerPart(bigDecimal("-123.456"))).toBe(-123n);
    });

    it("extracts fractional part", () => {
      const frac = fractionalPart(bigDecimal("123.456"));
      expect(toNumber(frac)).toBeCloseTo(0.456);
    });
  });

  describe("pow", () => {
    it("raises to non-negative power", () => {
      const result = pow(bigDecimal("2"), 3);
      expect(toNumber(result)).toBe(8);
    });

    it("handles power of 0", () => {
      const result = pow(bigDecimal("5"), 0);
      expect(toNumber(result)).toBe(1);
    });

    it("handles decimals", () => {
      const result = pow(bigDecimal("1.1"), 2);
      expect(toNumber(result)).toBeCloseTo(1.21);
    });

    it("throws on negative exponent", () => {
      expect(() => pow(bigDecimal("2"), -1)).toThrow();
    });
  });

  describe("min and max", () => {
    it("returns minimum", () => {
      expect(toNumber(min(bigDecimal("1.5"), bigDecimal("2.5")))).toBe(1.5);
    });

    it("returns maximum", () => {
      expect(toNumber(max(bigDecimal("1.5"), bigDecimal("2.5")))).toBe(2.5);
    });
  });

  describe("compareMagnitude", () => {
    it("compares absolute values", () => {
      expect(compareMagnitude(bigDecimal("-5"), bigDecimal("3"))).toBe(1);
      expect(compareMagnitude(bigDecimal("3"), bigDecimal("-5"))).toBe(-1);
    });
  });

  describe("typeclass laws", () => {
    const N = numericBigDecimal;
    const a = bigDecimal("1.5");
    const b = bigDecimal("2.5");
    const c = bigDecimal("3.5");

    describe("addition", () => {
      it("is associative", () => {
        const left = N.add(N.add(a, b), c);
        const right = N.add(a, N.add(b, c));
        expect(equals(left, right)).toBe(true);
      });

      it("is commutative", () => {
        const left = N.add(a, b);
        const right = N.add(b, a);
        expect(equals(left, right)).toBe(true);
      });

      it("has identity", () => {
        expect(equals(N.add(a, N.zero()), a)).toBe(true);
      });
    });

    describe("multiplication", () => {
      it("is associative", () => {
        const left = N.mul(N.mul(a, b), c);
        const right = N.mul(a, N.mul(b, c));
        expect(equals(left, right)).toBe(true);
      });

      it("is commutative", () => {
        const left = N.mul(a, b);
        const right = N.mul(b, a);
        expect(equals(left, right)).toBe(true);
      });

      it("has identity", () => {
        expect(equals(N.mul(a, N.one()), a)).toBe(true);
      });

      it("distributes over addition", () => {
        const left = N.mul(a, N.add(b, c));
        const right = N.add(N.mul(a, b), N.mul(a, c));
        expect(equals(left, right)).toBe(true);
      });
    });
  });
});
