# Loop Fusion

Single-pass iterator pipelines with zero intermediate allocations — `.filter().map().reduce()` runs in one loop.

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
  .sum();                        // sum (number pipelines)
  .min();                        // minimum
  .max();                        // maximum
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
import { vec, add, sub, scale, dot, magnitude, normalize } from "@typesugar/fusion";

const a = vec([1, 2, 3]);
const b = vec([4, 5, 6]);

add(a, b); // vec([5, 7, 9])
sub(a, b); // vec([-3, -3, -3])
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

## When to Use `lazy()` vs Plain Array Methods

| Scenario                                  | Use                                           |
| ----------------------------------------- | --------------------------------------------- |
| Small arrays (< 100 elements)             | Plain array methods — overhead doesn't matter |
| Long chains (3+ operations)               | `lazy()` — avoids intermediate allocations    |
| Early termination needed (`take`, `find`) | `lazy()` — stops as soon as result is found   |
| Infinite/generated sequences              | `lazy()` with `range()`, `iterate()`, etc.    |
| Single operation (just `.map()`)          | Plain array — no benefit from fusion          |

## What's Next

- [API Reference](/reference/packages#fusion)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/fusion)
