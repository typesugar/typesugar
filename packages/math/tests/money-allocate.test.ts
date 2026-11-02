/**
 * MU-12: moneyAllocate with non-integer ratios, and remainder distribution.
 */
import { describe, it, expect } from "vitest";
import { moneyAllocate, type Money } from "../src/types/money.js";
import { USD } from "../src/types/currencies.js";
import { prng } from "./helpers/reference.js";

const m = (n: bigint) => n as Money<typeof USD>;

describe("MU-12: moneyAllocate", () => {
  it("accepts fractional ratios", () => {
    expect(moneyAllocate(m(100n), [0.3, 0.7], USD)).toEqual([30n, 70n]);
    expect(moneyAllocate(m(100n), [1.5, 1.5, 1], USD)).toEqual([38n, 37n, 25n]);
  });

  it("never gives remainder cents to a zero-ratio party", () => {
    const r = moneyAllocate(m(10n), [0, 3, 3, 3], USD);
    expect(r[0]).toBe(0n);
    expect(r.reduce((a, b) => a + b, 0n)).toBe(10n);
  });

  it("rejects negative or non-finite ratios", () => {
    expect(() => moneyAllocate(m(10n), [1, -1, 2], USD)).toThrow(RangeError);
    expect(() => moneyAllocate(m(10n), [1, NaN], USD)).toThrow(RangeError);
    expect(() => moneyAllocate(m(10n), [1, Infinity], USD)).toThrow(RangeError);
  });

  it("property: sums exactly, each share within 1 unit of its exact share, zero ratio gets 0", () => {
    const rand = prng(12);
    for (let i = 0; i < 1000; i++) {
      const n = 1 + Math.floor(rand() * 6);
      const ratios: number[] = Array.from({ length: n }, () =>
        rand() < 0.2 ? 0 : Math.round(rand() * 1000) / 100
      );
      if (!ratios.some((r) => r !== 0)) ratios[0] = 1;
      const amount = BigInt(Math.floor(rand() * 2e9)) * (rand() < 0.3 ? -1n : 1n);
      const out = moneyAllocate(m(amount), ratios, USD) as bigint[];
      expect(out.reduce((a, b) => a + b, 0n)).toBe(amount);
      // ratios are multiples of 0.01, so scale by 100 for an exact reference
      const w = ratios.map((r) => BigInt(Math.round(r * 100)));
      const total = w.reduce((a, b) => a + b, 0n);
      out.forEach((share, k) => {
        if (w[k] === 0n) expect(share).toBe(0n);
        // |share·total − amount·w| < total  (within one unit of the exact share)
        const diff = share * total - amount * w[k];
        expect((diff < 0n ? -diff : diff) < total).toBe(true);
      });
    }
  });
});
