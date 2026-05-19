/**
 * Tests for generic numeric operations: gcdWith, lcmWith, pow, powFrac.
 *
 * PEP-039 Wave 5 — verifies correctness of the generic numeric algorithms
 * across both `number` and `bigint` Numeric/Integral instances.
 */

import { describe, it, expect } from "vitest";
import { gcdWith, lcmWith, pow, powFrac, sum, product } from "../src/typeclasses/numeric-ops.js";
import {
  numericNumber,
  numericBigInt,
  integralNumber,
  integralBigInt,
  fractionalNumber,
} from "../src/typeclasses/index.js";

describe("gcdWith", () => {
  it("gcd(0, 0) === 0", () => {
    expect(gcdWith(0, 0, numericNumber, integralNumber)).toBe(0);
  });

  it("gcd(0, n) === |n| for n > 0", () => {
    expect(gcdWith(0, 12, numericNumber, integralNumber)).toBe(12);
    expect(gcdWith(0, 7, numericNumber, integralNumber)).toBe(7);
    expect(gcdWith(0, 1, numericNumber, integralNumber)).toBe(1);
  });

  it("gcd(n, 0) === |n| for n > 0", () => {
    expect(gcdWith(12, 0, numericNumber, integralNumber)).toBe(12);
    expect(gcdWith(7, 0, numericNumber, integralNumber)).toBe(7);
  });

  it("gcd(12, 18) === 6", () => {
    expect(gcdWith(12, 18, numericNumber, integralNumber)).toBe(6);
  });

  it("gcd(48, 18) === 6", () => {
    expect(gcdWith(48, 18, numericNumber, integralNumber)).toBe(6);
  });

  it("gcd is commutative", () => {
    expect(gcdWith(18, 12, numericNumber, integralNumber)).toBe(
      gcdWith(12, 18, numericNumber, integralNumber)
    );
  });

  it("gcd takes absolute value of negatives", () => {
    expect(gcdWith(-12, 18, numericNumber, integralNumber)).toBe(6);
    expect(gcdWith(12, -18, numericNumber, integralNumber)).toBe(6);
    expect(gcdWith(-12, -18, numericNumber, integralNumber)).toBe(6);
  });

  it("gcd(coprime, coprime) === 1", () => {
    expect(gcdWith(7, 11, numericNumber, integralNumber)).toBe(1);
    expect(gcdWith(13, 17, numericNumber, integralNumber)).toBe(1);
  });

  it("gcd(n, n) === n", () => {
    expect(gcdWith(5, 5, numericNumber, integralNumber)).toBe(5);
    expect(gcdWith(100, 100, numericNumber, integralNumber)).toBe(100);
  });

  it("works for bigint", () => {
    expect(gcdWith(12n, 18n, numericBigInt, integralBigInt)).toBe(6n);
    expect(gcdWith(0n, 12n, numericBigInt, integralBigInt)).toBe(12n);
    expect(gcdWith(-12n, 18n, numericBigInt, integralBigInt)).toBe(6n);
  });
});

describe("lcmWith", () => {
  it("lcm(0, n) === 0", () => {
    expect(lcmWith(0, 5, numericNumber, integralNumber)).toBe(0);
    expect(lcmWith(0, 12, numericNumber, integralNumber)).toBe(0);
  });

  it("lcm(n, 0) === 0", () => {
    expect(lcmWith(5, 0, numericNumber, integralNumber)).toBe(0);
    expect(lcmWith(12, 0, numericNumber, integralNumber)).toBe(0);
  });

  it("lcm(0, 0) === 0", () => {
    expect(lcmWith(0, 0, numericNumber, integralNumber)).toBe(0);
  });

  it("lcm(12, 18) === 36", () => {
    expect(lcmWith(12, 18, numericNumber, integralNumber)).toBe(36);
  });

  it("lcm(1, n) === n", () => {
    expect(lcmWith(1, 5, numericNumber, integralNumber)).toBe(5);
    expect(lcmWith(1, 12, numericNumber, integralNumber)).toBe(12);
  });

  it("lcm(n, 1) === n", () => {
    expect(lcmWith(5, 1, numericNumber, integralNumber)).toBe(5);
    expect(lcmWith(12, 1, numericNumber, integralNumber)).toBe(12);
  });

  it("lcm of coprimes is their product", () => {
    expect(lcmWith(3, 7, numericNumber, integralNumber)).toBe(21);
    expect(lcmWith(5, 11, numericNumber, integralNumber)).toBe(55);
  });

  it("lcm(n, n) === n", () => {
    expect(lcmWith(5, 5, numericNumber, integralNumber)).toBe(5);
  });

  it("works for bigint", () => {
    expect(lcmWith(12n, 18n, numericBigInt, integralBigInt)).toBe(36n);
    expect(lcmWith(0n, 5n, numericBigInt, integralBigInt)).toBe(0n);
  });
});

describe("pow", () => {
  it("pow(n, 0) === 1 for any n (including n=0 by convention)", () => {
    expect(pow(0, 0, numericNumber)).toBe(1);
    expect(pow(5, 0, numericNumber)).toBe(1);
    expect(pow(-3, 0, numericNumber)).toBe(1);
  });

  it("pow(0, n) === 0 for n > 0", () => {
    expect(pow(0, 1, numericNumber)).toBe(0);
    expect(pow(0, 5, numericNumber)).toBe(0);
    expect(pow(0, 10, numericNumber)).toBe(0);
  });

  it("pow(n, 1) === n", () => {
    expect(pow(2, 1, numericNumber)).toBe(2);
    expect(pow(7, 1, numericNumber)).toBe(7);
    expect(pow(-3, 1, numericNumber)).toBe(-3);
  });

  it("pow(2, n) === 2^n", () => {
    expect(pow(2, 2, numericNumber)).toBe(4);
    expect(pow(2, 3, numericNumber)).toBe(8);
    expect(pow(2, 10, numericNumber)).toBe(1024);
    expect(pow(2, 16, numericNumber)).toBe(65536);
  });

  it("pow(3, 4) === 81", () => {
    expect(pow(3, 4, numericNumber)).toBe(81);
  });

  it("pow(-2, 3) === -8 (odd exponent preserves sign)", () => {
    expect(pow(-2, 3, numericNumber)).toBe(-8);
  });

  it("pow(-2, 4) === 16 (even exponent removes sign)", () => {
    expect(pow(-2, 4, numericNumber)).toBe(16);
  });

  it("throws RangeError on negative exponent", () => {
    expect(() => pow(2, -1, numericNumber)).toThrow(RangeError);
    expect(() => pow(2, -5, numericNumber)).toThrow(/non-negative/);
  });

  it("works for bigint", () => {
    expect(pow(2n, 10, numericBigInt)).toBe(1024n);
    expect(pow(3n, 4, numericBigInt)).toBe(81n);
    expect(pow(0n, 0, numericBigInt)).toBe(1n);
    expect(pow(5n, 0, numericBigInt)).toBe(1n);
  });

  it("produces large bigint results without overflow", () => {
    expect(pow(2n, 64, numericBigInt)).toBe(18446744073709551616n);
  });
});

describe("powFrac", () => {
  it("agrees with pow for non-negative exponents", () => {
    expect(powFrac(2, 3, numericNumber, fractionalNumber)).toBe(8);
    expect(powFrac(5, 0, numericNumber, fractionalNumber)).toBe(1);
  });

  it("returns reciprocal for negative exponents", () => {
    expect(powFrac(2, -1, numericNumber, fractionalNumber)).toBe(0.5);
    expect(powFrac(2, -3, numericNumber, fractionalNumber)).toBe(0.125);
    expect(powFrac(4, -2, numericNumber, fractionalNumber)).toBe(0.0625);
  });

  it("pow(n, -k) * pow(n, k) === 1", () => {
    const result = powFrac(3, -2, numericNumber, fractionalNumber) * pow(3, 2, numericNumber);
    expect(result).toBeCloseTo(1);
  });
});

describe("sum / product (sanity)", () => {
  it("sum of empty iterable is zero", () => {
    expect(sum([], numericNumber)).toBe(0);
  });

  it("product of empty iterable is one", () => {
    expect(product([], numericNumber)).toBe(1);
  });

  it("sum([1..5]) === 15", () => {
    expect(sum([1, 2, 3, 4, 5], numericNumber)).toBe(15);
  });

  it("product([1..5]) === 120", () => {
    expect(product([1, 2, 3, 4, 5], numericNumber)).toBe(120);
  });

  it("works for bigint", () => {
    expect(sum([1n, 2n, 3n], numericBigInt)).toBe(6n);
    expect(product([1n, 2n, 3n, 4n], numericBigInt)).toBe(24n);
  });
});
