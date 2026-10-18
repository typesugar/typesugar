/**
 * MU-9 (`fixed("…e-N")` off by 10^(2N)), MU-10 (money string parsing lossy
 * and locale-wrong), MU-19 (lenient BigDecimal / Rational input).
 *
 * The exponent cases are checked property-style against exact bigint
 * arithmetic: for random mantissas and exponents, the parsed value must equal
 * the exact decimal value rounded once under the requested mode.
 */
import { describe, it, expect } from "vitest";
import { fixed, fixedToString } from "../src/types/fixed-decimal.js";
import { moneyFromMajor } from "../src/types/money.js";
import { USD, EUR, JPY } from "../src/types/currencies.js";
import { bigDecimal, toString as bdToString } from "../src/types/bigdecimal.js";
import { rational, rat, pow as rationalPow, numericRational } from "../src/types/rational.js";
import { ALL_MODES, refRoundDiv, prng } from "./helpers/reference.js";

describe("MU-9: fixed() with scientific notation", () => {
  it("negative exponents divide, not multiply", () => {
    expect(fixedToString(fixed("1e-2", 2), 2)).toBe("0.01");
    expect(fixedToString(fixed("1.5e-1", 2), 2)).toBe("0.15");
    expect(fixedToString(fixed("-2.5E-3", 4), 4)).toBe("-0.0025");
    expect(fixedToString(fixed("1.234e2", 2), 2)).toBe("123.40");
  });

  it("rounds the exact value once (property vs bigint reference)", () => {
    const rand = prng(42);
    for (let i = 0; i < 2000; i++) {
      const intDigits = String(Math.floor(rand() * 100000));
      const fracDigits = String(Math.floor(rand() * 1000));
      const exp = Math.floor(rand() * 13) - 6;
      const scale = Math.floor(rand() * 5);
      const neg = rand() < 0.5;
      const text = `${neg ? "-" : ""}${intDigits}.${fracDigits}e${exp}`;
      // exact value = mantissaUnscaled * 10^(exp - fracLen)
      let unscaled = BigInt(intDigits + fracDigits);
      if (neg) unscaled = -unscaled;
      const pow10 = scale + exp - fracDigits.length; // result = unscaled * 10^pow10 / 1
      for (const mode of ALL_MODES) {
        const want =
          pow10 >= 0
            ? unscaled * 10n ** BigInt(pow10)
            : refRoundDiv(unscaled, 10n ** BigInt(-pow10), mode);
        const got = fixed(text, scale, mode) as bigint;
        if (got !== want)
          expect({ text, scale, mode, got }).toEqual({ text, scale, mode, got: want });
      }
    }
  });

  it("rejects malformed numeric strings", () => {
    for (const bad of ["", "abc", "1e", "--5", "0x10", "1.2.3", "1e2.5", "+-1", "."]) {
      expect(() => fixed(bad, 2), bad).toThrow(RangeError);
    }
  });
});

describe("MU-10: money string parsing", () => {
  it("parses exactly (no float round-trip), including > 2^53 minor units", () => {
    expect(moneyFromMajor("12.34", USD)).toBe(1234n);
    expect(moneyFromMajor("$1,234.56", USD)).toBe(123456n);
    expect(moneyFromMajor("-$1,234.56", USD)).toBe(-123456n);
    expect(moneyFromMajor("1234.56 USD", USD)).toBe(123456n);
    expect(moneyFromMajor("€ 5", EUR)).toBe(500n);
    expect(moneyFromMajor("¥1,000", JPY)).toBe(1000n);
    expect(moneyFromMajor("123456789012345678.91", USD)).toBe(12345678901234567891n);
    expect(moneyFromMajor("1e3", USD)).toBe(100000n);
    expect(moneyFromMajor("0.125", USD, "HALF_UP")).toBe(13n);
    expect(moneyFromMajor("0.125", USD, "HALF_EVEN")).toBe(12n);
  });

  it("throws instead of misreading locale-ambiguous or malformed input", () => {
    for (const bad of [
      "1.234,56",
      "1,23",
      "12,34.5",
      "(12.34)",
      "",
      "abc",
      "1.2.3",
      "12-34",
      "$$5",
      "5 GBP",
    ]) {
      expect(() => moneyFromMajor(bad, USD), bad).toThrow(RangeError);
    }
  });
});

describe("MU-19: strict BigDecimal / Rational input", () => {
  it("bigDecimal(string) rejects malformed input", () => {
    for (const bad of ["", "  ", "0x10", "0b11", "--5", "+-5", "1e", "1e+", "1.2.3", "abc", "."]) {
      expect(() => bigDecimal(bad), bad).toThrow(RangeError);
    }
  });

  it("bigDecimal(string) still parses valid forms exactly", () => {
    expect(bdToString(bigDecimal("-12.340"))).toBe("-12.34");
    expect(bigDecimal(".5")).toEqual({ unscaled: 5n, scale: 1 });
    expect(bigDecimal("5.")).toEqual({ unscaled: 5n, scale: 0 });
    expect(bigDecimal("1.5e-3")).toEqual({ unscaled: 15n, scale: 4 });
    expect(bigDecimal("1e1")).toEqual({ unscaled: 1n, scale: -1 });
    expect(bigDecimal(1e21)).toEqual({ unscaled: 1n, scale: -21 });
  });

  it("rational/rat reject non-integer number arguments instead of truncating", () => {
    expect(() => rat(0.5)).toThrow(RangeError);
    expect(() => rational(1.5, 2)).toThrow(RangeError);
    expect(() => rat(1, 2.5)).toThrow(RangeError);
    expect(rat(3, 6)).toEqual({ num: 1n, den: 2n });
  });

  it("rational pow rejects non-integer exponents", () => {
    expect(() => rationalPow(rational(2n), 2.5)).toThrow(RangeError);
    expect(() => numericRational.pow(rational(2n), rational(5n, 2n))).toThrow(RangeError);
    expect(numericRational.pow(rational(2n), rational(3n))).toEqual({ num: 8n, den: 1n });
  });
});
