/**
 * Complex Numbers
 *
 * Complex number arithmetic with real and imaginary parts.
 * Supports standard Numeric operations plus transcendental functions.
 *
 * @example
 * ```typescript
 * const z1 = complex(3, 4);    // 3 + 4i
 * const z2 = fromPolar(1, Math.PI / 4); // e^(iπ/4)
 * const prod = numericComplex.mul(z1, z2);
 * ```
 */

import type { Numeric, Fractional, Floating } from "@typesugar/std";
import type { Op } from "@typesugar/core";

/**
 * Complex number with real and imaginary parts.
 */
export interface Complex {
  readonly re: number;
  readonly im: number;
}

/**
 * Create a complex number from real and imaginary parts.
 *
 * @param re - Real part
 * @param im - Imaginary part (default: 0)
 */
export function complex(re: number, im: number = 0): Complex {
  return { re, im };
}

/**
 * Create a complex number from polar coordinates.
 *
 * @param r - Magnitude (radius)
 * @param theta - Phase angle in radians
 */
export function fromPolar(r: number, theta: number): Complex {
  return {
    re: r * Math.cos(theta),
    im: r * Math.sin(theta),
  };
}

/**
 * Complex conjugate: a + bi → a - bi
 */
export function conjugate(z: Complex): Complex {
  return { re: z.re, im: -z.im };
}

/**
 * Magnitude (absolute value) of a complex number.
 * |z| = sqrt(re² + im²)
 */
export function magnitude(z: Complex): number {
  return Math.hypot(z.re, z.im);
}

/**
 * Phase angle (argument) of a complex number.
 * arg(z) = atan2(im, re)
 */
export function phase(z: Complex): number {
  return Math.atan2(z.im, z.re);
}

/**
 * Convert complex number to polar form.
 */
export function toPolar(z: Complex): { r: number; theta: number } {
  return {
    r: magnitude(z),
    theta: phase(z),
  };
}

/**
 * Check if two complex numbers are equal within tolerance.
 */
export function equals(a: Complex, b: Complex, epsilon: number = 1e-10): boolean {
  return Math.abs(a.re - b.re) < epsilon && Math.abs(a.im - b.im) < epsilon;
}

/**
 * Check if a complex number is real (imaginary part ≈ 0).
 */
export function isReal(z: Complex, epsilon: number = 1e-10): boolean {
  return Math.abs(z.im) < epsilon;
}

/**
 * Check if a complex number is purely imaginary (real part ≈ 0).
 */
export function isImaginary(z: Complex, epsilon: number = 1e-10): boolean {
  return Math.abs(z.re) < epsilon;
}

/**
 * Check if a complex number is zero.
 */
export function isZero(z: Complex, epsilon: number = 1e-10): boolean {
  return Math.abs(z.re) < epsilon && Math.abs(z.im) < epsilon;
}

/**
 * Format a complex number as a string.
 */
export function toString(z: Complex): string {
  if (Math.abs(z.im) < 1e-15) {
    return z.re.toString();
  }
  if (Math.abs(z.re) < 1e-15) {
    return `${z.im}i`;
  }
  if (z.im < 0) {
    return `${z.re} - ${Math.abs(z.im)}i`;
  }
  return `${z.re} + ${z.im}i`;
}

/**
 * Numeric instance for Complex numbers.
 */
export const numericComplex: Numeric<Complex> = {
  add: (a, b) => ({ re: a.re + b.re, im: a.im + b.im }) as Complex & Op<"+">,

  sub: (a, b) => ({ re: a.re - b.re, im: a.im - b.im }) as Complex & Op<"-">,

  mul: (a, b) =>
    ({
      re: a.re * b.re - a.im * b.im,
      im: a.re * b.im + a.im * b.re,
    }) as Complex & Op<"*">,

  negate: (a) => ({ re: -a.re, im: -a.im }),

  abs: (a) => ({ re: magnitude(a), im: 0 }),

  signum: (a) => {
    const mag = magnitude(a);
    if (mag === 0) return { re: 0, im: 0 };
    return { re: a.re / mag, im: a.im / mag };
  },

  fromNumber: (n) => ({ re: n, im: 0 }),

  toNumber: (a) => {
    if (Math.abs(a.im) > 1e-10) {
      throw new RangeError("Cannot convert complex with non-zero imaginary part to number");
    }
    return a.re;
  },

  zero: () => ({ re: 0, im: 0 }),

  one: () => ({ re: 1, im: 0 }),
};

/**
 * Fractional instance for Complex numbers.
 */
export const fractionalComplex: Fractional<Complex> = {
  div: (a, b) => {
    const denom = b.re * b.re + b.im * b.im;
    if (denom === 0) {
      throw new RangeError("Complex division by zero");
    }
    return {
      re: (a.re * b.re + a.im * b.im) / denom,
      im: (a.im * b.re - a.re * b.im) / denom,
    } as Complex & Op<"/">;
  },

  recip: (a) => {
    const denom = a.re * a.re + a.im * a.im;
    if (denom === 0) {
      throw new RangeError("Complex reciprocal of zero");
    }
    return {
      re: a.re / denom,
      im: -a.im / denom,
    };
  },

  fromRational: (num, den) => ({ re: num / den, im: 0 }),
};

/**
 * Floating instance for Complex numbers.
 * Implements transcendental functions for complex domain.
 */
export const floatingComplex: Floating<Complex> = {
  pi: () => ({ re: Math.PI, im: 0 }),

  /**
   * Complex exponential: exp(z) = e^re * (cos(im) + i*sin(im))
   */
  exp: (z) => {
    const r = Math.exp(z.re);
    return {
      re: r * Math.cos(z.im),
      im: r * Math.sin(z.im),
    };
  },

  /**
   * Complex logarithm (principal value): log(z) = log(|z|) + i*arg(z)
   */
  log: (z) => {
    const mag = magnitude(z);
    if (mag === 0) {
      throw new RangeError("Complex logarithm of zero");
    }
    return {
      re: Math.log(mag),
      im: phase(z),
    };
  },

  /**
   * Complex square root: sqrt(z) = sqrt(|z|) * (cos(arg/2) + i*sin(arg/2))
   */
  sqrt: (z) => {
    const mag = magnitude(z);
    const arg = phase(z);
    const sqrtMag = Math.sqrt(mag);
    return {
      re: sqrtMag * Math.cos(arg / 2),
      im: sqrtMag * Math.sin(arg / 2),
    };
  },

  /**
   * Complex power: a^b = exp(b * log(a))
   */
  pow: (a, b) => {
    if (a.re === 0 && a.im === 0) {
      if (b.re === 0 && b.im === 0) {
        return { re: 1, im: 0 }; // 0^0 = 1 by convention
      }
      if (b.re > 0) {
        return { re: 0, im: 0 };
      }
      throw new RangeError("Complex: 0 raised to negative or complex power");
    }
    const logA = floatingComplex.log(a);
    const product = numericComplex.mul(b, logA);
    return floatingComplex.exp(product);
  },

  /**
   * Complex sine: sin(z) = sin(re)*cosh(im) + i*cos(re)*sinh(im)
   */
  sin: (z) => ({
    re: Math.sin(z.re) * Math.cosh(z.im),
    im: Math.cos(z.re) * Math.sinh(z.im),
  }),

  /**
   * Complex cosine: cos(z) = cos(re)*cosh(im) - i*sin(re)*sinh(im)
   */
  cos: (z) => ({
    re: Math.cos(z.re) * Math.cosh(z.im),
    im: -Math.sin(z.re) * Math.sinh(z.im),
  }),

  /**
   * Complex tangent: tan(z) = sin(z)/cos(z)
   */
  tan: (z) => fractionalComplex.div(floatingComplex.sin(z), floatingComplex.cos(z)),

  /**
   * Complex arcsine: asin(z) = -i * log(i*z + sqrt(1 - z²))
   */
  asin: (z) => {
    const i = { re: 0, im: 1 };
    const minusI = { re: 0, im: -1 };
    const one = { re: 1, im: 0 };
    const iz = numericComplex.mul(i, z);
    const zSquared = numericComplex.mul(z, z);
    const oneMinusZSquared = numericComplex.sub(one, zSquared);
    const sqrtPart = floatingComplex.sqrt(oneMinusZSquared);
    const inside = numericComplex.add(iz, sqrtPart);
    const logPart = floatingComplex.log(inside);
    return numericComplex.mul(minusI, logPart);
  },

  /**
   * Complex arccosine: acos(z) = π/2 - asin(z)
   */
  acos: (z) => {
    const piOver2 = { re: Math.PI / 2, im: 0 };
    return numericComplex.sub(piOver2, floatingComplex.asin(z));
  },

  /**
   * Complex arctangent: atan(z) = (i/2) * log((i+z)/(i-z))
   */
  atan: (z) => {
    const i = { re: 0, im: 1 };
    const iOver2 = { re: 0, im: 0.5 };
    const iPlusZ = numericComplex.add(i, z);
    const iMinusZ = numericComplex.sub(i, z);
    const ratio = fractionalComplex.div(iPlusZ, iMinusZ);
    const logPart = floatingComplex.log(ratio);
    return numericComplex.mul(iOver2, logPart);
  },

  /**
   * Complex atan2: not well-defined for complex, returns atan(a/b)
   */
  atan2: (a, b) => floatingComplex.atan(fractionalComplex.div(a, b)),

  /**
   * Complex hyperbolic sine: sinh(z) = (exp(z) - exp(-z)) / 2
   */
  sinh: (z) => {
    const expZ = floatingComplex.exp(z);
    const expNegZ = floatingComplex.exp(numericComplex.negate(z));
    const diff = numericComplex.sub(expZ, expNegZ);
    return { re: diff.re / 2, im: diff.im / 2 };
  },

  /**
   * Complex hyperbolic cosine: cosh(z) = (exp(z) + exp(-z)) / 2
   */
  cosh: (z) => {
    const expZ = floatingComplex.exp(z);
    const expNegZ = floatingComplex.exp(numericComplex.negate(z));
    const sum = numericComplex.add(expZ, expNegZ);
    return { re: sum.re / 2, im: sum.im / 2 };
  },

  /**
   * Complex hyperbolic tangent: tanh(z) = sinh(z) / cosh(z)
   */
  tanh: (z) => fractionalComplex.div(floatingComplex.sinh(z), floatingComplex.cosh(z)),
};

/**
 * Imaginary unit constant: i = 0 + 1i
 */
export const I: Complex = { re: 0, im: 1 };

/**
 * Real unit constant: 1 + 0i
 */
export const ONE: Complex = { re: 1, im: 0 };

/**
 * Zero constant: 0 + 0i
 */
export const ZERO: Complex = { re: 0, im: 0 };

/**
 * Compute the n-th roots of unity: e^(2πik/n) for k = 0, 1, ..., n-1
 */
export function rootsOfUnity(n: number): Complex[] {
  const roots: Complex[] = [];
  for (let k = 0; k < n; k++) {
    const theta = (2 * Math.PI * k) / n;
    roots.push(fromPolar(1, theta));
  }
  return roots;
}

/**
 * Compute all n-th roots of a complex number.
 */
export function nthRoots(z: Complex, n: number): Complex[] {
  if (n <= 0 || !Number.isInteger(n)) {
    throw new RangeError("nthRoots: n must be a positive integer");
  }

  const { r, theta } = toPolar(z);
  const rootR = Math.pow(r, 1 / n);
  const roots: Complex[] = [];

  for (let k = 0; k < n; k++) {
    const rootTheta = (theta + 2 * Math.PI * k) / n;
    roots.push(fromPolar(rootR, rootTheta));
  }

  return roots;
}
