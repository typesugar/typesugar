/**
 * Mathematical Types
 *
 * All modules are exported as namespaces to avoid function name conflicts
 * (e.g., `equals`, `toString` exist in multiple modules).
 *
 * Usage:
 * - `RationalOps` namespace - Exact rational arithmetic
 * - `ComplexOps` namespace - Complex numbers
 * - `BigDecOps` namespace - Arbitrary precision decimals
 * - `FixedDecOps` namespace - Fixed-point decimals with N decimal places
 * - `MoneyOps` namespace - Currency-safe money with integer minor units
 * - `MatrixOps` namespace - Type-safe matrices with dimension tracking
 * - `IntervalOps` namespace - Interval arithmetic for bounds tracking
 * - `ModOps` namespace - Modular arithmetic over Z/nZ
 * - `PolyOps` namespace - Polynomials over any ring
 *
 * @example
 * ```typescript
 * import { RationalOps, ComplexOps } from "@typesugar/math";
 * type Rational = RationalOps.Rational;
 *
 * const half = RationalOps.rational(1n, 2n);
 * const z = ComplexOps.complex(3, 4);
 * RationalOps.equals(half, half);  // No ambiguity
 * ComplexOps.equals(z, z);         // Different type's equals
 * ```
 */

// Rounding and currencies have no conflicts - export directly
export * from "./rounding.js";
export * from "./currencies.js";

// Conversions module - export directly
export * from "./conversions.js";

// Export all modules as namespaces (types accessible via Namespace.TypeName)
export * as RationalOps from "./rational.js";
export * as ComplexOps from "./complex.js";
export * as BigDecOps from "./bigdecimal.js";
export * as FixedDecOps from "./fixed-decimal.js";
export * as MoneyOps from "./money.js";
export * as MatrixOps from "./matrix.js";
export * as IntervalOps from "./interval.js";
export * as ModOps from "./modular.js";
export * as PolyOps from "./polynomial.js";
