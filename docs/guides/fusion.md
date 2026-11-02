# Loop Fusion

Single-pass iterator pipelines with zero intermediate allocations — `.filter().map().reduce()` runs in one loop.

Inspired by Blitz++/Eigen expression templates and Rust's zero-cost iterator adapters.

> **Two levels of fusion.** `lazy()` fuses at runtime through the `LazyPipeline` class: one pass, no intermediate arrays, but the pipeline object exists at runtime. With the typesugar transformer, wrapping a chain in `fused(...)` compiles it to a single loop with no pipeline object at all (see [Compile-Time Fusion](#compile-time-fusion-with-fused)).

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
const p = lazy(data).filter((x) => x > 0);

p.toArray(); // T[] — collect results
p.reduce((a, b) => a + b, 0); // fold left
p.find((x) => x > 100); // first match or null
p.some((x) => x > 100); // any match?
p.every((x) => x > 0); // all match?
p.count(); // count elements
p.forEach((x) => console.log(x)); // side effects
p.first(); // first element or null
p.last(); // last element or null
p.sum(); // sum (number pipelines)
p.min(); // minimum (optional comparator: .min(cmp))
p.max(); // maximum (optional comparator: .max(cmp))
p.groupBy((x) => x.category); // Map<K, T[]>
p.toMap(
  (x) => x.id,
  (x) => x
); // Map<K, V>
p.join(", "); // join strings
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

## Compile-Time Fusion with `fused()`

`lazy()` alone is runtime fusion: each element flows through every step before the next
one starts, nothing is allocated between steps, and `take(5)` stops after five elements.
The `LazyPipeline` object itself still exists at runtime.

`fused(chain)` removes it. The transformer reads the whole chain at compile time and emits
one loop in place of the call:

```typescript
import { fused, lazy } from "@typesugar/fusion";

const total = fused(
  users
    .filter((u) => u.active)
    .map((u) => u.score * 2)
    .reduce((a, b) => a + b, 0)
);

const sum = fused(
  lazy(users)
    .filter((u) => u.active)
    .map((u) => u.score)
    .sum()
);
```

`total` compiles to (generated names shortened):

```typescript
const total = (() => {
  let acc = 0;
  for (const el of users) {
    if (!((u) => u.active)(el)) continue;
    const v = ((u) => u.score * 2)(el);
    acc = ((a, b) => a + b)(acc, v);
  }
  return acc;
})();
```

Two chain shapes are fused, each keeping its own semantics:

| Root              | Intermediate steps      | Terminal steps                                                                           | Callbacks receive                                                                    |
| ----------------- | ----------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| An array or tuple | `map`, `filter`         | `reduce` (with an initial value), `find`, `some`, `every`, `forEach`                     | `(value, index, array)`, as the Array methods pass them                              |
| `lazy(iterable)`  | `map`, `filter`, `take` | `toArray`, `reduce`, `sum`, `count`, `find`, `some`, `every`, `forEach`, `first`, `last` | the value only; `find`/`first`/`last` return `null` when empty, as LazyPipeline does |

Anything else — another receiver type, an unsupported step (`sort`, `flatMap`, `min`, …), or a
callback containing `await`/`yield` that the loop's wrapper function would capture — is left
unfused: `fused(chain)` becomes plain `chain`, with identical behaviour. Without the
transformer, `fused` is the identity function.

## Zero-Cost Guarantee

- **`lazy()`:** no intermediate collections (a `.filter().map().take()` chain is one pass), but
  one `LazyPipeline` object per pipeline.
- **`fused(...)`:** no pipeline object and no method dispatch: the chain becomes the loop you
  would write by hand.

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

- **Any Iterable source** — `lazy()` accepts any `Iterable`: plain arrays, Sets, Maps, strings and generators. `@typesugar/std`'s `Range` and `@typesugar/fp`'s `List` are plain data, not iterables, so convert them to an array first (for a Range, `toArray(range)` from `@typesugar/std`).
- **Vec + numeric math** — `vec()` operations (`add`, `scale`, `dot`, etc.) provide SIMD-style element-wise arithmetic on numeric arrays, complementing the iterator pipeline for batch math workloads.
- **Macro registration** — the `fused` macro is loaded from the package's `./macros` entry, like every other typesugar macro package. `lazy` is a plain runtime function, not a macro.

## What's Next

- [API Reference](/reference/packages#fusion)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/fusion)
