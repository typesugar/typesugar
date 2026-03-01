# @typesugar/math

Comprehensive math types and typeclasses for TypeScript. Combines exact numeric types, linear algebra typeclasses, and seamless integration with `@typesugar/units`.

## Installation

```bash
pnpm add @typesugar/math
```

## Quick Start

```typescript
import {
  // Rational numbers
  rational,
  numericRational,
  // Complex numbers
  complex,
  complexMagnitude,
  // Arbitrary precision
  bigDecimal,
  numericBigDecimal,
  // Type-safe matrices
  matrix,
  det,
  matMul,
  // Interval arithmetic
  interval,
  numericInterval,
  // Modular arithmetic
  mod,
  modPow,
  // Polynomials
  polynomial,
  evaluate,
  // Units
  meters,
  seconds,
} from "@typesugar/math";

// Exact rational arithmetic
const half = rational(1n, 2n);
const third = rational(1n, 3n);
const sum = numericRational.add(half, third);
console.log(sum); // { num: 5n, den: 6n } — exactly 5/6

// Complex numbers
const z = complex(3, 4); // 3 + 4i
console.log(complexMagnitude(z)); // 5

// Type-safe matrices
const m = matrix(2, 2, [1, 2, 3, 4]);
console.log(det(m)); // -2
```

---

## Numeric Types

### Rational — Exact Fractions

Rational numbers using bigint numerator/denominator. All arithmetic is exact — no floating-point errors.

```typescript
import {
  rational,
  rat,
  numericRational,
  fractionalRational,
  rationalToNumber,
  rationalToString,
  rationalFloor,
  rationalCeil,
  rationalPow,
} from "@typesugar/math";

// Create rationals
const half = rational(1n, 2n);
const third = rational(1, 3); // numbers converted to bigint
const quarter = rat(1, 4); // convenience function

// Arithmetic (exact)
const sum = numericRational.add(half, third); // 5/6
const diff = numericRational.sub(half, third); // 1/6
const prod = numericRational.mul(half, third); // 1/6
const quot = fractionalRational.div(half, third); // 3/2

// Conversion
console.log(rationalToString(sum)); // "5/6"
console.log(rationalToNumber(sum)); // 0.8333333...

// Operations
const r = rational(7n, 3n);
rationalFloor(r); // 2n
rationalCeil(r); // 3n
rationalPow(r, 2); // 49/9
```

**Why use Rational?**

```typescript
// Floating-point: accumulates errors
let sum = 0;
for (let i = 0; i < 10; i++) sum += 0.1;
console.log(sum === 1); // false (0.9999999999999999)

// Rational: exact
let rSum = rational(0n);
const tenth = rational(1n, 10n);
for (let i = 0; i < 10; i++) rSum = numericRational.add(rSum, tenth);
console.log(rSum); // { num: 1n, den: 1n } — exactly 1
```

### Complex — a + bi

Complex number arithmetic with full support for transcendental functions.

```typescript
import {
  complex,
  fromPolar,
  I,
  numericComplex,
  fractionalComplex,
  floatingComplex,
  conjugate,
  complexMagnitude,
  phase,
  toPolar,
  nthRoots,
} from "@typesugar/math";

// Create complex numbers
const z1 = complex(3, 4); // 3 + 4i
const z2 = fromPolar(1, Math.PI / 4); // e^(iπ/4) = cos(π/4) + i*sin(π/4)

// Arithmetic
const sum = numericComplex.add(z1, z2);
const prod = numericComplex.mul(z1, z2);
const quot = fractionalComplex.div(z1, z2);

// Properties
complexMagnitude(z1); // 5 (|3 + 4i| = √(9+16))
phase(z1); // 0.927... (arg(3 + 4i))
conjugate(z1); // 3 - 4i
toPolar(z1); // { r: 5, theta: 0.927... }

// Transcendental functions
floatingComplex.exp(complex(0, Math.PI)); // ≈ -1 + 0i (Euler's identity)
floatingComplex.sqrt(complex(-1, 0)); // 0 + 1i

// Find all nth roots
nthRoots(complex(1, 0), 4); // Four 4th roots of unity
```

### BigDecimal — Arbitrary Precision

Exact decimal arithmetic using bigint storage with explicit scale. No floating-point rounding.

```typescript
import {
  bigDecimal,
  bigDecimalFromString,
  numericBigDecimal,
  ordBigDecimal,
  bigDecimalToString,
  toFixed,
  divWithScale,
  bigDecimalRound,
} from "@typesugar/math";

// Create BigDecimals
const a = bigDecimal("123.456"); // From string
const b = bigDecimal(100n, 2); // 100 * 10^-2 = 1.00
const c = bigDecimal(3.14159); // From number

// Arithmetic (exact for add/sub/mul)
const sum = numericBigDecimal.add(a, b); // 124.456
const prod = numericBigDecimal.mul(a, b); // 123.456

// Division requires explicit precision
const quotient = divWithScale(a, bigDecimal("3"), 10); // 41.152 (10 decimal places)

// Rounding
const rounded = bigDecimalRound(a, 2, "round"); // 123.46

// Formatting
bigDecimalToString(a); // "123.456"
toFixed(a, 2); // "123.46"
```

### Matrix<R, C> — Type-Safe Dimensions

Matrices with row/column counts tracked at the type level. Dimension mismatches caught at compile time.

```typescript
import {
  matrix,
  zeros,
  identity,
  fromRows,
  diag,
  matMul,
  transpose,
  det,
  matrixInverse,
  trace,
  rows,
  cols,
  matrixGet,
  matrixToString,
} from "@typesugar/math";

// Create matrices
const a = matrix(2, 3, [1, 2, 3, 4, 5, 6]); // 2×3 matrix
const b = matrix(3, 2, [1, 2, 3, 4, 5, 6]); // 3×2 matrix
const id = identity(3); // 3×3 identity
const z = zeros(2, 2); // 2×2 zeros
const d = diag([1, 2, 3]); // 3×3 diagonal

// Type-safe multiplication
const c = matMul(a, b); // 2×2 — types match!
// matMul(a, a);         // Type error! 2×3 × 2×3 invalid

// Square matrix operations
const sq = matrix(2, 2, [1, 2, 3, 4]);
det(sq); // -2
matrixInverse(sq); // inverse matrix
trace(sq); // 5 (1 + 4)
transpose(sq); // [[1,3],[2,4]]

// Access
rows(sq); // 2
cols(sq); // 2
matrixGet(sq, 0, 1); // 2

console.log(matrixToString(sq));
// [     1.0000      2.0000 ]
// [     3.0000      4.0000 ]
```

### Interval — Bounds Tracking

Interval arithmetic for numerical error analysis, range queries, and verified computing.

```typescript
import {
  interval,
  intervalPoint,
  entire,
  empty,
  numericInterval,
  width,
  intervalMidpoint,
  contains,
  overlaps,
  hull,
  intersect,
  intervalToString,
} from "@typesugar/math";

// Create intervals
const a = interval(1, 3); // [1, 3]
const b = interval(2, 5); // [2, 5]
const p = intervalPoint(4); // [4, 4] (point interval)

// Arithmetic propagates bounds correctly
const sum = numericInterval.add(a, b); // [3, 8]
const prod = numericInterval.mul(a, b); // [2, 15]

// Queries
width(a); // 2
intervalMidpoint(a); // 2
contains(a, 2); // true
overlaps(a, b); // true

// Set operations
hull(a, b); // [1, 5] — smallest containing both
intersect(a, b); // [2, 3] — overlap

intervalToString(a); // "[1, 3]"
```

**Use case: Error bounds**

```typescript
// Track uncertainty through calculations
const measurement = interval(9.8, 10.2); // 10 ± 0.2
const count = intervalPoint(5);

const total = numericInterval.mul(measurement, count);
// Result: [49, 51] — captures all possible values
```

### Mod<N> — Modular Arithmetic

Integers modulo N with the modulus tracked at the type level. Prevents mixing different moduli.

```typescript
import {
  mod,
  modAdd,
  modMul,
  modPow,
  modInverse,
  numericMod,
  fractionalMod,
  isPrime,
  gcd,
  totient,
  crt,
} from "@typesugar/math";

// Create modular values
const a = mod(5, 7); // 5 mod 7
const b = mod(10, 7); // 3 mod 7 (normalized)

// Arithmetic
modAdd(a, b); // 1 mod 7
modMul(a, b); // 1 mod 7
modPow(a, 3); // 6 mod 7 (5³ mod 7)

// Type safety prevents mixing moduli
const c = mod(2, 11);
// modAdd(a, c);   // Type error! Can't mix mod 7 with mod 11

// Modular inverse (when coprime)
modInverse(a); // 3 mod 7 (because 5 × 3 = 15 ≡ 1 mod 7)

// For prime modulus, get full field operations
const F = fractionalMod(7); // Z/7Z is a field
F.div(a, b); // 5/3 mod 7 = 5 × 3⁻¹ mod 7

// Number theory helpers
isPrime(7); // true
gcd(12, 18); // 6
totient(12); // 4 (count of 1,5,7,11 coprime to 12)
crt(2, 3, 3, 5); // 8 (x ≡ 2 mod 3, x ≡ 3 mod 5 → x ≡ 8 mod 15)
```

### Polynomial<F> — Polynomial Ring

Polynomials over any numeric type. Supports arithmetic, calculus, and root finding.

```typescript
import {
  polynomial,
  constant,
  xPoly,
  zeroPoly,
  numericPolynomial,
  evaluate,
  degree,
  addPoly,
  mulPoly,
  derivative,
  integral,
  divPoly,
  rationalRoots,
  polyToString,
} from "@typesugar/math";
import { numericNumber, fractionalNumber } from "@typesugar/std";

const N = numericNumber;
const F = fractionalNumber;

// p(x) = 1 + 2x + 3x²
const p = polynomial([1, 2, 3]);

// Evaluate at x = 2
evaluate(p, 2, N); // 17 (1 + 4 + 12)

// Arithmetic
const q = polynomial([1, 1]); // 1 + x
addPoly(p, q, N); // 2 + 3x + 3x²
mulPoly(p, q, N); // 1 + 3x + 5x² + 3x³

// Calculus
derivative(p, N); // 2 + 6x
integral(p, N, F); // x + x² + x³

// Division
const [quot, rem] = divPoly(p, q, N, F);

// Root finding (rational roots of integer polynomials)
const cubic = polynomial([-6, 11, -6, 1]); // x³ - 6x² + 11x - 6
rationalRoots(cubic); // [1, 2, 3]

polyToString(p, N); // "3x^2 + 2x + 1"
```

---

## Typeclasses

### VectorSpace

Abstraction for types that support vector addition and scalar multiplication.

```typescript
interface VectorSpace<V, F> {
  vAdd(a: V, b: V): V; // Vector addition
  vScale(scalar: F, v: V): V; // Scalar multiplication
  vZero(): V; // Zero vector
}
```

Instances: `vectorSpaceArray(F)`.

### InnerProduct

Extends VectorSpace with a dot product operation.

```typescript
interface InnerProduct<V, F> extends VectorSpace<V, F> {
  dot(a: V, b: V): F; // Inner product
}
```

Instances: `innerProductArray(F)`.

### Normed

Types with a notion of length/magnitude.

```typescript
interface Normed<V, F> {
  norm(v: V): F; // Length/magnitude
}
```

Instances: `normedVec2`, `normedVec3`, `normedNumberArray`.

### Derived Operations

```typescript
import {
  vSub, // Vector subtraction
  normSquared, // |v|² (efficient when sqrt not needed)
  normalize, // Unit vector
  distance, // Distance between vectors
  isOrthogonal, // Check perpendicularity
  project, // Project a onto b
} from "@typesugar/math";
```

---

## Integration with @typesugar/units

Convert between units and rationals for exact arithmetic:

```typescript
import { meters, unitToRational, rationalToUnit, scaleByRational, rational } from "@typesugar/math";
import type { Length } from "@typesugar/units";

// Get unit value as rational
const dist = meters(1.5);
const r = unitToRational(dist); // Rational approximation

// Create unit from rational
const half = rational(1n, 2n);
const halfMeter = rationalToUnit<Length>(half, "m");

// Scale by exact factor
const third = rational(1n, 3n);
const thirdMeter = scaleByRational(meters(1), third);
```

---

## Single Import

`@typesugar/math` re-exports everything from `@typesugar/units`:

```typescript
import {
  // Units
  meters,
  seconds,
  newtons,
  // Math types
  rational,
  complex,
  matrix,
  interval,
  mod,
  polynomial,
  // Typeclasses
  numericRational,
} from "@typesugar/math";
```

---

## Operator Support

Typeclass instances use `Op<>` return type annotations for operator integration:

```typescript
// When used with typesugar macro transform:
const a = rational(1n, 2n);
const b = rational(1n, 3n);

// Operators dispatch to typeclass methods
a + b; // → numericRational.add(a, b)
a - b; // → numericRational.sub(a, b)
a * b; // → numericRational.mul(a, b)
a / b; // → fractionalRational.div(a, b)
```

---

## API Quick Reference

### Types & Constructors

| Type            | Constructor                          | Description                  |
| --------------- | ------------------------------------ | ---------------------------- |
| `Rational`      | `rational(num, den)`, `rat(n, d)`    | Exact fractions              |
| `Complex`       | `complex(re, im)`, `fromPolar(r, θ)` | Complex numbers              |
| `BigDecimal`    | `bigDecimal(value, scale?)`          | Arbitrary precision decimals |
| `Matrix<R,C>`   | `matrix(rows, cols, data)`           | Type-safe matrices           |
| `Interval`      | `interval(lo, hi)`                   | Interval arithmetic          |
| `Mod<N>`        | `mod(value, modulus)`                | Modular arithmetic           |
| `Polynomial<F>` | `polynomial(coeffs)`                 | Polynomial ring              |

### Typeclass Instances

| Instance               | Type            | Typeclass              |
| ---------------------- | --------------- | ---------------------- |
| `numericRational`      | `Rational`      | `Numeric`              |
| `fractionalRational`   | `Rational`      | `Fractional`           |
| `numericComplex`       | `Complex`       | `Numeric`              |
| `fractionalComplex`    | `Complex`       | `Fractional`           |
| `floatingComplex`      | `Complex`       | `Floating`             |
| `numericBigDecimal`    | `BigDecimal`    | `Numeric`              |
| `numericInterval`      | `Interval`      | `Numeric`              |
| `numericMod(n)`        | `Mod<N>`        | `Numeric`              |
| `fractionalMod(p)`     | `Mod<P>`        | `Fractional` (prime p) |
| `numericMatrix(n)`     | `Matrix<N,N>`   | `Numeric`              |
| `numericPolynomial(F)` | `Polynomial<F>` | `Numeric`              |

## License

MIT
