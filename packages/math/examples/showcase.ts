/**
 * @typesugar/math Showcase Examples
 *
 * Demonstrating the power of type-safe mathematical abstractions.
 */

import {
  // Rational - exact fractions
  rational, rat, rationalToNumber, rationalToString,
  numericRational, fractionalRational,
  
  // Complex - a + bi
  complex, fromPolar, complexMagnitude, phase, conjugate,
  numericComplex, floatingComplex,
  
  // BigDecimal - arbitrary precision
  bigDecimal, bigDecimalFromString, toFixed,
  numericBigDecimal,
  
  // Matrix - type-safe dimensions
  matrix, identity, zeros, matMul, transpose, det, matrixInverse,
  
  // Interval - bounds tracking
  interval, intervalPoint, hull, width, intervalMidpoint,
  numericInterval,
  
  // Modular arithmetic
  mod, modPow, modInverse, isPrime,
  
  // Polynomial
  polynomial, evaluate, derivative,
  numericPolynomial,
  
  // Typeclasses
  type VectorSpace, type InnerProduct,
  vectorSpaceVec2, innerProductVec2, normedVec2,
} from "../src/index.js";

import { numericNumber } from "@typesugar/std";

// ============================================================================
// 1. RATIONAL NUMBERS - Exact Arithmetic Without Floating Point Errors
// ============================================================================

console.log("=== Rational Numbers ===\n");

// The classic floating point problem: 0.1 + 0.2 !== 0.3
console.log("JavaScript floating point:");
console.log(`  0.1 + 0.2 = ${0.1 + 0.2}`);
console.log(`  0.1 + 0.2 === 0.3? ${0.1 + 0.2 === 0.3}`);

// With rationals: exact!
const tenth = rational(1n, 10n);
const fifth = rational(1n, 5n);
const sum = numericRational.add(tenth, fifth);
console.log("\nRational arithmetic:");
console.log(`  1/10 + 1/5 = ${rationalToString(sum)}`);
console.log(`  As decimal: ${rationalToNumber(sum)}`);

// Financial calculations stay exact
const price = rat(19, 100);  // $0.19
const quantity = rat(7, 1);   // 7 items
const tax = rat(8, 100);      // 8% tax

const subtotal = numericRational.mul(price, quantity);
const taxAmount = numericRational.mul(subtotal, tax);
const total = numericRational.add(subtotal, taxAmount);

console.log("\nFinancial calculation:");
console.log(`  7 items × $0.19 = $${rationalToString(subtotal)}`);
console.log(`  + 8% tax = $${rationalToString(taxAmount)}`);
console.log(`  Total: $${rationalToString(total)} = $${rationalToNumber(total).toFixed(2)}`);

// ============================================================================
// 2. COMPLEX NUMBERS - From Basics to Transcendentals
// ============================================================================

console.log("\n=== Complex Numbers ===\n");

// Basic arithmetic
const z1 = complex(3, 4);
const z2 = complex(1, -2);

console.log(`z1 = 3 + 4i, |z1| = ${complexMagnitude(z1)}`);  // Classic 3-4-5 triangle
console.log(`z2 = 1 - 2i`);

const product = numericComplex.mul(z1, z2);
console.log(`z1 × z2 = ${product.re} + ${product.im}i`);

// Euler's identity: e^(iπ) + 1 = 0
const eulerResult = floatingComplex.exp(complex(0, Math.PI));
console.log(`\nEuler's identity: e^(iπ) = ${eulerResult.re.toFixed(10)} + ${eulerResult.im.toFixed(10)}i`);
console.log(`(Should be -1 + 0i, the tiny error is floating point)`);

// Roots of unity: the n-th roots of 1 form a regular n-gon
console.log("\n5th roots of unity (regular pentagon):");
for (let k = 0; k < 5; k++) {
  const root = fromPolar(1, (2 * Math.PI * k) / 5);
  console.log(`  ω${k} = ${root.re.toFixed(4)} + ${root.im.toFixed(4)}i`);
}

// ============================================================================
// 3. MATRICES - Type-Safe Dimensions Prevent Runtime Errors
// ============================================================================

console.log("\n=== Type-Safe Matrices ===\n");

// Create a 2x3 matrix
const A = matrix(2, 3, [
  1, 2, 3,
  4, 5, 6
]);

// Create a 3x2 matrix
const B = matrix(3, 2, [
  7, 8,
  9, 10,
  11, 12
]);

// Matrix multiplication: (2x3) × (3x2) = (2x2) - types ensure compatibility!
const C = matMul(A, B);
console.log("A (2×3) × B (3×2) = C (2×2):");
console.log(`  [${C[0]}, ${C[1]}]`);
console.log(`  [${C[2]}, ${C[3]}]`);

// This would be a TYPE ERROR (uncomment to see):
// const D = matMul(A, A);  // Error: Cannot multiply 2×3 by 2×3

// Square matrix operations
const M = matrix(2, 2, [4, 7, 2, 6]);
console.log(`\nMatrix M = [[4, 7], [2, 6]]`);
console.log(`  det(M) = ${det(M)}`);

const Minv = matrixInverse(M);
console.log(`  M⁻¹ = [[${Minv[0].toFixed(2)}, ${Minv[1].toFixed(2)}], [${Minv[2].toFixed(2)}, ${Minv[3].toFixed(2)}]]`);

// Verify: M × M⁻¹ = I
const shouldBeI = matMul(M, Minv);
console.log(`  M × M⁻¹ ≈ [[${shouldBeI[0].toFixed(2)}, ${shouldBeI[1].toFixed(2)}], [${shouldBeI[2].toFixed(2)}, ${shouldBeI[3].toFixed(2)}]]`);

// ============================================================================
// 4. INTERVAL ARITHMETIC - Track Uncertainty Through Calculations
// ============================================================================

console.log("\n=== Interval Arithmetic ===\n");

// Measurement with uncertainty: 10.0 ± 0.1
const measurement = interval(9.9, 10.1);

// Another measurement: 5.0 ± 0.05  
const factor = interval(4.95, 5.05);

// Propagate uncertainty through calculations
const result = numericInterval.mul(measurement, factor);

console.log("Uncertainty propagation:");
console.log(`  (10.0 ± 0.1) × (5.0 ± 0.05)`);
console.log(`  = [${result.lo.toFixed(4)}, ${result.hi.toFixed(4)}]`);
console.log(`  = ${intervalMidpoint(result).toFixed(4)} ± ${(width(result) / 2).toFixed(4)}`);

// Division shows how intervals can grow
const divided = numericInterval.mul(measurement, interval(0.19, 0.21));
console.log(`\n(10.0 ± 0.1) × (0.2 ± 0.01)`);
console.log(`  = [${divided.lo.toFixed(4)}, ${divided.hi.toFixed(4)}]`);

// ============================================================================
// 5. MODULAR ARITHMETIC - Cryptography Foundations
// ============================================================================

console.log("\n=== Modular Arithmetic ===\n");

// RSA-style operations (tiny example)
const p = 61;
const q = 53;
const n = p * q;  // 3233

console.log(`RSA-style example with small primes:`);
console.log(`  p = ${p}, q = ${q}, n = p×q = ${n}`);

// Fermat's little theorem: a^(p-1) ≡ 1 (mod p) for prime p
const base = mod(2, 61);
const fermatResult = modPow(base, 60);
console.log(`\nFermat's little theorem: 2^60 mod 61 = ${fermatResult.value}`);
console.log(`  (Should be 1 since 61 is prime)`);

// Modular inverse for encryption/decryption
const a = mod(17, 3233);
const aInv = modInverse(a);
console.log(`\nModular inverse: 17⁻¹ mod 3233 = ${aInv?.value}`);

// Verify: a × a⁻¹ ≡ 1 (mod n)
if (aInv) {
  const product = mod((17 * aInv.value) % 3233, 3233);
  console.log(`  Verify: 17 × ${aInv.value} mod 3233 = ${product.value}`);
}

// ============================================================================
// 6. POLYNOMIALS - Symbolic Math
// ============================================================================

console.log("\n=== Polynomials ===\n");

// poly(x) = x³ - 6x² + 11x - 6 = (x-1)(x-2)(x-3)
const poly = polynomial([
  -6,  // constant term
  11,  // x¹
  -6,  // x²
  1    // x³
]);

console.log("poly(x) = x³ - 6x² + 11x - 6");
console.log("       = (x-1)(x-2)(x-3)");

// Evaluate at roots
console.log(`\nEvaluating at roots:`);
console.log(`  poly(1) = ${evaluate(poly, 1, numericNumber)}`);
console.log(`  poly(2) = ${evaluate(poly, 2, numericNumber)}`);
console.log(`  poly(3) = ${evaluate(poly, 3, numericNumber)}`);

// Derivative: poly'(x) = 3x² - 12x + 11
const polyPrime = derivative(poly, numericNumber);
console.log(`\npoly'(x) = ${polyPrime.coeffs[2]}x² + ${polyPrime.coeffs[1]}x + ${polyPrime.coeffs[0]}`);

// Find critical points (where poly'(x) = 0)
// Using quadratic formula: x = (12 ± √(144-132)) / 6 = (12 ± √12) / 6
const discriminant = 144 - 4 * 3 * 11;
const x1 = (12 - Math.sqrt(discriminant)) / 6;
const x2 = (12 + Math.sqrt(discriminant)) / 6;
console.log(`\nCritical points: x ≈ ${x1.toFixed(3)}, ${x2.toFixed(3)}`);
console.log(`  poly(${x1.toFixed(3)}) ≈ ${evaluate(poly, x1, numericNumber).toFixed(3)} (local max)`);
console.log(`  poly(${x2.toFixed(3)}) ≈ ${evaluate(poly, x2, numericNumber).toFixed(3)} (local min)`);

// ============================================================================
// 7. VECTOR SPACES - Generic Linear Algebra
// ============================================================================

console.log("\n=== Vector Spaces (with Geometry) ===\n");

// The VectorSpace typeclass abstracts over any vector-like structure
// Works with Vec2 from @typesugar/geometry via the bridge module

// Dot product and norms
const v1 = [3, 4] as const;  // Vec2-like
const v2 = [1, 0] as const;

// Using the typeclass instances
const dotProduct = innerProductVec2.dot(v1 as any, v2 as any);
const norm1 = normedVec2.norm(v1 as any);

console.log(`v1 = [3, 4], v2 = [1, 0]`);
console.log(`  v1 · v2 = ${dotProduct}`);
console.log(`  |v1| = ${norm1}`);
console.log(`  |v2| = ${normedVec2.norm(v2 as any)}`);

// Vector addition and scaling via VectorSpace
const v3 = vectorSpaceVec2.vAdd(v1 as any, v2 as any);
const v4 = vectorSpaceVec2.vScale(2, v1 as any);

console.log(`\n  v1 + v2 = [${v3[0]}, ${v3[1]}]`);
console.log(`  2 × v1 = [${v4[0]}, ${v4[1]}]`);

// ============================================================================
// 8. PUTTING IT ALL TOGETHER - Signal Processing Example
// ============================================================================

console.log("\n=== Signal Processing Example ===\n");

// Represent a signal as a polynomial (discrete samples → polynomial interpolation)
// Then analyze it using complex numbers (DFT-style)

const samples = polynomial([1, 2, 3, 2, 1]);  // Simple symmetric signal
console.log("Signal samples: [1, 2, 3, 2, 1]");

// Evaluate at complex roots of unity (simplified DFT)
console.log("\nFrequency components (DFT-style):");
const N = 5;
for (let k = 0; k < N; k++) {
  const omega = fromPolar(1, -2 * Math.PI * k / N);
  
  // Evaluate polynomial at ω^k using Horner's method with complex arithmetic
  let result = complex(0, 0);
  for (let i = samples.coeffs.length - 1; i >= 0; i--) {
    result = numericComplex.add(
      numericComplex.mul(result, omega),
      complex(samples.coeffs[i], 0)
    );
  }
  
  console.log(`  X[${k}] = ${result.re.toFixed(3)} + ${result.im.toFixed(3)}i, |X[${k}]| = ${complexMagnitude(result).toFixed(3)}`);
}

console.log("\n✨ All examples completed!");
