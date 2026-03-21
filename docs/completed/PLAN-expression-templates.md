# Plan: Expression Templates / Loop Fusion

## Status: PHASE 1 IMPLEMENTED

Phase 1 (lazy iterator fusion with single-pass execution, vec element-wise operations) is implemented in `packages/fusion/`. Phase 2 (compile-time method chain analysis and fused loop emission) is future work.

## Inspiration

Expression templates are THE iconic C++ zero-cost technique. Popularized by Blitz++ and Eigen, the idea is: instead of evaluating `a + b * c` eagerly (allocating intermediate arrays), build an expression tree at compile time and fuse it into a single loop.

This is directly aligned with typesugar's core philosophy — zero-cost abstractions that compile to what you'd write by hand. Nobody else does this in TypeScript.

## The Problem

```typescript
// Naive array arithmetic (3 loops, 2 intermediate allocations):
const result = a.map((x, i) => x + b[i]).map((x, i) => x * c[i]);
// Loop 1: a + b → tmp1
// Loop 2: tmp1 * c → result

// What we want (1 loop, 0 intermediates):
const result = new Array(a.length);
for (let i = 0; i < a.length; i++) {
  result[i] = (a[i] + b[i]) * c[i];
}
```

The same problem applies to:

- **Iterator chains**: `.filter().map().reduce()` creates intermediate iterators
- **Promise chains**: `.then().then().then()` creates intermediate promises
- **Option chains**: `.map().filter().map()` creates intermediate null checks

## Design

### Array Expression Fusion

```typescript
import { fused, vec } from "@typesugar/fusion";

// Wrap arrays in fusion context
const result = fused(() => {
  const a = vec([1, 2, 3, 4, 5]);
  const b = vec([10, 20, 30, 40, 50]);
  const c = vec([2, 2, 2, 2, 2]);
  return (a + b) * c;
});

// Compiles to:
const result = new Array(5);
for (let i = 0; i < 5; i++) {
  result[i] = (a_arr[i] + b_arr[i]) * c_arr[i];
}
```

### Iterator Fusion

```typescript
import { lazy } from "@typesugar/fusion";

const result = lazy([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  .filter((x) => x % 2 === 0)
  .map((x) => x * x)
  .filter((x) => x > 10)
  .take(3)
  .toArray();

// Without fusion (4 intermediate arrays/iterators):
// [1..10] → [2,4,6,8,10] → [4,16,36,64,100] → [16,36,64,100] → [16,36,64]

// With fusion (single pass, early termination):
const result = [];
for (let i = 0; i < arr.length && result.length < 3; i++) {
  const x = arr[i];
  if (x % 2 !== 0) continue;
  const y = x * x;
  if (y <= 10) continue;
  result.push(y);
}
```

### Numeric Expression Fusion (Eigen-Style)

For math-heavy code with typed arrays:

```typescript
import { Matrix, mat } from "@typesugar/fusion";

const A = mat([
  [1, 2],
  [3, 4],
]);
const B = mat([
  [5, 6],
  [7, 8],
]);
const C = mat([
  [1, 0],
  [0, 1],
]);

// Expression: (A * B) + C
// Without fusion: tmp = A*B (allocate matrix), result = tmp+C (allocate matrix)
// With fusion: single loop, compute (A*B+C)[i][j] directly
const result = fused(() => A * B + C);

// Compiles to:
const result = new Float64Array(4);
for (let i = 0; i < 2; i++) {
  for (let j = 0; j < 2; j++) {
    let sum = 0;
    for (let k = 0; k < 2; k++) sum += A[i * 2 + k] * B[k * 2 + j];
    result[i * 2 + j] = sum + C[i * 2 + j];
  }
}
```

### How It Works

The `fused()` macro:

1. **Parses the expression tree** at compile time — identifies operators, method chains, and data sources
2. **Builds a fusion IR** — nodes represent operations (map, filter, add, multiply), edges represent data flow
3. **Fuses compatible operations** — adjacent maps merge, filter+map merge, element-wise ops merge into single loops
4. **Generates optimal code** — single loop with inlined operations, no intermediates

```
Expression Tree:          Fused IR:              Generated Code:
    *                     for i in 0..n:         for (let i = 0; i < n; i++) {
   / \                     result[i] =             result[i] =
  +   c                     (a[i]+b[i]) * c[i]       (a[i] + b[i]) * c[i];
 / \                                              }
a   b
```

### Fusion Rules

| Pattern                     | Fuses To                        | Condition             |
| --------------------------- | ------------------------------- | --------------------- |
| `arr.map(f).map(g)`         | `arr.map(x => g(f(x)))`         | Always                |
| `arr.filter(p).map(f)`      | Single loop with guard          | Always                |
| `arr.map(f).filter(p)`      | Single loop: compute then guard | Always                |
| `arr.filter(p).filter(q)`   | `arr.filter(x => p(x) && q(x))` | Always                |
| `a.map(f).reduce(g, init)`  | Single loop: map+fold           | Always                |
| `vec(a) + vec(b)`           | Element-wise loop               | Same length           |
| `vec(a) * scalar`           | Element-wise loop               | Always                |
| `mat(A) * mat(B)`           | Fused matrix multiply           | Compatible dimensions |
| `lazy(a).take(n).toArray()` | Loop with early exit            | Always                |

### Escape Hatch

Not everything can be fused. The macro should handle unfusable patterns gracefully:

```typescript
const result = fused(() => {
  const sorted = arr.sort(); // sort can't be fused — it needs all elements
  return sorted.map((x) => x * 2).filter((x) => x > 10);
});

// Compiles to:
const sorted = arr.slice().sort(); // materialized
const result = [];
for (let i = 0; i < sorted.length; i++) {
  const y = sorted[i] * 2;
  if (y > 10) result.push(y);
}
// sort is materialized, but map+filter after it are still fused
```

## Implementation

### Phase 1: Iterator Fusion (`lazy()`)

**Package:** `@typesugar/fusion`

**`lazy()` expression macro:**

1. Detect method chain on the argument (`.filter().map().reduce()`, etc.)
2. Build a pipeline IR: sequence of `Map | Filter | Take | Drop | Reduce | ToArray` nodes
3. Apply fusion rules to merge compatible adjacent nodes
4. Generate a single for-loop with inlined operations

This is the most impactful phase — iterator chains are everywhere in TypeScript.

### Phase 2: Array Expression Fusion (`fused()`, `vec()`)

**`vec()` wraps arrays for operator overloading.** Inside a `fused()` block:

- `+`, `-`, `*`, `/` on `vec` values build an expression tree (at compile time)
- The `fused()` macro walks the tree and emits a single element-wise loop

This reuses the `@op` JSDoc typeclass infrastructure.

### Phase 3: Matrix Fusion

Extend Phase 2 with matrix-specific optimizations:

- Matrix multiply fusion (avoid intermediate matrix allocation)
- Transpose fusion (transpose \* multiply → swap indices)
- Scalar broadcasting

### Phase 4: SIMD Hints

For TypedArray expressions, generate code that V8 can auto-vectorize:

```typescript
// fused(() => vec(a) + vec(b)) with Float64Array
// Generates loop patterns V8 recognizes for SIMD optimization:
for (let i = 0; i < n; i++) result[i] = a[i] + b[i];
// V8 auto-vectorizes this to SIMD adds
```

## Zero-Cost Verification

The output of fusion must be byte-for-byte what you'd write by hand:

```typescript
// lazy([1,2,3,4,5]).filter(x => x > 2).map(x => x * 2).toArray()
// Must compile to exactly:
const result = [];
for (let i = 0; i < arr.length; i++) {
  if (arr[i] > 2) result.push(arr[i] * 2);
}
// NOT:
// const filtered = arr.filter(x => x > 2);
// const result = filtered.map(x => x * 2);
```

Test strategy: compare generated code against hand-written baselines. Include benchmark tests that verify no intermediate allocations.

## Inspirations

- **Blitz++ / Eigen** — expression templates for numeric arrays
- **Rust iterators** — lazy, fused by default (`.filter().map()` is single-pass)
- **Java Streams** — lazy pipeline fusion (but with megamorphic dispatch overhead)
- **Scala collections `view`** — lazy views with operation fusion
- **GHC stream fusion** — Haskell's `build/foldr` fusion framework
- **Polars** — query plan optimization (same idea applied to dataframes)

## Dependencies

- `@typesugar/core` — expression macros
- `@typesugar/macros` — `@op` JSDoc on typeclass methods for `vec` arithmetic, `specialize()` for inlining lambdas

## Open Questions

1. Should `lazy()` be the default for array operations? Rust does this — iterators are lazy by default. We could make `.filter().map()` on arrays automatically fuse without an explicit `lazy()` wrapper.
2. How to handle side effects in fused pipelines? `arr.map(x => { log(x); return x * 2 })` — fusing changes evaluation order. Should we detect side effects and refuse to fuse?
3. Should matrix operations integrate with WebGPU compute shaders for large matrices? That's a different compilation target but same expression template approach.
4. How does this interact with `@typesugar/fp`'s lazy `List`? Should `List.filter().map()` also be fusable?
