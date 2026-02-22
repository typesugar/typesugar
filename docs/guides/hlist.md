# Heterogeneous Lists

Type-safe tuples with a full library of typed operations — every transformation preserves complete type information.

## Quick Start

```bash
npm install @typesugar/hlist
```

```typescript
import { hlist, head, tail, append, concat, reverse } from "@typesugar/hlist";

const list = hlist(1, "hello", true);

head(list); // 1       — typed as number
tail(list); // ["hello", true] — typed as HList<[string, boolean]>
append(list, 42); // HList<[number, string, boolean, number]>
```

## What is an HList?

An `HList<[A, B, C]>` is a tuple where each element can be a different type, and the type system tracks every one individually. At runtime, it's just an array — no wrapper objects, no overhead.

TypeScript already has tuples, but they're awkward to manipulate generically. Try writing a type-safe `concat` or `reverse` for tuples — it's painful. HList gives you a library of operations that handle the type gymnastics for you.

## Operations

### Element Access

```typescript
import { hlist, head, tail, at, last, init, length } from "@typesugar/hlist";

const list = hlist("a", 42, true, [1, 2]);

head(list); // "a"    — string
tail(list); // HList<[number, boolean, number[]]>
at(list, 2); // true   — boolean
last(list); // [1, 2] — number[]
init(list); // HList<[string, number, boolean]>
length(list); // 4
```

### Structural Transforms

```typescript
import { hlist, append, prepend, concat, reverse, zip, splitAt } from "@typesugar/hlist";

const a = hlist(1, "x");
const b = hlist(true, null);

append(a, 99); // HList<[number, string, number]>
prepend("start", a); // HList<[string, number, string]>
concat(a, b); // HList<[number, string, boolean, null]>
reverse(a); // HList<[string, number]>

zip(hlist(1, 2), hlist("a", "b")); // HList<[[number, string], [number, string]]>
splitAt(hlist(1, 2, 3, 4), 2); // [HList<[number, number]>, HList<[number, number]>]
```

## Labeled HList

When you need named access like a record, use `labeled()`:

```typescript
import { labeled, get, set, labels, project, merge } from "@typesugar/hlist";

const rec = labeled({ x: 10, y: "hi", z: true });

get(rec, "x"); // 10 — typed as number
get(rec, "y"); // "hi" — typed as string
labels(rec); // ["x", "y", "z"]

const updated = set(rec, "x", 99); // new LabeledHList with x=99
const subset = project(rec, "x", "z"); // just x and z

const merged = merge(labeled({ a: 1 }), labeled({ b: "two" })); // LabeledHList with a: number, b: string
```

This gives you type-safe named fields without needing to define an interface.

## Higher-Order Operations

```typescript
import { hlist, map, foldLeft, forEach, toArray } from "@typesugar/hlist";

const list = hlist(1, 2, 3);

const doubled = map(list, (x) => x * 2); // HList<[number, number, number]>

const sum = foldLeft(list, 0, (acc, x) => acc + x); // 6

forEach(list, (x) => console.log(x)); // side effects

const arr = toArray(list); // [1, 2, 3] as plain array
```

## Type-Level Tracking

Every operation preserves full type information — this is the key difference from plain arrays. The type-level utilities are exported for your own generic code:

```typescript
import type { Head, Tail, Concat, Reverse, SplitAt } from "@typesugar/hlist";

type First = Head<[number, string, boolean]>; // number
type Rest = Tail<[number, string, boolean]>; // [string, boolean]
type Joined = Concat<[1, 2], [3, 4]>; // [1, 2, 3, 4]
type Rev = Reverse<[1, 2, 3]>; // [3, 2, 1]
type Halves = SplitAt<[1, 2, 3, 4], 2>; // [[1, 2], [3, 4]]
```

## When to Use HList vs Arrays/Tuples

| Use Case                                      | Reach for        |
| --------------------------------------------- | ---------------- |
| Homogeneous data (`number[]`)                 | Plain array      |
| Fixed-length, known types (2-3 elements)      | TypeScript tuple |
| Typed argument builders, generic programming  | HList            |
| Named fields without an interface             | LabeledHList     |
| Structural representations for derive/generic | HList            |

HList shines when you need to **transform** heterogeneous sequences while keeping the type system in the loop. If you're just storing data, a tuple or interface is simpler.

## What's Next

- [API Reference](/reference/packages#hlist)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/hlist)
