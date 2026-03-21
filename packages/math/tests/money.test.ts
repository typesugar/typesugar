import { describe, it, expect } from "vitest";
import {
  money,
  moneyFromMajor,
  moneyZero,
  moneyAdd,
  moneySub,
  moneyNegate,
  moneyAbs,
  moneyScale,
  moneyDivide,
  moneyMin,
  moneyMax,
  moneySum,
  moneyPercentage,
  moneyAddPercentage,
  moneyAllocate,
  moneySplit,
  moneyConvert,
  moneyMinorUnits,
  moneyToMajor,
  moneyFormat,
  moneyToString,
  moneyCompare,
  moneyEquals,
  moneyIsZero,
  moneyIsPositive,
  moneyIsNegative,
  moneyNumeric,
  type Money,
} from "../types/money.js";
import { USD, EUR, JPY, GBP, KWD, BTC } from "../types/currencies.js";

describe("Money", () => {
  describe("construction", () => {
    it("creates from minor units", () => {
      const m = money(1299, USD);
      expect(moneyMinorUnits(m)).toBe(1299n);
    });

    it("creates from bigint", () => {
      const m = money(1299n, USD);
      expect(moneyMinorUnits(m)).toBe(1299n);
    });

    it("creates from major units", () => {
      const m = moneyFromMajor(12.99, USD);
      expect(moneyMinorUnits(m)).toBe(1299n);
    });

    it("creates from string", () => {
      const m = moneyFromMajor("12.99", USD);
      expect(moneyMinorUnits(m)).toBe(1299n);
    });

    it("handles zero-decimal currencies (JPY)", () => {
      const m = money(1000, JPY);
      expect(moneyToMajor(m, JPY)).toBe(1000);
    });

    it("handles 3-decimal currencies (KWD)", () => {
      const m = moneyFromMajor(1.234, KWD);
      expect(moneyMinorUnits(m)).toBe(1234n);
    });

    it("handles 8-decimal currencies (BTC)", () => {
      const m = moneyFromMajor(0.00001234, BTC);
      expect(moneyMinorUnits(m)).toBe(1234n);
    });

    it("rounds fractional cents", () => {
      const m = moneyFromMajor(12.995, USD);
      expect(moneyMinorUnits(m)).toBe(1300n); // rounded up
    });
  });

  describe("zero", () => {
    it("creates zero money", () => {
      const m = moneyZero(USD);
      expect(moneyMinorUnits(m)).toBe(0n);
    });
  });

  describe("arithmetic", () => {
    it("adds same currency", () => {
      const a = money(1299, USD);
      const b = money(501, USD);
      expect(moneyMinorUnits(moneyAdd(a, b))).toBe(1800n);
    });

    it("subtracts same currency", () => {
      const a = money(1299, USD);
      const b = money(299, USD);
      expect(moneyMinorUnits(moneySub(a, b))).toBe(1000n);
    });

    it("negates", () => {
      const m = money(1299, USD);
      expect(moneyMinorUnits(moneyNegate(m))).toBe(-1299n);
    });

    it("takes absolute value", () => {
      const m = money(-1299, USD);
      expect(moneyMinorUnits(moneyAbs(m))).toBe(1299n);
    });

    it("scales by integer", () => {
      const m = money(1000, USD);
      expect(moneyMinorUnits(moneyScale(m, 3n, USD))).toBe(3000n);
    });

    it("scales by fraction", () => {
      const m = money(1000, USD);
      expect(moneyMinorUnits(moneyScale(m, 0.5, USD))).toBe(500n);
    });

    it("divides by integer", () => {
      const m = money(1000, USD);
      expect(moneyMinorUnits(moneyDivide(m, 4n, USD))).toBe(250n);
    });

    it("divides with rounding", () => {
      const m = money(1000, USD);
      // 1000 / 3 = 333.33... rounds to 333
      expect(moneyMinorUnits(moneyDivide(m, 3n, USD))).toBe(333n);
    });
  });

  describe("comparison", () => {
    it("compares equal", () => {
      const a = money(1299, USD);
      const b = money(1299, USD);
      expect(moneyCompare(a, b)).toBe(0);
      expect(moneyEquals(a, b)).toBe(true);
    });

    it("compares less than", () => {
      const a = money(1298, USD);
      const b = money(1299, USD);
      expect(moneyCompare(a, b)).toBe(-1);
    });

    it("compares greater than", () => {
      const a = money(1300, USD);
      const b = money(1299, USD);
      expect(moneyCompare(a, b)).toBe(1);
    });

    it("min/max", () => {
      const a = money(1299, USD);
      const b = money(500, USD);
      expect(moneyMin(a, b)).toBe(b);
      expect(moneyMax(a, b)).toBe(a);
    });
  });

  describe("queries", () => {
    it("isZero", () => {
      expect(moneyIsZero(money(0, USD))).toBe(true);
      expect(moneyIsZero(money(1, USD))).toBe(false);
    });

    it("isPositive", () => {
      expect(moneyIsPositive(money(1, USD))).toBe(true);
      expect(moneyIsPositive(money(0, USD))).toBe(false);
      expect(moneyIsPositive(money(-1, USD))).toBe(false);
    });

    it("isNegative", () => {
      expect(moneyIsNegative(money(-1, USD))).toBe(true);
      expect(moneyIsNegative(money(0, USD))).toBe(false);
      expect(moneyIsNegative(money(1, USD))).toBe(false);
    });
  });

  describe("conversion", () => {
    it("toMajor", () => {
      const m = money(1299, USD);
      expect(moneyToMajor(m, USD)).toBe(12.99);
    });

    it("toString", () => {
      const m = money(1299, USD);
      expect(moneyToString(m, USD)).toBe("12.99");
    });

    it("toString negative", () => {
      const m = money(-1299, USD);
      expect(moneyToString(m, USD)).toBe("-12.99");
    });

    it("toString with leading zeros", () => {
      const m = money(5, USD);
      expect(moneyToString(m, USD)).toBe("0.05");
    });

    it("toString for zero-decimal currency", () => {
      const m = money(1000, JPY);
      expect(moneyToString(m, JPY)).toBe("1000");
    });
  });

  describe("formatting", () => {
    it("formats with currency symbol", () => {
      const m = money(1299, USD);
      const formatted = moneyFormat(m, USD, "en-US");
      expect(formatted).toContain("12.99");
      expect(formatted).toContain("$");
    });

    it("formats JPY without decimals", () => {
      const m = money(1000, JPY);
      const formatted = moneyFormat(m, JPY, "ja-JP");
      expect(formatted).toContain("1,000");
    });
  });

  describe("allocation (Foemmel's conundrum)", () => {
    it("splits evenly when divisible", () => {
      const m = money(900, USD);
      const [a, b, c] = moneyAllocate(m, [1, 1, 1], USD);
      expect(moneyMinorUnits(a)).toBe(300n);
      expect(moneyMinorUnits(b)).toBe(300n);
      expect(moneyMinorUnits(c)).toBe(300n);
    });

    it("distributes remainder to first portions", () => {
      const m = money(1000, USD);
      const [a, b, c] = moneyAllocate(m, [1, 1, 1], USD);
      // 1000 / 3 = 333 each, remainder 1
      expect(moneyMinorUnits(a)).toBe(334n);
      expect(moneyMinorUnits(b)).toBe(333n);
      expect(moneyMinorUnits(c)).toBe(333n);
      // Sum should equal original
      expect(moneyMinorUnits(a) + moneyMinorUnits(b) + moneyMinorUnits(c)).toBe(1000n);
    });

    it("handles weighted allocation", () => {
      const m = money(10000, USD); // $100.00
      const [a, b, c] = moneyAllocate(m, [50, 30, 20], USD);
      expect(moneyMinorUnits(a)).toBe(5000n); // $50.00
      expect(moneyMinorUnits(b)).toBe(3000n); // $30.00
      expect(moneyMinorUnits(c)).toBe(2000n); // $20.00
    });

    it("handles 2-way split with remainder", () => {
      const m = money(1001, USD);
      const [a, b] = moneyAllocate(m, [1, 1], USD);
      expect(moneyMinorUnits(a)).toBe(501n);
      expect(moneyMinorUnits(b)).toBe(500n);
    });

    it("handles negative money", () => {
      const m = money(-1000, USD);
      const [a, b, c] = moneyAllocate(m, [1, 1, 1], USD);
      expect(moneyMinorUnits(a)).toBe(-334n);
      expect(moneyMinorUnits(b)).toBe(-333n);
      expect(moneyMinorUnits(c)).toBe(-333n);
    });

    it("split into equal parts", () => {
      const m = money(1000, USD);
      const parts = moneySplit(m, 3, USD);
      expect(parts.length).toBe(3);
      const sum = parts.reduce((acc, p) => acc + moneyMinorUnits(p), 0n);
      expect(sum).toBe(1000n);
    });
  });

  describe("percentages", () => {
    it("calculates percentage", () => {
      const m = money(10000, USD); // $100.00
      const pct = moneyPercentage(m, 15, USD);
      expect(moneyMinorUnits(pct)).toBe(1500n); // $15.00
    });

    it("adds percentage (tax)", () => {
      const m = money(10000, USD); // $100.00
      const withTax = moneyAddPercentage(m, 8.25, USD);
      expect(moneyMinorUnits(withTax)).toBe(10825n); // $108.25
    });

    it("handles fractional percentage", () => {
      const m = money(10000, USD); // $100.00
      const pct = moneyPercentage(m, 8.25, USD);
      expect(moneyMinorUnits(pct)).toBe(825n); // $8.25
    });
  });

  describe("sum", () => {
    it("sums array of money", () => {
      const values = [money(100, USD), money(200, USD), money(300, USD)];
      const total = moneySum(values, USD);
      expect(moneyMinorUnits(total)).toBe(600n);
    });

    it("sums empty array to zero", () => {
      const total = moneySum([], USD);
      expect(moneyMinorUnits(total)).toBe(0n);
    });
  });

  describe("currency conversion", () => {
    it("converts between currencies", () => {
      const usd = money(1000, USD); // $10.00
      const eur = moneyConvert(usd, 0.85, USD, EUR);
      expect(moneyMinorUnits(eur)).toBe(850n); // €8.50
    });

    it("handles zero-decimal target currency", () => {
      const usd = money(1000, USD); // $10.00
      const jpy = moneyConvert(usd, 150, USD, JPY);
      expect(moneyMinorUnits(jpy)).toBe(1500n); // ¥1500
    });
  });

  describe("Numeric typeclass", () => {
    const N = moneyNumeric(USD);

    it("add", () => {
      const a = money(1299, USD);
      const b = money(501, USD);
      expect(moneyMinorUnits(N.add(a, b))).toBe(1800n);
    });

    it("sub", () => {
      const a = money(1299, USD);
      const b = money(299, USD);
      expect(moneyMinorUnits(N.sub(a, b))).toBe(1000n);
    });

    it("fromNumber", () => {
      const m = N.fromNumber(12.99);
      expect(moneyMinorUnits(m)).toBe(1299n);
    });

    it("toNumber", () => {
      const m = money(1299, USD);
      expect(N.toNumber(m)).toBe(12.99);
    });

    it("zero and one", () => {
      expect(moneyMinorUnits(N.zero())).toBe(0n);
      expect(moneyMinorUnits(N.one())).toBe(100n);
    });
  });

  describe("edge cases", () => {
    it("handles very large amounts", () => {
      const big = money(99999999999999n, USD);
      expect(moneyToMajor(big, USD)).toBeCloseTo(999999999999.99, 0);
    });

    it("throws on divide by zero", () => {
      const m = money(1000, USD);
      expect(() => moneyDivide(m, 0n, USD)).toThrow("division by zero");
    });

    it("throws on allocate with zero ratios", () => {
      const m = money(1000, USD);
      expect(() => moneyAllocate(m, [0, 0, 0], USD)).toThrow("ratios sum to zero");
    });

    it("returns empty array for empty ratios", () => {
      const m = money(1000, USD);
      expect(moneyAllocate(m, [], USD)).toEqual([]);
    });
  });
});
