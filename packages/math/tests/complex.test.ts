import { describe, it, expect } from "vitest";
import {
  complex,
  fromPolar,
  conjugate,
  magnitude,
  phase,
  toPolar,
  equals,
  isReal,
  isImaginary,
  isZero,
  toString,
  rootsOfUnity,
  nthRoots,
  numericComplex,
  fractionalComplex,
  floatingComplex,
  I,
  ONE,
  ZERO,
  type Complex,
} from "../types/complex.js";

const EPSILON = 1e-10;

function approxEquals(a: Complex, b: Complex, eps = EPSILON): boolean {
  return Math.abs(a.re - b.re) < eps && Math.abs(a.im - b.im) < eps;
}

describe("Complex", () => {
  describe("construction", () => {
    it("creates complex from re and im", () => {
      const z = complex(3, 4);
      expect(z.re).toBe(3);
      expect(z.im).toBe(4);
    });

    it("defaults imaginary to 0", () => {
      const z = complex(5);
      expect(z.re).toBe(5);
      expect(z.im).toBe(0);
    });

    it("creates from polar coordinates", () => {
      const z = fromPolar(2, Math.PI / 4);
      expect(Math.abs(z.re - Math.SQRT2)).toBeLessThan(EPSILON);
      expect(Math.abs(z.im - Math.SQRT2)).toBeLessThan(EPSILON);
    });
  });

  describe("constants", () => {
    it("I is the imaginary unit", () => {
      expect(I.re).toBe(0);
      expect(I.im).toBe(1);
    });

    it("ONE is real 1", () => {
      expect(ONE.re).toBe(1);
      expect(ONE.im).toBe(0);
    });

    it("ZERO is 0+0i", () => {
      expect(ZERO.re).toBe(0);
      expect(ZERO.im).toBe(0);
    });
  });

  describe("conjugate", () => {
    it("flips imaginary sign", () => {
      const z = complex(3, 4);
      const c = conjugate(z);
      expect(c.re).toBe(3);
      expect(c.im).toBe(-4);
    });
  });

  describe("magnitude", () => {
    it("computes |z|", () => {
      expect(magnitude(complex(3, 4))).toBe(5);
      expect(magnitude(complex(1, 0))).toBe(1);
      expect(magnitude(complex(0, 1))).toBe(1);
    });
  });

  describe("phase", () => {
    it("computes arg(z)", () => {
      expect(phase(complex(1, 0))).toBeCloseTo(0);
      expect(phase(complex(0, 1))).toBeCloseTo(Math.PI / 2);
      expect(phase(complex(-1, 0))).toBeCloseTo(Math.PI);
      expect(phase(complex(0, -1))).toBeCloseTo(-Math.PI / 2);
    });
  });

  describe("toPolar", () => {
    it("converts to polar form", () => {
      const z = complex(1, 1);
      const p = toPolar(z);
      expect(p.r).toBeCloseTo(Math.SQRT2);
      expect(p.theta).toBeCloseTo(Math.PI / 4);
    });
  });

  describe("predicates", () => {
    it("isReal", () => {
      expect(isReal(complex(5, 0))).toBe(true);
      expect(isReal(complex(5, 0.0001), 0.001)).toBe(true);
      expect(isReal(complex(5, 1))).toBe(false);
    });

    it("isImaginary", () => {
      expect(isImaginary(complex(0, 5))).toBe(true);
      expect(isImaginary(complex(0.0001, 5), 0.001)).toBe(true);
      expect(isImaginary(complex(1, 5))).toBe(false);
    });

    it("isZero", () => {
      expect(isZero(ZERO)).toBe(true);
      expect(isZero(complex(0.0001, 0), 0.001)).toBe(true);
      expect(isZero(complex(1, 0))).toBe(false);
    });
  });

  describe("toString", () => {
    it("formats real numbers", () => {
      expect(toString(complex(5, 0))).toBe("5");
    });

    it("formats purely imaginary", () => {
      expect(toString(complex(0, 3))).toBe("3i");
    });

    it("formats general complex", () => {
      expect(toString(complex(3, 4))).toBe("3 + 4i");
      expect(toString(complex(3, -4))).toBe("3 - 4i");
    });
  });

  describe("numericComplex", () => {
    const N = numericComplex;

    describe("add", () => {
      it("adds complex numbers", () => {
        const z1 = complex(1, 2);
        const z2 = complex(3, 4);
        const result = N.add(z1, z2);
        expect(result.re).toBe(4);
        expect(result.im).toBe(6);
      });
    });

    describe("sub", () => {
      it("subtracts complex numbers", () => {
        const z1 = complex(5, 7);
        const z2 = complex(3, 4);
        const result = N.sub(z1, z2);
        expect(result.re).toBe(2);
        expect(result.im).toBe(3);
      });
    });

    describe("mul", () => {
      it("multiplies complex numbers", () => {
        // (1+2i)(3+4i) = 3 + 4i + 6i + 8i² = 3 + 10i - 8 = -5 + 10i
        const z1 = complex(1, 2);
        const z2 = complex(3, 4);
        const result = N.mul(z1, z2);
        expect(result.re).toBe(-5);
        expect(result.im).toBe(10);
      });

      it("i² = -1", () => {
        const result = N.mul(I, I);
        expect(result.re).toBeCloseTo(-1);
        expect(result.im).toBeCloseTo(0);
      });
    });

    describe("negate", () => {
      it("negates both parts", () => {
        const result = N.negate(complex(3, 4));
        expect(result.re).toBe(-3);
        expect(result.im).toBe(-4);
      });
    });

    describe("abs", () => {
      it("returns magnitude as real", () => {
        const result = N.abs(complex(3, 4));
        expect(result.re).toBe(5);
        expect(result.im).toBe(0);
      });
    });

    describe("signum", () => {
      it("returns unit vector", () => {
        const result = N.signum(complex(3, 4));
        expect(result.re).toBeCloseTo(0.6);
        expect(result.im).toBeCloseTo(0.8);
      });

      it("returns zero for zero", () => {
        const result = N.signum(ZERO);
        expect(result.re).toBe(0);
        expect(result.im).toBe(0);
      });
    });

    describe("zero and one", () => {
      it("zero is 0+0i", () => {
        const z = N.zero();
        expect(z.re).toBe(0);
        expect(z.im).toBe(0);
      });

      it("one is 1+0i", () => {
        const o = N.one();
        expect(o.re).toBe(1);
        expect(o.im).toBe(0);
      });
    });

    describe("toNumber", () => {
      it("converts real to number", () => {
        expect(N.toNumber(complex(5, 0))).toBe(5);
      });

      it("throws for non-real", () => {
        expect(() => N.toNumber(complex(5, 1))).toThrow();
      });
    });
  });

  describe("fractionalComplex", () => {
    const F = fractionalComplex;

    describe("div", () => {
      it("divides complex numbers", () => {
        // (1+2i)/(3+4i) = (1+2i)(3-4i)/25 = (3-4i+6i-8i²)/25 = (11+2i)/25
        const z1 = complex(1, 2);
        const z2 = complex(3, 4);
        const result = F.div(z1, z2);
        expect(result.re).toBeCloseTo(11 / 25);
        expect(result.im).toBeCloseTo(2 / 25);
      });

      it("throws on division by zero", () => {
        expect(() => F.div(complex(1, 0), ZERO)).toThrow();
      });
    });

    describe("recip", () => {
      it("computes reciprocal", () => {
        // 1/(3+4i) = (3-4i)/25
        const result = F.recip(complex(3, 4));
        expect(result.re).toBeCloseTo(3 / 25);
        expect(result.im).toBeCloseTo(-4 / 25);
      });

      it("throws for zero", () => {
        expect(() => F.recip(ZERO)).toThrow();
      });
    });
  });

  describe("floatingComplex", () => {
    const Fl = floatingComplex;

    describe("pi", () => {
      it("returns pi as real", () => {
        const p = Fl.pi();
        expect(p.re).toBeCloseTo(Math.PI);
        expect(p.im).toBe(0);
      });
    });

    describe("exp", () => {
      it("computes e^z", () => {
        // e^(iπ) = -1
        const z = complex(0, Math.PI);
        const result = Fl.exp(z);
        expect(result.re).toBeCloseTo(-1);
        expect(Math.abs(result.im)).toBeLessThan(EPSILON);
      });

      it("e^0 = 1", () => {
        const result = Fl.exp(ZERO);
        expect(result.re).toBeCloseTo(1);
        expect(result.im).toBeCloseTo(0);
      });
    });

    describe("log", () => {
      it("computes principal log", () => {
        // log(e) = 1
        const result = Fl.log(complex(Math.E, 0));
        expect(result.re).toBeCloseTo(1);
        expect(result.im).toBeCloseTo(0);
      });

      it("log(-1) = iπ", () => {
        const result = Fl.log(complex(-1, 0));
        expect(result.re).toBeCloseTo(0);
        expect(result.im).toBeCloseTo(Math.PI);
      });

      it("throws for zero", () => {
        expect(() => Fl.log(ZERO)).toThrow();
      });
    });

    describe("sqrt", () => {
      it("computes square root", () => {
        // sqrt(i) = (1+i)/√2
        const result = Fl.sqrt(I);
        const expected = Math.SQRT1_2;
        expect(result.re).toBeCloseTo(expected);
        expect(result.im).toBeCloseTo(expected);
      });

      it("sqrt(-1) = i", () => {
        const result = Fl.sqrt(complex(-1, 0));
        expect(Math.abs(result.re)).toBeLessThan(EPSILON);
        expect(result.im).toBeCloseTo(1);
      });
    });

    describe("pow", () => {
      it("computes complex power", () => {
        // i^i = e^(i*log(i)) = e^(i*(iπ/2)) = e^(-π/2)
        const result = Fl.pow(I, I);
        expect(result.re).toBeCloseTo(Math.exp(-Math.PI / 2));
        expect(Math.abs(result.im)).toBeLessThan(EPSILON);
      });
    });

    describe("trig functions", () => {
      it("sin of real is real", () => {
        const result = Fl.sin(complex(Math.PI / 6, 0));
        expect(result.re).toBeCloseTo(0.5);
        expect(Math.abs(result.im)).toBeLessThan(EPSILON);
      });

      it("cos of real is real", () => {
        const result = Fl.cos(complex(Math.PI / 3, 0));
        expect(result.re).toBeCloseTo(0.5);
        expect(Math.abs(result.im)).toBeLessThan(EPSILON);
      });

      it("sin²z + cos²z = 1", () => {
        const z = complex(1, 2);
        const sinZ = Fl.sin(z);
        const cosZ = Fl.cos(z);
        const sin2 = numericComplex.mul(sinZ, sinZ);
        const cos2 = numericComplex.mul(cosZ, cosZ);
        const sum = numericComplex.add(sin2, cos2);
        expect(sum.re).toBeCloseTo(1);
        expect(sum.im).toBeCloseTo(0);
      });
    });

    describe("hyperbolic functions", () => {
      it("sinh(0) = 0", () => {
        const result = Fl.sinh(ZERO);
        expect(result.re).toBeCloseTo(0);
        expect(result.im).toBeCloseTo(0);
      });

      it("cosh(0) = 1", () => {
        const result = Fl.cosh(ZERO);
        expect(result.re).toBeCloseTo(1);
        expect(result.im).toBeCloseTo(0);
      });

      it("cosh²z - sinh²z = 1", () => {
        const z = complex(1, 2);
        const sinhZ = Fl.sinh(z);
        const coshZ = Fl.cosh(z);
        const sinh2 = numericComplex.mul(sinhZ, sinhZ);
        const cosh2 = numericComplex.mul(coshZ, coshZ);
        const diff = numericComplex.sub(cosh2, sinh2);
        expect(diff.re).toBeCloseTo(1);
        expect(diff.im).toBeCloseTo(0);
      });
    });
  });

  describe("rootsOfUnity", () => {
    it("returns n-th roots of unity", () => {
      const roots = rootsOfUnity(4);
      expect(roots.length).toBe(4);
      expect(roots[0].re).toBeCloseTo(1);
      expect(roots[0].im).toBeCloseTo(0);
      expect(roots[1].re).toBeCloseTo(0);
      expect(roots[1].im).toBeCloseTo(1);
      expect(roots[2].re).toBeCloseTo(-1);
      expect(roots[2].im).toBeCloseTo(0);
      expect(roots[3].re).toBeCloseTo(0);
      expect(roots[3].im).toBeCloseTo(-1);
    });
  });

  describe("nthRoots", () => {
    it("returns all cube roots of 1", () => {
      const roots = nthRoots(ONE, 3);
      expect(roots.length).toBe(3);
      // Product of roots should equal 1
      let product = roots[0];
      for (let i = 1; i < roots.length; i++) {
        product = numericComplex.mul(product, roots[i]);
      }
      expect(product.re).toBeCloseTo(1);
      expect(Math.abs(product.im)).toBeLessThan(EPSILON);
    });

    it("throws for non-positive n", () => {
      expect(() => nthRoots(ONE, 0)).toThrow();
      expect(() => nthRoots(ONE, -1)).toThrow();
    });
  });

  describe("typeclass laws", () => {
    const N = numericComplex;
    const a = complex(1, 2);
    const b = complex(3, 4);
    const c = complex(5, 6);

    describe("addition", () => {
      it("is associative", () => {
        const left = N.add(N.add(a, b), c);
        const right = N.add(a, N.add(b, c));
        expect(approxEquals(left, right)).toBe(true);
      });

      it("is commutative", () => {
        const left = N.add(a, b);
        const right = N.add(b, a);
        expect(approxEquals(left, right)).toBe(true);
      });

      it("has identity", () => {
        expect(approxEquals(N.add(a, N.zero()), a)).toBe(true);
      });
    });

    describe("multiplication", () => {
      it("is associative", () => {
        const left = N.mul(N.mul(a, b), c);
        const right = N.mul(a, N.mul(b, c));
        expect(approxEquals(left, right)).toBe(true);
      });

      it("is commutative", () => {
        const left = N.mul(a, b);
        const right = N.mul(b, a);
        expect(approxEquals(left, right)).toBe(true);
      });

      it("has identity", () => {
        expect(approxEquals(N.mul(a, N.one()), a)).toBe(true);
      });

      it("distributes over addition", () => {
        const left = N.mul(a, N.add(b, c));
        const right = N.add(N.mul(a, b), N.mul(a, c));
        expect(approxEquals(left, right)).toBe(true);
      });
    });
  });
});
