import { describe, it, expect } from "vitest";
import {
  mod,
  modZero,
  modOne,
  modAdd,
  modSub,
  modMul,
  modNegate,
  modPow,
  modInverse,
  modDiv,
  isPrime,
  gcd,
  coprime,
  totient,
  crt,
  numericMod,
  integralMod,
  fractionalMod,
  modEquals,
  modToString,
  modUnits,
} from "../src/index.js";

describe("Mod", () => {
  describe("constructors", () => {
    it("creates mod value", () => {
      const a = mod(5, 7);
      expect(a.value).toBe(5);
      expect(a.modulus).toBe(7);
    });

    it("normalizes negative values", () => {
      const a = mod(-3, 7);
      expect(a.value).toBe(4);
    });

    it("normalizes values >= modulus", () => {
      const a = mod(10, 7);
      expect(a.value).toBe(3);
    });

    it("throws for non-positive modulus", () => {
      expect(() => mod(5, 0)).toThrow(RangeError);
      expect(() => mod(5, -7)).toThrow(RangeError);
    });

    it("creates zero", () => {
      const z = modZero(7);
      expect(z.value).toBe(0);
      expect(z.modulus).toBe(7);
    });

    it("creates one", () => {
      const o = modOne(7);
      expect(o.value).toBe(1);
      expect(o.modulus).toBe(7);
    });
  });

  describe("basic operations", () => {
    it("adds mod values", () => {
      const a = mod(5, 7);
      const b = mod(3, 7);
      const sum = modAdd(a, b);
      expect(sum.value).toBe(1);
    });

    it("subtracts mod values", () => {
      const a = mod(5, 7);
      const b = mod(3, 7);
      const diff = modSub(a, b);
      expect(diff.value).toBe(2);
    });

    it("handles subtraction with wrap", () => {
      const a = mod(2, 7);
      const b = mod(5, 7);
      const diff = modSub(a, b);
      expect(diff.value).toBe(4);
    });

    it("multiplies mod values", () => {
      const a = mod(5, 7);
      const b = mod(3, 7);
      const prod = modMul(a, b);
      expect(prod.value).toBe(1);
    });

    it("negates mod value", () => {
      const a = mod(3, 7);
      const neg = modNegate(a);
      expect(neg.value).toBe(4);
    });
  });

  describe("modPow", () => {
    it("computes positive powers", () => {
      const a = mod(2, 7);
      expect(modPow(a, 0).value).toBe(1);
      expect(modPow(a, 1).value).toBe(2);
      expect(modPow(a, 3).value).toBe(1);
    });

    it("handles large exponents efficiently", () => {
      const a = mod(3, 11);
      const result = modPow(a, 10);
      expect(result.value).toBe(1);
    });

    it("computes negative powers with inverse", () => {
      const a = mod(2, 7);
      const inv = modPow(a, -1);
      expect(modMul(a, inv).value).toBe(1);
    });

    it("throws for negative power when no inverse", () => {
      const a = mod(2, 6);
      expect(() => modPow(a, -1)).toThrow(RangeError);
    });
  });

  describe("modInverse", () => {
    it("finds inverse when coprime", () => {
      const a = mod(3, 7);
      const inv = modInverse(a);
      expect(inv).not.toBeNull();
      expect(modMul(a, inv!).value).toBe(1);
    });

    it("returns null when not coprime", () => {
      const a = mod(2, 6);
      expect(modInverse(a)).toBeNull();
    });

    it("inverse of 1 is 1", () => {
      const a = mod(1, 7);
      expect(modInverse(a)!.value).toBe(1);
    });
  });

  describe("modDiv", () => {
    it("divides when inverse exists", () => {
      const a = mod(6, 7);
      const b = mod(2, 7);
      const result = modDiv(a, b);
      expect(result).not.toBeNull();
      expect(result!.value).toBe(3);
    });

    it("returns null when no inverse", () => {
      const a = mod(5, 6);
      const b = mod(2, 6);
      expect(modDiv(a, b)).toBeNull();
    });
  });

  describe("number theory helpers", () => {
    it("isPrime", () => {
      expect(isPrime(2)).toBe(true);
      expect(isPrime(3)).toBe(true);
      expect(isPrime(7)).toBe(true);
      expect(isPrime(11)).toBe(true);
      expect(isPrime(1)).toBe(false);
      expect(isPrime(4)).toBe(false);
      expect(isPrime(9)).toBe(false);
    });

    it("gcd", () => {
      expect(gcd(48, 18)).toBe(6);
      expect(gcd(7, 3)).toBe(1);
      expect(gcd(100, 25)).toBe(25);
    });

    it("coprime", () => {
      expect(coprime(7, 3)).toBe(true);
      expect(coprime(6, 9)).toBe(false);
    });

    it("totient", () => {
      expect(totient(7)).toBe(6);
      expect(totient(10)).toBe(4);
      expect(totient(12)).toBe(4);
    });
  });

  describe("Chinese Remainder Theorem", () => {
    it("solves basic CRT problem", () => {
      const x = crt(2, 3, 3, 5);
      expect(x % 3).toBe(2);
      expect(x % 5).toBe(3);
      expect(x).toBe(8);
    });

    it("throws for non-coprime moduli", () => {
      expect(() => crt(1, 4, 2, 6)).toThrow(RangeError);
    });
  });

  describe("typeclass instances", () => {
    describe("numericMod", () => {
      const N = numericMod(7);

      it("zero", () => {
        expect(N.zero().value).toBe(0);
      });

      it("one", () => {
        expect(N.one().value).toBe(1);
      });

      it("add", () => {
        const a = mod(5, 7);
        const b = mod(4, 7);
        expect(N.add(a, b).value).toBe(2);
      });

      it("mul", () => {
        const a = mod(3, 7);
        const b = mod(4, 7);
        expect(N.mul(a, b).value).toBe(5);
      });
    });

    describe("integralMod", () => {
      const I = integralMod(7);

      it("div (requires inverse)", () => {
        const a = mod(6, 7);
        const b = mod(2, 7);
        expect(I.div(a, b).value).toBe(3);
      });

      it("toInteger", () => {
        expect(I.toInteger(mod(5, 7))).toBe(5n);
      });
    });

    describe("fractionalMod", () => {
      it("works for prime modulus", () => {
        const F = fractionalMod(7);
        const a = mod(6, 7);
        const b = mod(2, 7);
        expect(F.div(a, b).value).toBe(3);
      });

      it("throws for non-prime modulus", () => {
        expect(() => fractionalMod(6)).toThrow(RangeError);
      });

      it("recip", () => {
        const F = fractionalMod(7);
        const a = mod(2, 7);
        const inv = F.recip(a);
        expect(modMul(a, inv).value).toBe(1);
      });
    });
  });

  describe("utilities", () => {
    it("equals", () => {
      const a = mod(3, 7);
      const b = mod(3, 7);
      const c = mod(4, 7);
      expect(modEquals(a, b)).toBe(true);
      expect(modEquals(a, c)).toBe(false);
    });

    it("toString", () => {
      expect(modToString(mod(5, 7))).toBe("5 (mod 7)");
    });

    it("units lists all invertible elements", () => {
      const u = modUnits(6);
      expect(u.map((m) => m.value).sort()).toEqual([1, 5]);
    });
  });
});

describe("docs B#13: mismatched moduli", () => {
  const a = mod(5, 7);
  const c = mod(2, 11) as unknown as ReturnType<typeof mod<7>>;
  it.each([
    ["modAdd", () => modAdd(a, c)],
    ["modSub", () => modSub(a, c)],
    ["modMul", () => modMul(a, c)],
    ["modDiv", () => modDiv(a, c)],
  ])("%s throws RangeError instead of returning a wrong value", (_name, op) => {
    expect(op).toThrow(RangeError);
    expect(op).toThrow(/moduli/);
  });
  it("the Numeric instance rejects a value from another modulus", () => {
    expect(() => numericMod(7).add(a, c)).toThrow(RangeError);
  });
  it("matching moduli still work", () => {
    expect(modAdd(a, mod(3, 7))).toEqual({ value: 1, modulus: 7 });
  });
});
