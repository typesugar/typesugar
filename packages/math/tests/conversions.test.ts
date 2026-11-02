/**
 * MU-5 (`rationalToFixed` 10^10 too large) and MU-11 (conversions ignore
 * `mode` or go through float). Property-style against the exact reference:
 * converting an exact value to `s` places must equal the exact quotient
 * rounded once under the requested mode.
 */
import { describe, it, expect } from "vitest";
import {
  rationalToFixed,
  rationalToMoney,
  rationalToBigDecimal,
  bigDecimalToFixed,
  bigDecimalToMoney,
} from "../src/types/conversions.js";
import { rational } from "../src/types/rational.js";
import { bigDecimal } from "../src/types/bigdecimal.js";
import { fixedToString } from "../src/types/fixed-decimal.js";
import { USD, JPY, KWD } from "../src/types/currencies.js";
import { ALL_MODES, refRoundDiv, prng, randBig } from "./helpers/reference.js";

describe("MU-5: rationalToFixed", () => {
  it("1/3 at 2 places is 0.33", () => {
    expect(fixedToString(rationalToFixed(rational(1n, 3n), 2), 2)).toBe("0.33");
    expect(fixedToString(rationalToFixed(rational(-2n, 3n), 2, "HALF_UP"), 2)).toBe("-0.67");
  });
});

describe("MU-11: conversions honour mode and stay exact", () => {
  it("documented failure cases", () => {
    expect(bigDecimalToFixed(bigDecimal("1.239"), 2, "FLOOR")).toBe(123n);
    expect(rationalToMoney(rational(2n, 3n), USD, "HALF_UP")).toBe(67n);
    expect(bigDecimalToMoney(bigDecimal("1.005"), USD, "HALF_UP")).toBe(101n);
    expect(bigDecimalToMoney(bigDecimal("12345678901234567.89"), USD)).toBe(1234567890123456789n);
    expect(rationalToBigDecimal(rational(2n, 3n), 2, "HALF_UP")).toEqual({
      unscaled: 67n,
      scale: 2,
    });
    expect(bigDecimalToFixed(bigDecimal("1e2"), 1)).toBe(1000n); // negative source scale
  });

  it("rational → fixed / money / BigDecimal match the exact reference for all modes", () => {
    const rand = prng(7);
    for (let i = 0; i < 1500; i++) {
      const num = randBig(rand, 10n ** 15n);
      let den = randBig(rand, 10n ** 6n);
      if (den === 0n) den = 9n;
      const r = rational(num, den);
      const s = Math.floor(rand() * 5);
      for (const mode of ALL_MODES) {
        const want = refRoundDiv(r.num * 10n ** BigInt(s), r.den, mode);
        const got = {
          fixed: rationalToFixed(r, s, mode) as bigint,
          bd: rationalToBigDecimal(r, s, mode).unscaled,
        };
        if (got.fixed !== want || got.bd !== want)
          expect({ r, s, mode, got }).toEqual({ r, s, mode, got: { fixed: want, bd: want } });
        for (const cur of [USD, JPY, KWD]) {
          const wantM = refRoundDiv(r.num * 10n ** BigInt(cur.minorUnits), r.den, mode);
          const gotM = rationalToMoney(r, cur, mode) as bigint;
          if (gotM !== wantM)
            expect({ r, cur: cur.code, mode, gotM }).toEqual({
              r,
              cur: cur.code,
              mode,
              gotM: wantM,
            });
        }
      }
    }
  });

  it("BigDecimal → fixed / money match the exact reference for all modes", () => {
    const rand = prng(8);
    for (let i = 0; i < 1500; i++) {
      const unscaled = randBig(rand, 10n ** 24n);
      const scale = Math.floor(rand() * 9) - 2; // includes negative scales
      const bd = bigDecimal(unscaled, scale);
      const s = Math.floor(rand() * 5);
      for (const mode of ALL_MODES) {
        const exact = (target: number) =>
          target >= scale
            ? unscaled * 10n ** BigInt(target - scale)
            : refRoundDiv(unscaled, 10n ** BigInt(scale - target), mode);
        const gotF = bigDecimalToFixed(bd, s, mode) as bigint;
        if (gotF !== exact(s))
          expect({ bd, s, mode, gotF }).toEqual({ bd, s, mode, gotF: exact(s) });
        const gotM = bigDecimalToMoney(bd, USD, mode) as bigint;
        if (gotM !== exact(2)) expect({ bd, mode, gotM }).toEqual({ bd, mode, gotM: exact(2) });
      }
    }
  });
});
