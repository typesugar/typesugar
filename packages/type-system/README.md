# @typesugar/type-system

> Advanced type system extensions for TypeScript.

## Overview

`@typesugar/type-system` extends TypeScript with powerful type-level features from the "too hard basket" — things the TypeScript team deemed too complex to add to the language. All implemented through compile-time macros.

## Installation

```bash
npm install @typesugar/type-system
# or
pnpm add @typesugar/type-system
```

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

### Newtype (Zero-Cost Branding)

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

// Wrap values (compiles away to nothing)
const id = wrap<UserId>(42);
const raw = unwrap(id);

// Type-safe! Can't mix up UserId and Meters
function getUser(id: UserId): User { ... }
getUser(wrap<UserId>(42)); // OK
getUser(42); // Type error!

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

### Higher-Kinded Types (HKT)

Type constructors as type parameters via phantom kind markers.

```typescript
import {
  type $,
  type Kind,
  type TypeFunction,
  type ArrayF,
  type PromiseF,
} from "@typesugar/type-system";

// F is a type constructor (Array, Promise, etc.)
interface Functor<F> {
  map<A, B>(fa: Kind<F, A>, f: (a: A) => B): Kind<F, B>;
}

// Apply a type constructor — preprocessor resolves known type functions
type Result = Kind<ArrayF, number>; // → number[]
type AsyncResult = Kind<PromiseF, string>; // → Promise<string>
```

#### Warning: Phantom HKT Types

When defining your own type-level functions for HKT, the `_` property **must** reference
`this["__kind__"]` to be sound. If `Kind<F, A>` always resolves to the same type regardless
of `A`, the HKT encoding is phantom/unsound.

```typescript
// ✓ CORRECT: _ uses this["__kind__"] - Kind<ArrayF, A> resolves to A[]
interface ArrayF extends TypeFunction {
  _: Array<this["__kind__"]>;
}

// ✗ WRONG: _ doesn't use this["__kind__"] - Kind<StringF, A> always resolves to string
interface StringF extends TypeFunction {
  _: string;
}
```

Types that cannot be parameterized (e.g., primitives) should NOT implement typeclasses
like `Functor` that change the element type via `map`. Use read-only typeclasses like
`Foldable` instead. See Finding #2 in FINDINGS.md.

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

### Refinement Types

Types with predicates — Byte, Port, NonEmpty, Email — with compile-time validation for literals.

```typescript
import { type Refined, Positive, NonEmpty, Email, Port } from "@typesugar/type-system";

// Refined types carry their constraints
type PositiveInt = Refined<number, typeof Positive>;
type ValidEmail = Refined<string, typeof Email>;
type ValidPort = Refined<number, typeof Port>;

// Compile-time validation for literals
const port = refine<Port>(8080); // ✓
const badPort = refine<Port>(-1); // ✗ Compile error
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
const v3: Vec<number, 3> = Vec.from([1, 2, 3]);
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
const v6: Vec<number, 6> = Vec.concat(v3, v3); // Add<3, 3> = 6
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
- `Vec.concat(a, b)` produces `Vec<T, Add<N, M>>`

### Opaque Type Modules

ML-style abstract types with controlled access.

```typescript
import { opaqueModule, type OpaqueModule } from "@typesugar/type-system";

// Define an opaque type with smart constructor
const UserId = opaqueModule<number, "UserId">({
  validate: (n) => n > 0,
  error: "UserId must be positive",
});

const id = UserId.make(42); // ✓ UserId
const bad = UserId.make(-1); // Throws: "UserId must be positive"
const raw = UserId.unwrap(id); // number
```

### Phantom Type State Machines

Encode state machines in the type system.

```typescript
import { createStateMachine, type Phantom } from "@typesugar/type-system";

type DoorState = "open" | "closed" | "locked";

const Door = createStateMachine<DoorState>()
  .state("closed", { open: "open", lock: "locked" })
  .state("open", { close: "closed" })
  .state("locked", { unlock: "closed" })
  .build();

// Type-safe transitions
const closed = Door.initial("closed");
const open = Door.transition(closed, "open"); // ✓
const locked = Door.transition(open, "lock"); // ✗ Can't lock an open door
```

### Effect System Annotations

Compile-time side-effect tracking.

```typescript
import { pure, io, async, assertPure } from "@typesugar/type-system";

@pure
function add(a: number, b: number): number {
  return a + b;
}

@io
function log(msg: string): void {
  console.log(msg);
}

// Verify purity at compile time
assertPure(() => add(1, 2));      // ✓
assertPure(() => log("hello"));   // ✗ Compile error: log has IO effect
```

## API Reference

### HKT

- `Kind<F, A>` / `$<F, A>` — Phantom kind marker: type constructor F applied to type A
- `TypeFunction` — Base interface for type-level functions
- `Apply<F, A>` — Eagerly resolve a type-level function (rarely needed)
- `ArrayF`, `PromiseF`, `SetF`, `MapF`, `ReadonlyArrayF` — Built-in type-level functions

### Existential Types

- `Exists<W>` — Existential type with witness W
- `packExists`, `useExists`, `mapExists` — Operations
- `Showable`, `Comparable`, `Serializable` — Common witnesses

### Refinement Types

- `Refined<Base, R>` — Refined type
- `refinement(predicate, name)` — Create refinement
- `Positive`, `NonNegative`, `Int`, `Byte`, `Port` — Number refinements
- `NonEmpty`, `Email`, `Url`, `Uuid` — String refinements

### Type-Level Arithmetic

- `Add`, `Sub`, `Mul`, `Div`, `Mod`, `Pow` — Operations
- `Lt`, `Lte`, `Gt`, `Gte`, `Eq` — Comparisons
- `Inc`, `Dec`, `Negate`, `Abs` — Unary operations

### Length-Indexed Arrays

- `Vec<T, N>` — Array of T with exactly N elements
- `Vec.from(arr)` — Create from array (validates length at runtime)
- `Vec.empty()` — Create empty Vec<T, 0>
- `Vec.fill(value, n)` — Create Vec<T, N> filled with value
- `Vec.cons(head, tail)` — Prepend element (N+1)
- `Vec.snoc(init, last)` — Append element (N+1)
- `Vec.concat(a, b)` — Concatenate (Add<N, M>)
- `Vec.head(v)`, `Vec.last(v)` — First/last element (error on empty)
- `Vec.tail(v)`, `Vec.init(v)` — Rest/prefix (Sub<N, 1>)
- `Vec.zip(a, b)` — Zip two vectors of same length
- `Vec.length(v)` — Get length as literal type N

### Opaque Types

- `Opaque<Base, Brand>` — Opaque type
- `OpaqueModule` — Module with make/unwrap
- `opaqueModule(options)` — Create opaque module

### Phantom Types

- `Phantom<State, Data>` — Phantom-typed value
- `createStateMachine()` — State machine builder
- `transition(state, event)` — Type-safe transition

### Effects

- `@pure`, `@io`, `@async` — Effect annotations
- `assertPure(fn)` — Verify purity at compile time
- `Pure`, `IO`, `Async` — Effect types

## License

MIT
