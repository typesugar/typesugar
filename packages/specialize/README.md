# @typesugar/specialize

> Zero-cost typeclass specialization macros.

## Overview

`@typesugar/specialize` provides compile-time specialization for generic functions, eliminating runtime typeclass dictionary passing. Similar to GHC's SPECIALIZE pragma or Rust's monomorphization — achieve true zero-cost abstractions.

## Installation

```bash
npm install @typesugar/specialize
# or
pnpm add @typesugar/specialize
```

## Usage

### specialize() — Create Specialized Functions

```typescript
import { specialize } from "@typesugar/specialize";

// Generic function with typeclass constraint
function sortWith<T>(items: T[], ord: Ord<T>): T[] {
  return items.slice().sort((a, b) => ord.compare(a, b));
}

// Create a specialized version for numbers
const sortNumbers = specialize(sortWith, [numberOrd]);
// Type: (items: number[]) => number[]

// No more passing instances at runtime!
const sorted = sortNumbers([3, 1, 2]); // [1, 2, 3]
```

### specialize$() — Inline Single Expressions

```typescript
import { specialize$ } from "@typesugar/specialize";

// Inline specialization for an expression
// The lambda parameter receives the dictionary, and all method calls are inlined
const result = specialize$(arrayMonad, (F) => F.map([1, 2, 3], (x) => x * 2));
// Compiles to: [1, 2, 3].map(x => x * 2)

// More complex example with flatMap
const nested = specialize$(arrayMonad, (F) =>
  F.flatMap([1, 2], (x) => F.map([x, x + 1], (y) => y * 2))
);
// Compiles to: [1, 2].flatMap(x => [x, x + 1].map(y => y * 2))
```

### mono() — Monomorphize Generics

```typescript
import { mono } from "@typesugar/specialize";

// Monomorphize for specific type arguments
const identity = <T>(x: T): T => x;

const identityNumber = mono<number>(identity);
// Type: (x: number) => number

const identityString = mono<string>(identity);
// Type: (x: string) => string
```

### inlineCall() — Inline Function Calls

```typescript
import { inlineCall } from "@typesugar/specialize";

const double = (x: number) => x * 2;

// Inline the function call at compile time
const result = inlineCall(double(21));
// Compiles to: ((x) => x * 2)(21)
// Or with further optimization: 42
```

## How It Works

### Before Specialization

```typescript
// Runtime: every call passes the typeclass instance
const sorted = sortWith([3, 1, 2], numberOrd);
const sorted2 = sortWith([5, 4], numberOrd);
```

### After Specialization

```typescript
// Compile-time: instance is baked into the specialized function
const sortNumbers = specialize(sortWith, [numberOrd]);
// sortNumbers = (items) => sortWith(items, numberOrd)

const sorted = sortNumbers([3, 1, 2]);
const sorted2 = sortNumbers([5, 4]);
```

## API Reference

### Expression Macros

- `specialize(fn, dict1, dict2?, ...)` — Create a specialized function with dictionaries pre-applied
- `specialize$(dict, expr)` — Inline specialization: `expr` is a lambda `F => body` where `F.method()` calls get inlined
- `mono<T1, ...>(fn)` — Monomorphize a generic function for specific types
- `inlineCall(call)` — Attempt to inline a function call

## Performance Benefits

| Pattern                        | Runtime Cost                     |
| ------------------------------ | -------------------------------- |
| Generic function with instance | Dictionary lookup per call       |
| Specialized function           | Zero — instance baked in         |
| Inlined call                   | Zero — code directly substituted |

## License

MIT
