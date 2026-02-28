# @typesugar/erased

Typeclass-based type erasure for heterogeneous collections — `dyn Trait` for TypeScript.

## The Problem

TypeScript arrays are homogeneous: `Array<T>` requires every element to share the same type. When you need a collection of _different_ types that all support the same operations (show, compare, hash, ...), you're stuck with `any[]` or complex union gymnastics.

## The Solution

Wrap each value in an `Erased<Caps>` that carries a **vtable** — a record of method implementations for the capabilities you care about. The concrete type is forgotten, but you retain type-safe access to the shared operations.

```typescript
import { eraseWith, show, equals, showAll } from "@typesugar/erased";
import type { ShowCapability, EqCapability } from "@typesugar/erased";

type Caps = [ShowCapability, EqCapability];

const items = [
  eraseWith<number, Caps>(42, {
    show: (v) => String(v),
    equals: (a, b) => a === b,
  }),
  eraseWith<string, Caps>("hello", {
    show: (v) => `"${v}"`,
    equals: (a, b) => a === b,
  }),
];

showAll(items); // ["42", '"hello"']
equals(items[0], items[1]); // false
```

## Quick Start

### Convenience constructors

For common single/dual capability cases:

```typescript
import { showable, equatable, showableEq } from "@typesugar/erased";

const s = showable(42, (n) => `num:${n}`);
show(s); // "num:42"

const e = equatable(10, (a, b) => a === b);
equals(
  e,
  equatable(10, (a, b) => a === b)
); // true

const se = showableEq(
  "hi",
  (s) => s.toUpperCase(),
  (a, b) => a === b
);
show(se); // "HI"
```

### Full vtable

For multiple capabilities, pass the complete vtable to `eraseWith`:

```typescript
import type {
  ShowCapability,
  EqCapability,
  OrdCapability,
  HashCapability,
  CloneCapability,
} from "@typesugar/erased";

type AllCaps = [ShowCapability, EqCapability, OrdCapability, HashCapability, CloneCapability];

const erased = eraseWith<number, AllCaps>(42, {
  show: (v) => String(v),
  equals: (a, b) => a === b,
  compare: (a, b) => (a as number) - (b as number),
  hash: (v) => v as number,
  clone: (v) => v,
});
```

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

You can also define custom capabilities by extending `Capability<Name>`.

## Collection Operations

```typescript
import { sortErased, dedup, groupByHash, filterErased, mapErased } from "@typesugar/erased";

// Sort by Ord capability
const sorted = sortErased(items);

// Remove consecutive duplicates by Eq
const unique = dedup(items);

// Group by hash code
const groups = groupByHash(items);

// Standard map/filter
const names = mapErased(items, (e) => show(e));
const filtered = filterErased(items, (e) => show(e).length > 2);
```

## Widen and Narrow

**Widen** drops capabilities from the type. Zero-cost — it's an identity cast at runtime:

```typescript
import { widen } from "@typesugar/erased";

const full: Erased<[ShowCapability, EqCapability, OrdCapability]> = /* ... */;
const showOnly = widen<typeof full extends Erased<infer C> ? C : never, [ShowCapability]>(full);
```

**Narrow** asserts additional capabilities with a runtime check:

```typescript
import { narrow } from "@typesugar/erased";

const result = narrow<[ShowCapability], [ShowCapability, EqCapability]>(
  showOnly,
  ["equals"] // method names to check for
);
// result is Erased<[ShowCapability, EqCapability]> | null
```

**Extend** adds new vtable methods:

```typescript
import { extendCapabilities } from "@typesugar/erased";

const extended = extendCapabilities(showOnly, { equals: (a, b) => a === b });
```

**Probe** a single method without full narrowing:

```typescript
import { hasCapability } from "@typesugar/erased";

if (hasCapability(erased, "show")) {
  // vtable has a show method
}
```

## Runtime Representation

An `Erased` value is a plain object at runtime:

```typescript
{
  __erased__: true,
  __value: <the concrete value>,
  __vtable: { show: ..., equals: ..., ... }
}
```

No classes, no prototypes, no hidden state. `widen()` is literally identity.

## Comparison to Exists<W>

|             | `Erased<Caps>`                            | `Exists<W>` (existential wrapper) |
| ----------- | ----------------------------------------- | --------------------------------- |
| Level       | High-level, capability-oriented           | Low-level, witness-oriented       |
| Vtable      | Explicit method record                    | Implicit via witness type         |
| Collections | First-class `ErasedList<Caps>`            | Manual wrapping                   |
| Narrowing   | Runtime method check                      | Type-level only                   |
| Use case    | Heterogeneous collections, plugin systems | Type-level existentials           |

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

| Capability        | Typeclass | Method Mapping       |
| ----------------- | --------- | -------------------- |
| `ShowCapability`  | `Show`    | `show` → `show`      |
| `EqCapability`    | `Eq`      | `equals` → `equals`  |
| `OrdCapability`   | `Ord`     | `compare` → `compare`|
| `HashCapability`  | `Hash`    | `hash` → `hash`      |
| `CloneCapability` | `Clone`   | `clone` → `clone`    |

## Auto-Derivation with `erased()`

The `erased()` macro resolves vtables automatically from the typeclass registry at compile time:

```typescript
import { erased } from "@typesugar/erased";

@derive(Show, Eq)
interface Point { x: number; y: number; }

const p = { x: 1, y: 2 };
const e = erased<[Show, Eq]>(p);
// Automatically generates vtable from Show<Point> and Eq<Point> instances!
```

**How it works:**

1. Parse type arguments: `erased<[Show, Eq]>(value)` → capabilities = [Show, Eq]
2. Infer value's type: TypeChecker determines `typeof value`
3. Resolve instances: Look up `Show<T>`, `Eq<T>` from the registry
4. Generate vtable: Build `{ show: ..., equals: ... }` at compile time

**Benefits:**

- **No boilerplate**: Skip manual vtable construction
- **Type safety**: Compile error if capability instance doesn't exist
- **Consistent**: Same instances used for operators and erased values

**Fallback:** For types without registered instances, use `eraseWith()`, `showable()`, etc. for manual vtable construction.
