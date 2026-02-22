# Math Types

Comprehensive math types and typeclasses: exact rational arithmetic, complex numbers, arbitrary precision decimals, type-safe matrices, and more.

## Quick Start

```bash
npm install @typesugar/math
```

```typescript
import {
  rational,
  numericRational,
  complex,
  complexMagnitude,
  matrix,
  det,
  matMul,
  interval,
  numericInterval,
} from "@typesugar/math";

// Exact rational arithmetic
const half = rational(1n, 2n);
const third = rational(1n, 3n);
const sum = numericRational.add(half, third); // Exactly 5/6

// Complex numbers
const z = complex(3, 4); // 3 + 4i
complexMagnitude(z); // 5

// Type-safe matrices
const m = matrix(2, 2, [1, 2, 3, 4]);
det(m); // -2
```

## Numeric Types

### Rational — Exact Fractions

No floating-point errors. Ever.

```typescript
// Floating-point accumulates errors
let sum = 0;
for (let i = 0; i < 10; i++) sum += 0.1;
sum === 1; // false!

// Rational is exact
let rSum = rational(0n);
const tenth = rational(1n, 10n);
for (let i = 0; i < 10; i++) rSum = numericRational.add(rSum, tenth);
// rSum = { num: 1n, den: 1n } — exactly 1
```

### Matrix\<R, C\> — Type-Safe Dimensions

```typescript
const a = matrix(2, 3, [1, 2, 3, 4, 5, 6]); // 2×3
const b = matrix(3, 2, [1, 2, 3, 4, 5, 6]); // 3×2

const c = matMul(a, b); // 2×2 — types match!
// matMul(a, a);        // Type error! 2×3 × 2×3 invalid
```

### Interval — Bounds Tracking

Track uncertainty through calculations.

```typescript
const measurement = interval(9.8, 10.2); // 10 ± 0.2
const count = intervalPoint(5);
const total = numericInterval.mul(measurement, count);
// Result: [49, 51] — captures all possible values
```

### Mod\<N\> — Modular Arithmetic

Type-level modulus prevents mixing.

```typescript
const a = mod(5, 7);
const b = mod(10, 7); // → 3 mod 7
modMul(a, b); // 1 mod 7

const c = mod(2, 11);
// modAdd(a, c); // Type error! Can't mix mod 7 with mod 11
```

## Typeclasses

- `VectorSpace<V, F>` — Vector addition and scalar multiplication
- `InnerProduct<V, F>` — Dot product operations
- `Normed<V, F>` — Length/magnitude

## Learn More

- [API Reference](/reference/packages#math)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/math)
