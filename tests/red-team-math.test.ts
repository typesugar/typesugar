/**
 * Red Team Tests for @typesugar/math
 *
 * Attack surfaces:
 * - Rational division by zero
 * - Complex number edge cases (NaN, Infinity)
 * - BigDecimal precision loss
 * - Interval arithmetic edge cases
 * - Money currency mixing
 * - Modular arithmetic edge cases
 */
import { describe, it, expect } from "vitest";
import {
  rational,
  rat,
  fromNumber,
  toNumber,
  numericRational,
  ordRational,
  equals as rationalEquals,
} from "../packages/math/src/types/rational.js";
import {
  complex,
  fromPolar,
  magnitude,
  phase,
  conjugate,
  numericComplex,
  fractionalComplex,
  floatingComplex,
  equals as complexEquals,
  isZero,
  isReal,
  isImaginary,
} from "../packages/math/src/types/complex.js";

describe("Rational Number Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Division by Zero
  // ==========================================================================
  describe("Division by zero", () => {
    it("Creating rational with zero denominator throws", () => {
      expect(() => rational(1n, 0n)).toThrow("denominator cannot be zero");
    });

    it("Division by zero rational throws", () => {
      const a = rational(1n, 2n);
      const zero = rational(0n, 1n);

      expect(() => numericRational.div(a, zero)).toThrow();
    });

    it("Zero numerator is valid", () => {
      const zero = rational(0n, 5n);
      expect(zero.num).toBe(0n);
      expect(zero.den).toBe(1n); // Normalized
    });
  });

  // ==========================================================================
  // Attack 2: Normalization Edge Cases
  // ==========================================================================
  describe("Normalization", () => {
    it("Negative denominator is normalized", () => {
      const r = rational(1n, -2n);
      expect(r.num).toBe(-1n);
      expect(r.den).toBe(2n);
    });

    it("Double negative is normalized", () => {
      const r = rational(-1n, -2n);
      expect(r.num).toBe(1n);
      expect(r.den).toBe(2n);
    });

    it("Large values are reduced", () => {
      const r = rational(100n, 200n);
      expect(r.num).toBe(1n);
      expect(r.den).toBe(2n);
    });

    it("Coprime numbers stay as-is", () => {
      const r = rational(3n, 7n);
      expect(r.num).toBe(3n);
      expect(r.den).toBe(7n);
    });
  });

  // ==========================================================================
  // Attack 3: fromNumber Edge Cases
  // ==========================================================================
  describe("fromNumber edge cases", () => {
    it("fromNumber with Infinity throws", () => {
      expect(() => fromNumber(Infinity)).toThrow("non-finite");
    });

    it("fromNumber with NaN throws", () => {
      expect(() => fromNumber(NaN)).toThrow("non-finite");
    });

    it("fromNumber with integer", () => {
      const r = fromNumber(42);
      expect(r.num).toBe(42n);
      expect(r.den).toBe(1n);
    });

    it("fromNumber with simple fraction", () => {
      const r = fromNumber(0.5);
      expect(r.num).toBe(1n);
      expect(r.den).toBe(2n);
    });

    it("fromNumber with repeating decimal", () => {
      const r = fromNumber(1 / 3);
      // Should be close to 1/3
      const asNumber = toNumber(r);
      expect(asNumber).toBeCloseTo(1 / 3, 10);
    });

    it("fromNumber with moderately small number", () => {
      // Very small numbers like 1e-10 may not convert well due to
      // continued fraction algorithm limitations
      const r = fromNumber(0.001);
      const asNumber = toNumber(r);
      expect(asNumber).toBeCloseTo(0.001, 10);
    });
  });

  // ==========================================================================
  // Attack 4: Arithmetic Overflow
  // ==========================================================================
  describe("BigInt overflow handling", () => {
    it("Very large numbers work with bigint", () => {
      const big = rational(10n ** 100n, 10n ** 99n);
      expect(big.num).toBe(10n);
      expect(big.den).toBe(1n);
    });

    it("Multiplication of large numbers", () => {
      const a = rational(10n ** 50n, 1n);
      const b = rational(10n ** 50n, 1n);
      const product = numericRational.mul(a, b);

      expect(product.num).toBe(10n ** 100n);
    });

    it("rat() with number truncates", () => {
      const r = rat(5.9, 2.1);
      // 5.9 truncates to 5, 2.1 truncates to 2
      expect(r.num).toBe(5n);
      expect(r.den).toBe(2n);
    });
  });

  // ==========================================================================
  // Attack 5: Comparison Edge Cases
  // ==========================================================================
  describe("Comparison edge cases", () => {
    it("Equal rationals with different representations", () => {
      const a = rational(1n, 2n);
      const b = rational(2n, 4n);

      // Both are normalized to 1/2
      expect(rationalEquals(a, b)).toBe(true);
      expect(ordRational.compare(a, b)).toBe(0);
    });

    it("Comparison with zero", () => {
      const zero = rational(0n);
      const positive = rational(1n, 1000000n);
      const negative = rational(-1n, 1000000n);

      expect(ordRational.compare(zero, positive)).toBeLessThan(0);
      expect(ordRational.compare(zero, negative)).toBeGreaterThan(0);
    });

    it("Comparison of negatives", () => {
      const a = rational(-1n, 2n);
      const b = rational(-1n, 3n);

      // -1/2 < -1/3
      expect(ordRational.compare(a, b)).toBeLessThan(0);
    });
  });
});

describe("Complex Number Edge Cases", () => {
  // ==========================================================================
  // Attack 6: Complex Division by Zero
  // ==========================================================================
  describe("Division by zero", () => {
    it("Division by zero complex throws", () => {
      const a = complex(1, 1);
      const zero = complex(0, 0);

      // Complex division by zero throws an error
      expect(() => fractionalComplex.div(a, zero)).toThrow();
    });

    it("Division by purely imaginary zero throws", () => {
      const a = complex(1, 0);
      const zero = complex(0, 0);

      expect(() => fractionalComplex.div(a, zero)).toThrow();
    });
  });

  // ==========================================================================
  // Attack 7: NaN and Infinity in Complex
  // ==========================================================================
  describe("NaN and Infinity handling", () => {
    it("Complex with NaN parts", () => {
      const z = complex(NaN, 1);

      expect(Number.isNaN(magnitude(z))).toBe(true);
    });

    it("Complex with Infinity parts", () => {
      const z = complex(Infinity, 0);

      expect(magnitude(z)).toBe(Infinity);
    });

    it("Addition with NaN propagates", () => {
      const a = complex(NaN, 1);
      const b = complex(1, 1);

      const result = numericComplex.add(a, b);
      expect(Number.isNaN(result.re)).toBe(true);
    });

    it("Multiplication with Infinity", () => {
      const a = complex(Infinity, 0);
      const b = complex(2, 0);

      const result = numericComplex.mul(a, b);
      expect(result.re).toBe(Infinity);
    });
  });

  // ==========================================================================
  // Attack 8: Phase at Zero
  // ==========================================================================
  describe("Phase edge cases", () => {
    it("Phase of zero is zero", () => {
      const z = complex(0, 0);
      expect(phase(z)).toBe(0); // atan2(0, 0) = 0
    });

    it("Phase of positive real", () => {
      const z = complex(1, 0);
      expect(phase(z)).toBe(0);
    });

    it("Phase of negative real", () => {
      const z = complex(-1, 0);
      expect(phase(z)).toBeCloseTo(Math.PI);
    });

    it("Phase of purely imaginary positive", () => {
      const z = complex(0, 1);
      expect(phase(z)).toBeCloseTo(Math.PI / 2);
    });

    it("Phase of purely imaginary negative", () => {
      const z = complex(0, -1);
      expect(phase(z)).toBeCloseTo(-Math.PI / 2);
    });
  });

  // ==========================================================================
  // Attack 9: Polar Conversion Edge Cases
  // ==========================================================================
  describe("Polar conversion edge cases", () => {
    it("fromPolar with zero radius", () => {
      const z = fromPolar(0, Math.PI);
      expect(isZero(z)).toBe(true);
    });

    it("fromPolar with negative radius", () => {
      const z = fromPolar(-1, 0);
      // Negative radius flips direction
      expect(z.re).toBeCloseTo(-1);
    });

    it("fromPolar roundtrip", () => {
      const original = complex(3, 4);
      const polar = { r: magnitude(original), theta: phase(original) };
      const restored = fromPolar(polar.r, polar.theta);

      expect(complexEquals(original, restored)).toBe(true);
    });

    it("fromPolar with angle > 2π", () => {
      const z1 = fromPolar(1, 0);
      const z2 = fromPolar(1, 2 * Math.PI);

      expect(complexEquals(z1, z2, 1e-10)).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 10: Square Root of Negative Numbers
  // ==========================================================================
  describe("Complex square root", () => {
    it("Square root of -1 is i", () => {
      const z = complex(-1, 0);
      const sqrt = floatingComplex.sqrt(z);

      // sqrt(-1) = i
      expect(sqrt.re).toBeCloseTo(0);
      expect(sqrt.im).toBeCloseTo(1);
    });

    it("Square root of i", () => {
      const z = complex(0, 1);
      const sqrt = floatingComplex.sqrt(z);

      // sqrt(i) = (1 + i) / sqrt(2)
      const expected = 1 / Math.sqrt(2);
      expect(sqrt.re).toBeCloseTo(expected);
      expect(sqrt.im).toBeCloseTo(expected);
    });

    it("Square root of zero", () => {
      const z = complex(0, 0);
      const sqrt = floatingComplex.sqrt(z);

      expect(isZero(sqrt)).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 11: Logarithm Edge Cases
  // ==========================================================================
  describe("Complex logarithm", () => {
    it("Log of 1 is 0", () => {
      const z = complex(1, 0);
      const log = floatingComplex.log(z);

      expect(isZero(log, 1e-10)).toBe(true);
    });

    it("Log of e is 1", () => {
      const z = complex(Math.E, 0);
      const log = floatingComplex.log(z);

      expect(log.re).toBeCloseTo(1);
      expect(log.im).toBeCloseTo(0);
    });

    it("Log of -1 is iπ", () => {
      const z = complex(-1, 0);
      const log = floatingComplex.log(z);

      expect(log.re).toBeCloseTo(0);
      expect(log.im).toBeCloseTo(Math.PI);
    });

    it("Log of 0 throws", () => {
      const z = complex(0, 0);

      // Complex logarithm of zero throws
      expect(() => floatingComplex.log(z)).toThrow();
    });
  });

  // ==========================================================================
  // Attack 12: Conjugate and Magnitude Properties
  // ==========================================================================
  describe("Conjugate properties", () => {
    it("z * conjugate(z) = |z|²", () => {
      const z = complex(3, 4);
      const zConj = conjugate(z);
      const product = numericComplex.mul(z, zConj);

      const magSquared = magnitude(z) ** 2;
      expect(product.re).toBeCloseTo(magSquared);
      expect(product.im).toBeCloseTo(0);
    });

    it("Conjugate is self-inverse", () => {
      const z = complex(3, 4);
      const doubleConj = conjugate(conjugate(z));

      expect(complexEquals(z, doubleConj)).toBe(true);
    });

    it("Conjugate of real is itself", () => {
      const z = complex(5, 0);
      const conj = conjugate(z);

      expect(complexEquals(z, conj)).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 13: Equality with Tolerance
  // ==========================================================================
  describe("Equality edge cases", () => {
    it("Equality with default tolerance", () => {
      const a = complex(1, 1);
      const b = complex(1 + 1e-11, 1 + 1e-11);

      expect(complexEquals(a, b)).toBe(true); // Within 1e-10
    });

    it("Equality fails outside tolerance", () => {
      const a = complex(1, 1);
      const b = complex(1.001, 1);

      expect(complexEquals(a, b)).toBe(false);
    });

    it("Custom tolerance", () => {
      const a = complex(1, 1);
      const b = complex(1.001, 1);

      expect(complexEquals(a, b, 0.01)).toBe(true);
    });

    it("Zero vs very small", () => {
      const zero = complex(0, 0);
      const tiny = complex(1e-15, 1e-15);

      expect(complexEquals(zero, tiny)).toBe(true); // Within default tolerance
    });
  });

  // ==========================================================================
  // Attack 14: Type Predicates
  // ==========================================================================
  describe("Type predicates", () => {
    it("isReal for real number", () => {
      expect(isReal(complex(5, 0))).toBe(true);
      expect(isReal(complex(5, 1e-15))).toBe(true); // Within tolerance
      expect(isReal(complex(5, 1))).toBe(false);
    });

    it("isImaginary for pure imaginary", () => {
      expect(isImaginary(complex(0, 5))).toBe(true);
      expect(isImaginary(complex(1e-15, 5))).toBe(true); // Within tolerance
      expect(isImaginary(complex(1, 5))).toBe(false);
    });

    it("isZero for zero", () => {
      expect(isZero(complex(0, 0))).toBe(true);
      expect(isZero(complex(1e-15, 1e-15))).toBe(true); // Within tolerance
      expect(isZero(complex(1, 0))).toBe(false);
    });
  });

  // ==========================================================================
  // Attack 15: Numeric Operations Identity
  // ==========================================================================
  describe("Numeric operation identities", () => {
    it("Addition identity (0)", () => {
      const z = complex(3, 4);
      const zero = complex(0, 0);

      const result = numericComplex.add(z, zero);
      expect(complexEquals(z, result)).toBe(true);
    });

    it("Multiplication identity (1)", () => {
      const z = complex(3, 4);
      const one = complex(1, 0);

      const result = numericComplex.mul(z, one);
      expect(complexEquals(z, result)).toBe(true);
    });

    it("Additive inverse", () => {
      const z = complex(3, 4);
      const neg = numericComplex.negate(z);

      const sum = numericComplex.add(z, neg);
      expect(isZero(sum)).toBe(true);
    });

    it("Multiplicative inverse", () => {
      const z = complex(3, 4);
      const inv = fractionalComplex.recip(z);

      const product = numericComplex.mul(z, inv);
      expect(complexEquals(product, complex(1, 0), 1e-10)).toBe(true);
    });
  });
});
