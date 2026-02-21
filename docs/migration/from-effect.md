# typesugar for Effect Users

This guide shows how to enhance Effect-TS with typesugar's compile-time macros.

## Overview

typesugar doesn't replace Effect — it makes Effect more ergonomic:

| Effect Pattern            | typesugar Enhancement             |
| ------------------------- | --------------------------------- |
| `Context.Tag` boilerplate | `@service` auto-generates it      |
| `Layer.succeed/effect`    | `@layer` with dependency tracking |
| Manual layer composition  | `resolveLayer<R>()` auto-composes |
| `Effect.gen`              | `let:/yield:` with E/R inference  |
| Manual Schema/Equal/Hash  | `@derive(EffectSchema)` etc.      |
| Method chaining           | `EffectExt` extension methods     |

## Quick Start

```bash
npm install @typesugar/effect effect
```

```typescript
import { service, layer, resolveLayer } from "@typesugar/effect";
import { Effect } from "effect";

// Define services with zero boilerplate
@service
interface UserRepo {
  findById(id: string): Effect.Effect<User, NotFound>
}

@service
interface EmailService {
  send(to: string, body: string): Effect.Effect<void, EmailError>
}

// Define layers with automatic dependency tracking
@layer(UserRepo, { requires: [Database] })
const userRepoLive: Effect.Effect<UserRepo, never, Database> =
let: {
  db << Database;
}
yield: ({ findById: (id) => db.query(sql`...`) })

@layer(EmailService, { requires: [Logger] })
const emailServiceLive: Effect.Effect<EmailService, never, Logger> =
let: {
  log << Logger;
}
yield: ({ send: (to, body) => Effect.tryPromise(...) })

// Use do-notation for your program logic
const program: Effect<{ user: User, sent: void }, NotFound | EmailError, UserRepo | EmailService> =
let: {
  user << UserRepo.findById(userId);
  sent << EmailService.send(user.email, "Welcome!");
}
yield: ({ user, sent })

// Compose layers automatically
const runnable = program.pipe(
  Effect.provide(resolveLayer<UserRepo | EmailService>())
);
```

## @service — Zero-Boilerplate Services

### Before: Manual Context.Tag

```typescript
interface UserRepo {
  findById(id: string): Effect.Effect<User, NotFound>;
}

class UserRepoTag extends Context.Tag("UserRepo")<UserRepoTag, UserRepo>() {}

const UserRepo = {
  findById: (id: string) => Effect.flatMap(UserRepoTag, (repo) => repo.findById(id)),
};
```

### After: @service

```typescript
@service
interface UserRepo {
  findById(id: string): Effect.Effect<User, NotFound>
}

// Generates:
// - UserRepoTag (Context.Tag class)
// - UserRepo.findById (accessor that yields from tag)
```

## @layer — Declarative Layers with Dependency Tracking

### Before: Manual Layer + No Dependency Graph

```typescript
const userRepoLive = Layer.effect(
  UserRepoTag,
  Effect.gen(function*() {
    const db = yield* DatabaseTag;
    return { findById: (id) => db.query(...) };
  })
);

// Must manually compose:
const fullLayer = userRepoLive.pipe(
  Layer.provide(databaseLive),
  Layer.provide(loggerLive)
);
```

### After: @layer with requires

```typescript
@layer(UserRepo, { requires: [Database] })
const userRepoLive =
let: {
  db << Database;
}
yield: ({ findById: (id) => db.query(...) })

// Layer is registered with its dependencies for automatic resolution
```

## resolveLayer\<R\>() — Automatic Layer Composition

The `resolveLayer<R>()` macro:

1. Extracts service names from the type parameter
2. Finds registered layers that provide those services
3. Builds a dependency graph from `@layer` requirements
4. Topologically sorts to get correct provision order
5. Generates `Layer.merge`/`Layer.provide` calls

```typescript
// Given these layers:
@layer(Database) const dbLive = ...
@layer(Logger) const loggerLive = ...
@layer(UserRepo, { requires: [Database] }) const userRepoLive = ...
@layer(EmailService, { requires: [Logger] }) const emailServiceLive = ...

// This:
resolveLayer<UserRepo | EmailService>()

// Compiles to:
Layer.merge(
  userRepoLive.pipe(Layer.provide(dbLive)),
  emailServiceLive.pipe(Layer.provide(loggerLive))
)
```

## Do-Notation with E/R Inference

typesugar's `let:/yield:` syntax has special handling for Effect that tracks error and requirement types:

```typescript
// Types are correctly accumulated:
let: {
  user << getUserById(id); // Effect<User, NotFound, UserRepo>
  posts << getPostsForUser(user.id); // Effect<Post[], DbError, PostRepo>
}
yield: ({ user, posts });

// Result: Effect<{ user: User, posts: Post[] }, NotFound | DbError, UserRepo | PostRepo>
```

### Comparison with Effect.gen

```typescript
// Effect.gen — also great, but requires generator syntax
const program = Effect.gen(function* () {
  const user = yield* getUserById(id);
  const posts = yield* getPostsForUser(user.id);
  return { user, posts };
});

// typesugar — alternative syntax, same semantics
let: {
  user << getUserById(id);
  posts << getPostsForUser(user.id);
}
yield: ({ user, posts });
```

Both compile to equivalent `Effect.flatMap` chains. Use whichever you prefer.

## @derive Macros

Auto-generate Effect Schema, Equal, and Hash implementations:

### @derive(EffectSchema)

```typescript
@derive(EffectSchema)
interface User {
  id: string;
  name: string;
  age: number;
  email?: string;
}

// Generates:
export const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  age: Schema.Number,
  email: Schema.optional(Schema.String),
});
```

### @derive(EffectEqual)

```typescript
@derive(EffectEqual)
interface Point { x: number; y: number; }

// Generates:
export const PointEqual: Equal.Equal<Point> = {
  [Equal.symbol]: (self, that) =>
    self.x === that.x && self.y === that.y
};
```

### @derive(EffectHash)

```typescript
@derive(EffectHash)
interface Point { x: number; y: number; }

// Generates:
export const PointHash: Hash.Hash<Point> = {
  [Hash.symbol]: (self) =>
    Hash.combine(Hash.number(self.x))(Hash.number(self.y))
};
```

## Extension Methods

Import `EffectExt` to enable fluent method calls that compile to direct function calls:

```typescript
import { EffectExt } from "@typesugar/effect";

// The transformer rewrites .method() to EffectExt.method(self, ...)
effect
  .map((x) => x + 1)
  .flatMap((x) => Effect.succeed(x * 2))
  .tap((x) => Effect.log(`Got: ${x}`))
  .orElseSucceed(() => 0);
```

Available extensions: `map`, `flatMap`, `tap`, `mapError`, `catchAll`, `orElse`, `orElseSucceed`, `orElseFail`, `as`, `asVoid`, `zip`, `zipWith`, `zipLeft`, `zipRight`, `provide`, `provideService`, `timeout`, `delay`, `repeat`, `retry`, `when`, `unless`, `tap`, `tapError`.

Also: `OptionExt` and `EitherExt` for Effect's Option and Either types.

## Typeclass Bridge

Use Effect types with typesugar's generic FP functions:

```typescript
import { effectFunctor, effectMonad, chunkFoldable } from "@typesugar/effect";
import { map, flatMap, fold } from "@typesugar/fp";

// Effect works with generic typeclass functions
const mapped = map(effectFunctor<never, never>(), myEffect, f);
const chained = flatMap(effectMonad<never, never>(), myEffect, f);

// Chunk works with Foldable
const sum = fold(chunkFoldable, 0, chunk, (acc, x) => acc + x);
```

### Available Instances

| Instance          | Typeclasses                             |
| ----------------- | --------------------------------------- |
| Effect.Effect     | Functor, Applicative, Monad, MonadError |
| Chunk             | Functor, Foldable, Traverse             |
| Option (Effect's) | Functor, Monad, MonadError              |
| Either (Effect's) | Functor, Monad, MonadError              |

## Vision: Track 2 — Fx Compile-Away

The current implementation (Track 1) enhances Effect-TS ergonomics while keeping the Effect runtime.

Track 2 (future) introduces `Fx<Value, Error, Requirements>` — a typed effect that compiles away entirely:

```typescript
// Future syntax
const program = fx<User, NotFound, UserRepo>(() => {
  const repo = summon<UserRepo>();
  return repo.findById(id);
});

// When all requirements are statically resolved,
// compiles to plain async/await with no Effect runtime
```

See [Effect Integration Vision](../vision/effect-integration.md) for the full roadmap.

## Summary

| Feature                   | What It Does                               |
| ------------------------- | ------------------------------------------ |
| `@service`                | Generates Context.Tag and accessors        |
| `@layer(S, { requires })` | Generates Layer with dependency tracking   |
| `resolveLayer<R>()`       | Auto-composes layers from dependency graph |
| `let:/yield:`             | Do-notation with E/R type inference        |
| `@derive(EffectSchema)`   | Auto-generates Schema.Struct               |
| `@derive(EffectEqual)`    | Auto-generates Equal instance              |
| `@derive(EffectHash)`     | Auto-generates Hash instance               |
| `EffectExt`               | Fluent extension methods                   |
| Typeclass instances       | Bridge to generic FP                       |

All of these are compile-time — no runtime overhead beyond what Effect itself requires.
