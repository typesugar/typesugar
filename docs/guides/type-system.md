# Type System

Advanced type system extensions for TypeScript: refined types, newtypes, HKT, existentials, phantom types, effect tracking, and type-level arithmetic.

`@typesugar/type-system` extends TypeScript with powerful type-level features from the "too hard basket" — things the TypeScript team deemed too complex to add to the language. All implemented through compile-time macros.

## Quick Start

```bash
npm install @typesugar/type-system
# or
pnpm add @typesugar/type-system
```

```typescript
import { type Newtype, wrap, unwrap, type Refined, Port } from "@typesugar/type-system";

// Zero-cost branding
type UserId = Newtype<number, "UserId">;
const id = wrap<UserId>(42);

// Refinements validate at runtime (`Port.refine` throws on failure)
const port = Port.refine(8080); // ✓ Port
const bad = Port.refine(-1); // throws at runtime
```

> **Macros expand only when imported from `@typesugar/type-system`.** `wrap`, `unwrap`,
> `newtypeCtor`, `unsafeRefine`, `opaqueModule`, `@pure`, `@effect`, the type-level arithmetic
> macros, and the rest are scoped to that module: the transformer rewrites an identifier only
> if it resolves to an import from `@typesugar/type-system`. A same-named function from another
> library (or a locally defined one) is left alone.

## Features

### Type-Level Boolean Utilities

Pure type-level boolean logic for compile-time type assertions and comparisons.

```typescript
import {
  type Equal,
  type Extends,
  type Not,
  type And,
  type Or,
  type IsNever,
  type IsAny,
  type IsUnknown,
} from "@typesugar/type-system";

// Type-level equality check
type Test1 = Equal<string, string>; // true
type Test2 = Equal<string, number>; // false

// Subtype check
type Test3 = Extends<"hello", string>; // true

// Boolean combinators
type Test4 = And<true, true>; // true
type Test5 = Or<false, true>; // true
type Test6 = Not<false>; // true

// Special type checks
type Test7 = IsNever<never>; // true
type Test8 = IsAny<any>; // true
type Test9 = IsUnknown<unknown>; // true
```

### Newtype — Zero-Cost Branding

Branded types that compile away completely — type-safe wrappers with zero runtime cost.

```typescript
import {
  type Newtype,
  wrap,
  unwrap,
  newtypeCtor,
  validatedNewtype,
} from "@typesugar/type-system";

// Define branded types
type UserId = Newtype<number, "UserId">;
type Meters = Newtype<number, "Meters">;
type Feet = Newtype<number, "Feet">;

// Wrap values (compiles away to nothing)
const id = wrap<UserId>(42);
const raw = unwrap(id);

// Type-safe! Can't mix up UserId and Meters
function getUser(id: UserId): User { ... }
getUser(wrap<UserId>(42)); // OK
getUser(42); // Type error!

// Can't mix up Meters and Feet either
function calculateArea(width: Meters, height: Meters): number {
  return unwrap(width) * unwrap(height);
}
calculateArea(wrap<Meters>(10), wrap<Feet>(5)); // Type error!

// Constructor factory
const mkUserId = newtypeCtor<UserId>();
const id2 = mkUserId(42);

// Validated constructor (validation runs, wrapping is zero-cost)
const mkEmail = validatedNewtype<Email>(s => s.includes("@"));
```

### The Branding Spectrum

This module provides three levels of type branding:

| Level       | Type                   | Runtime Cost | Use Case                                |
| ----------- | ---------------------- | ------------ | --------------------------------------- |
| **Newtype** | `Newtype<Base, Brand>` | Zero         | Type discrimination (UserId, Meters)    |
| **Opaque**  | `Opaque<Base, Brand>`  | Minimal      | Hidden representation (Password, Token) |
| **Refined** | `Refined<Base, R>`     | Validation   | Runtime constraints (Email, Port)       |

### Refinement Types

Types with predicates — Byte, Port, NonEmpty, Email. Each refinement is a value with the same name as its type, and validates at runtime through `.refine` (throws), `.from` (returns `undefined`), `.safe` (result object) and `.is` (type guard). There is no `refine<T>(value)` macro; it was removed because it could only ever fire on someone else's `refine`.

```typescript
import { type Refined, Positive, NonEmpty, Email, Port, MaxLength } from "@typesugar/type-system";

// Each built-in refinement exports a type and a value under the same name
const port: Port = Port.refine(8080); // ✓
const badPort = Port.from(-1); // undefined (no throw)
const checked = Email.safe("not-an-email"); // { ok: false, error: "..." }

// Parameterised refinements carry their bound in the brand, so
// MaxLength(5) and MaxLength(100) are different types
const atMost5 = MaxLength<number, 5>(5);
const short = atMost5.refine([1, 2, 3]); // Refined<number[], "MaxLength<5>">

// Escape hatch: skip validation (the macro erases it to its argument)
// unsafeRefine<Port>(n)
```

### Higher-Kinded Types (HKT)

Type constructors as type parameters. Most users never touch this directly — `@impl Functor<Option>` handles everything. This package provides the low-level primitives for library authors and advanced use cases.

#### The `_` Marker Type (Tier 3)

For types you don't own, the `_` marker lets you define type-level functions with `@hkt`:

```typescript
import type { _ } from "@typesugar/type-system";

/** @hkt */
type ArrayF = Array<_>;

/** @hkt */
type MapF<K> = Map<K, _>;
```

The `_` type is `never & "__kind__"` — TypeScript reduces it to `never` (valid anywhere), but the AST preserves the intersection for macro detection. The `@hkt` macro finds the `_` position, replaces it with `this["__kind__"]`, and generates the full `TypeFunction` interface.

#### Kind and TypeFunction (Manual)

For full control, define type-level functions manually:

```typescript
import { type Kind, type TypeFunction, type ArrayF, type PromiseF } from "@typesugar/type-system";

// Apply a type constructor
type Result = Kind<ArrayF, number>; // → number[]
type AsyncResult = Kind<PromiseF, string>; // → Promise<string>

// Define your own
interface ArrayF extends TypeFunction {
  _: Array<this["__kind__"]>;
}
```

#### Warning: Phantom HKT Types

The `_` property **must** reference `this["__kind__"]` to be sound. If `Kind<F, A>` always resolves to the same type regardless of `A`, the encoding is phantom/unsound.

```typescript
// ✓ CORRECT: Kind<ArrayF, A> resolves to A[]
interface ArrayF extends TypeFunction {
  _: Array<this["__kind__"]>;
}

// ✗ WRONG: Kind<StringF, A> always resolves to string
interface StringF extends TypeFunction {
  _: string;
}
```

Phantom types must NOT implement typeclasses that change the element type (`Functor`, `Monad`). Use read-only typeclasses like `Foldable` instead.

### Existential Types

"There exists some type T" with CPS encoding — heterogeneous collections, type-safe plugins.

```typescript
import {
  type Exists,
  packExists,
  useExists,
  type Showable,
  showable,
} from "@typesugar/type-system";

// Pack a value with its witness
const items: Showable[] = [
  showable(42, numShow),
  showable("hello", strShow),
  showable(true, boolShow),
];

// Safely use each item
for (const item of items) {
  console.log(showValue(item)); // Type-safe despite heterogeneous types
}
```

### Type-Level Arithmetic

Compile-time numeric computation.

```typescript
import { Add, Sub, Mul, Div, Mod, Pow } from "@typesugar/type-system";

type Sum = Add<1, 2>; // 3
type Diff = Sub<10, 3>; // 7
type Product = Mul<4, 5>; // 20
type Quotient = Div<20, 4>; // 5
type Remainder = Mod<17, 5>; // 2
type Power = Pow<2, 8>; // 256
```

### Length-Indexed Arrays (Vec)

Arrays with compile-time known length — type-safe head/tail, concatenation, zip.

```typescript
import { Vec, type Add, type Sub } from "@typesugar/type-system";

// Create length-indexed vectors
const v3: Vec<number, 3> = Vec.from([1, 2, 3]); // length inferred from the tuple
const checked: Vec<number, 3> = Vec.from(someArray, 3); // length checked at runtime (throws on mismatch)
const v0: Vec<string, 0> = Vec.empty();
const v5: Vec<number, 5> = Vec.fill(0, 5);

// Length is part of the type
const len: 3 = Vec.length(v3); // Type is literal 3, not number

// Safe head/tail (compile error on empty)
const first: number = Vec.head(v3); // ✓
const rest: Vec<number, 2> = Vec.tail(v3); // ✓
// Vec.head(v0);  // ✗ Compile error: Vec<string, 0> has no head

// Type-preserving operations
const v4: Vec<number, 4> = Vec.cons(0, v3); // Add<3, 1> = 4
const v6: Vec<number, 6> = Vec.append(v3, v3); // Add<3, 3> = 6
const pairs: Vec<[number, string], 3> = Vec.zip(v3, Vec.from(["a", "b", "c"]));

// Use with contracts: length is provable
function processTriple(v: Vec<number, 3>): number {
  requires(Vec.length(v) === 3); // PROVEN: type fact
  return Vec.head(v) + Vec.last(v);
}
```

Key properties for contract proofs:

- `Vec<T, N>.length === N` (type fact)
- `Vec.head(v)` is safe when `N > 0` (non-empty)
- `Vec.append(a, b)` produces `Vec<T, Add<N, M>>`

### Opaque Type Modules

ML-style abstract types with controlled access.

```typescript
import { opaqueModule, type Opaque } from "@typesugar/type-system";

// opaqueModule<Repr, Brand>(brand, validate?)(ops)
const UserId = opaqueModule<number, "UserId">(
  "UserId",
  (n) => n > 0 // optional validator
)({
  // operations receive the underlying representation
  toString: (n) => `user-${n}`,
});
type UserId = Opaque<number, "UserId">;

const id = UserId.create(42); // ✓ UserId
const bad = UserId.create(-1); // Throws: Invalid UserId: -1 failed validation
const maybe = UserId.tryCreate(-1); // undefined
const raw = UserId.unwrap(id); // number
UserId.toString(id); // "user-42" (results of operations are returned as-is)
```

### Phantom Type State Machines

Encode state machines in the type system.

```typescript
import { createStateMachine } from "@typesugar/type-system";

type DoorDef = {
  closed: { open: "open"; lock: "locked" };
  open: { close: "closed" };
  locked: { unlock: "closed" };
};

const Door = createStateMachine<DoorDef, { opens: number }>({
  initial: "closed",
  initialData: { opens: 0 },
  // Runtime state table: same shape as DoorDef. Required, because DoorDef is
  // type-only and the runtime needs to know each transition's target state.
  states: {
    closed: { open: "open", lock: "locked" },
    open: { close: "closed" },
    locked: { unlock: "closed" },
  },
  transitions: {
    open: (d) => ({ opens: d.opens + 1 }),
    close: (d) => d,
    lock: (d) => d,
    unlock: (d) => d,
  },
});

const closed = Door.create(); // { state: "closed", data: { opens: 0 } }
const open = Door.open(closed); // state: "open"
Door.lock(open); // throws at runtime: "lock" is not valid in state "open"
```

A transition that is not listed for the instance's current state throws at runtime. The
result type tracks the target state, but the argument type is not narrowed to the source
state.

### Effect System Annotations

Compile-time side-effect tracking with `@pure` and `@effect(...)`.

```typescript
import { pure, effect, assertPure } from "@typesugar/type-system";

@effect("io")
function log(msg: string): void {
  console.log(msg);
}

@pure
function add(a: number, b: number): number {
  return a + b;
}

@pure
function bad(): void {
  log("hello"); // ✗ Compile error: @pure function calls an @effect("io") function
}

// A runtime no-op that returns its argument. It is NOT checked at compile time.
assertPure(() => add(1, 2));
```

`@pure` is checked by the macro (it must be imported from `@typesugar/type-system`): it
reports an error for every call to a function declared `@effect(...)`. There is no `@io`
or `@async` decorator; use `@effect("io")`, `@effect("async")`, etc. The `pure`, `io` and
`async` exports are value wrappers that tag a value with the `Pure<T>`, `IO<T>` and
`Async<T>` types.

## API Reference

### HKT

- `Kind<F, A>` / `$<F, A>` — Phantom kind marker: type constructor F applied to type A
- `_` — Hole marker for `@hkt` type aliases (Tier 3): `type ArrayF = Array<_>`
- `TypeFunction` — Base interface for type-level functions
- `Apply<F, A>` — Eagerly resolve a type-level function (rarely needed)
- `ArrayF`, `PromiseF`, `SetF`, `MapF`, `ReadonlyArrayF` — Built-in type-level functions

### Existential Types

- `Exists<W>` — Existential type with witness W
- `packExists`, `useExists`, `mapExists` — Operations
- `Showable`, `Comparable`, `Serializable` — Common witnesses

### Refinement Types

- `Refined<Base, R>` — Refined type
- `refinement(predicate, name)` — Create refinement (`.refine`, `.is`, `.from`, `.safe`)
- `Positive`, `NonNegative`, `Int`, `Byte`, `Port` — Number refinements
- `NonEmpty`, `Email`, `Url`, `Uuid` — String refinements
- `MaxLength(n)`, `MinLength(n)` — Array refinements; the bound is part of the brand (`"MaxLength<5>"`)
- `unsafeRefine(value)` — Macro that skips validation

### Type-Level Arithmetic

- `Add`, `Sub`, `Mul`, `Div`, `Mod`, `Pow` — Operations
- `Lt`, `Lte`, `Gt`, `Gte`, `Eq` — Comparisons
- `Inc`, `Dec`, `Negate`, `Abs` — Unary operations

### Length-Indexed Arrays

- `Vec<T, N>` — Array of T with exactly N elements
- `Vec.from(tuple)` — Create from a tuple (length inferred); `Vec.from(arr, n)` — checks length at runtime
- `Vec.empty()` — Create empty `Vec<T, 0>`
- `Vec.fill(value, n)` — Create `Vec<T, N>` filled with value
- `Vec.cons(head, tail)` — Prepend element (N+1)
- `Vec.snoc(init, last)` — Append element (N+1)
- `Vec.append(a, b)` — Concatenate (`Add<N, M>`)
- `Vec.head(v)`, `Vec.last(v)` — First/last element (error on empty)
- `Vec.tail(v)`, `Vec.init(v)` — Rest/prefix (`Sub<N, 1>`)
- `Vec.zip(a, b)` — Zip two vectors of same length
- `Vec.length(v)` — Get length as literal type N

### Opaque Types

- `Opaque<Base, Brand>` — Opaque type
- `OpaqueModuleResult` — Module with `create`/`unwrap`/`isValid`/`tryCreate` plus your operations
- `opaqueModule<Repr, Brand>(brand, validate?)(ops)` — Create opaque module

### Phantom Types

- `Phantom<Data, State>` — Phantom-typed value
- `createStateMachine<Def, Data>({ initial, initialData, states, transitions })` — State machine (the `states` table is required)

### Effects

- `@pure`, `@effect("io", ...)` — Effect annotations (checked at compile time)
- `assertPure(fn)` — Runtime no-op that returns `fn`
- `Pure`, `IO`, `Async` — Effect types

## Learn More

- [API Reference](/reference/packages#type-system)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/type-system)
