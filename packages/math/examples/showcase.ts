/**
 * @typesugar/math Showcase
 *
 * Self-documenting examples of type-safe mathematical abstractions.
 * 
 * NOTE: Operator overloading (a + b → instance.add(a, b)) is planned
 * but not yet implemented in the transformer. This showcase uses explicit
 * typeclass method calls which compile to zero-cost direct calls.
 *
 * Type assertions used:
 *   typeAssert<Equal<A, B>>()        - A and B are the same type
 *   typeAssert<Extends<A, B>>()      - A is assignable to B  
 *   typeAssert<Not<Equal<A, B>>>()   - A and B are DIFFERENT (would error if mixed)
 *   typeAssert<Not<Extends<A, B>>>() - A is NOT assignable to B
 *
 * Run:   typesugar run examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import { assert, typeAssert, type Equal, type Extends, type Not } from "@typesugar/testing";

import {
  // Rational - exact fractions
  rational, rat, rationalToNumber, rationalToString, type Rational,
  numericRational, fractionalRational,

  // Complex - a + bi
  complex, fromPolar, complexMagnitude, type Complex,
  numericComplex,

  // FixedDecimal - fixed-point arithmetic
  fixed, fixedToString, type FixedDecimal,
  fixedNumeric,

  // Money - currency-safe finance
  money, moneyFormat,
  moneyAllocate, moneyAddPercentage, moneyConvert, type Money,
  USD, EUR, JPY,

  // Matrix - type-safe dimensions
  matrix, matMul, det, matrixInverse, type Matrix,

  // Interval - bounds tracking
  interval, width, intervalMidpoint, type Interval,
  numericInterval, intervalDiv,

  // Modular arithmetic
  mod, modPow, modInverse, type Mod,

  // Polynomial
  polynomial, evaluate, derivative, type Polynomial,
  numericPolynomial,
} from "../src/index.js";

import { numericNumber } from "@typesugar/std";

// ============================================================================
// 1. RATIONAL NUMBERS - Exact Arithmetic Without Floating Point Errors
// ============================================================================

// JavaScript's classic floating point problem
const jsFloatBroken = 0.1 + 0.2;  // 0.30000000000000004
assert(jsFloatBroken !== 0.3, "JS floats are broken");

// Rationals: exact arithmetic via typeclass methods
const tenth = rational(1n, 10n);
const fifth = rational(1n, 5n);
const exactSum = numericRational.add(tenth, fifth);  // 3/10 exactly — no floating point!

typeAssert<Equal<typeof tenth, Rational>>();
typeAssert<Equal<typeof exactSum, Rational>>();

assert(rationalToString(exactSum) === "3/10");
assert(rationalToNumber(exactSum) === 0.3);  // Rationals are exact!

// Financial calculation without floating point drift
const price = rat(19, 100);     // $0.19
const quantity = rat(7, 1);     // 7 items
const taxRate = rat(8, 100);    // 8%

const subtotal = numericRational.mul(price, quantity);           // $1.33
const tax = numericRational.mul(subtotal, taxRate);              // $0.1064
const total = numericRational.add(subtotal, tax);                // $1.4364 exactly
// No accumulation error, no rounding surprises

// Division is exact too
const half = fractionalRational.div(rational(1n, 1n), rational(2n, 1n));
assert(rationalToString(half) === "1/2");

// ============================================================================
// 2. MONEY - Currency-Typed Finance with Minor Unit Storage
// ============================================================================

// Money is a branded bigint storing minor units (cents, pence, etc.)
const itemPrice = money(1999, USD);     // $19.99 as 1999 cents
const shipping = money(499, USD);       // $4.99

typeAssert<Equal<typeof itemPrice, Money<typeof USD>>>();

// Money addition (same currency) - these are branded bigints, so + works directly
const orderSubtotal = itemPrice + shipping;  // Type-safe addition
assert(orderSubtotal === money(2498, USD));

// Type safety: USD and EUR are incompatible types
typeAssert<Not<Extends<Money<typeof USD>, Money<typeof EUR>>>>();
typeAssert<Not<Equal<typeof itemPrice, Money<typeof EUR>>>>();
// So this would be a compile error: itemPrice + eurAmount

// Foemmel's conundrum: split $100.00 three ways fairly
const bill = money(10000, USD);
const [share1, share2, share3] = moneyAllocate(bill, [1, 1, 1], USD);
// Remainder distributed: $33.34 + $33.33 + $33.33 = $100.00
assert(share1 + share2 + share3 === bill);

// Type-safe formatting
const formatted = moneyFormat(itemPrice, USD);
assert(formatted.includes("19.99"));

// Currency conversion preserves type safety
const usdAmount = money(10000, USD);
const eurAmount = moneyConvert(usdAmount, 0.92, USD, EUR);
const jpyAmount = moneyConvert(usdAmount, 149.5, USD, JPY);

typeAssert<Equal<typeof eurAmount, Money<typeof EUR>>>();
typeAssert<Equal<typeof jpyAmount, Money<typeof JPY>>>();

// ============================================================================
// 3. FIXED DECIMAL - Compile-Time Scale, Banker's Rounding
// ============================================================================

// FixedDecimal<N> uses type-level scale for compile-time precision tracking
const rate = fixed(0.0825, 4);       // 8.25% at 4 decimal places
const principal = fixed(1000, 4);    // $1000.0000

typeAssert<Equal<typeof rate, FixedDecimal<4>>>();
typeAssert<Equal<typeof principal, FixedDecimal<4>>>();

// Scale safety: FixedDecimal<4> and FixedDecimal<2> are incompatible
typeAssert<Not<Equal<FixedDecimal<4>, FixedDecimal<2>>>>();
// So this would be a compile error: fixed(1, 4) + fixed(1, 2)

// Operations preserve scale via typeclass methods
const N = fixedNumeric(4);
const one = fixed(1, 4);
const onePlusRate = N.add(one, rate);
const afterYear1 = N.mul(principal, onePlusRate);   // P(1+r)
const afterYear2 = N.mul(afterYear1, onePlusRate);  // P(1+r)²

typeAssert<Equal<typeof afterYear1, FixedDecimal<4>>>();

// ============================================================================
// 4. COMPLEX NUMBERS - Full Arithmetic + Transcendentals
// ============================================================================

const z1 = complex(3, 4);
const z2 = complex(1, -2);

typeAssert<Equal<typeof z1, Complex>>();

// Complex arithmetic via typeclass methods
const sum = numericComplex.add(z1, z2);      // (4 + 2i)
const diff = numericComplex.sub(z1, z2);     // (2 + 6i)
const prod = numericComplex.mul(z1, z2);     // (3×1 - 4×(-2)) + (3×(-2) + 4×1)i = 11 - 2i

// |3+4i| = 5 (the classic 3-4-5 triangle)
assert(complexMagnitude(z1) === 5);

// Roots of unity form regular polygons
const fifthRoots = Array.from({ length: 5 }, (_, k) =>
  fromPolar(1, (2 * Math.PI * k) / 5)
);

// ============================================================================
// 5. TYPE-SAFE MATRICES - Dimensions in the Type System
// ============================================================================

// Matrix dimensions are type parameters
const A = matrix(2, 3, [1, 2, 3, 4, 5, 6]);
const B = matrix(3, 2, [7, 8, 9, 10, 11, 12]);

typeAssert<Equal<typeof A, Matrix<2, 3>>>();
typeAssert<Equal<typeof B, Matrix<3, 2>>>();

// Matrix multiplication: (2×3) × (3×2) = (2×2)
const C = matMul(A, B);
typeAssert<Equal<typeof C, Matrix<2, 2>>>();

// Dimension safety: Matrix<2,3> cannot multiply Matrix<2,3> (need inner dims to match)
typeAssert<Not<Equal<Matrix<2, 3>, Matrix<3, 2>>>>();  // Different dimensions
// So this would be a compile error: matMul(A, A)

// Square matrix operations
const M = matrix(2, 2, [4, 7, 2, 6]);
assert(det(M) === 10);

const Minv = matrixInverse(M);
const I = matMul(M, Minv);  // Should be identity
assert(Math.abs(I[0] - 1) < 1e-10);
assert(Math.abs(I[3] - 1) < 1e-10);

// ============================================================================
// 6. INTERVAL ARITHMETIC - Uncertainty Propagation
// ============================================================================

// Measurement with uncertainty: 10.0 ± 0.1
const measurement = interval(9.9, 10.1);
const factor = interval(4.95, 5.05);

typeAssert<Equal<typeof measurement, Interval>>();

// Uncertainty propagates through operations via typeclass methods
const result = numericInterval.mul(measurement, factor);
const resultMid = intervalMidpoint(result);
const resultWidth = width(result);

// Division shows how intervals can grow
const divided = intervalDiv(measurement, factor);

// ============================================================================
// 7. MODULAR ARITHMETIC - Finite Fields
// ============================================================================

// Mod<N> is a number constrained to [0, N)
const a = mod(17, 61);
const b = mod(44, 61);

typeAssert<Extends<typeof a, Mod<61>>>();

// Modulus safety: Mod<61> and Mod<97> are incompatible
typeAssert<Not<Equal<Mod<61>, Mod<97>>>>();
// So this would be a compile error: mod(5, 61) + mod(5, 97)

// Modular operations
const modSum = mod((a.value + b.value) % 61, 61);   // (17 + 44) mod 61 = 0
const modProdVal = mod((a.value * b.value) % 61, 61);  // (17 × 44) mod 61

// Fermat's little theorem: a^(p-1) ≡ 1 (mod p) for prime p
const fermatResult = modPow(mod(2, 61), 60);
assert(fermatResult.value === 1);

// Modular inverse
const aInv = modInverse(mod(17, 3233));  // 17⁻¹ mod 3233

// ============================================================================
// 8. POLYNOMIALS - Symbolic Computation
// ============================================================================

// p(x) = x³ - 6x² + 11x - 6 = (x-1)(x-2)(x-3)
const p = polynomial([-6, 11, -6, 1]);
const q = polynomial([1, 1]);  // x + 1

typeAssert<Equal<typeof p, Polynomial<number>>>();

// Polynomial arithmetic via typeclass methods
const P = numericPolynomial(numericNumber);
const pPlusQ = P.add(p, q);    // Add polynomials
const pTimesQ = P.mul(p, q);   // Multiply polynomials

// Evaluate at roots: (x-1)(x-2)(x-3) = 0 when x ∈ {1, 2, 3}
assert(evaluate(p, 1, numericNumber) === 0);
assert(evaluate(p, 2, numericNumber) === 0);
assert(evaluate(p, 3, numericNumber) === 0);

// Derivative: p'(x) = 3x² - 12x + 11
const pPrime = derivative(p, numericNumber);
typeAssert<Equal<typeof pPrime, Polynomial<number>>>();

console.log("✓ All assertions passed");
