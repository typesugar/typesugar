/**
 * MU-7: Mod<N> arithmetic must stay exact for moduli up to 2^53, e.g. the
 * ubiquitous 1e9+7. Property-style against BigInt arithmetic.
 */
import { describe, it, expect } from "vitest";
import { mod, modAdd, modSub, modMul, modPow, modInverse, crt } from "../src/types/modular.js";
import { prng } from "./helpers/reference.js";

const P = 1_000_000_007;

function refPow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n;
  b %= m;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}

describe("MU-7: large moduli", () => {
  it("documented failure cases", () => {
    expect(modMul(mod(999999999, P), mod(999999999, P)).value).toBe(64);
    expect(modPow(mod(2, P), P - 2).value).toBe(500000004);
  });

  it("exponents >= 2^32 are not truncated", () => {
    const e = 2 ** 32 + 5;
    expect(modPow(mod(3, P), e).value).toBe(Number(refPow(3n, BigInt(e), BigInt(P))));
  });

  it("property: add/sub/mul/pow/inverse match BigInt for moduli up to 2^53-1", () => {
    const rand = prng(77);
    const moduli = [P, 998_244_353, 2 ** 31 - 1, 94_906_267, 2 ** 53 - 111, 9_007_199_254_740_881];
    for (const M of moduli) {
      const bm = BigInt(M);
      for (let i = 0; i < 300; i++) {
        const a = Math.floor(rand() * M);
        const b = Math.floor(rand() * M);
        const e = Math.floor(rand() * 2 ** 40);
        const A = mod(a, M);
        const B = mod(b, M);
        expect(modAdd(A, B).value).toBe(Number((BigInt(a) + BigInt(b)) % bm));
        expect(modSub(A, B).value).toBe(Number((((BigInt(a) - BigInt(b)) % bm) + bm) % bm));
        expect(modMul(A, B).value).toBe(Number((BigInt(a) * BigInt(b)) % bm));
        expect(modPow(A, e).value).toBe(Number(refPow(BigInt(a), BigInt(e), bm)));
        const inv = modInverse(A);
        if (inv) expect(Number((BigInt(a) * BigInt(inv.value)) % bm)).toBe(1);
      }
    }
  });

  it("crt is exact when m1*m2 > 2^53", () => {
    const m1 = 1_000_000_007;
    const m2 = 998_244_353;
    const x = 123_456_789_012_345_678n % (BigInt(m1) * BigInt(m2));
    // The CRT answer (x itself, here 1.2e17) is not representable as a safe
    // number: it must throw rather than return a rounded value.
    expect(() => crt(Number(x % BigInt(m1)), m1, Number(x % BigInt(m2)), m2)).toThrow(RangeError);
    const small = 4_000_000_000_000n; // < 2^53, but m1 * (…) overflows in float
    expect(BigInt(crt(Number(small % BigInt(m1)), m1, Number(small % BigInt(m2)), m2))).toBe(small);
  });

  it("validates the modulus and value", () => {
    expect(() => mod(1, 2 ** 53 + 2)).toThrow(RangeError);
    expect(() => mod(1, 7.5)).toThrow(RangeError);
    expect(() => mod(1.5, 7)).toThrow(RangeError);
  });
});
