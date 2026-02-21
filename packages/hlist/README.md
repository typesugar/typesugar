# @typesugar/hlist

Heterogeneous lists with compile-time type tracking -- Boost.Fusion for TypeScript.

An `HList<[A, B, C]>` is a tuple where every element can be a different type,
and the type system tracks each one individually. At runtime it's just an array.
The cost is zero; the value is in the types.

## Why HList?

TypeScript already has tuples, but they're awkward to manipulate generically.
HList gives you a library of typed operations (head, tail, concat, zip, split,
reverse, fold, labeled access) that preserve full type information through
every transformation.

Use cases:

- **Typed argument builders** -- accumulate heterogeneous arguments with full type tracking
- **Record-like structures** -- `LabeledHList` gives you type-safe named fields without interfaces
- **Generic programming** -- HList is the runtime backbone for `Generic<T>` structural representations
- **Compile-time pipelines** -- chain transformations where each step changes the element types

## Quick Start

```typescript
import {
  hlist, hnil, head, tail, concat, reverse, zip, splitAt,
  append, prepend, at, last, init, length,
  labeled, get, set, labels, project, merge,
  map, foldLeft, forEach, toArray, fromArray,
} from "@typesugar/hlist";

// --- Positional HList ---

const list = hlist(1, "hello", true);

head(list);    // 1       (typed as number)
tail(list);    // ["hello", true] (typed as HList<[string, boolean]>)
at(list, 2);   // true    (typed as boolean)
last(list);    // true    (typed as boolean)

// Structural transforms
append(list, 42);                // HList<[number, string, boolean, number]>
prepend("start", list);         // HList<[string, number, string, boolean]>
concat(hlist(1, 2), hlist(3));  // HList<[number, number, number]>
reverse(list);                  // HList<[boolean, string, number]>

// Zip and split
zip(hlist(1, 2), hlist("a", "b"));  // HList<[[number, string], [number, string]]>
splitAt(list, 1);                    // [HList<[number]>, HList<[string, boolean]>]

// --- Labeled HList ---

const rec = labeled({ x: 10, y: "hi", z: true });

get(rec, "x");     // 10 (typed as number)
get(rec, "y");     // "hi" (typed as string)
labels(rec);       // ["x", "y", "z"]

set(rec, "x", 99);            // new LabeledHList with x=99
project(rec, "x", "z");       // subset with just x and z
merge(
  labeled({ a: 1 }),
  labeled({ b: 2 }),
);  // combined LabeledHList with a=1, b=2
```

## API Reference

### Construction

| Function | Signature | Description |
| --- | --- | --- |
| `hlist` | `(...args: T) => HList<T>` | Create from positional arguments |
| `hnil` | `() => HNil` | Create empty HList |
| `labeled` | `(record: R) => LabeledHList<...>` | Create from a record object |
| `fromArray` | `(arr: T) => HList<T>` | Wrap an existing array/tuple |

### Element Access

| Function | Signature | Description |
| --- | --- | --- |
| `head` | `(list) => H` | First element |
| `tail` | `(list) => HList<T>` | All but first |
| `last` | `(list) => Last<T>` | Last element |
| `init` | `(list) => HList<Init<T>>` | All but last |
| `at` | `(list, N) => At<T, N>` | Element at index N |
| `length` | `(list) => number` | Number of elements |

### Structural Operations

| Function | Signature | Description |
| --- | --- | --- |
| `append` | `(list, value) => HList<[...T, V]>` | Add to end |
| `prepend` | `(value, list) => HList<[V, ...T]>` | Add to front |
| `concat` | `(a, b) => HList<[...A, ...B]>` | Join two lists |
| `reverse` | `(list) => HList<Reverse<T>>` | Reverse order |
| `zip` | `(a, b) => HList<Zip<A, B>>` | Pairwise zip |
| `splitAt` | `(list, N) => [left, right]` | Split at index |

### Labeled Operations

| Function | Signature | Description |
| --- | --- | --- |
| `get` | `(list, name) => ValueByName<...>` | Get field by label |
| `set` | `(list, name, value) => LabeledHList<...>` | Replace field value (immutable) |
| `labels` | `(list) => string[]` | Get all label names |
| `project` | `(list, ...names) => LabeledHList<...>` | Select subset of fields |
| `merge` | `(a, b) => LabeledHList<[...A, ...B]>` | Combine two labeled lists |

### Higher-Order Operations

| Function | Signature | Description |
| --- | --- | --- |
| `map` | `(list, f) => HList<...>` | Apply f to each element |
| `foldLeft` | `(list, init, f) => Acc` | Left fold |
| `forEach` | `(list, f) => void` | Side-effecting iteration |
| `toArray` | `(list) => T` | Extract underlying array (copy) |

## Type-Level Utilities

All type-level operations are exported for use in your own generic code:

```typescript
import type {
  Head, Tail, Last, Init, Length, At,
  Concat, Reverse, Zip, SplitAt,
  LabelOf, ValueOf, FieldByName, ValueByName,
  UpdateField, ProjectFields,
  HList, HNil, HCons,
  LabeledField, LabeledHList,
} from "@typesugar/hlist";

type First = Head<[number, string, boolean]>;  // number
type Rest = Tail<[number, string, boolean]>;   // [string, boolean]
type Joined = Concat<[1, 2], [3, 4]>;         // [1, 2, 3, 4]
type Rev = Reverse<[1, 2, 3]>;                // [3, 2, 1]
type Halves = SplitAt<[1, 2, 3, 4], 2>;       // [[1, 2], [3, 4]]
```

## Zero-Cost Design

HList's runtime representation is a plain JavaScript array. There are no
wrapper objects, no indirection, no extra allocations.

The `__hlist__` brand is a phantom type -- it exists only in the type system
so the typesugar extension method resolver can dispatch on HList values.
It has zero runtime cost.

When the typesugar transformer is active, the `hlist()` and `labeled()` macros
compile away entirely:

```typescript
// Source
const list = hlist(1, "hello", true);

// After macro expansion
const list = [1, "hello", true];
```

## Relationship to Generic

`HList` is independent of `Generic<T>` -- it doesn't depend on it and doesn't
require macros to function. However, the two work together naturally:
`Generic<T>` decomposes a type into an HList representation, and HList
operations manipulate that representation with full type tracking.
