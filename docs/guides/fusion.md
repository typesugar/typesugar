# Loop Fusion

Single-pass iterator pipelines with zero intermediate allocations — `.filter().map().reduce()` runs in one loop.

Inspired by Blitz++/Eigen expression templates and Rust's zero-cost iterator adapters.

> **Current Status:** Runtime fusion via `LazyPipeline` class. Single-pass iteration with no intermediate arrays is achieved, but the pipeline object itself exists at runtime. Phase 2 will add compile-time macro analysis to eliminate the pipeline class entirely.

## The Problem

Standard array method chains allocate intermediate arrays at every step:

```typescript
const result = users
  .filter((u) => u.active) // pass 1 — intermediate array
  .map((u) => u.score * 2) // pass 2 — intermediate array
  .reduce((a, b) => a + b, 0); // pass 3
```

Three passes over the data, two throwaway arrays. For large datasets, this matters.

## Quick Start

```bash
npm install @typesugar/fusion
```

```typescript
import { lazy } from "@typesugar/fusion";

// 1 pass, 0 intermediate arrays
const result = lazy(users)
  .filter((u) => u.active)
  .map((u) => u.score * 2)
  .reduce((a, b) => a + b, 0);
```

`lazy()` wraps any iterable (arrays, Sets, Maps, generators) and collects operations into a pipeline. Nothing executes until you call a terminal operation.

## Pipeline Operations

### Intermediate (chainable, lazy)

```typescript
import { lazy } from "@typesugar/fusion";

lazy(data)
  .map((x) => x * 2) // transform each element
  .filter((x) => x > 10) // keep matching elements
  .flatMap((x) => [x, x + 1]) // map and flatten
  .take(5) // first 5 elements
  .drop(2) // skip first 2
  .takeWhile((x) => x < 100) // take while condition holds
  .dropWhile((x) => x < 10); // skip while condition holds
```

These build up the pipeline description. No work happens yet.

### Terminal (execute the pipeline)

```typescript
lazy(data).filter(x => x > 0).map(x => x * 2)
  .toArray();          // T[] — collect results
  .reduce((a, b) => a + b, 0);  // fold left
  .find(x => x > 100);          // first match or null
  .some(x => x > 100);          // any match?
  .every(x => x > 0);           // all match?
  .count();                      // count elements
  .forEach(x => console.log(x)); // side effects
  .first();                      // first element or null
  .last();                       // last element or null
  .sum();                        // sum (number pipelines)
  .min();                        // minimum (optional comparator: .min(cmp))
  .max();                        // maximum (optional comparator: .max(cmp))
  .groupBy(x => x.category);    // Map<K, T[]>
  .toMap(x => x.id, x => x);    // Map<K, V>
  .join(", ");                   // join strings
```

Calling any terminal runs the entire pipeline in a single pass.

## Infinite Sources

Generate data on the fly — combined with `take()`, these are safe to use:

```typescript
import { range, iterate, repeat, generate } from "@typesugar/fusion";

range(0, 10); // [0, 1, 2, ..., 9]
range(0, 10, 2); // [0, 2, 4, 6, 8]

iterate(1, (x) => x * 2)
  .take(5)
  .toArray(); // [1, 2, 4, 8, 16]
repeat("x").take(3).toArray(); // ["x", "x", "x"]
generate(Math.random).take(4).toArray(); // 4 random numbers

// First 10 squares of odd numbers
range(1, Infinity)
  .filter((x) => x % 2 !== 0)
  .map((x) => x * x)
  .take(10)
  .toArray();
// [1, 9, 25, 49, 81, 121, 169, 225, 289, 361]
```

`take()` and `takeWhile()` provide early termination — the pipeline stops as soon as enough elements are collected.

## Vector Operations

For element-wise numeric array math (think NumPy-lite):

```typescript
import { vec, add, sub, mul, scale, dot, magnitude, normalize } from "@typesugar/fusion";

const a = vec([1, 2, 3]);
const b = vec([4, 5, 6]);

add(a, b); // vec([5, 7, 9])
sub(a, b); // vec([-3, -3, -3])
mul(a, b); // vec([4, 10, 18]) — element-wise product
scale(a, 10); // vec([10, 20, 30])
dot(a, b); // 32
magnitude(a); // 3.741...
normalize(a); // unit vector in same direction
```

## Single-Pass Guarantee

Here's what happens under the hood for a fused pipeline:

```
lazy(data).filter(pred).map(f).take(100).toArray()

For each element in data:
  1. Does pred(element) pass?  → no: skip, next element
  2. Apply f(element)
  3. Add to results
  4. Have 100 results?  → yes: stop immediately

Total: 1 partial pass, 0 intermediate allocations
```

Compare to the multi-pass equivalent:

```
data.filter(pred)  → full pass, allocates array
    .map(f)        → full pass, allocates array
    .slice(0, 100) → allocates array
```

The fused version touches each element at most once and stops early.

## Current vs Future Fusion

### Current (Phase 1): Runtime Fusion

The `LazyPipeline` class provides runtime fusion:

- **Single-pass iteration** — each element flows through all steps before the next
- **No intermediate arrays** — `filter().map().take()` doesn't allocate between steps
- **Early termination** — `take(5)` stops after 5 elements, doesn't process the rest

The pipeline object itself exists at runtime (allocation overhead), but the fusion benefit comes from avoiding intermediate arrays on large datasets.

### Future (Phase 2): Compile-Time Fusion

The `lazy` macro will inspect the full method chain at compile time and emit a hand-optimized loop — no `LazyPipeline` class at runtime at all.

```typescript
// Phase 2 (future): macro rewrites this to a single for-loop
const result = lazy(users)
  .filter((u) => u.active)
  .map((u) => u.score)
  .sum();

// Compiles to:
// let __sum = 0;
// for (const __el of users) {
//   if (__el.active) __sum += __el.score;
// }
// const result = __sum;
```

This will be true zero-cost abstraction: write high-level pipeline code, get hand-optimized loops.

## Zero-Cost Guarantee

Fusion's zero-cost story has two phases, each eliminating a different category of overhead:

- **Phase 1 (current):** The `LazyPipeline` object is allocated at runtime, but no intermediate arrays are created. A chain like `.filter().map().take()` performs single-pass iteration, eliminating the O(n) allocations-per-operation cost of standard array methods. For large datasets this is the dominant cost savings.
- **Phase 2 (planned):** The `lazy` and `fused` macros will compile method chains directly to single for-loops, eliminating the `LazyPipeline` object entirely. No class instantiation, no method dispatch — just a tight loop.

**Net effect:** Phase 1 achieves _memory-zero-cost_ (no intermediate collections). Phase 2 will achieve _allocation-zero-cost_ (no pipeline object). Together they deliver true zero-cost abstraction where the high-level pipeline syntax compiles to the same code you would write by hand.

## When to Use `lazy()` vs Plain Array Methods

| Scenario                                  | Use                                           |
| ----------------------------------------- | --------------------------------------------- |
| Small arrays (< 100 elements)             | Plain array methods — overhead doesn't matter |
| Long chains (3+ operations)               | `lazy()` — avoids intermediate allocations    |
| Early termination needed (`take`, `find`) | `lazy()` — stops as soon as result is found   |
| Infinite/generated sequences              | `lazy()` with `range()`, `iterate()`, etc.    |
| Single operation (just `.map()`)          | Plain array — no benefit from fusion          |

## Integration

`@typesugar/fusion` is designed to interoperate with the rest of the typesugar ecosystem:

- **Any Iterable source** — `lazy()` accepts any `Iterable`, including `@typesugar/std` collections like `Range` and `Tuple`, plain arrays, Sets, Maps, and generators.
- **Vec + numeric math** — `vec()` operations (`add`, `scale`, `dot`, etc.) provide SIMD-style element-wise arithmetic on numeric arrays, complementing the iterator pipeline for batch math workloads.
- **Compatible with @typesugar/fp** — `@typesugar/fp`'s lazy `List` also uses deferred evaluation. You can feed a lazy `List` into `lazy()` (it implements `Iterable`) for fusion, or use each independently depending on whether you need persistent data structure semantics or pure throughput.
- **Macro registration** — Fusion's compile-time macros (Phase 2) are registered through `@typesugar/core`'s `globalRegistry`, following the same pattern as all other typesugar macro packages.

## What's Next

- [API Reference](/reference/packages#fusion)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/fusion)
