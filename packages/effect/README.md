# @ttfx/effect

> Effect-TS adapter for ttfx do-notation macros.

## Overview

`@ttfx/effect` provides seamless integration between ttfx macros and Effect-TS. Use labeled block syntax or expression macros to write Effect code with cleaner syntax that compiles to standard Effect API calls.

## Installation

```bash
npm install @ttfx/effect
# or
pnpm add @ttfx/effect
```

Requires Effect-TS as a peer dependency:

```bash
npm install effect
```

## Usage

### Labeled Block Syntax

```typescript
import { Effect } from "effect";

// Use let:/yield: blocks for do-notation
let: {
  user << getUserById(id);
  posts << getPostsForUser(user.id);
  comments << getCommentsForPost(posts[0].id);
}
yield: {
  {
    (user, posts, comments);
  }
}

// Compiles to:
Effect.flatMap(getUserById(id), (user) =>
  Effect.flatMap(getPostsForUser(user.id), (posts) =>
    Effect.flatMap(getCommentsForPost(posts[0].id), (comments) =>
      Effect.succeed({ user, posts, comments }),
    ),
  ),
);
```

### gen$ — Effect.gen Shorthand

```typescript
import { gen$ } from "@ttfx/effect";

const program = gen$(function* () {
  const user = yield* getUserById(id);
  const posts = yield* getPostsForUser(user.id);
  return { user, posts };
});

// Compiles to:
const program = Effect.gen(function* () {
  const user = yield* getUserById(id);
  const posts = yield* getPostsForUser(user.id);
  return { user, posts };
});
```

### map$ — Effect.map Shorthand

```typescript
import { map$ } from "@ttfx/effect";

const userName = map$(getUser(), (user) => user.name);

// Compiles to:
const userName = Effect.map(getUser(), (user) => user.name);
```

### flatMap$ — Effect.flatMap Shorthand

```typescript
import { flatMap$ } from "@ttfx/effect";

const posts = flatMap$(getUser(), (user) => getPostsForUser(user.id));

// Compiles to:
const posts = Effect.flatMap(getUser(), (user) => getPostsForUser(user.id));
```

### pipe$ — Effect.pipe Shorthand

```typescript
import { pipe$ } from "@ttfx/effect";

const result = pipe$(
  getUser(),
  Effect.flatMap((user) => getPosts(user.id)),
  Effect.map((posts) => posts.length),
);

// Compiles to:
const result = Effect.pipe(
  getUser(),
  Effect.flatMap((user) => getPosts(user.id)),
  Effect.map((posts) => posts.length),
);
```

## Labeled Block Syntax Details

> **Note:** The `let:/yield:` syntax is provided by `@ttfx/std`. This package registers a `FlatMap` instance for Effect that enables it.

The `let:` block uses the `<<` operator for bindings:

```typescript
let: {
  x << effectA; // Bind result of effectA to x
  y << effectB(x); // Use x in subsequent effects
}
yield: {
  expression; // Final value wrapped in Effect.succeed
}
```

Continuation labels:

- `yield:` — Wrap result in `Effect.succeed`
- `pure:` — Alias for `yield:`
- `return:` — Alias for `yield:`

## API Reference

### Labeled Block Macros

- `let: { ... } yield: { ... }` — Do-notation (provided by `@ttfx/std`, enabled by this package's FlatMap registration)

### Expression Macros

- `gen$(fn)` — Shorthand for `Effect.gen(fn)`
- `map$(effect, fn)` — Shorthand for `Effect.map(effect, fn)`
- `flatMap$(effect, fn)` — Shorthand for `Effect.flatMap(effect, fn)`
- `pipe$(initial, ...ops)` — Shorthand for `Effect.pipe(initial, ...ops)`

### Registration

- `register()` — Register macros (called automatically on import)

## Why Use This?

| Before (Verbose)                                                        | After (with adapter)                       |
| ----------------------------------------------------------------------- | ------------------------------------------ |
| `Effect.flatMap(a, x => Effect.flatMap(b, y => Effect.succeed(x + y)))` | `let: { x << a; y << b } yield: { x + y }` |
| `Effect.gen(function* () { ... })`                                      | `gen$(function* () { ... })`               |
| `Effect.map(effect, fn)`                                                | `map$(effect, fn)`                         |

The macros compile away completely — you get cleaner syntax with zero runtime overhead.

## License

MIT
