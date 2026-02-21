/**
 * Polynomial<F> - Polynomials over any ring
 *
 * Polynomials are represented as arrays of coefficients where
 * coeffs[i] is the coefficient of x^i. The polynomial ring F[x]
 * inherits algebraic structure from the coefficient ring F.
 *
 * @example
 * ```typescript
 * import { numericNumber } from "@typesugar/std";
 *
 * // p(x) = 1 + 2x + 3x²
 * const p = polynomial([1, 2, 3]);
 *
 * // Evaluate at x = 2
 * evaluate(p, 2, numericNumber);  // 1 + 4 + 12 = 17
 *
 * // Arithmetic
 * const q = polynomial([1, 1]);  // 1 + x
 * const sum = addPoly(p, q, numericNumber);  // 2 + 3x + 3x²
 * const prod = mulPoly(p, q, numericNumber); // 1 + 3x + 5x² + 3x³
 * ```
 */

import type { Numeric, Fractional } from "@typesugar/std";
import type { Op } from "@typesugar/core";

// ============================================================================
// Type Definition
// ============================================================================

/**
 * A polynomial with coefficients of type F.
 * coeffs[i] is the coefficient of x^i.
 * Leading zeros are trimmed.
 */
export interface Polynomial<F> {
  readonly coeffs: readonly F[];
}

// ============================================================================
// Constructors
// ============================================================================

/**
 * Create a polynomial from coefficients.
 * Trims trailing zeros.
 */
export function polynomial<F>(coeffs: F[]): Polynomial<F> {
  // Trim trailing zeros
  let end = coeffs.length;
  while (end > 0 && isZeroCoeff(coeffs[end - 1])) {
    end--;
  }
  return { coeffs: coeffs.slice(0, end) };
}

/**
 * Create a constant polynomial c.
 */
export function constant<F>(c: F): Polynomial<F> {
  if (isZeroCoeff(c)) {
    return { coeffs: [] };
  }
  return { coeffs: [c] };
}

/**
 * Create a monomial coeff * x^degree.
 */
export function monomial<F>(coeff: F, degree: number, zero: F): Polynomial<F> {
  if (isZeroCoeff(coeff)) {
    return { coeffs: [] };
  }
  const coeffs = new Array(degree + 1).fill(zero);
  coeffs[degree] = coeff;
  return { coeffs };
}

/**
 * Create the zero polynomial.
 */
export function zeroPoly<F>(): Polynomial<F> {
  return { coeffs: [] };
}

/**
 * Create the polynomial 1.
 */
export function onePoly<F>(N: Numeric<F>): Polynomial<F> {
  return { coeffs: [N.one()] };
}

/**
 * Create the polynomial x.
 */
export function xPoly<F>(N: Numeric<F>): Polynomial<F> {
  return { coeffs: [N.zero(), N.one()] };
}

// ============================================================================
// Helper Functions
// ============================================================================

function isZeroCoeff(c: unknown): boolean {
  if (typeof c === "number") return c === 0;
  if (typeof c === "bigint") return c === 0n;
  return false;
}

function isZeroCoeffWith<F>(c: F, N: Numeric<F>): boolean {
  return N.toNumber(c) === 0;
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Get the degree of a polynomial.
 * The zero polynomial has degree -1 by convention.
 */
export function degree<F>(p: Polynomial<F>): number {
  return p.coeffs.length - 1;
}

/**
 * Check if the polynomial is zero.
 */
export function isZero<F>(p: Polynomial<F>): boolean {
  return p.coeffs.length === 0;
}

/**
 * Get the leading coefficient.
 * Returns undefined for the zero polynomial.
 */
export function leading<F>(p: Polynomial<F>): F | undefined {
  if (p.coeffs.length === 0) return undefined;
  return p.coeffs[p.coeffs.length - 1];
}

/**
 * Get the coefficient of x^n.
 */
export function coeff<F>(p: Polynomial<F>, n: number, N: Numeric<F>): F {
  if (n < 0 || n >= p.coeffs.length) return N.zero();
  return p.coeffs[n];
}

// ============================================================================
// Evaluation
// ============================================================================

/**
 * Evaluate the polynomial at a point using Horner's method.
 * This is O(n) and numerically stable.
 */
export function evaluate<F>(p: Polynomial<F>, x: F, N: Numeric<F>): F {
  if (p.coeffs.length === 0) {
    return N.zero();
  }

  // Horner's method: p(x) = c0 + x(c1 + x(c2 + ...))
  let result = p.coeffs[p.coeffs.length - 1];
  for (let i = p.coeffs.length - 2; i >= 0; i--) {
    result = N.add(N.mul(result, x), p.coeffs[i]);
  }
  return result;
}

// ============================================================================
// Arithmetic Operations
// ============================================================================

/**
 * Add two polynomials.
 */
export function addPoly<F>(a: Polynomial<F>, b: Polynomial<F>, N: Numeric<F>): Polynomial<F> {
  const maxLen = Math.max(a.coeffs.length, b.coeffs.length);
  const result: F[] = [];

  for (let i = 0; i < maxLen; i++) {
    const ai = i < a.coeffs.length ? a.coeffs[i] : N.zero();
    const bi = i < b.coeffs.length ? b.coeffs[i] : N.zero();
    result.push(N.add(ai, bi));
  }

  return polynomial(result);
}

/**
 * Subtract two polynomials.
 */
export function subPoly<F>(a: Polynomial<F>, b: Polynomial<F>, N: Numeric<F>): Polynomial<F> {
  const maxLen = Math.max(a.coeffs.length, b.coeffs.length);
  const result: F[] = [];

  for (let i = 0; i < maxLen; i++) {
    const ai = i < a.coeffs.length ? a.coeffs[i] : N.zero();
    const bi = i < b.coeffs.length ? b.coeffs[i] : N.zero();
    result.push(N.sub(ai, bi));
  }

  return polynomial(result);
}

/**
 * Multiply two polynomials (convolution).
 */
export function mulPoly<F>(a: Polynomial<F>, b: Polynomial<F>, N: Numeric<F>): Polynomial<F> {
  if (a.coeffs.length === 0 || b.coeffs.length === 0) {
    return zeroPoly();
  }

  const resultLen = a.coeffs.length + b.coeffs.length - 1;
  const result: F[] = new Array(resultLen).fill(null).map(() => N.zero());

  for (let i = 0; i < a.coeffs.length; i++) {
    for (let j = 0; j < b.coeffs.length; j++) {
      result[i + j] = N.add(result[i + j], N.mul(a.coeffs[i], b.coeffs[j]));
    }
  }

  return polynomial(result);
}

/**
 * Negate a polynomial.
 */
export function negatePoly<F>(p: Polynomial<F>, N: Numeric<F>): Polynomial<F> {
  return { coeffs: p.coeffs.map((c) => N.negate(c)) };
}

/**
 * Multiply a polynomial by a scalar.
 */
export function scalePoly<F>(p: Polynomial<F>, scalar: F, N: Numeric<F>): Polynomial<F> {
  return polynomial(p.coeffs.map((c) => N.mul(c, scalar)));
}

// ============================================================================
// Calculus (for Fractional coefficients)
// ============================================================================

/**
 * Compute the derivative of a polynomial.
 */
export function derivative<F>(p: Polynomial<F>, N: Numeric<F>): Polynomial<F> {
  if (p.coeffs.length <= 1) {
    return zeroPoly();
  }

  const result: F[] = [];
  for (let i = 1; i < p.coeffs.length; i++) {
    result.push(N.mul(p.coeffs[i], N.fromNumber(i)));
  }

  return polynomial(result);
}

/**
 * Compute the indefinite integral of a polynomial (with constant 0).
 * Requires Fractional for division.
 */
export function integral<F>(p: Polynomial<F>, N: Numeric<F>, F: Fractional<F>): Polynomial<F> {
  if (p.coeffs.length === 0) {
    return zeroPoly();
  }

  const result: F[] = [N.zero()]; // constant of integration
  for (let i = 0; i < p.coeffs.length; i++) {
    result.push(F.div(p.coeffs[i], N.fromNumber(i + 1)));
  }

  return polynomial(result);
}

/**
 * Compute the nth derivative.
 */
export function nthDerivative<F>(p: Polynomial<F>, n: number, N: Numeric<F>): Polynomial<F> {
  let result = p;
  for (let i = 0; i < n; i++) {
    result = derivative(result, N);
  }
  return result;
}

// ============================================================================
// Polynomial Division
// ============================================================================

/**
 * Polynomial long division.
 * Returns [quotient, remainder] such that a = b * quotient + remainder.
 * Requires Fractional for coefficient division.
 */
export function divPoly<F>(
  a: Polynomial<F>,
  b: Polynomial<F>,
  N: Numeric<F>,
  Fr: Fractional<F>
): [Polynomial<F>, Polynomial<F>] {
  if (isZero(b)) {
    throw new RangeError("Polynomial division by zero");
  }

  if (degree(a) < degree(b)) {
    return [zeroPoly(), a];
  }

  const leadB = leading(b)!;
  let remainder: Polynomial<F> = { coeffs: [...a.coeffs] };
  const quotCoeffs: F[] = new Array(degree(a) - degree(b) + 1).fill(N.zero());

  while (!isZero(remainder) && degree(remainder) >= degree(b)) {
    const leadR = leading(remainder)!;
    const coeff = Fr.div(leadR, leadB);
    const degDiff = degree(remainder) - degree(b);
    quotCoeffs[degDiff] = coeff;

    // Subtract coeff * x^degDiff * b from remainder
    const subtrahend = scalePoly(b, coeff, N);
    const shifted = shiftPoly(subtrahend, degDiff, N);
    remainder = subPoly(remainder, shifted, N);
  }

  return [polynomial(quotCoeffs), remainder];
}

/**
 * Shift polynomial by n (multiply by x^n).
 */
function shiftPoly<F>(p: Polynomial<F>, n: number, N: Numeric<F>): Polynomial<F> {
  if (n === 0 || isZero(p)) return p;
  const padding = new Array(n).fill(N.zero());
  return { coeffs: [...padding, ...p.coeffs] };
}

/**
 * Compute GCD of two polynomials (Euclidean algorithm).
 * Returns a monic polynomial.
 */
export function gcdPoly<F>(
  a: Polynomial<F>,
  b: Polynomial<F>,
  N: Numeric<F>,
  Fr: Fractional<F>
): Polynomial<F> {
  while (!isZero(b)) {
    const [, r] = divPoly(a, b, N, Fr);
    a = b;
    b = r;
  }

  // Make monic
  const lead = leading(a);
  if (lead === undefined) return zeroPoly();
  return scalePoly(a, Fr.recip(lead), N);
}

// ============================================================================
// Root Finding (for number coefficients)
// ============================================================================

/**
 * Find all rational roots of a polynomial with integer coefficients.
 * Uses the rational root theorem.
 */
export function rationalRoots(p: Polynomial<number>): number[] {
  if (p.coeffs.length === 0) return [];

  const a0 = Math.abs(Math.round(p.coeffs[0]));
  const an = Math.abs(Math.round(p.coeffs[p.coeffs.length - 1]));

  if (a0 === 0) {
    // 0 is a root; factor it out and recurse
    const reduced = polynomial(p.coeffs.slice(1));
    return [0, ...rationalRoots(reduced)];
  }

  const roots: number[] = [];
  const factorsA0 = factors(a0);
  const factorsAn = factors(an);

  for (const p0 of factorsA0) {
    for (const pn of factorsAn) {
      const candidate = p0 / pn;
      for (const sign of [1, -1]) {
        const x = sign * candidate;
        const y = evaluate(p, x, numericNumberLocal);
        if (Math.abs(y) < 1e-10) {
          if (!roots.includes(x)) {
            roots.push(x);
          }
        }
      }
    }
  }

  return roots.sort((a, b) => a - b);
}

function factors(n: number): number[] {
  const result: number[] = [];
  for (let i = 1; i * i <= n; i++) {
    if (n % i === 0) {
      result.push(i);
      if (i !== n / i) {
        result.push(n / i);
      }
    }
  }
  return result;
}

// Local copy of numericNumber to avoid circular dependency
const numericNumberLocal: Numeric<number> = {
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  negate: (a) => -a,
  abs: Math.abs,
  signum: Math.sign,
  fromNumber: (n) => n,
  toNumber: (a) => a,
  zero: () => 0,
  one: () => 1,
};

// ============================================================================
// Typeclass Instance
// ============================================================================

/**
 * Numeric instance for polynomials over F.
 * Forms the polynomial ring F[x].
 */
export function numericPolynomial<F>(N: Numeric<F>): Numeric<Polynomial<F>> {
  return {
    add: (a, b) => addPoly(a, b, N) as Polynomial<F> & Op<"+">,
    sub: (a, b) => subPoly(a, b, N) as Polynomial<F> & Op<"-">,
    mul: (a, b) => mulPoly(a, b, N) as Polynomial<F> & Op<"*">,
    negate: (a) => negatePoly(a, N),
    abs: (a) => a, // no meaningful abs for polynomials
    signum: (a) => (isZero(a) ? zeroPoly() : onePoly(N)),
    fromNumber: (n) => constant(N.fromNumber(n)),
    toNumber: (a) => (a.coeffs.length > 0 ? N.toNumber(a.coeffs[0]) : 0),
    zero: zeroPoly,
    one: () => onePoly(N),
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if two polynomials are equal.
 */
export function equals<F>(a: Polynomial<F>, b: Polynomial<F>, N: Numeric<F>): boolean {
  if (a.coeffs.length !== b.coeffs.length) return false;
  for (let i = 0; i < a.coeffs.length; i++) {
    const diff = N.toNumber(N.sub(a.coeffs[i], b.coeffs[i]));
    if (Math.abs(diff) > 1e-10) return false;
  }
  return true;
}

/**
 * Pretty-print a polynomial.
 */
export function toString<F>(p: Polynomial<F>, N: Numeric<F>): string {
  if (p.coeffs.length === 0) return "0";

  const terms: string[] = [];
  for (let i = p.coeffs.length - 1; i >= 0; i--) {
    const c = N.toNumber(p.coeffs[i]);
    if (Math.abs(c) < 1e-10) continue;

    let term = "";
    if (i === 0) {
      term = formatCoeff(c);
    } else if (i === 1) {
      term = formatCoeff(c, true) + "x";
    } else {
      term = formatCoeff(c, true) + "x^" + i;
    }

    if (terms.length > 0 && c > 0) {
      term = "+ " + term;
    } else if (c < 0 && terms.length > 0) {
      term = "- " + formatCoeff(-c, i > 0) + (i > 0 ? "x" : "") + (i > 1 ? "^" + i : "");
    }

    terms.push(term);
  }

  return terms.length > 0 ? terms.join(" ") : "0";
}

function formatCoeff(c: number, hideOne = false): string {
  if (hideOne && Math.abs(c) === 1) return c < 0 ? "-" : "";
  return Number.isInteger(c) ? String(c) : c.toFixed(4);
}

/**
 * Compose two polynomials: compute p(q(x)).
 */
export function compose<F>(p: Polynomial<F>, q: Polynomial<F>, N: Numeric<F>): Polynomial<F> {
  if (isZero(p)) return zeroPoly();

  // p(q(x)) = c_0 + c_1*q(x) + c_2*q(x)² + ...
  let result = constant(p.coeffs[p.coeffs.length - 1]);
  for (let i = p.coeffs.length - 2; i >= 0; i--) {
    result = addPoly(mulPoly(result, q, N), constant(p.coeffs[i]), N);
  }

  return result;
}
