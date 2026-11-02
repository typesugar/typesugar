/**
 * Mod<N> - Modular arithmetic over Z/nZ
 *
 * The modulus is encoded at the type level, ensuring that operations
 * between values with different moduli are caught at compile time.
 *
 * @example
 * ```typescript
 * const a = mod(5, 7);  // 5 mod 7
 * const b = mod(3, 7);  // 3 mod 7
 * const sum = modAdd(a, b);  // 1 mod 7
 *
 * // Type error: can't mix different moduli
 * const c = mod(2, 11);
 * modAdd(a, c);  // Error!
 * ```
 */

import type { Numeric, Integral, Fractional } from "@typesugar/std";

// ============================================================================
// Type Definition
// ============================================================================

/**
 * A value in Z/nZ (integers modulo n).
 * The modulus N is tracked at the type level.
 */
export interface Mod<N extends number> {
  readonly value: number;
  readonly modulus: N;
}

// ============================================================================
// Constructors
// ============================================================================

/**
 * Create a value in Z/nZ.
 * The value is automatically normalized to [0, modulus).
 */
export function mod<N extends number>(value: number, modulus: N): Mod<N> {
  if (!Number.isSafeInteger(modulus) || modulus <= 0) {
    throw new RangeError(`Modulus must be a positive safe integer, got ${modulus}`);
  }
  if (!Number.isInteger(value)) {
    throw new RangeError(`Mod value must be an integer, got ${value}`);
  }
  // Normalize to [0, modulus). `((v % m) + m) % m` can exceed 2^53 (and so
  // round) for m near 2^53; adding m only to a negative remainder stays below m.
  let normalized = value % modulus;
  if (normalized < 0) normalized += modulus;
  return { value: normalized + 0, modulus }; // + 0 folds -0
}

/**
 * Create zero in Z/nZ.
 */
export function zero<N extends number>(modulus: N): Mod<N> {
  return { value: 0, modulus };
}

/**
 * Create one in Z/nZ.
 */
export function one<N extends number>(modulus: N): Mod<N> {
  return { value: 1, modulus };
}

// ============================================================================
// Basic Operations
// ============================================================================

/**
 * Modular addition.
 */
export function modAdd<N extends number>(a: Mod<N>, b: Mod<N>): Mod<N> {
  const sum = a.value + b.value;
  if (Number.isSafeInteger(sum)) return mod(sum, a.modulus);
  return {
    value: Number((BigInt(a.value) + BigInt(b.value)) % BigInt(a.modulus)),
    modulus: a.modulus,
  };
}

/**
 * Modular subtraction.
 */
export function modSub<N extends number>(a: Mod<N>, b: Mod<N>): Mod<N> {
  return mod(a.value - b.value, a.modulus);
}

/**
 * Modular multiplication.
 */
export function modMul<N extends number>(a: Mod<N>, b: Mod<N>): Mod<N> {
  const product = a.value * b.value;
  if (Number.isSafeInteger(product)) return mod(product, a.modulus);
  // Above 2^53 the float product is already rounded before `%` (MU-7: with
  // 1e9+7, 999999999² mod p came out 63 instead of 64). Exact via BigInt.
  return { value: mulMod(a.value, b.value, a.modulus), modulus: a.modulus };
}

/** `(a · b) mod m` exactly, for non-negative safe integers. */
function mulMod(a: number, b: number, m: number): number {
  return Number((BigInt(a) * BigInt(b)) % BigInt(m));
}

/**
 * Modular negation.
 */
export function modNegate<N extends number>(a: Mod<N>): Mod<N> {
  return mod(-a.value, a.modulus);
}

/**
 * Modular exponentiation using repeated squaring.
 * Handles negative exponents if the inverse exists.
 */
export function modPow<N extends number>(a: Mod<N>, exp: number): Mod<N> {
  if (exp < 0) {
    const inv = modInverse(a);
    if (inv === null) {
      throw new RangeError(
        `Cannot raise ${a.value} to negative power: no inverse mod ${a.modulus}`
      );
    }
    return modPow(inv, -exp);
  }

  if (!Number.isSafeInteger(exp)) {
    throw new RangeError(`Mod exponent must be a safe integer, got ${exp}`);
  }
  if (exp === 0) return one(a.modulus);
  if (exp === 1) return a;

  let result = one(a.modulus);
  let base = a;
  let e = exp;

  while (e > 0) {
    if (e % 2 === 1) {
      result = modMul(result, base);
    }
    e = Math.floor(e / 2); // not `>>>= 1`, which truncates exponents >= 2^32 (MU-7)
    if (e > 0) base = modMul(base, base);
  }

  return result;
}

// ============================================================================
// Extended Euclidean Algorithm
// ============================================================================

/**
 * Extended Euclidean algorithm.
 * Returns [gcd, x, y] such that gcd = a*x + b*y
 */
function extendedGcd(a: number, b: number): [number, number, number] {
  // Iterative, in BigInt: `Math.floor(a / b)` on floats can be off by one
  // near 2^53, and the recursive form's intermediates can leave the safe
  // range (MU-7). |x| <= b and |y| <= a, so the results fit back in numbers.
  let [oldR, r] = [BigInt(a), BigInt(b)];
  let [oldS, sCoef] = [1n, 0n];
  let [oldT, t] = [0n, 1n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, sCoef] = [sCoef, oldS - q * sCoef];
    [oldT, t] = [t, oldT - q * t];
  }
  return [Number(oldR), Number(oldS), Number(oldT)];
}

/**
 * Compute the modular inverse of a.
 * Returns null if a and modulus are not coprime.
 */
export function modInverse<N extends number>(a: Mod<N>): Mod<N> | null {
  const [g, x] = extendedGcd(a.value, a.modulus);
  if (g !== 1) {
    return null;
  }
  return mod(x, a.modulus);
}

/**
 * Modular division (multiply by inverse).
 * Returns null if divisor has no inverse.
 */
export function modDiv<N extends number>(a: Mod<N>, b: Mod<N>): Mod<N> | null {
  const bInv = modInverse(b);
  if (bInv === null) return null;
  return modMul(a, bInv);
}

// ============================================================================
// Number Theory Helpers
// ============================================================================

/**
 * Check if a number is prime (simple trial division).
 */
export function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  const sqrt = Math.sqrt(n);
  for (let i = 3; i <= sqrt; i += 2) {
    if (n % i === 0) return false;
  }
  return true;
}

/**
 * Compute GCD of two numbers.
 */
export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

/**
 * Check if two numbers are coprime.
 */
export function coprime(a: number, b: number): boolean {
  return gcd(a, b) === 1;
}

/**
 * Euler's totient function φ(n).
 * Counts integers in [1, n] coprime to n.
 */
export function totient(n: number): number {
  let result = n;
  let m = n;
  for (let p = 2; p * p <= m; p++) {
    if (m % p === 0) {
      while (m % p === 0) {
        m = m / p;
      }
      result -= result / p;
    }
  }
  if (m > 1) {
    result -= result / m;
  }
  return result;
}

// ============================================================================
// Typeclass Instances
// ============================================================================

/**
 * Numeric instance for Mod<N>.
 * Always works - provides ring structure.
 */
export function numericMod<N extends number>(modulus: N): Numeric<Mod<N>> {
  return {
    add: (a, b) => modAdd(a, b),
    sub: (a, b) => modSub(a, b),
    mul: (a, b) => modMul(a, b),
    div: (a, b) => {
      const result = modDiv(a, b);
      if (result === null)
        throw new RangeError(`Division not defined: ${b.value} has no inverse mod ${modulus}`);
      return result;
    },
    pow: (a, b) => modPow(a, b.value),
    negate: modNegate,
    abs: (a) => a,
    signum: (a) => (a.value === 0 ? zero(modulus) : one(modulus)),
    fromNumber: (n) => mod(Math.floor(n), modulus),
    toNumber: (a) => a.value,
    zero: () => zero(modulus),
    one: () => one(modulus),
  };
}

/**
 * Integral instance for Mod<N>.
 * Always works - provides Euclidean domain operations.
 */
export function integralMod<N extends number>(modulus: N): Integral<Mod<N>> {
  return {
    div: (a, b) => {
      const result = modDiv(a, b);
      if (result === null) {
        throw new RangeError(`Division not defined: ${b.value} has no inverse mod ${modulus}`);
      }
      return result;
    },
    mod: (a, b) => zero(modulus), // a/b * b = a in a field
    divMod: (a, b) => {
      const q = modDiv(a, b);
      if (q === null) {
        throw new RangeError(`Division not defined: ${b.value} has no inverse mod ${modulus}`);
      }
      return [q, zero(modulus)];
    },
    quot: (a, b) => {
      const result = modDiv(a, b);
      if (result === null) {
        throw new RangeError(`Division not defined: ${b.value} has no inverse mod ${modulus}`);
      }
      return result;
    },
    rem: () => zero(modulus),
    toInteger: (a) => BigInt(a.value),
  };
}

/**
 * Fractional instance for Mod<N>.
 * Only valid when N is prime (Z/pZ is a field).
 *
 * @throws RangeError if modulus is not prime
 */
export function fractionalMod<N extends number>(modulus: N): Fractional<Mod<N>> {
  if (!isPrime(modulus)) {
    throw new RangeError(`Fractional instance requires prime modulus, got ${modulus}`);
  }

  return {
    div: (a, b) => {
      const result = modDiv(a, b);
      if (result === null) {
        throw new RangeError(`Division by zero: ${b.value} = 0 mod ${modulus}`);
      }
      return result;
    },
    recip: (a) => {
      const result = modInverse(a);
      if (result === null) {
        throw new RangeError(`No inverse: ${a.value} = 0 mod ${modulus}`);
      }
      return result;
    },
    fromRational: (num, den) => {
      const n = mod(Math.floor(num), modulus);
      const d = mod(Math.floor(den), modulus);
      const result = modDiv(n, d);
      if (result === null) {
        throw new RangeError(
          `Cannot represent ${num}/${den} mod ${modulus}: denominator has no inverse`
        );
      }
      return result;
    },
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if two Mod values are equal.
 */
export function equals<N extends number>(a: Mod<N>, b: Mod<N>): boolean {
  return a.value === b.value && a.modulus === b.modulus;
}

/**
 * Pretty-print a Mod value.
 */
export function toString<N extends number>(a: Mod<N>): string {
  return `${a.value} (mod ${a.modulus})`;
}

/**
 * Get all units (invertible elements) in Z/nZ.
 */
export function units<N extends number>(modulus: N): Mod<N>[] {
  const result: Mod<N>[] = [];
  for (let i = 1; i < modulus; i++) {
    if (coprime(i, modulus)) {
      result.push(mod(i, modulus));
    }
  }
  return result;
}

/**
 * Chinese Remainder Theorem.
 * Given a ≡ r1 (mod m1) and a ≡ r2 (mod m2), find a mod (m1*m2).
 * Requires m1 and m2 to be coprime.
 */
export function crt(r1: number, m1: number, r2: number, m2: number): number {
  if (!coprime(m1, m2)) {
    throw new RangeError(`CRT requires coprime moduli, got ${m1} and ${m2}`);
  }

  // Exact in BigInt: `m1 * ((x * (r2 - r1)) % m2)` overflows 2^53 for
  // moduli around 1e8 and up (MU-7).
  const [, x] = extendedGcd(m1, m2);
  const B1 = BigInt(m1);
  const B2 = BigInt(m2);
  const M = B1 * B2;
  const t = (((BigInt(x) * (BigInt(r2) - BigInt(r1))) % B2) + B2) % B2;
  const result = (((BigInt(r1) + B1 * t) % M) + M) % M;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`CRT result ${result} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return Number(result);
}
