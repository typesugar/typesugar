/**
 * MU-4 (HALF_CEIL wrong for negatives in all three rounding implementations)
 * and MU-8 (moneyDivide bigint branch: HALF_UP/HALF_CEIL/HALF_FLOOR wrong for
 * odd divisors). Property-style: every mode is checked against an independent
 * exact reference (tests/helpers/reference.ts) over random bigints.
 */
import { describe, it, expect } from "vitest";
import { roundBigInt, roundNumber, type RoundingMode } from "../src/types/rounding.js";
import { fixedDiv, fixedMul, type FixedDecimal } from "../src/types/fixed-decimal.js";
import { moneyDivide, type Money } from "../src/types/money.js";
import { USD } from "../src/types/currencies.js";
import { ALL_MODES, refRoundDiv, prng, randBig } from "./helpers/reference.js";

describe("MU-4: HALF_CEIL on negative values", () => {
  it("roundBigInt(-27n, 0, 1, HALF_CEIL) is -3n", () => {
    expect(roundBigInt(-27n, 0, 1, "HALF_CEIL")).toBe(-3n);
    expect(roundBigInt(-25n, 0, 1, "HALF_CEIL")).toBe(-2n);
    expect(roundBigInt(-23n, 0, 1, "HALF_CEIL")).toBe(-2n);
  });

  it("fixedDiv(-27n, 10n, 0, HALF_CEIL) is -3n", () => {
    expect(fixedDiv(-27n as FixedDecimal<0>, 10n as FixedDecimal<0>, 0, "HALF_CEIL")).toBe(-3n);
  });

  it("roundNumber matches the mode table for ±2.3 / ±2.5 / ±2.7", () => {
    const expected: Record<RoundingMode, number[]> = {
      //          2.3 2.5 2.7 -2.3 -2.5 -2.7
      HALF_UP: [2, 3, 3, -2, -3, -3],
      HALF_DOWN: [2, 2, 3, -2, -2, -3],
      HALF_EVEN: [2, 2, 3, -2, -2, -3],
      CEIL: [3, 3, 3, -2, -2, -2],
      FLOOR: [2, 2, 2, -3, -3, -3],
      TRUNC: [2, 2, 2, -2, -2, -2],
      HALF_CEIL: [2, 3, 3, -2, -2, -3],
      HALF_FLOOR: [2, 2, 3, -2, -3, -3],
    };
    const inputs = [2.3, 2.5, 2.7, -2.3, -2.5, -2.7];
    for (const mode of ALL_MODES) {
      const got = inputs.map((x) => roundNumber(x, 0, mode) + 0); // +0 folds -0
      expect({ mode, got }).toEqual({ mode, got: expected[mode] });
    }
  });
});

describe("roundBigInt / fixedDiv / fixedMul agree with the exact reference (all modes)", () => {
  const rand = prng(0x5eed);
  it("roundBigInt", () => {
    for (let i = 0; i < 3000; i++) {
      const v = randBig(rand, 10n ** 12n);
      const from = Math.floor(rand() * 6);
      const to = Math.floor(rand() * (from + 1));
      for (const mode of ALL_MODES) {
        const want = refRoundDiv(v, 10n ** BigInt(from - to), mode);
        const got = roundBigInt(v, to, from, mode);
        if (got !== want)
          expect({ v, to, from, mode, got }).toEqual({ v, to, from, mode, got: want });
      }
    }
  });

  it("fixedDiv (any divisor, including odd and negative)", () => {
    for (let i = 0; i < 3000; i++) {
      const a = randBig(rand, 10n ** 9n);
      let b = randBig(rand, 10n ** 6n);
      if (b === 0n) b = 7n;
      const scale = Math.floor(rand() * 4);
      for (const mode of ALL_MODES) {
        const want = refRoundDiv(a * 10n ** BigInt(scale), b, mode);
        const got = fixedDiv(a as FixedDecimal<number>, b as FixedDecimal<number>, scale, mode);
        if (got !== want)
          expect({ a, b, scale, mode, got }).toEqual({ a, b, scale, mode, got: want });
      }
    }
  });

  it("fixedMul", () => {
    for (let i = 0; i < 2000; i++) {
      const a = randBig(rand, 10n ** 9n);
      const b = randBig(rand, 10n ** 9n);
      const scale = Math.floor(rand() * 4);
      for (const mode of ALL_MODES) {
        const want = refRoundDiv(a * b, 10n ** BigInt(scale), mode);
        const got = fixedMul(a as FixedDecimal<number>, b as FixedDecimal<number>, scale, mode);
        if (got !== want)
          expect({ a, b, scale, mode, got }).toEqual({ a, b, scale, mode, got: want });
      }
    }
  });
});

describe("MU-8: moneyDivide with a bigint divisor", () => {
  it("10n / 3n rounds 3.33 to 3 under HALF_UP and HALF_CEIL", () => {
    expect(moneyDivide(10n as Money<typeof USD>, 3n, USD, "HALF_UP")).toBe(3n);
    expect(moneyDivide(10n as Money<typeof USD>, 3n, USD, "HALF_CEIL")).toBe(3n);
    expect(moneyDivide(-5n as Money<typeof USD>, 2n, USD, "HALF_CEIL")).toBe(-2n);
    expect(moneyDivide(-5n as Money<typeof USD>, 2n, USD, "HALF_FLOOR")).toBe(-3n);
  });

  it("agrees with the exact reference for every mode", () => {
    const rand = prng(0xc0ffee);
    for (let i = 0; i < 3000; i++) {
      const m = randBig(rand, 10n ** 12n);
      let d = randBig(rand, 10n ** 4n);
      if (d === 0n) d = 3n;
      for (const mode of ALL_MODES) {
        const want = refRoundDiv(m, d, mode);
        const got = moneyDivide(m as Money<typeof USD>, d, USD, mode);
        if (got !== want) expect({ m, d, mode, got }).toEqual({ m, d, mode, got: want });
      }
    }
  });
});
