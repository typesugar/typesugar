# Zero-Cost Specialization

Compile-time specialization for generic functions, eliminating runtime typeclass dictionary passing. Similar to GHC's `SPECIALIZE` pragma or Rust's monomorphization — achieve true zero-cost abstractions where the typeclass instance is baked in at compile time rather than looked up at runtime.

## Quick Start

```bash
npm install @typesugar/specialize
```

### Implicit Specialization (Recommended)

With `= implicit()`, specialization happens automatically:

```typescript
function sortWith<T>(items: T[], ord: Ord<T> = implicit()): T[] {
  return items.slice().sort((a, b) => ord.compare(a, b));
}

// Just call it — instance is resolved AND inlined automatically
const sorted = sortWith([3, 1, 2]); // [1, 2, 3]
// Compiles to: [3, 1, 2].slice().sort((a, b) => a < b ? -1 : a > b ? 1 : 0)

// Or pass an explicit instance to override
const sorted2 = sortWith([3, 1, 2], reverseOrd);
```

### Extension Method Syntax

When you need a named specialized function:

```typescript
import "@typesugar/specialize"; // Adds .specialize() to functions

// Generic function with typeclass constraint
function sortWith<T>(items: T[], ord: Ord<T>): T[] {
  return items.slice().sort((a, b) => ord.compare(a, b));
}

// Create a specialized version using the extension method
const sortNumbers = sortWith.specialize(numberOrd);
// Type: (items: number[]) => number[]

// No more passing instances at runtime!
const sorted = sortNumbers([3, 1, 2]); // [1, 2, 3]
```

### Multiple Dictionaries

```typescript
function sortAndShow<T>(items: T[], ord: Ord<T>, show: Show<T>): string {
  const sorted = items.slice().sort((a, b) => ord.compare(a, b));
  return "[" + sorted.map((item) => show.show(item)).join(", ") + "]";
}

// Specialize with multiple instances
const sortAndShowNumbers = sortAndShow.specialize(numberOrd, numberShow);
```

## How It Works

| Pattern                          | Runtime Cost               |
| -------------------------------- | -------------------------- |
| Generic function with instance   | Dictionary lookup per call |
| `.specialize(dict)`              | Zero — instance baked in   |
| `= implicit()` + auto-specialize | Zero — fully automatic     |

### Before Specialization

```typescript
// Every call passes the typeclass instance
const sorted = sortWith([3, 1, 2], numberOrd);
const sorted2 = sortWith([5, 4], numberOrd);
```

### After Specialization

```typescript
// Instance is baked into the specialized function
const sortNumbers = sortWith.specialize(numberOrd);
const sorted = sortNumbers([3, 1, 2]);
const sorted2 = sortNumbers([5, 4]);
```

### With `= implicit()` (Best)

```typescript
function sortWith<T>(items: T[], ord: Ord<T> = implicit()): T[] { ... }

// No dictionary passing, no .specialize() — just works
const sorted = sortWith([3, 1, 2]);
// Or override: sortWith([3, 1, 2], customOrd)
```

## Other Specialization Macros

Beyond `= implicit()` and `.specialize()`, the package provides three lower-level macros for inlining and monomorphization.

### Inline a single expression — `specialize$()`

`specialize$(dict, expr)` inline-specializes one expression. `expr` is a lambda `F => body`, and every `F.method()` call in the body is replaced with the inlined implementation from `dict`:

```typescript
import { specialize$ } from "@typesugar/specialize";

// The lambda parameter receives the dictionary; method calls are inlined
const result = specialize$(arrayMonad, (F) => F.map([1, 2, 3], (x) => x * 2));
// Compiles to: [1, 2, 3].map((x) => x * 2)

// Nesting works too
const nested = specialize$(arrayMonad, (F) =>
  F.flatMap([1, 2], (x) => F.map([x, x + 1], (y) => y * 2))
);
// Compiles to: [1, 2].flatMap((x) => [x, x + 1].map((y) => y * 2))
```

### Monomorphize a generic — `mono()`

`mono<T>(fn)` produces a version of a generic function fixed to specific type arguments:

```typescript
import { mono } from "@typesugar/specialize";

const identity = <T>(x: T): T => x;

const identityNumber = mono<number>(identity);
// Type: (x: number) => number

const identityString = mono<string>(identity);
// Type: (x: string) => string
```

### Inline a function call — `inlineCall()`

`inlineCall(expr)` inlines a function call at compile time:

```typescript
import { inlineCall } from "@typesugar/specialize";

const double = (x: number) => x * 2;

const result = inlineCall(double(21));
// Compiles to: ((x) => x * 2)(21)
// And, where the optimizer can fold it: 42
```

### Legacy: `specialize()` function form

The array-syntax `specialize(fn, [instances])` predates the `.specialize()` extension method and remains for backwards compatibility:

```typescript
import { specialize } from "@typesugar/specialize";

function sortWith<T>(items: T[], ord: Ord<T>): T[] {
  return items.slice().sort((a, b) => ord.compare(a, b));
}

const sortNumbers = specialize(sortWith, [numberOrd]);
// Type: (items: number[]) => number[]
const sorted = sortNumbers([3, 1, 2]); // [1, 2, 3]
```

## API

### Extension Method (Preferred)

- `fn.specialize(instance)` — Create a specialized function with one instance pre-applied
- `fn.specialize(inst1, inst2, ...)` — Specialize with multiple instances

### Functions

- `specialize(fn, [instances])` — Legacy: create a specialized function (array syntax)
- `specialize$(dict, expr)` — Inline specialization: `expr` is a lambda `F => body` where `F.method()` calls get inlined
- `mono<T1, ...>(fn)` — Monomorphize a generic function for specific types
- `inlineCall(call)` — Attempt to inline a function call

## When to Use What

| Scenario                          | Approach                         |
| --------------------------------- | -------------------------------- |
| Most cases                        | `= implicit()` — fully automatic |
| Need a named specialized function | `fn.specialize(dict)`            |
| One-off inline specialization     | `specialize$(dict, expr)`        |
| Legacy code / edge cases          | `specialize(fn, [dict])`         |

## Learn More

- [API Reference](/reference/packages#specialize)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/specialize)
