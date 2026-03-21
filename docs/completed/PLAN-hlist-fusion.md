# Plan: HList / Heterogeneous Sequences (Fusion-Style)

## Status: PHASE 1 IMPLEMENTED

Phase 1 (HList types, operations, LabeledHList, macros) is implemented in `packages/hlist/`. Phase 2 (macro-based zero-cost inlining, `mapWith(TC)` typeclass resolution) is future work.

## Inspiration

C++ Boost.Fusion provides heterogeneous containers (tuples, structs) with compile-time indexing and iteration. Boost.Hana modernized this with constexpr. The key: you can write generic algorithms over heterogeneous sequences where every element has a different type, and it all compiles to direct field access — no boxing, no runtime type dispatch.

## Relationship to Generic

HList and Generic look similar but serve different purposes:

- **Generic** = compile-time structural metadata for typeclass derivation. Its `to`/`from` are identity functions (zero-cost). It never creates an intermediate data structure — macros read `GenericMeta` at compile time and generate inlined code directly.
- **HList** = runtime heterogeneous container with operations. It IS a data structure — a branded array that you construct, transform, and consume.

They share conceptual DNA (both model "a sequence of differently-typed values"), but Generic's zero-cost identity representation can't be swapped for HList without introducing runtime conversion overhead.

**What they share:** HList can use `GenericMeta` to bridge records into HLists:

```typescript
// Optional bridge — allocates, not free, use when you want HList operations
const fields = HList.fromRecord<Point>({ x: 1, y: 2 });
// Uses GenericMeta to know field order → LabeledHList<[["x", number], ["y", number]]>
```

**Features:**

- **User-facing construction** — `hlist(1, "hello", true)` creates `HList<[number, string, boolean]>`
- **Operations** — `head`, `tail`, `append`, `prepend`, `zip`, `map`, `fold`, `splitAt`, `take`, `drop`
- **Type-level computation** — every operation preserves the full heterogeneous type
- **Integration with typeclasses** — `mapWith(Show)` applies Show to each element regardless of type
- **Labeled variant** — `LabeledHList<[["x", number], ["y", number]]>` for named fields

The runtime representation is just a plain array — `HList<[number, string, boolean]>` is `[number, string, boolean]` at runtime. All operations compile to direct array/index operations.

## Design

### Core Types

```typescript
// HList is a branded tuple — the brand is for method resolution, the tuple IS the runtime value
type HList<T extends readonly unknown[]> = T & { readonly __hlist__: true };

// HNil — the empty HList
type HNil = HList<[]>;

// HCons — prepend an element
type HCons<H, T extends readonly unknown[]> = HList<[H, ...T]>;
```

### Construction

```typescript
import { hlist, HNil, hnil } from "@typesugar/hlist";

const empty: HNil = hnil; // HList<[]>
const one = hlist(42); // HList<[number]>
const three = hlist(42, "hello", true); // HList<[number, string, boolean]>

// From tuple (type assertion — zero cost)
const fromTuple = HList.from([1, "a", false] as const); // HList<[1, "a", false]>
```

### Element Access

```typescript
const h = hlist(42, "hello", true);

h.head; // 42 (type: number)          → compiles to: h[0]
h.tail; // HList<[string, boolean]>   → compiles to: h.slice(1)
h.last; // true (type: boolean)       → compiles to: h[h.length - 1]
h.init; // HList<[number, string]>    → compiles to: h.slice(0, -1)

// Indexed access (compile-time bounds checked)
h.at(0); // 42 (type: number)          → compiles to: h[0]
h.at(1); // "hello" (type: string)     → compiles to: h[1]
h.at(5); // Compile error: index 5 out of bounds for HList of length 3
```

### Operations

```typescript
const a = hlist(1, "hello");
const b = hlist(true, 42n);

// Append / Prepend
a.append(true); // HList<[number, string, boolean]>    → [1, "hello", true]
a.prepend(false); // HList<[boolean, number, string]>    → [false, 1, "hello"]

// Concat
a.concat(b); // HList<[number, string, boolean, bigint]>

// Zip
a.zip(b); // HList<[[number, boolean], [string, bigint]]>

// Split
a.concat(b).splitAt(2); // [HList<[number, string]>, HList<[boolean, bigint]>]

// Reverse
a.reverse(); // HList<[string, number]>

// Length (type-level)
a.length; // 2 (literal type)
```

### Heterogeneous Map / Fold

This is the killer feature — apply a typeclass or polymorphic function to each element:

```typescript
import { Show } from "@typesugar/std";

const h = hlist(42, "hello", true);

// Map with a typeclass — each element dispatched to its Show instance
h.mapWith(Show); // HList<[string, string, string]>
// → ["42", "hello", "true"]

// Map with a natural transformation
h.map((x) => [x]); // HList<[number[], string[], boolean[]]>
// → [[42], ["hello"], [true]]

// Fold
h.foldLeft("", (acc, elem, show) => acc + show.show(elem) + " ");
// → "42 hello true "

// ForEach
h.forEach((elem, show) => console.log(show.show(elem)));
```

**How `mapWith(Show)` works at compile time:**

The macro knows the type of each element at each position. For position 0 (number), it resolves `Show<number>`. For position 1 (string), it resolves `Show<string>`. Each call is inlined — no runtime dispatch.

```typescript
// h.mapWith(Show) compiles to:
[showNumber.show(h[0]), showString.show(h[1]), showBoolean.show(h[2])];
```

### Labeled HList (Record-Like)

Since Generic's `Product` already has labels, HList should support them too:

```typescript
import { labeled } from "@typesugar/hlist";

const point = labeled({ x: 1, y: 2, z: 3 });
// Type: LabeledHList<[["x", number], ["y", number], ["z", number]]>

point.get("x"); // 1 (type: number)     → compiles to: point[0]
point.get("y"); // 2 (type: number)     → compiles to: point[1]
point.set("z", 5); // LabeledHList<...>    → compiles to: [...point.slice(0,2), 5]

// Project — select a subset of fields
point.project("x", "z"); // LabeledHList<[["x", number], ["z", number]]>

// Merge — combine two labeled hlists
const extended = point.merge(labeled({ w: 4 }));
// LabeledHList<[["x", number], ["y", number], ["z", number], ["w", number]]>
```

### Bridge: HList.fromRecord (Optional)

When you want HList operations on a record type, explicitly convert:

```typescript
import { HList } from "@typesugar/hlist";

interface Point {
  x: number;
  y: number;
}

// Explicit conversion — not free, allocates an array
const fields = HList.fromRecord<Point>({ x: 1, y: 2 });
// LabeledHList<[["x", number], ["y", number]]>

// Now HList operations are available
fields.mapWith(Show); // ["1", "2"]
fields.get("x"); // 1
fields.head; // 1
```

**Generic stays unchanged.** Its `Product<Fields>` and per-typeclass functions (`showProduct`, `eqProduct`, etc.) continue to serve compile-time derivation. HList is a separate tool for when users need runtime heterogeneous operations.

## Implementation

### Phase 1: Core HList + LabeledHList Types

**Package:** `@typesugar/hlist`

**No dependencies on `@typesugar/macros`** — HList is lower in the dependency graph than Generic.

```typescript
// HList — branded tuple, runtime = plain array
type HList<T extends readonly unknown[]> = T & { readonly __hlist__: true };
type HNil = HList<[]>;
type HCons<H, T extends readonly unknown[]> = HList<[H, ...T]>;

// LabeledHList — branded tuple of [label, value] pairs
type LabeledField<Name extends string, Value> = readonly [Name, Value];
type LabeledHList<Fields extends readonly LabeledField<string, unknown>[]> = HList<{
  [K in keyof Fields]: Fields[K][1];
}> & {
  readonly __labels__: { [K in keyof Fields]: Fields[K][0] };
};

// Construction macros
const hlistMacro = defineExpressionMacro({
  name: "hlist",
  expand(ctx, call, args) {
    return ctx.factory.createArrayLiteralExpression(args);
  },
});

const labeledMacro = defineExpressionMacro({
  name: "labeled",
  expand(ctx, call, args) {
    // { x: 1, y: 2 } → [1, 2] as LabeledHList<[["x", number], ["y", number]]>
    // Labels tracked in types only, not at runtime
  },
});
```

### Phase 2: Operations via Extension Methods

Register operations on the `__hlist__` branded type:

- `head`, `tail`, `last`, `init` — index/slice
- `at(n)` — compile-time bounds check
- `append`, `prepend`, `concat` — spread
- `zip`, `splitAt`, `reverse` — structural

For LabeledHList, add:

- `get(name)` — compile-time field name → index lookup
- `set(name, value)` — functional update
- `project(names...)` — sub-selection
- `merge(other)` — combine labeled hlists
- `labels()` — return label names as string tuple

### Phase 3: Heterogeneous Map / Fold (`mapWith`, `foldWith`)

The `mapWith(TC)` macro:

1. At compile time, inspect the HList's element types
2. For each position, resolve the typeclass instance via `summon()`
3. Emit an array literal with each element's method inlined

```typescript
// h.mapWith(Show) compiles to:
[showNumber.show(h[0]), showString.show(h[1]), showBoolean.show(h[2])];
```

Also: `zipWith(other, TC, method)` for pairwise typeclass operations (needed for Eq, Ord derivation).

This reuses `summon()` from `typeclass.ts` and `inlineMethod()` from `specialize.ts`.

### Phase 4: LabeledHList + fromRecord Bridge

- `labeled()` macro wraps object literals as labeled HLists
- `HList.fromRecord<T>(value)` uses `GenericMeta` (if available) to convert a record into a `LabeledHList` with known field order
- This does NOT change Generic — it's a convenience for users who want HList operations on record types

## Zero-Cost Verification

Every operation compiles to what you'd write by hand:

```typescript
// hlist(1, "hello", true).tail.head
// Compiles to:
"hello"[ // constant folded if inputs are literals
  // hlist(a, b, c).mapWith(Show)
  // Compiles to:
  (String(a), b, String(c))
][ // direct calls per element, no dispatch
  // hlist(a, b).zip(hlist(c, d))
  // Compiles to:
  ([a, c], [b, d])
]; // direct array construction
```

## Inspirations

- **Boost.Fusion** — heterogeneous sequence algorithms
- **Boost.Hana** — modernized Fusion with constexpr
- **shapeless (Scala 2)** — HList with typeclass derivation
- **Scala 3 Tuples** — first-class heterogeneous operations on tuples
- **frunk (Rust)** — HList crate with Generic derive

## Dependencies

- `@typesugar/core` — expression macros, extension methods
- `@typesugar/macros` — `summon()` for `mapWith(TC)`, `specialize()` / `inlineMethod()` for zero-cost dispatch
- `@typesugar/std` — typeclass instances (Show, Eq, etc.) that `mapWith` resolves

`@typesugar/hlist` is a peer of `@typesugar/macros`, not a dependency of it. Generic and HList are independent — they share no code, just a conceptual relationship and an optional `fromRecord` bridge.

## Open Questions

1. Should labeled HList be a separate type or unified with unlabeled? Shapeless uses a single `HList` with `FieldType` wrappers; Scala 3 uses `NamedTuple`. Named tuples feel cleaner.
2. How deep can TypeScript's type system go? Operations on HLists of length >20 may hit recursion limits. Need to benchmark.
3. Should `mapWith` support multiple typeclasses simultaneously? E.g., `mapWith(Show, Eq)` to get a tuple of `[show, eq]` for each field.
