# @ttfx/fp

> Functional programming library for TypeScript, inspired by Scala's Cats library.

## Overview

`@ttfx/fp` provides a complete functional programming toolkit: typeclasses (Functor, Monad, Applicative), data types (Option, Either, List, Validated), monad transformers (State, Reader, Writer), and an IO monad with stack-safe interpreter.

## Installation

```bash
npm install @ttfx/fp
# or
pnpm add @ttfx/fp
```

## Quick Start

```typescript
import {
  Option,
  Some,
  None,
  Either,
  Left,
  Right,
  IO,
  runIO,
  pipe,
  flow,
} from "@ttfx/fp";

// Option — nullable values
const user = Option.flatMap(Some(2), (x) => Some(x * 3));
// Some(6)

// Either — error handling
const result = Either.map(Right(42), (x) => x.toString());
// Right("42")

// IO — pure effects
const program = IO.flatMap(
  IO.delay(() => "Hello"),
  (msg) => IO.delay(() => console.log(msg)),
);
await runIO(program);

// Pipe — function composition
const transformed = pipe(
  5,
  (x) => x * 2,
  (x) => x + 1,
  (x) => x.toString(),
);
// "11"
```

## Data Types

### Option<A>

Represents optional values — `Some<A>` or `None`.

```typescript
import { Option, Some, None, isSome, isNone } from "@ttfx/fp";

const value = Some(42);
const empty = None<number>();

Option.map(value, (x) => x * 2); // Some(84)
Option.flatMap(value, (x) => Some(x + 1)); // Some(43)
Option.getOrElse(empty, 0); // 0
Option.filter(value, (x) => x > 50); // None
```

### Either<L, R>

Represents success (`Right`) or failure (`Left`).

```typescript
import { Either, Left, Right, isLeft, isRight } from "@ttfx/fp";

const success = Right<string, number>(42);
const failure = Left<string, number>("error");

Either.map(success, (x) => x * 2); // Right(84)
Either.mapLeft(failure, (e) => e.toUpperCase()); // Left("ERROR")
Either.fold(
  success,
  (e) => 0,
  (x) => x,
); // 42
```

### List<A>

Immutable linked list.

```typescript
import { List, Cons, Nil } from "@ttfx/fp";

const list = List.of(1, 2, 3);

List.map(list, (x) => x * 2); // [2, 4, 6]
List.filter(list, (x) => x > 1); // [2, 3]
List.foldLeft(list, 0, (a, b) => a + b); // 6
```

### Validated<E, A>

Accumulates errors instead of failing fast.

```typescript
import { Validated, valid, invalid, validNel, invalidNel } from "@ttfx/fp";

const v1 = valid<string[], number>(42);
const v2 = invalid<string[], number>(["error 1"]);
const v3 = invalid<string[], number>(["error 2"]);

// Combine with error accumulation
Validated.mapN(v2, v3, (a, b) => a + b);
// Invalid(["error 1", "error 2"])
```

### IO<A>

Pure description of side effects with stack-safe interpreter.

```typescript
import { IO, runIO, runIOSync } from "@ttfx/fp";

const program = IO.flatMap(
  IO.delay(() => fetch("/api/user")),
  (response) => IO.delay(() => response.json()),
);

// Run the effect
const result = await runIO(program);
```

## Monad Transformers

### State<S, A>

Stateful computations.

```typescript
import { State, IndexedState } from "@ttfx/fp";

const increment = State.modify<number>((n) => n + 1);
const getDouble = State.gets<number, number>((n) => n * 2);

const program = State.flatMap(increment, () => getDouble);
State.run(program, 5); // [12, 6] (new state, result)
```

### Reader<R, A>

Dependency injection.

```typescript
import { Reader, Kleisli } from "@ttfx/fp";

interface Config {
  apiUrl: string;
}

const getUrl = Reader.ask<Config>().map((c) => c.apiUrl);
const fetchData = Reader.flatMap(getUrl, (url) => Reader.pure(fetch(url)));

Reader.run(fetchData, { apiUrl: "http://api.example.com" });
```

### Writer<W, A>

Logging and accumulation.

```typescript
import { Writer, LogWriter } from "@ttfx/fp";

const program = Writer.flatMap(Writer.tell(["Started"]), () =>
  Writer.flatMap(Writer.pure(42), (x) =>
    Writer.tell([`Got ${x}`]).map(() => x),
  ),
);

Writer.run(program); // [["Started", "Got 42"], 42]
```

## Typeclasses

```typescript
import { TC } from "@ttfx/fp";

// Functor
TC.Functor.map(someOption, f);

// Applicative
TC.Applicative.pure(42);
TC.Applicative.ap(Some(f), Some(x));

// Monad
TC.Monad.flatMap(effect, f);

// Foldable
TC.Foldable.foldLeft(list, init, f);

// Traverse
TC.Traverse.traverse(list, f);
```

## Zero-Cost Abstractions

Compile-time-optimized variants of common functional patterns with zero runtime overhead.

```typescript
import {
  type ZeroCostOption,
  ZeroCostOptionOps,
  type ZeroCostResult,
  ZeroCostResultOps,
  match,
  matchLiteral,
  matchGuard,
} from "@ttfx/fp";

// Zero-cost Option — just T | null at runtime
const opt: ZeroCostOption<number> = 42;
if (ZeroCostOptionOps.isSome(opt)) {
  console.log(opt * 2);
}

// Zero-cost Result — minimal object wrapper
const result = ZeroCostResultOps.ok<number, string>(42);
if (ZeroCostResultOps.isOk(result)) {
  console.log(result.value);
}

// Pattern matching (compiles to if/else chains)
type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "square"; side: number };

const area = match(shape, {
  circle: (s) => Math.PI * s.radius ** 2,
  square: (s) => s.side * s.side,
});
```

See also: `@ttfx/fp/zero-cost` for direct imports.

## Syntax Utilities

```typescript
import { pipe, flow } from "@ttfx/fp";

// Left-to-right application
const result = pipe(
  5,
  (x) => x * 2,
  (x) => x + 1,
);

// Function composition
const transform = flow(
  (x: number) => x * 2,
  (x) => x + 1,
  (x) => x.toString(),
);
```

## API Reference

### Data Types

- `Option`, `Some`, `None` — Optional values
- `Either`, `Left`, `Right` — Error handling
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
