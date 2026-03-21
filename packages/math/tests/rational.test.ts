import { describe, it, expect } from "vitest";
import {
  rational,
  rat,
  fromNumber,
  toNumber,
  isInteger,
  toString,
  equals,
  isZero,
  isPositive,
  isNegative,
  floor,
  ceil,
  trunc,
  pow,
  numericRational,
  fractionalRational,
  ordRational,
  type Rational,
} from "../types/rational.js";

describe("Rational", () => {
  describe("construction", () => {
    it("creates rationals from bigints", () => {
      const r = rational(3n, 4n);
      expect(r.num).toBe(3n);
      expect(r.den).toBe(4n);
    });

    it("creates rationals from numbers", () => {
      const r = rational(3, 4);
      expect(r.num).toBe(3n);
      expect(r.den).toBe(4n);
    });

    it("reduces to lowest terms", () => {
      const r = rational(6n, 8n);
      expect(r.num).toBe(3n);
      expect(r.den).toBe(4n);
    });

    it("normalizes sign to numerator", () => {
      const r = rational(3n, -4n);
      expect(r.num).toBe(-3n);
      expect(r.den).toBe(4n);
    });

    it("handles negative numerator", () => {
      const r = rational(-6n, 8n);
      expect(r.num).toBe(-3n);
      expect(r.den).toBe(4n);
    });

    it("handles both negative", () => {
      const r = rational(-6n, -8n);
      expect(r.num).toBe(3n);
      expect(r.den).toBe(4n);
    });

    it("throws on zero denominator", () => {
      expect(() => rational(1n, 0n)).toThrow("denominator cannot be zero");
    });

    it("handles zero numerator", () => {
      const r = rational(0n, 5n);
      expect(r.num).toBe(0n);
      expect(r.den).toBe(1n);
    });
  });

  describe("rat() convenience constructor", () => {
    it("creates rationals from integers", () => {
      const r = rat(1, 2);
      expect(r.num).toBe(1n);
      expect(r.den).toBe(2n);
    });

    it("defaults denominator to 1", () => {
      const r = rat(5);
      expect(r.num).toBe(5n);
      expect(r.den).toBe(1n);
    });
  });

  describe("fromNumber", () => {
    it("converts integers exactly", () => {
      const r = fromNumber(42);
      expect(r.num).toBe(42n);
      expect(r.den).toBe(1n);
    });

    it("converts simple fractions", () => {
      const r = fromNumber(0.5);
      expect(r.num).toBe(1n);
      expect(r.den).toBe(2n);
    });

    it("approximates pi", () => {
      const r = fromNumber(Math.PI, 1000n);
      expect(Math.abs(toNumber(r) - Math.PI)).toBeLessThan(0.001);
    });

    it("handles negative numbers", () => {
      const r = fromNumber(-0.25);
      expect(r.num).toBe(-1n);
      expect(r.den).toBe(4n);
    });

    it("throws on non-finite", () => {
      expect(() => fromNumber(Infinity)).toThrow("non-finite");
      expect(() => fromNumber(NaN)).toThrow("non-finite");
    });
  });

  describe("toNumber", () => {
    it("converts to floating point", () => {
      expect(toNumber(rational(1n, 2n))).toBe(0.5);
      expect(toNumber(rational(3n, 4n))).toBe(0.75);
      expect(toNumber(rational(-1n, 4n))).toBe(-0.25);
    });
  });

  describe("predicates", () => {
    it("isInteger", () => {
      expect(isInteger(rational(5n, 1n))).toBe(true);
      expect(isInteger(rational(10n, 2n))).toBe(true);
      expect(isInteger(rational(1n, 2n))).toBe(false);
    });

    it("isZero", () => {
      expect(isZero(rational(0n, 1n))).toBe(true);
      expect(isZero(rational(1n, 1n))).toBe(false);
    });

    it("isPositive", () => {
      expect(isPositive(rational(1n, 2n))).toBe(true);
      expect(isPositive(rational(-1n, 2n))).toBe(false);
      expect(isPositive(rational(0n, 1n))).toBe(false);
    });

    it("isNegative", () => {
      expect(isNegative(rational(-1n, 2n))).toBe(true);
      expect(isNegative(rational(1n, 2n))).toBe(false);
      expect(isNegative(rational(0n, 1n))).toBe(false);
    });
  });

  describe("toString", () => {
    it("formats integers without denominator", () => {
      expect(toString(rational(5n, 1n))).toBe("5");
      expect(toString(rational(-3n, 1n))).toBe("-3");
    });

    it("formats fractions", () => {
      expect(toString(rational(1n, 2n))).toBe("1/2");
      expect(toString(rational(-3n, 4n))).toBe("-3/4");
    });
  });

  describe("numericRational", () => {
    const N = numericRational;
    const half = rational(1n, 2n);
    const third = rational(1n, 3n);
    const quarter = rational(1n, 4n);

    describe("add", () => {
      it("adds fractions", () => {
        const result = N.add(half, third);
        expect(result.num).toBe(5n);
        expect(result.den).toBe(6n);
      });

      it("handles negatives", () => {
        const result = N.add(half, rational(-1n, 2n));
        expect(isZero(result)).toBe(true);
      });
    });

    describe("sub", () => {
      it("subtracts fractions", () => {
        const result = N.sub(half, quarter);
        expect(result.num).toBe(1n);
        expect(result.den).toBe(4n);
      });
    });

    describe("mul", () => {
      it("multiplies fractions", () => {
        const result = N.mul(half, third);
        expect(result.num).toBe(1n);
        expect(result.den).toBe(6n);
      });
    });

    describe("negate", () => {
      it("negates", () => {
        const result = N.negate(half);
        expect(result.num).toBe(-1n);
        expect(result.den).toBe(2n);
      });
    });

    describe("abs", () => {
      it("returns absolute value", () => {
        const neg = rational(-3n, 4n);
        const result = N.abs(neg);
        expect(result.num).toBe(3n);
        expect(result.den).toBe(4n);
      });
    });

    describe("signum", () => {
      it("returns sign", () => {
        expect(N.signum(rational(5n, 1n)).num).toBe(1n);
        expect(N.signum(rational(-5n, 1n)).num).toBe(-1n);
        expect(N.signum(rational(0n, 1n)).num).toBe(0n);
      });
    });

    describe("zero and one", () => {
      it("zero is 0/1", () => {
        const z = N.zero();
        expect(z.num).toBe(0n);
        expect(z.den).toBe(1n);
      });

      it("one is 1/1", () => {
        const o = N.one();
        expect(o.num).toBe(1n);
        expect(o.den).toBe(1n);
      });
    });
  });

  describe("fractionalRational", () => {
    const F = fractionalRational;
    const half = rational(1n, 2n);
    const third = rational(1n, 3n);

    describe("div", () => {
      it("divides fractions", () => {
        const result = F.div(half, third);
        expect(result.num).toBe(3n);
        expect(result.den).toBe(2n);
      });

      it("throws on division by zero", () => {
        expect(() => F.div(half, rational(0n, 1n))).toThrow("division by zero");
      });
    });

    describe("recip", () => {
      it("computes reciprocal", () => {
        const result = F.recip(rational(3n, 4n));
        expect(result.num).toBe(4n);
        expect(result.den).toBe(3n);
      });

      it("throws on reciprocal of zero", () => {
        expect(() => F.recip(rational(0n, 1n))).toThrow("reciprocal of zero");
      });
    });

    describe("fromRational", () => {
      it("creates from number fraction", () => {
        const r = F.fromRational(3, 4);
        expect(r.num).toBe(3n);
        expect(r.den).toBe(4n);
      });
    });
  });

  describe("ordRational", () => {
    const O = ordRational;

    it("compares equal values", () => {
      expect(O.compare(rational(1n, 2n), rational(2n, 4n))).toBe(0);
    });

    it("compares less than", () => {
      expect(O.compare(rational(1n, 3n), rational(1n, 2n))).toBe(-1);
    });

    it("compares greater than", () => {
      expect(O.compare(rational(2n, 3n), rational(1n, 2n))).toBe(1);
    });

    it("handles negatives", () => {
      expect(O.compare(rational(-1n, 2n), rational(1n, 2n))).toBe(-1);
    });
  });

  describe("floor, ceil, trunc", () => {
    it("floor of positive", () => {
      expect(floor(rational(7n, 3n))).toBe(2n); // 7/3 = 2.33...
      expect(floor(rational(6n, 3n))).toBe(2n); // 6/3 = 2
    });

    it("floor of negative", () => {
      expect(floor(rational(-7n, 3n))).toBe(-3n); // -7/3 = -2.33... → -3
    });

    it("ceil of positive", () => {
      expect(ceil(rational(7n, 3n))).toBe(3n);
      expect(ceil(rational(6n, 3n))).toBe(2n);
    });

    it("ceil of negative", () => {
      expect(ceil(rational(-7n, 3n))).toBe(-2n);
    });

    it("trunc toward zero", () => {
      expect(trunc(rational(7n, 3n))).toBe(2n);
      expect(trunc(rational(-7n, 3n))).toBe(-2n);
    });
  });

  describe("pow", () => {
    const half = rational(1n, 2n);

    it("raises to positive powers", () => {
      const r = pow(half, 3);
      expect(r.num).toBe(1n);
      expect(r.den).toBe(8n);
    });

    it("handles power of zero", () => {
      const r = pow(half, 0);
      expect(r.num).toBe(1n);
      expect(r.den).toBe(1n);
    });

    it("handles negative powers", () => {
      const r = pow(rational(2n, 3n), -2);
      expect(r.num).toBe(9n);
      expect(r.den).toBe(4n);
    });

    it("throws on 0^negative", () => {
      expect(() => pow(rational(0n, 1n), -1)).toThrow();
    });
  });

  describe("typeclass laws", () => {
    const N = numericRational;
    const a = rational(1n, 2n);
    const b = rational(1n, 3n);
    const c = rational(1n, 4n);

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
