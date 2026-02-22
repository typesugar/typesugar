# Type Erasure

Typeclass-based type erasure for heterogeneous collections — `dyn Trait` for TypeScript.

## The Problem

You have values of different types that all support the same operations — show, compare, hash. How do you put them in a single collection?

- `any[]` throws away all type information
- Union types (`(number | string | Widget)[]`) get unwieldy and require manual narrowing
- Wrapper classes add boilerplate for every new type

## Quick Start

```bash
npm install @typesugar/erased
```

```typescript
import { showable, show, showAll } from "@typesugar/erased";

const items = [
  showable(42, (n) => `num:${n}`),
  showable("hello", (s) => `str:${s}`),
  showable(true, (b) => (b ? "yes" : "no")),
];

show(items[0]); // "num:42"
showAll(items); // ["num:42", "str:hello", "yes"]
```

Each value is wrapped in an `Erased<Caps>` that carries a vtable — a record of method implementations for the capabilities you need. The concrete type is forgotten, but the operations remain type-safe.

## Built-in Capabilities

| Capability        | Methods                 | Matches Typeclass |
| ----------------- | ----------------------- | ----------------- |
| `ShowCapability`  | `show(value): string`   | Show              |
| `EqCapability`    | `equals(a, b): boolean` | Eq                |
| `OrdCapability`   | `compare(a, b): number` | Ord               |
| `HashCapability`  | `hash(value): number`   | Hash              |
| `CloneCapability` | `clone(value): unknown` | Clone             |
| `DebugCapability` | `debug(value): string`  | Debug             |
| `JsonCapability`  | `toJson / fromJson`     | Json              |

### Convenience Constructors

For common cases:

```typescript
import { showable, equatable, showableEq } from "@typesugar/erased";

const s = showable(42, (n) => String(n));
const e = equatable(10, (a, b) => a === b);
const se = showableEq(
  "hi",
  (s) => s.toUpperCase(),
  (a, b) => a === b
);
```

### Full Vtable

For multiple capabilities, use `eraseWith`:

```typescript
import { eraseWith } from "@typesugar/erased";
import type { ShowCapability, EqCapability, OrdCapability } from "@typesugar/erased";

type Caps = [ShowCapability, EqCapability, OrdCapability];

const item = eraseWith<number, Caps>(42, {
  show: (v) => String(v),
  equals: (a, b) => a === b,
  compare: (a, b) => (a as number) - (b as number),
});
```

## Creating Custom Capabilities

Extend `Capability<Name>` to define your own:

```typescript
import type { Capability } from "@typesugar/erased";

interface SerializeCapability extends Capability<"Serialize"> {
  serialize(value: unknown): Uint8Array;
  deserialize(bytes: Uint8Array): unknown;
}
```

Then include it in your `Caps` tuple and provide implementations in the vtable.

## Collections

Erased values compose naturally into heterogeneous collections:

```typescript
import {
  sortErased,
  dedup,
  groupByHash,
  filterErased,
  mapErased,
  showAll,
} from "@typesugar/erased";

// Sort by Ord capability
const sorted = sortErased(items);

// Deduplicate consecutive equal elements
const unique = dedup(items);

// Group by hash value
const groups = groupByHash(items);

// Standard map/filter over erased values
const names = mapErased(items, (e) => show(e));
const long = filterErased(items, (e) => show(e).length > 3);
```

## Widen and Narrow

### Widen — drop capabilities (zero-cost)

```typescript
import { widen } from "@typesugar/erased";
import type { ShowCapability } from "@typesugar/erased";

// Drop Eq and Ord, keep only Show
const showOnly = widen<typeof item extends Erased<infer C> ? C : never, [ShowCapability]>(item);
```

This is an identity cast at runtime — no allocation, no copying.

### Narrow — add capabilities (runtime check)

```typescript
import { narrow } from "@typesugar/erased";
import type { ShowCapability, EqCapability } from "@typesugar/erased";

const result = narrow<[ShowCapability], [ShowCapability, EqCapability]>(
  showOnly,
  ["equals"] // method names to check
);
// result is Erased<[ShowCapability, EqCapability]> | null
```

Returns `null` if the vtable doesn't have the required methods.

### Extend — add new vtable methods

```typescript
import { extendCapabilities } from "@typesugar/erased";

const withEq = extendCapabilities(showOnly, {
  equals: (a, b) => a === b,
});
```

### Probe — check a single method

```typescript
import { hasCapability } from "@typesugar/erased";

if (hasCapability(erased, "show")) {
  // vtable has a show method
}
```

## Comparison to Exists\<W\>

|             | `Erased<Caps>`                     | `Exists<W>`                 |
| ----------- | ---------------------------------- | --------------------------- |
| Level       | High-level, capability-oriented    | Low-level, witness-oriented |
| Vtable      | Explicit method record             | Implicit via witness type   |
| Collections | First-class support                | Manual wrapping             |
| Narrowing   | Runtime method check               | Type-level only             |
| Use case    | Heterogeneous collections, plugins | Type-level existentials     |

Use `Erased` when you need collections of mixed types with shared behavior. Use `Exists` when you need type-level existential quantification and don't care about collections.

## What's Next

- [API Reference](/reference/packages#erased)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/erased)
