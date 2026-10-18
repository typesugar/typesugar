/**
 * MU-6: divPoly / gcdPoly must terminate for non-number coefficients and
 * give the right quotient for float coefficients.
 */
import { describe, it, expect } from "vitest";
import {
  polynomial,
  divPoly,
  gcdPoly,
  subPoly,
  addPoly,
  mulPoly,
  isZero as isZeroPoly,
  degree,
} from "../src/types/polynomial.js";
import {
  rational,
  numericRational,
  fractionalRational,
  type Rational,
} from "../src/types/rational.js";
import { prng } from "./helpers/reference.js";

const R = (n: bigint, d: bigint = 1n) => rational(n, d);
const numericNumber = {
  add: (a: number, b: number) => a + b,
  sub: (a: number, b: number) => a - b,
  mul: (a: number, b: number) => a * b,
  div: (a: number, b: number) => a / b,
  pow: (a: number, b: number) => a ** b,
  negate: (a: number) => -a,
  abs: Math.abs,
  signum: Math.sign,
  fromNumber: (n: number) => n,
  toNumber: (a: number) => a,
  zero: () => 0,
  one: () => 1,
};
const fractionalNumber = {
  div: (a: number, b: number) => a / b,
  recip: (a: number) => 1 / a,
  fromRational: (n: number, d: number) => n / d,
};

describe("MU-6: polynomial division", () => {
  it("(x^2+2x+1) / (x+1) over Rational terminates with q = x+1, r = 0", () => {
    const p = polynomial([R(1n), R(2n), R(1n)]);
    const b = polynomial([R(1n), R(1n)]);
    const [q, r] = divPoly(p, b, numericRational, fractionalRational);
    expect(q.coeffs).toEqual([R(1n), R(1n)]);
    expect(isZeroPoly(r)).toBe(true);
  });

  it("p - p over Rational is the zero polynomial", () => {
    const p = polynomial([R(1n), R(2n), R(1n)]);
    expect(isZeroPoly(subPoly(p, p, numericRational))).toBe(true);
  });

  it("float coefficients: (1 + 0.1x) / (1 + 0.7999999999999999x) has q ≈ 0.125", () => {
    const [q] = divPoly(
      polynomial([1, 0.1]),
      polynomial([1, 0.7999999999999999]),
      numericNumber,
      fractionalNumber
    );
    expect(q.coeffs.length).toBe(1);
    expect(q.coeffs[0]).toBeCloseTo(0.125, 12);
  });

  it("gcdPoly over Rational terminates and is monic", () => {
    // (x+1)(x+2) and (x+1)(x+3)  → gcd x+1
    const a = polynomial([R(2n), R(3n), R(1n)]);
    const b = polynomial([R(3n), R(4n), R(1n)]);
    const g = gcdPoly(a, b, numericRational, fractionalRational);
    expect(g.coeffs).toEqual([R(1n), R(1n)]);
  });

  it("property: a = q·b + r with deg r < deg b, exactly, over Rational", () => {
    const rand = prng(6);
    const rr = (): Rational =>
      R(BigInt(Math.floor(rand() * 21) - 10), BigInt(1 + Math.floor(rand() * 5)));
    for (let i = 0; i < 200; i++) {
      const a = polynomial(Array.from({ length: 1 + Math.floor(rand() * 7) }, rr));
      let bc = Array.from({ length: 1 + Math.floor(rand() * 4) }, rr);
      if (bc.every((c) => c.num === 0n)) bc = [R(1n)];
      const b = polynomial(bc);
      if (isZeroPoly(b)) continue;
      const [q, r] = divPoly(a, b, numericRational, fractionalRational);
      expect(isZeroPoly(r) || degree(r) < degree(b)).toBe(true);
      const back = addPoly(mulPoly(q, b, numericRational), r, numericRational);
      expect(isZeroPoly(subPoly(back, a, numericRational))).toBe(true);
    }
  });
});
