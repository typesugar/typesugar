# Type Erasure

> 🧊 **Frozen ([PEP-048](https://github.com/typesugar/typesugar/blob/main/peps/PEP-048-package-triage.md)).** `@typesugar/erased` is not under active development and is excluded from release. It still lives in the repo and builds, but is not part of typesugar's actively-maintained surface.

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

| Capability        | Methods                                             | Matches Typeclass |
| ----------------- | --------------------------------------------------- | ----------------- |
| `ShowCapability`  | `show(value): string`                               | Show              |
| `EqCapability`    | `equals(a, b): boolean`                             | Eq                |
| `OrdCapability`   | `compare(a, b): number`                             | Ord               |
| `HashCapability`  | `hash(value): number`                               | Hash              |
| `CloneCapability` | `clone(value): unknown`                             | Clone             |
| `DebugCapability` | `debug(value): string`                              | Debug             |
| `JsonCapability`  | `toJson(value): unknown`, `fromJson(json): unknown` | Json              |

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

## Runtime Representation

An `Erased` value is a plain object at runtime:

```typescript
{
  __erased__: true,
  __value: /* the concrete value */,
  __vtable: { show: /* ... */, equals: /* ... */ },
}
```

No classes, no prototypes, no hidden state. `widen()` is literally identity.

## Zero-Cost Analysis

| Operation                  | Cost                                             |
| -------------------------- | ------------------------------------------------ |
| `eraseWith()`              | One object allocation (value + vtable ref)       |
| `show()`, `equals()`, etc. | One vtable lookup + one function call            |
| `widen()`                  | Zero — identity cast                             |
| `narrow()`                 | O(n) where n = number of required methods        |
| `clone()`                  | Depends on clone implementation + one allocation |
| `unwrapErased()`           | Zero — property access                           |

The vtable is shared across all values created with the same method implementations, so there is no per-element overhead for the method pointers themselves.

## Typeclass Integration

The capability system mirrors typesugar's typeclass system. The `erased()` macro automatically resolves vtables from registered typeclass instances:

| Capability       | Typeclass | Method Mapping        |
| ---------------- | --------- | --------------------- |
| `ShowCapability` | `Show`    | `show` → `show`       |
| `EqCapability`   | `Eq`      | `equals` → `equals`   |
| `OrdCapability`  | `Ord`     | `compare` → `compare` |
| `HashCapability` | `Hash`    | `hash` → `hash`       |

**Available for auto-derivation:** Show, Eq, Ord, Hash (these have typeclass definitions in `@typesugar/std` and `@typesugar/fp`).

**Requires manual vtable construction:** Clone, Debug, Json. These capabilities are supported by `eraseWith()` but have no corresponding typeclass in the registry, so `erased()` cannot resolve them automatically. Use `eraseWith()` or the convenience constructors to provide implementations.

## Auto-Derivation with `erased()`

The `erased()` macro resolves vtables automatically from the typeclass registry at compile time:

```typescript
import { erased } from "@typesugar/erased";

@derive(Show, Eq)
interface Point {
  x: number;
  y: number;
}

const p = { x: 1, y: 2 };
const e = erased<[Show, Eq]>(p);
// Automatically generates the vtable from Show<Point> and Eq<Point> instances.
```

**How it works:**

1. Parse type arguments: `erased<[Show, Eq]>(value)` → capabilities = `[Show, Eq]`
2. Infer the value's type: the TypeChecker determines `typeof value`
3. Resolve instances: look up `Show<T>`, `Eq<T>` from the registry
4. Generate the vtable: build `{ show: ..., equals: ... }` at compile time

**Benefits:**

- **No boilerplate**: skip manual vtable construction
- **Type safety**: compile error if a capability instance doesn't exist
- **Consistent**: the same instances are used for operators and erased values

**Fallback:** for types without registered instances, use `eraseWith()`, `showable()`, etc. for manual vtable construction.

## What's Next

- [API Reference](/reference/packages#erased)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/erased)
