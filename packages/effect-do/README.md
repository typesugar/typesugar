# @ttfx/effect-do

> Do-comprehension macros for monadic types.

## Overview

`@ttfx/effect-do` provides Scala-style for-comprehension syntax for monadic types. Transform generator-based syntax into flatMap chains at compile time — works with Effect, Promise, Option, Either, and any type with `map` and `flatMap` methods.

## Installation

```bash
npm install @ttfx/effect-do
# or
pnpm add @ttfx/effect-do
```

## Usage

### Do() — Generator Comprehensions

```typescript
import { Do } from "@ttfx/effect-do";

// Generator-style syntax
const result = Do(function* () {
  const user = yield* fetchUser(id);
  const posts = yield* fetchPosts(user.id);
  const comments = yield* fetchComments(posts[0].id);
  return { user, posts, comments };
});

// Compiles to:
fetchUser(id).flatMap((user) =>
  fetchPosts(user.id).flatMap((posts) =>
    fetchComments(posts[0].id).map((comments) => ({ user, posts, comments })),
  ),
);
```

### asyncDo() — Promise Comprehensions

```typescript
import { asyncDo } from "@ttfx/effect-do";

// Works with Promises
const result = asyncDo(function* () {
  const user = yield* getUser(id);
  const profile = yield* getProfile(user.profileId);
  return { user, profile };
});

// Compiles to Promise.then chains:
getUser(id).then((user) =>
  getProfile(user.profileId).then((profile) => ({ user, profile })),
);
```

### For — Runtime Comprehension Builder

```typescript
import { For, some, none } from "@ttfx/effect-do";

// Fluent builder syntax (no macro needed)
const result = For.from({ x: some(1) })
  .bind("y", ({ x }) => some(x + 1))
  .bind("z", ({ x, y }) => some(x + y))
  .yield(({ x, y, z }) => x + y + z);
// Some(5)
```

### forYield() — Array Syntax

```typescript
import { forYield } from "@ttfx/effect-do";

const result = forYield(
  [
    ["user", fetchUser(id)],
    ["posts", fetchPosts],
  ],
  ({ user, posts }) => ({ user, posts }),
);
```

## Built-in Monads

The package includes simple implementations for common monads:

### Option

```typescript
import { Option, some, none } from "@ttfx/effect-do";

const opt = some(42);
opt.map((x) => x * 2); // Some(84)
opt.flatMap((x) => some(x + 1)); // Some(43)
opt.getOrElse(0); // 42
```

### Either

```typescript
import { Either, left, right } from "@ttfx/effect-do";

const result = right<string, number>(42);
result.map((x) => x * 2); // Right(84)
result.flatMap((x) => right(x)); // Right(42)
result.fold(
  (e) => `Error: ${e}`,
  (x) => `Value: ${x}`,
);
```

### IO

```typescript
import { IO, io } from "@ttfx/effect-do";

const program = io(() => console.log("Hello")).flatMap(() =>
  io(() => console.log("World")),
);

program.run(); // Executes effects
```

## API Reference

### Macros

- `Do(function*() { ... })` — Transform generator to flatMap chain
- `asyncDo(function*() { ... })` — Transform to Promise.then chain
- `forYield(bindings, yieldExpr)` — Array-based comprehension

### For Comprehension Builder

```typescript
class ForComprehension {
  static from<Name, A>(
    bindings: Record<Name, Monad<A>>,
  ): ForComprehensionBuilder;
}

class ForComprehensionBuilder<Ctx> {
  bind<Name, A>(
    name: Name,
    effect: (ctx: Ctx) => Monad<A>,
  ): ForComprehensionBuilder<Ctx & { [K in Name]: A }>;
  yield<B>(f: (ctx: Ctx) => B): Monad<B>;
}
```

### Monad Interface

```typescript
interface Monad<A> {
  map<B>(f: (a: A) => B): Monad<B>;
  flatMap<B>(f: (a: A) => Monad<B>): Monad<B>;
}
```

### Built-in Types

- `Option<A>` — `some(value)`, `none()`
- `Either<L, R>` — `left(error)`, `right(value)`
- `IO<A>` — `io(() => effect)`, `IO.of(value)`, `IO.suspend(thunk)`

### Registration

- `register()` — Register macros (called automatically on import)

## How It Works

The macro transforms:

```typescript
Do(function* () {
  const a = yield* effectA;
  const b = yield* effectB(a);
  return a + b;
});
```

Into:

```typescript
effectA.flatMap((a) => effectB(a).map((b) => a + b));
```

The generator syntax is purely for ergonomics — the actual code runs as nested flatMap calls.

## License

MIT
