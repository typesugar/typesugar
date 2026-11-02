/**
 * MU-14: interval arithmetic must round outward so the result always
 * contains the exact result of the operation on the (exact) float inputs;
 * 0 × ∞ must not turn into the empty interval.
 *
 * Containment is checked EXACTLY: every finite double is a dyadic rational,
 * so the exact sum/product/quotient of endpoints is computed in BigInt
 * arithmetic and compared with the result's endpoints.
 */
import { describe, it, expect } from "vitest";
import {
  add,
  sub,
  mul,
  div,
  sqrt,
  pow,
  point,
  interval,
  entire,
  isEmpty,
  numericInterval,
  type Interval,
} from "../src/types/interval.js";
import { prng } from "./helpers/reference.js";

/** Exact value of a finite double as num / 2^k. */
function exact(x: number): { num: bigint; k: bigint } {
  if (!Number.isFinite(x)) throw new Error("finite only");
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const sign = bits >> 63n ? -1n : 1n;
  const e = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  const mant = e === 0 ? frac : frac | (1n << 52n);
  const exp = (e === 0 ? 1 : e) - 1075; // x = mant * 2^exp
  return exp >= 0
    ? { num: sign * mant * (1n << BigInt(exp)), k: 0n }
    : { num: sign * mant, k: BigInt(-exp) };
}

/** Compare p/q (q > 0) with the double x: -1, 0, 1. */
function cmpFrac(p: bigint, q: bigint, x: number): number {
  if (x === Infinity) return -1;
  if (x === -Infinity) return 1;
  const { num, k } = exact(x);
  const lhs = p * (1n << k);
  const rhs = num * q;
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
}

function containsFrac(i: Interval, p: bigint, q: bigint): boolean {
  if (q < 0n) {
    p = -p;
    q = -q;
  }
  return cmpFrac(p, q, i.lo) >= 0 && cmpFrac(p, q, i.hi) <= 0;
}

function asFrac(x: number): [bigint, bigint] {
  const { num, k } = exact(x);
  return [num, 1n << k];
}

function randDouble(rand: () => number): number {
  const mag = Math.pow(10, Math.floor(rand() * 20) - 10);
  return (rand() - 0.5) * mag * (1 + rand());
}

describe("MU-14: outward rounding", () => {
  it("0.1 + 0.2 contains the exact sum of the two doubles", () => {
    const s = add(point(0.1), point(0.2));
    const [a, qa] = asFrac(0.1);
    const [b, qb] = asFrac(0.2);
    expect(containsFrac(s, a * qb + b * qa, qa * qb)).toBe(true);
    expect(s.lo).toBeLessThan(s.hi);
  });

  it("exact operations stay tight", () => {
    expect(add(point(1), point(2))).toEqual({ lo: 3, hi: 3 });
    expect(mul(interval(1, 2), interval(3, 4))).toEqual({ lo: 3, hi: 8 });
    expect(div(point(1), point(4))).toEqual({ lo: 0.25, hi: 0.25 });
    expect(sqrt(interval(4, 9))).toEqual({ lo: 2, hi: 3 });
    expect(pow(interval(2, 3), 3)).toEqual({ lo: 8, hi: 27 });
  });

  it("0 × ∞ is 0, not empty", () => {
    const r = numericInterval.mul(entire, point(0));
    expect(isEmpty(r)).toBe(false);
    expect(r).toEqual({ lo: 0, hi: 0 });
  });

  it("property: add/sub/mul/div of random point intervals contain the exact result", () => {
    const rand = prng(14);
    for (let i = 0; i < 3000; i++) {
      const x = randDouble(rand);
      let y = randDouble(rand);
      if (y === 0) y = 1.5;
      const [a, qa] = asFrac(x);
      const [b, qb] = asFrac(y);
      const X = point(x);
      const Y = point(y);
      const cases: Array<[string, Interval, bigint, bigint]> = [
        ["add", add(X, Y), a * qb + b * qa, qa * qb],
        ["sub", sub(X, Y), a * qb - b * qa, qa * qb],
        ["mul", mul(X, Y), a * b, qa * qb],
        ["div", div(X, Y), a * qb, qa * b],
      ];
      for (const [op, r, p, q] of cases) {
        if (!containsFrac(r, p, q)) expect({ op, x, y, r }).toBe("contained");
      }
    }
  });

  it("property: sqrt and integer pow contain the exact result", () => {
    const rand = prng(15);
    for (let i = 0; i < 2000; i++) {
      const x = Math.abs(randDouble(rand));
      const s = sqrt(point(x));
      // s.lo^2 <= x <= s.hi^2, exactly
      const [lo, qlo] = asFrac(s.lo);
      const [hi, qhi] = asFrac(s.hi);
      const [xn, xq] = asFrac(x);
      expect(lo * lo * xq <= xn * qlo * qlo).toBe(true);
      expect(hi * hi * xq >= xn * qhi * qhi).toBe(true);

      const n = 2 + Math.floor(rand() * 5);
      const base = randDouble(rand) / 1e3;
      const pw = pow(point(base), n);
      const [bn, bq] = asFrac(base);
      if (Number.isFinite(pw.lo) && Number.isFinite(pw.hi)) {
        if (!containsFrac(pw, bn ** BigInt(n), bq ** BigInt(n)))
          expect({ base, n, pw }).toBe("contained");
      }
    }
  });
});
