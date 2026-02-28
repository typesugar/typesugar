# @typesugar/fusion

Expression templates and loop fusion for TypeScript. Iterator chains like `.filter().map().reduce()` execute in a single pass with no intermediate arrays.

Inspired by Blitz++/Eigen expression templates and Rust's zero-cost iterator adapters.

> **Current Status:** Runtime fusion via `LazyPipeline` class. Single-pass iteration with no intermediate arrays is achieved, but the pipeline object itself exists at runtime. Phase 2 will add compile-time macro analysis to eliminate the pipeline class entirely.

## The Problem

Standard array method chains allocate intermediate arrays at every step:

```typescript
// 3 passes over the data, 2 intermediate arrays allocated
const result = users
  .filter((u) => u.active) // pass 1 → intermediate array
  .map((u) => u.score * 2) // pass 2 → intermediate array
  .reduce((a, b) => a + b, 0); // pass 3
```

## The Solution

`lazy()` collects operations into a pipeline and fuses them into a single pass:

```typescript
import { lazy } from "@typesugar/fusion";

// 1 pass, 0 intermediate arrays
const result = lazy(users)
  .filter((u) => u.active)
  .map((u) => u.score * 2)
  .reduce((a, b) => a + b, 0);
```

## API

### `lazy(source)` — Lazy Iterator Pipeline

Wraps any `Iterable` (arrays, Sets, Maps, generators) and returns a `LazyPipeline`.

#### Intermediate operations (chainable)

| Method             | Description                      |
| ------------------ | -------------------------------- |
| `.map(f)`          | Transform each element           |
| `.filter(pred)`    | Keep elements matching predicate |
| `.flatMap(f)`      | Map to iterable and flatten      |
| `.take(n)`         | Take first N elements            |
| `.drop(n)`         | Skip first N elements            |
| `.takeWhile(pred)` | Take while predicate holds       |
| `.dropWhile(pred)` | Skip while predicate holds       |

#### Terminal operations (execute the pipeline)

| Method                 | Returns      | Description             |
| ---------------------- | ------------ | ----------------------- |
| `.toArray()`           | `T[]`        | Collect into array      |
| `.reduce(f, init)`     | `Acc`        | Fold left               |
| `.find(pred)`          | `T \| null`  | First match             |
| `.some(pred)`          | `boolean`    | Any match?              |
| `.every(pred)`         | `boolean`    | All match?              |
| `.count()`             | `number`     | Count elements          |
| `.forEach(f)`          | `void`       | Side effect per element |
| `.first()`             | `T \| null`  | First element           |
| `.last()`              | `T \| null`  | Last element            |
| `.sum()`               | `number`     | Sum (number pipelines)  |
| `.min(cmp?)`           | `T \| null`  | Minimum element         |
| `.max(cmp?)`           | `T \| null`  | Maximum element         |
| `.join(sep?)`          | `string`     | Join strings            |
| `.toMap(keyFn, valFn)` | `Map<K,V>`   | Collect into Map        |
| `.groupBy(keyFn)`      | `Map<K,T[]>` | Group by key            |

### Source Factories

```typescript
import { range, iterate, repeat, generate } from "@typesugar/fusion";

range(0, 10); // [0, 1, 2, ..., 9]
range(0, 10, 2); // [0, 2, 4, 6, 8]

iterate(1, (x) => x * 2).take(5); // [1, 2, 4, 8, 16]
repeat("x").take(3); // ["x", "x", "x"]
generate(Math.random).take(4); // [0.12, 0.87, 0.34, 0.56]
```

### `vec()` — Element-wise Vector Operations

For numeric array operations (think NumPy-lite):

```typescript
import { vec, add, sub, mul, scale, dot, magnitude, normalize } from "@typesugar/fusion";

const a = vec([1, 2, 3]);
const b = vec([4, 5, 6]);

add(a, b); // vec([5, 7, 9])
scale(a, 10); // vec([10, 20, 30])
dot(a, b); // 32
magnitude(a); // 3.741...
normalize(a); // unit vector in same direction
```

## Performance: Single-Pass vs Multi-Pass

```
Operation: .filter().map().take(100) on 100,000 elements

Multi-pass (Array methods):
  Pass 1: filter → allocates intermediate array
  Pass 2: map → allocates another intermediate array
  Pass 3: slice → allocates final array
  Total: 3 passes, 2+ allocations

Single-pass (lazy):
  1 loop, processes each element through filter→map→take inline
  Stops after 100 elements emitted
  Total: 1 partial pass, 0 intermediate allocations
```

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
