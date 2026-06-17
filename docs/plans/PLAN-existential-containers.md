# Plan: Type Erasure / Existential Containers (Boost.TypeErasure-Style)

## Status: PHASE 1 IMPLEMENTED

Phase 1 (Erased type with explicit vtables, built-in capabilities, collections, widen/narrow) is implemented in `packages/erased/`. Phase 2 (auto-resolve vtables from typeclass registry at compile time) is future work.

## Inspiration

C++ `Boost.TypeErasure` and `std::any` / `std::function` let you define ad-hoc interfaces that hide concrete types. Unlike traditional OOP (where you must inherit from a base class), type erasure says "I need something with these capabilities" and wraps any value that satisfies them.

typesugar already has existential types via CPS encoding (`packages/type-system/src/existential.ts`). This plan extends that foundation with **multi-capability existentials** that integrate with the typeclass system — you specify which typeclasses you need, and the macro generates an efficient container.

## What Already Exists

`existential.ts` provides:

- `Exists<Witness>` — CPS-encoded existential type
- `packExists(witness)` / `useExists(ex, callback)` — pack/unpack
- `@existential` attribute — generates pack/use helpers for an interface
- Pre-built: `Showable`, `Comparable`, `Serializable`

**Limitations of current approach:**

- Each capability needs a hand-written witness interface (`ShowWitness<T>`, etc.)
- Combining capabilities requires a new combined witness (`ShowAndEqWitness<T>`)
- No integration with the typeclass system — can't say "anything with Show + Eq"
- CPS encoding requires continuation style, which is ergonomically awkward

## Design

### Typeclass-Based Erasure

```typescript
import { erased, Erased } from "@typesugar/erased";

// Erase to "anything that has Show and Eq"
type ShowableEq = Erased<[Show, Eq]>;

const items: ShowableEq[] = [
  erased(42), // number has Show + Eq → auto-resolved
  erased("hello"), // string has Show + Eq → auto-resolved
  erased(point(1, 2)), // Point has Show + Eq (derived) → auto-resolved
];

// Use typeclass methods directly — dispatched per-element
items.forEach((item) => {
  console.log(item.show()); // dispatches to the erased Show instance
  console.log(item.equals(item)); // dispatches to the erased Eq instance
});
```

### How It Works

`erased(value)` at compile time:

1. Inspects the type of `value`
2. Resolves each required typeclass instance (Show, Eq, etc.)
3. Packs the value with its vtable (object mapping method names to resolved implementations)

```typescript
// erased(42) where Erased<[Show, Eq]>
// Compiles to:
{
  __value: 42,
  __vtable: {
    show: (x: unknown) => String(x),
    equals: (a: unknown, b: unknown) => a === b,
  },
  show() { return this.__vtable.show(this.__value); },
  equals(other: ShowableEq) { return this.__vtable.equals(this.__value, other.__value); },
}
```

### Inline vs Boxed Mode

For hot paths where even vtable dispatch is too expensive:

```typescript
// Boxed mode (default) — vtable dispatch, works for heterogeneous collections
const items: Erased<[Show]>[] = [erased(42), erased("hello")];

// Inline mode — monomorphized at each call site, no dispatch
// Use when you know the concrete type at compile time but want the interface flexibility
function logValue<T: Show>(value: T): void {
  console.log(value.show()); // inlined via specialize()
}
```

### Multi-Capability Composition

```typescript
// Compose capabilities with &
type Printable = Erased<[Show, Debug]>;
type Storable = Erased<[Eq, Hash, Clone]>;
type FullFeatured = Erased<[Show, Eq, Ord, Hash, Clone, Json]>;

// Widen — drop capabilities (always safe)
const showable: Erased<[Show]> = fullFeatured; // OK: Show ⊆ [Show, Eq, Ord, ...]

// Narrow — add capabilities (requires runtime check or compile-time proof)
const orderable = narrow<Erased<[Show, Ord]>>(showable); // Runtime: checks vtable has Ord
```

### Dynamic Dispatch Table Generation

The `erased()` macro generates vtables at compile time:

```typescript
// For Erased<[Show, Eq, Ord]> applied to Point:
const __Point_vtable__ = {
  show: (p: Point) => `Point(${p.x}, ${p.y})`,
  equals: (a: Point, b: Point) => a.x === b.x && a.y === b.y,
  compare: (a: Point, b: Point) => a.x - b.x || a.y - b.y,
};
```

Vtables are deduplicated — one per (type × capability set) combination.

### Integration with Existing Existentials

The current `Exists<W>` becomes a low-level building block. `Erased<TCs>` is the high-level, typeclass-integrated API:

```typescript
// Low-level (existing): manual witness, CPS style
const packed: Exists<ShowWitness<unknown>> = packExists({
  value: 42,
  show: String,
});
useExists(packed, ({ value, show }) => console.log(show(value)));

// High-level (new): typeclass-based, method style
const erased: Erased<[Show]> = erased(42);
console.log(erased.show()); // direct method call
```

## Implementation

### Phase 1: `Erased<TCs>` Type + `erased()` Macro

**Package:** `@typesugar/erased` (or extend `@typesugar/type-system`)

**`erased()` expression macro:**

1. Infer the concrete type of the argument
2. Look up each typeclass in `TCs` via `summon()` / instance registry
3. Generate vtable object with resolved method implementations
4. Return boxed value with vtable

**Type definition:**

```typescript
type Erased<TCs extends readonly unknown[]> = {
  readonly __value: unknown;
  readonly __vtable: VtableFor<TCs>;
} & MethodsFor<TCs>;

// VtableFor extracts method signatures from typeclass list
// MethodsFor creates convenience methods that delegate to vtable
```

### Phase 2: Vtable Deduplication + Caching

- At compile time, track which (type, capability set) vtables have been generated
- Reuse vtable constants across the module
- Use `MacroExpansionCache` for cross-file deduplication

### Phase 3: Widen / Narrow Operations

- `widen` is free — just a type assertion (subset of vtable is always available)
- `narrow` generates a runtime check that the vtable has the required methods
- Compile-time `narrow` when the concrete type is known

### Phase 4: Pattern Matching Integration

```typescript
match(erasedValue, {
  // Match on concrete type (requires TypeGuard)
  Number: (n) => n * 2,
  String: (s) => s.length,
  _: (other) => other.show(),
});
```

## Zero-Cost Analysis

| Operation                 | Cost                                                                           |
| ------------------------- | ------------------------------------------------------------------------------ |
| `erased(42)` construction | Object allocation (vtable + value) — unavoidable for heterogeneous collections |
| `item.show()`             | One indirect call through vtable — same as C++ virtual dispatch                |
| `widen`                   | Free (type-only)                                                               |
| `narrow`                  | One vtable property check                                                      |
| Monomorphic path          | Zero-cost via `specialize()` — vtable call inlined to direct call              |

This is NOT zero-cost for the heterogeneous case (you need the vtable), but it's as efficient as possible — matching C++ `Boost.TypeErasure` exactly. The monomorphic path via `specialize()` IS zero-cost.

## Inspirations

- **Boost.TypeErasure** — ad-hoc interfaces via type erasure
- **Rust `dyn Trait`** — trait objects with vtable dispatch
- **Swift protocol existentials** — `any Equatable` containers
- **Haskell `ExistentialQuantification`** — `forall a. Show a => SomeShowable`

## Dependencies

- `@typesugar/core` — expression macros
- `@typesugar/macros` — `summon()`, typeclass registry, `specialize()`
- `@typesugar/type-system` — existing `Exists<W>` as building block

## Open Questions

1. Should `Erased` support associated types? E.g., `Erased<[Functor]>` where the container type varies — this requires more complex vtable encoding.
2. Memory layout: should vtable be inline (per-instance) or shared (pointer to static table)? Inline is simpler; shared saves memory for large collections.
3. Name: `Erased`, `Dyn`, `Any`, or `AnyOf`? Rust uses `dyn`, Swift uses `any`, Haskell uses existentials.
