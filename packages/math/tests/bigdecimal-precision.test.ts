/**
 * MU-16: BigDecimal division precision and pow exponent handling.
 */
import { describe, it, expect } from "vitest";
import { bigDecimal, numericBigDecimal, toString as bdToString } from "../src/types/bigdecimal.js";
import { prng, randBig } from "./helpers/reference.js";

const N = numericBigDecimal;

describe("MU-16: BigDecimal division", () => {
  it("1 / a 30-digit divisor is not 0", () => {
    const q = N.div(bigDecimal("1"), bigDecimal("123456789012345678901234567890"));
    expect(q.unscaled).not.toBe(0n);
    // 1 / 1.2345678901234567890123456789e29 = 8.1000000729000006634e-30
    expect(bdToString(q)).toMatch(/^0\.0{29}81000000729000006633/);
  });

  it("quotient has >= 20 significant digits and truncation error < 1 ulp (property)", () => {
    const rand = prng(99);
    for (let i = 0; i < 1000; i++) {
      const a = bigDecimal(randBig(rand, 10n ** 30n) || 1n, Math.floor(rand() * 10));
      const bU = randBig(rand, 10n ** 40n) || 3n;
      const b = bigDecimal(bU, Math.floor(rand() * 10));
      const q = N.div(a, b);
      // exact check: |a/b - q| < 10^-q.scale  <=>  |a·10^.. - q·b| < |b|·10^..
      // a/b = (a.u / b.u) · 10^(b.s - a.s); q = q.u · 10^-q.s
      // compare a.u · 10^(q.s + b.s - a.s)  vs  q.u · b.u   (shift so exponents >= 0)
      const e = q.scale + b.scale - a.scale;
      const lhs = e >= 0 ? a.unscaled * 10n ** BigInt(e) : a.unscaled;
      const rhs = e >= 0 ? q.unscaled * b.unscaled : q.unscaled * b.unscaled * 10n ** BigInt(-e);
      const err = lhs - rhs;
      const bound = e >= 0 ? b.unscaled : b.unscaled * 10n ** BigInt(-e);
      expect((err < 0n ? -err : err) < (bound < 0n ? -bound : bound)).toBe(true);
      // >= 20 significant digits: relative error < 10^-19
      // (|err| / |lhs| < 10^-19; trailing zeros may have been normalized away,
      // so the digit count of q.unscaled itself is not the measure).
      const absErr = err < 0n ? -err : err;
      const absLhs = lhs < 0n ? -lhs : lhs;
      expect(absErr * 10n ** 19n < absLhs || absErr === 0n).toBe(true);
    }
  });
});

describe("MU-16: BigDecimal pow", () => {
  it("accepts integer exponents with negative or trailing-zero scale", () => {
    expect(bdToString(N.pow(bigDecimal("2"), bigDecimal("1e1")))).toBe("1024");
    expect(bdToString(N.pow(bigDecimal("2"), bigDecimal("3.0")))).toBe("8");
    expect(bdToString(N.pow(bigDecimal("2"), bigDecimal("-2")))).toBe("0.25");
  });

  it("rejects non-integer exponents instead of truncating", () => {
    expect(() => N.pow(bigDecimal("2"), bigDecimal("2.7"))).toThrow(RangeError);
  });
});
