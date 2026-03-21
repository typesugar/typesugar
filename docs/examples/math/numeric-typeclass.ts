//! Math Types
//! Complex, Rational, Matrix — with Numeric typeclass operator overloading

import { complex, numericComplex, complexEquals, complexToString, complexMagnitude, rat, rational, matrix, interval } from "@typesugar/math";

// @typesugar/math provides Numeric instances with @op annotations.
// 👀 Check JS Output — a + b and a * b rewrite to numericComplex.add/mul!

// --- Complex numbers ---
const a = complex(3, 4);
const b = complex(1, -2);
const sum = a + b;
const product = a * b;

console.log(`${complexToString(a)} + ${complexToString(b)} = ${complexToString(sum)}`);
console.log(`${complexToString(a)} * ${complexToString(b)} = ${complexToString(product)}`);
console.log(`|${complexToString(a)}| = ${complexMagnitude(a)}`);  // 5

// --- Rational numbers (exact fractions) ---
const half = rat(1, 2);
const third = rat(1, 3);
console.log("\n--- Rational ---");
console.log("1/2 =", half);
console.log("1/3 =", third);

// --- Matrix (typed dimensions) ---
const m = matrix(2, 2, [1, 2, 3, 4]);
console.log("\n--- Matrix ---");
console.log("2x2 matrix:", m);

// --- Interval arithmetic ---
const range = interval(0.9, 1.1);
console.log("\n--- Interval ---");
console.log("range:", range);

// Try: compute a * conjugate(a) where conjugate(3+4i) = (3-4i) → should give |a|² = 25
