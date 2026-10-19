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
import "@typesugar/effect/syntax/do"; // activate let:/yield: labels + Effect instances
import { service, layer, resolveLayer } from "@typesugar/effect";
import { Effect } from "effect";

interface User { id: string; email: string }

// Define services with zero boilerplate (generates DatabaseTag, UserRepoTag, ...
// and accessors such as UserRepo.findById)
@service
interface Database {
  query(sql: string): Effect.Effect<User>;
}

@service
interface UserRepo {
  findById(id: string): Effect.Effect<User>;
}

@service
interface EmailService {
  send(to: string, body: string): Effect.Effect<string>;
}

// Define layers with automatic dependency tracking
@layer(Database)
const databaseLive = {
  query: (sql: string) => Effect.succeed({ id: sql, email: "a@example.com" }),
};

@layer(UserRepo, { requires: [Database] })
const userRepoLive = Effect.gen(function* () {
  const db = yield* DatabaseTag;
  return { findById: (id: string) => db.query(id) };
});

@layer(EmailService)
const emailServiceLive = {
  send: (to: string, body: string) => Effect.succeed(`sent "${body}" to ${to}`),
};

// Use do-notation for your program logic
const program = let: {
  user << UserRepo.findById("42");
  sent << EmailService.send(user.email, "Welcome!");
}
yield: ({ user, sent });

// Compose layers automatically
const runnable = program.pipe(
  Effect.provide(resolveLayer<UserRepo | EmailService>())
);
Effect.runSync(runnable);
// → { user: { id: "42", email: "a@example.com" }, sent: 'sent "Welcome!" to a@example.com' }
```

::: warning Layer bodies: use `Effect.gen`, not `let:`
Inside a layer body, get a dependency with `yield* DatabaseTag` in `Effect.gen`, as
above. Binding the tag in a `let:` block (`db << DatabaseTag` or `db << Database`)
fails with "Could not infer type constructor", because the tag is generated in the
same compilation pass and the type checker hasn't seen it yet. Service accessors
such as `UserRepo.findById(...)` do work inside `let:`.
:::

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
// - UserRepo.Tag, UserRepo.findById (accessor: Effect.serviceFunctionEffect(UserRepoTag, _ => _.findById))
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
const userRepoLive = Effect.gen(function* () {
  const db = yield* DatabaseTag;
  return { findById: (id: string) => db.query(id) };
});
// → const userRepoLive = Layer.effect(UserRepoTag, Effect.gen(...))

// Layer is registered with its dependencies for automatic resolution.
// A plain object becomes Layer.succeed(Tag, object).
```

`layerMake<R>(...layers)` is the explicit form: it takes the layers to use (both
`@layer` consts and ordinary `Layer` values) and wires them for `R`.

## resolveLayer\<R\>() — Automatic Layer Composition

The `resolveLayer<R>()` macro:

1. Extracts service names from the type parameter
2. Finds registered layers that provide those services
3. Builds a dependency graph from `@layer` requirements
4. Topologically sorts to get correct provision order
5. Generates `Layer.provideMerge` calls

```typescript
// Given these layers:
@layer(Database) const dbLive = ...
@layer(Logger) const loggerLive = ...
@layer(UserRepo, { requires: [Database] }) const userRepoLive = ...
@layer(EmailService, { requires: [Logger] }) const emailServiceLive = ...

// This:
resolveLayer<UserRepo | EmailService>()

// Compiles to a provideMerge chain in dependency order, e.g. (from the Quick Start):
userRepoLive.pipe(Layer.provideMerge(emailServiceLive.pipe(Layer.provideMerge(databaseLive))))
```

A service with no provider is a compile error: `[EFFECT001] No layer provides
\`Database\``, with a note naming the layer that requires it. A dependency cycle is
`[EFFECT020] Circular layer dependency detected`, with the cycle in a note.

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
export const PointEqual = (self: Point, that: Point): boolean =>
  Equal.equals(self["x"], that["x"]) && Equal.equals(self["y"], that["y"]);
```

The result is a plain `(self, that) => boolean` function (an Effect `Equivalence`), not an `Equal.Equal<T>` instance. In Effect 3, `Equal.Equal` is an interface an object implements on itself, so a separate object keyed by `Equal.symbol` would never be consulted by `Equal.equals`. Union types with a literal discriminant get a `switch` over the discriminant.

### @derive(EffectHash)

```typescript
@derive(EffectHash)
interface Point { x: number; y: number; }

// Generates:
export const PointHash = (self: Point): number =>
  Hash.combine(Hash.hash(self["y"]))(
    Hash.combine(Hash.hash(self["x"]))(Hash.string("Point"))
  );
```

Likewise a plain `(self: T) => number` function rather than a `Hash.Hash<T>` instance. It is seeded with the type name and combines `Hash.hash` of each field, so values that `PointEqual` considers equal hash equally.

## Extension Methods

::: warning Not working in 1.0
In the current build, `effect.map(...)` with `EffectExt` imported is reported as
"Ambiguous extension method 'map' … EffectExt.map (from "@typesugar/effect") /
Effect.map (from "effect")" whenever the file also imports `Effect` from `"effect"`
(which Effect code always does), and a chained call after the first one is not
rewritten. Call the `Effect.*` functions or `pipe` directly until this is fixed.
:::

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
import { Effect, Chunk } from "effect";

const myEffect = Effect.succeed(1);

// Effect instances for code written against Functor / Monad dictionaries
const mapped = effectFunctor<never, never>().map(myEffect, (x) => x + 1); // Effect<2>
const chained = effectMonad<never, never>().flatMap(myEffect, (x) => Effect.succeed(x * 3)); // Effect<3>

// Chunk works with Foldable
const sum = chunkFoldable.foldLeft(Chunk.make(1, 2, 3), 0, (acc, x) => acc + x); // 6
```

### Available Instances

| Instance          | Typeclasses                             |
| ----------------- | --------------------------------------- |
| Effect.Effect     | Functor, Applicative, Monad, MonadError |
| Chunk             | Functor, Foldable, Traverse             |
| Option (Effect's) | Functor, Monad, MonadError              |
| Either (Effect's) | Functor, Monad, MonadError              |

## Planned: Track 2 — Fx Compile-Away (not in 1.0)

The current implementation (Track 1) enhances Effect-TS ergonomics while keeping the Effect runtime.

Track 2 (future) introduces `Fx<Value, Error, Requirements>` — a typed effect that compiles away entirely:

```typescript
// Planned — not in 1.0
const program = fx<User, NotFound, UserRepo>(() => {
  const repo = summon<UserRepo>();
  return repo.findById(id);
});

// When all requirements are statically resolved,
// compiles to plain async/await with no Effect runtime
```

This is not implemented. See [Effect Integration Vision](../vision/effect-integration.md)
(a historical design document) for the exploration behind it.

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
