# @typesugar/fp

> Functional programming library for TypeScript, inspired by Scala's Cats library.

## Overview

`@typesugar/fp` provides a complete functional programming toolkit: typeclasses (Functor, Monad, Applicative), data types (Option, Either, List, Validated), monad transformers (State, Reader, Writer), and an IO monad with stack-safe interpreter.

All data types use **@opaque type macros** for zero-cost dot syntax — `Option<A>` is `A | null` at runtime, but TypeScript sees a rich interface with `.map()`, `.flatMap()`, `.getOrElse()`, and more.

## Installation

```bash
npm install @typesugar/fp
# or
pnpm add @typesugar/fp
```

## Quick Start

```typescript
import { Some, None, Right, Left, IO, runIO, pipe, flow } from "@typesugar/fp";
import type { Option, Either } from "@typesugar/fp";

// Option — dot syntax, zero-cost (null at runtime)
const user = Some(2).flatMap((x) => Some(x * 3));
// Some(6) — really just 6 at runtime

// Either — dot syntax, zero-cost
const result = Right<string, number>(42).map((x) => x.toString());
// Right("42")

// Chain operations fluently
const output = Some(5)
  .map((n) => n * 2)
  .filter((n) => n > 5)
  .getOrElse(() => 0);
// 10

// IO — pure effects
const program = IO.flatMap(
  IO.delay(() => "Hello"),
  (msg) => IO.delay(() => console.log(msg))
);
await runIO(program);

// Pipe — function composition
const transformed = pipe(
  5,
  (x) => x * 2,
  (x) => x + 1,
  (x) => x.toString()
);
// "11"
```

## Data Types

### Option\<A\>

Represents optional values. `Some(x)` wraps a value; `None` is empty. At runtime, `Some(42)` is just `42` and `None` is `null`.

```typescript
import { Some, None, isSome, isNone } from "@typesugar/fp";
import type { Option } from "@typesugar/fp";

const value: Option<number> = Some(42);
const empty: Option<number> = None;

// Dot syntax — methods resolve via type rewrite registry
value.map((x) => x * 2); // Some(84)
value.flatMap((x) => Some(x + 1)); // Some(43)
value.getOrElse(() => 0); // 42
value.filter((x) => x > 50); // None
value.fold(
  () => "empty",
  (x) => `got ${x}`
); // "got 42"

// Chain fluently
Some(5)
  .map((n) => n * 2)
  .filter((n) => n > 5)
  .getOrElse(() => 0); // 10

// Implicit conversion via SFINAE (no fromNullable needed)
const nullable: number | null = getFromDatabase();
const opt: Option<number> = nullable; // Just works — runtime identity
```

### Either\<E, A\>

Represents success (`Right`) or failure (`Left`).

```typescript
import { Left, Right, isLeft, isRight } from "@typesugar/fp";
import type { Either } from "@typesugar/fp";

const success: Either<string, number> = Right(42);
const failure: Either<string, number> = Left("error");

// Dot syntax
success.map((x) => x * 2); // Right(84)
success.flatMap((x) => Right(x + 1)); // Right(43)
failure.map((x) => x * 2); // Left("error") — no-op
success.fold(
  (e) => 0,
  (x) => x
); // 42

// Chain validations
Right<string, number>(10)
  .map((n) => n * 2)
  .flatMap((n) => (n > 10 ? Right(n) : Left("too small")))
  .getOrElse(() => -1); // 20
```

### List\<A\>

Immutable linked list.

```typescript
import { Cons, Nil } from "@typesugar/fp";
import * as L from "@typesugar/fp/data/list";

const list = L.of(1, 2, 3);

L.map(list, (x) => x * 2); // [2, 4, 6]
L.filter(list, (x) => x > 1); // [2, 3]
L.foldLeft(list, 0, (a, b) => a + b); // 6
```

### Validated\<E, A\>

Accumulates errors instead of failing fast.

```typescript
import { validNel, invalidNel } from "@typesugar/fp";
import * as V from "@typesugar/fp/data/validated";

const v1 = validNel(42);
const v2 = invalidNel("error 1");
const v3 = invalidNel("error 2");

// Combine with error accumulation — collects ALL errors
V.map2Nel(v2, v3, (a, b) => a + b);
// Invalid(["error 1", "error 2"])
```

### IO\<A\>

Pure description of side effects with stack-safe interpreter.

```typescript
import { IO, runIO, runIOSync } from "@typesugar/fp";

const program = IO.flatMap(
  IO.delay(() => fetch("/api/user")),
  (response) => IO.delay(() => response.json())
);

const result = await runIO(program);
```

## Monad Transformers

### State\<S, A\>

```typescript
import { State } from "@typesugar/fp";

const increment = State.modify<number>((n) => n + 1);
const getDouble = State.gets<number, number>((n) => n * 2);
const program = State.flatMap(increment, () => getDouble);
State.run(program, 5); // [12, 6]
```

### Reader\<R, A\>

```typescript
import { Reader } from "@typesugar/fp";

const getUrl = Reader.ask<{ apiUrl: string }>().map((c) => c.apiUrl);
Reader.run(getUrl, { apiUrl: "http://api.example.com" });
```

### Writer\<W, A\>

```typescript
import { Writer, LogWriterMonoid } from "@typesugar/fp";

const program = Writer.flatMap(
  Writer.tell(["Started"]),
  () => Writer.writer(42, ["Done"]),
  LogWriterMonoid
);
Writer.run(program); // [42, ["Started", "Done"]]
```

## How It Works: @opaque Type Macros

`@typesugar/fp` data types use `@opaque` type macros (PEP-012) for zero-cost dot syntax:

```typescript
/** @opaque A | null */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
  flatMap<B>(f: (a: A) => Option<B>): Option<B>;
  getOrElse(defaultValue: () => A): A;
  // ...
}
```

- **TypeScript sees**: An interface with methods (full IDE support, type inference)
- **Runtime emits**: `A | null` (zero-cost, no wrapper objects)
- **Transformer rewrites**: `x.map(f)` → `map(x, f)` (standalone function call)

Implicit conversions via SFINAE mean `Option<T>` and `T | null` are interchangeable:

```typescript
const nullable: number | null = someApi();
const opt: Option<number> = nullable; // No error — runtime identity
const raw: number | null = opt; // Also fine
```

## Syntax Utilities

```typescript
import { pipe, flow } from "@typesugar/fp";

const result = pipe(
  5,
  (x) => x * 2,
  (x) => x + 1
);
const transform = flow(
  (x: number) => x * 2,
  (x) => x + 1,
  (x) => x.toString()
);
```

## API Reference

### Data Types

- `Option`, `Some`, `None` — Optional values (dot syntax)
- `Either`, `Left`, `Right` — Error handling (dot syntax)
- `List`, `Cons`, `Nil` — Immutable lists
- `NonEmptyList` — Non-empty lists
- `Validated`, `Valid`, `Invalid` — Error accumulation
- `State`, `Reader`, `Writer` — Monad transformers
- `IO` — Effect monad

### Typeclasses (TC namespace)

- `Functor`, `Apply`, `Applicative`
- `FlatMap`, `Monad`
- `Foldable`, `Traverse`
- `Semigroup`, `Monoid`
- `Eq`, `Ord`, `Show`
- `ApplicativeError`, `MonadError`

### IO Runtime

- `runIO(io)` — Execute async
- `runIOSync(io)` — Execute sync
- `IODo` — Do-notation helper

## License

MIT
