# Zero-Cost Specialization

Compile-time specialization for generic functions, eliminating runtime typeclass dictionary passing.

## Quick Start

```bash
npm install @typesugar/specialize
```

### Implicit Specialization (Recommended)

With `@implicits`, specialization happens automatically:

```typescript
@implicits
function sortWith<T>(items: T[], ord: Ord<T>): T[] {
  return items.slice().sort((a, b) => ord.compare(a, b));
}

// Just call it — instance is resolved AND inlined automatically
const sorted = sortWith([3, 1, 2]); // [1, 2, 3]
// Compiles to: [3, 1, 2].slice().sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
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

| Pattern                        | Runtime Cost                     |
| ------------------------------ | -------------------------------- |
| Generic function with instance | Dictionary lookup per call       |
| `.specialize(dict)`            | Zero — instance baked in         |
| `@implicits` + auto-specialize | Zero — fully automatic           |

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

### With @implicits (Best)

```typescript
@implicits
function sortWith<T>(items: T[], ord: Ord<T>): T[] { ... }

// No dictionary passing, no .specialize() — just works
const sorted = sortWith([3, 1, 2]);
```

## API

### Extension Method (Preferred)

- `fn.specialize(instance)` — Create a specialized function with one instance pre-applied
- `fn.specialize(inst1, inst2, ...)` — Specialize with multiple instances

### Functions

- `specialize(fn, [instances])` — Legacy: create a specialized function (array syntax)
- `specialize$(call)` — Inline specialization for a single call
- `mono<T1, ...>(fn)` — Monomorphize a generic function for specific types
- `inlineCall(call)` — Attempt to inline a function call

## When to Use What

| Scenario | Approach |
| -------- | -------- |
| Most cases | `@implicits` — fully automatic |
| Need a named specialized function | `fn.specialize(dict)` |
| One-off inline specialization | `specialize$(call)` |
| Legacy code / edge cases | `specialize(fn, [dict])` |

## Learn More

- [API Reference](/reference/packages#specialize)
- [Package README](https://github.com/dpovey/typesugar/tree/main/packages/specialize)
