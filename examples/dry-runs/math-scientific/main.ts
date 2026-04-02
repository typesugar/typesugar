/**
 * Scientific Computing Application using TypeSugar
 *
 * A comprehensive test of TypeSugar packages for math/scientific use cases.
 * Uses: comptime, @typesugar/math, @typesugar/symbolic, @typesugar/std,
 *       @typesugar/units, @typesugar/contracts, @typesugar/type-system,
 *       @typesugar/derive.
 */

import { comptime } from "typesugar";
import { derive, Eq, Clone, Debug } from "@typesugar/derive";
import {
  complex, complexMagnitude, complexToString, conjugate, numericComplex,
  rational, numericRational, rationalToString, rationalToNumber,
  matrix, det, transpose, matMul, identity, matrixToString,
  interval, intervalMul, intervalToString, width,
  polynomial, derivative, polyToString, evaluate as polyEval,
} from "@typesugar/math";
import { numericNumber, match } from "@typesugar/std";
import { meters, seconds, kilograms, units } from "@typesugar/units";
import {
  var_, const_, pow, sin, cos, add, mul,
  diff, integrate, simplify,
  evaluate, toText, toLatex,
} from "@typesugar/symbolic";
import "@typesugar/contracts";
import { requires, PreconditionError } from "@typesugar/contracts";
import {
  type Refined, Positive, NonZero, type Newtype, wrap, unwrap,
} from "@typesugar/type-system";

// ============================================================================
// 1. Compile-Time Constants
// ============================================================================
console.log("=== Compile-Time Constants ===");
const PI = comptime(Math.PI);
const E_ = comptime(Math.E);
const PHI = comptime((1 + Math.sqrt(5)) / 2);
const AVOGADRO = comptime(6.02214076e23);
console.log(`pi = ${PI}`);
console.log(`e  = ${E_}`);
console.log(`phi = ${PHI}`);
console.log(`N_A = ${AVOGADRO}`);

// ============================================================================
// 2. Derived Classes for Scientific Data
// ============================================================================
console.log("\n=== Derived Classes ===");

@derive(Eq, Clone, Debug)
class Measurement {
  constructor(
    public value: number,
    public uncertainty: number,
    public unit: string,
  ) {}
}

@derive(Eq, Clone, Debug)
class Particle {
  constructor(
    public name: string,
    public mass: number,
    public charge: number,
  ) {}
}

const m1 = new Measurement(9.81, 0.01, "m/s^2");
const m2 = new Measurement(9.81, 0.01, "m/s^2");
const m3 = (Measurement as any).Clone.clone(m1);
console.log("m1:", (Measurement as any).Debug.debug(m1));
console.log("m1 == m2:", (Measurement as any).Eq.equals(m1, m2));
console.log("m1 == m3 (clone):", (Measurement as any).Eq.equals(m1, m3));

const electron = new Particle("electron", 9.109e-31, -1.602e-19);
const proton = new Particle("proton", 1.673e-27, 1.602e-19);
console.log("electron:", (Particle as any).Debug.debug(electron));
console.log("same?", (Particle as any).Eq.equals(electron, proton));

// ============================================================================
// 3. Complex Number Arithmetic (Quantum Mechanics)
// ============================================================================
console.log("\n=== Complex Numbers (Quantum Amplitudes) ===");
const psi1 = complex(0.6, 0.8);
const psi2 = complex(0.3, -0.4);
const psi = numericComplex.add(psi1, psi2);
console.log(`psi1 = ${complexToString(psi1)}`);
console.log(`psi2 = ${complexToString(psi2)}`);
console.log(`psi  = ${complexToString(psi)}`);
const prob = numericComplex.mul(psi, conjugate(psi));
console.log(`|psi|^2 = ${complexToString(prob)} (should be real)`);
console.log(`|psi1| = ${complexMagnitude(psi1)}`);

// ============================================================================
// 4. Rational Arithmetic (Exact Fractions)
// ============================================================================
console.log("\n=== Rational Arithmetic ===");
const ratSum = numericRational.add(rational(1n, 3n), rational(1n, 6n));
console.log(`1/3 + 1/6 = ${rationalToString(ratSum)}`);

let harmonic = rational(0n, 1n);
for (let i = 1; i <= 10; i++) {
  harmonic = numericRational.add(harmonic, rational(1n, BigInt(i)));
}
console.log(`H_10 = ${rationalToString(harmonic)} = ${rationalToNumber(harmonic).toFixed(6)}`);

// ============================================================================
// 5. Matrix Operations (Linear Algebra)
// ============================================================================
console.log("\n=== Matrix Operations ===");
const A = matrix(3, 3, [2, -1, 0, -1, 2, -1, 0, -1, 2]);
console.log("A =", matrixToString(A));
console.log("det(A) =", det(A));
console.log("A^T * A =", matrixToString(matMul(transpose(A), A)));

// ============================================================================
// 6. Interval Arithmetic (Error Propagation)
// ============================================================================
console.log("\n=== Interval Arithmetic ===");
const grav = interval(9.79, 9.83);
const mass_iv = interval(74.9, 75.1);
const weight_iv = intervalMul(mass_iv, grav);
console.log(`F = m*g = ${intervalToString(weight_iv)} N, width = ${width(weight_iv).toFixed(4)}`);

// ============================================================================
// 7. Polynomial Operations
// ============================================================================
console.log("\n=== Polynomial Ring ===");
const p = polynomial([1, -6, 11, -6]);
console.log(`p(x) = ${polyToString(p, numericNumber)}`);
console.log(`p(1)=${polyEval(p, 1, numericNumber)}, p(2)=${polyEval(p, 2, numericNumber)}, p(3)=${polyEval(p, 3, numericNumber)}`);
const dp = derivative(p, numericNumber);
console.log(`p'(x) = ${polyToString(dp, numericNumber)}`);

// ============================================================================
// 8. Unit-Safe Physics (Dimensional Analysis)
// ============================================================================
console.log("\n=== Dimensional Analysis ===");
const dist = meters(100);
const time = seconds(9.58);
const speed = dist.div(time);
console.log(`Distance: ${dist.toString()}`);
console.log(`Time: ${time.toString()}`);
console.log(`Speed: ${speed.toString()}`);

const mass_u = kilograms(75);
const gravity_u = units`9.81 m/s^2`;
const weight_u = mass_u.mul(gravity_u);
console.log(`Weight: ${weight_u.toString()}`);

// ============================================================================
// 9. Symbolic Calculus
// ============================================================================
console.log("\n=== Symbolic Calculus ===");
const t = var_("t");
const x = var_("x");

const position = mul(const_(4.905), pow(t, const_(2)));
const velocity = simplify(diff(position, "t"));
const acceleration = simplify(diff(velocity, "t"));
console.log(`s(t) = ${toText(simplify(position))}`);
console.log(`v(t) = ${toText(velocity)}`);
console.log(`a(t) = ${toText(acceleration)}`);
console.log(`s(3) = ${evaluate(position, { t: 3 })}`);

console.log(`\nint(x^2) = ${toText(simplify(integrate(pow(x, const_(2)), "x")))}`);
console.log(`d/dx sin(x) = ${toText(simplify(diff(sin(x), "x")))}`);
console.log(`d/dx cos(x) = ${toText(simplify(diff(cos(x), "x")))}`);

const expr = add(pow(x, const_(3)), mul(const_(-2), pow(x, const_(2))));
console.log(`\nLaTeX: ${toLatex(simplify(expr))}`);
console.log(`d/dx:  ${toLatex(simplify(diff(expr, "x")))}`);

// Multi-variable
const y = var_("y");
const fxy = add(mul(pow(x, const_(2)), y), mul(x, pow(y, const_(2))));
console.log(`\nf(x,y) = ${toText(simplify(fxy))}`);
console.log(`df/dx  = ${toText(simplify(diff(fxy, "x")))}`);
console.log(`df/dy  = ${toText(simplify(diff(fxy, "y")))}`);
console.log(`f(2,3) = ${evaluate(fxy, { x: 2, y: 3 })}`);

// ============================================================================
// 10. Design by Contract
// ============================================================================
console.log("\n=== Design by Contract ===");

/** @contract */
function newtonSqrt(n: number, iterations: number): number {
  requires: { n >= 0; iterations > 0; iterations <= 100; }
  let guess = n / 2 || 1;
  for (let i = 0; i < iterations; i++) {
    guess = (guess + n / guess) / 2;
  }
  return guess;
}

console.log(`sqrt(2) = ${newtonSqrt(2, 10)}`);
console.log(`sqrt(144) = ${newtonSqrt(144, 10)}`);

try { newtonSqrt(-1, 10); }
catch (e: any) { console.log(`Contract violation: ${e.message}`); }

function safeDiv(a: number, b: number): number {
  requires(b !== 0, "Division by zero");
  return a / b;
}
console.log(`10 / 3 = ${safeDiv(10, 3)}`);
try { safeDiv(1, 0); }
catch (e: any) { console.log(`Division error: ${e.message}`); }

// ============================================================================
// 11. Pattern Matching
// ============================================================================
console.log("\n=== Pattern Matching ===");

type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "rectangle"; width: number; height: number }
  | { kind: "triangle"; base: number; height: number };

function area(shape: Shape): number {
  return match<Shape, number>(shape, {
    circle: (s) => Math.PI * (s as { kind: "circle"; radius: number }).radius ** 2,
    rectangle: (s) => (s as { kind: "rectangle"; width: number; height: number }).width * (s as { kind: "rectangle"; width: number; height: number }).height,
    triangle: (s) => 0.5 * (s as { kind: "triangle"; base: number; height: number }).base * (s as { kind: "triangle"; base: number; height: number }).height,
  });
}

for (const s of [
  { kind: "circle" as const, radius: 5 },
  { kind: "rectangle" as const, width: 4, height: 6 },
  { kind: "triangle" as const, base: 3, height: 8 },
]) {
  console.log(`${s.kind}: area = ${area(s).toFixed(2)}`);
}

// ============================================================================
// 12. Refined Types
// ============================================================================
console.log("\n=== Refined Types ===");

type Temperature = Newtype<number, "Temperature">;
type Pressure = Newtype<number, "Pressure">;

const temp = wrap<Temperature>(293.15);
const pressure = wrap<Pressure>(101325);
console.log(`Temperature: ${unwrap(temp)} K`);
console.log(`Pressure: ${unwrap(pressure)} Pa`);

const R = 8.314;
const n_ = 1.0;
const volume = (n_ * R * unwrap(temp)) / unwrap(pressure);
console.log(`Volume of 1 mol ideal gas: ${(volume * 1000).toFixed(2)} L`);

// ============================================================================
console.log("\n=== All computations complete ===");
