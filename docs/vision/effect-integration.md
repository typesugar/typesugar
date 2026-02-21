# Deep Effect-TS Integration

> Bringing ZIO/Scala-level ergonomics to Effect-TS through typesugar's compile-time capabilities.

## Overview

typesugar's Effect integration has two tracks:

| Track       | What                            | Goal                                                 |
| ----------- | ------------------------------- | ---------------------------------------------------- |
| **Track 1** | Deep integration with Effect-TS | Use Effect as the runtime, add ergonomics via macros |
| **Track 2** | Fx compile-away system          | Zero-cost effects that compile to async/await        |

This document covers both tracks and how they relate.

---

## Track 1: Deep Effect-TS Integration

### The Problem

Effect-TS is a powerful library inspired by ZIO, but it has ergonomic friction:

1. **Service boilerplate**: Defining `Context.Tag` and accessor functions is repetitive
2. **Layer composition**: Manual `Layer.provide` / `Layer.merge` chains are verbose
3. **Do-notation**: `Effect.gen()` is good but TypeScript's inference sometimes struggles
4. **Derive macros**: No automatic Schema/Equal/Hash generation

### The Solution: typesugar Macros

We leverage typesugar's compile-time capabilities to eliminate boilerplate while keeping Effect's full runtime semantics.

---

### @service — Zero-Boilerplate Services

Instead of manually writing Context.Tag classes and accessors:

```typescript
// Before: manual Effect service definition
class HttpClientTag extends Context.Tag("HttpClient")<
  HttpClient,
  {
    readonly get: (url: string) => Effect.Effect<Response, HttpError>;
    readonly post: (url: string, body: unknown) => Effect.Effect<Response, HttpError>;
  }
>() {}

const HttpClient = {
  get: Effect.serviceFunctionEffect(HttpClientTag, (_) => _.get),
  post: Effect.serviceFunctionEffect(HttpClientTag, (_) => _.post),
};
```

With @service:

```typescript
@service
interface HttpClient {
  get(url: string): Effect.Effect<Response, HttpError>
  post(url: string, body: unknown): Effect.Effect<Response, HttpError>
}

// Generates both the Tag class and accessor namespace automatically
```

The macro:

1. Generates a `Context.Tag` class with the interface shape
2. Creates a companion namespace with `Effect.serviceFunctionEffect` accessors
3. Registers the service in the service registry for later layer resolution

---

### @layer — Declarative Dependency Injection

Define layers with automatic dependency tracking:

```typescript
@layer(HttpClient)
const httpClientLive = {
  get: (url) => Effect.tryPromise(() => fetch(url)),
  post: (url, body) => Effect.tryPromise(() => fetch(url, { method: "POST", body })),
}
// Generates: Layer.succeed(HttpClientTag, { ... })

@layer(UserRepo, { requires: [Database] })
const userRepoLive =
let: {
  db << Database;
}
yield: ({ findById: (id) => db.query(sql`SELECT * FROM users WHERE id = ${id}`) })
// Generates: Layer.effect(UserRepoTag, ...)
// + registers dependency for automatic resolution
```

---

### resolveLayer\<R\>() — Automatic Layer Composition

Given registered layers, automatically build the dependency graph:

```typescript
// Registered layers:
@layer(Database) const databaseLive = { ... }
@layer(Logger) const loggerLive = { ... }
@layer(UserRepo, { requires: [Database] }) const userRepoLive = ...
@layer(EmailService, { requires: [Logger] }) const emailServiceLive = ...

// Resolve all layers for an Effect with requirements:
const program: Effect<void, Error, UserRepo | EmailService> = ...

const runnable = program.pipe(
  Effect.provide(resolveLayer<UserRepo | EmailService>())
)

// Generates:
// Layer.merge(
//   userRepoLive.pipe(Layer.provide(databaseLive)),
//   emailServiceLive.pipe(Layer.provide(loggerLive))
// )
```

The macro:

1. Parses the union type to extract required services
2. Looks up layers from the registry
3. Topologically sorts by dependencies
4. Generates the appropriate `Layer.provide` / `Layer.merge` composition

---

### Enhanced Do-Notation

The `let:/yield:` syntax from `@typesugar/std` has been enhanced for Effect:

```typescript
let: {
  user << getUserById(id); // Effect<User, NotFound, UserRepo>
  posts << getPostsForUser(user.id); // Effect<Post[], DbError, PostRepo>
}
yield: ({ user, posts });

// Compiles to:
Effect.flatMap(getUserById(id), (user) =>
  Effect.map(getPostsForUser(user.id), (posts) => ({ user, posts }))
);
```

Unlike generic do-notation, the Effect-aware path:

- Directly calls `Effect.flatMap` and `Effect.map`
- Preserves TypeScript's inference of `E` (error) and `R` (requirements)
- Correctly accumulates union types across the chain

---

### @derive Macros

Auto-generate Effect Schema, Equal, and Hash implementations:

```typescript
@derive(EffectSchema)
interface User {
  id: string;
  name: string;
  age: number;
  role: "admin" | "user";
}

// Generates:
export const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  age: Schema.Number,
  role: Schema.Union(Schema.Literal("admin"), Schema.Literal("user")),
});
export type UserEncoded = Schema.Schema.Encoded<typeof UserSchema>;
```

```typescript
@derive(EffectEqual)
interface Point { x: number; y: number; }

// Generates:
export const PointEqual: Equal.Equal<Point> = {
  [Equal.symbol](self: Point, that: Point): boolean {
    return Equal.equals(self.x, that.x) && Equal.equals(self.y, that.y);
  }
};
```

```typescript
@derive(EffectHash)
interface Point { x: number; y: number; }

// Generates:
export const PointHash: Hash.Hash<Point> = {
  [Hash.symbol](self: Point): number {
    return Hash.combine(Hash.hash(self.x), Hash.hash(self.y));
  }
};
```

---

### Typeclass Instances for Generic Programming

Bridge Effect types to typesugar's generic FP typeclasses:

```typescript
import {
  effectFunctor,
  effectMonad,
  effectMonadError,
  chunkFoldable,
  chunkTraverse,
} from "@typesugar/effect";

// Use with generic functions that work on any Functor/Monad
const mapped = genericMap(effectFunctor<never, never>(), effect, f);

// Enable specialize() inlining for Effect operations
const specialized = specialize(genericFunction);
```

HKT encodings available:

- `EffectF<E, R>` — Effect.Effect parameterized by success type
- `ChunkF` — Effect's Chunk collection
- `EffectOptionF<E, R>` — Effect wrapping Option
- `EffectEitherF<L, E, R>` — Effect wrapping Either

---

### Extension Methods

Import `EffectExt` to enable fluent method chaining:

```typescript
import { EffectExt } from "@typesugar/effect";

// The transformer rewrites .method() calls to direct function calls
effect.map((x) => x + 1); // → EffectExt.map(effect, x => x + 1)

// Chain operations fluently:
effect
  .map((x) => x + 1)
  .flatMap((x) => Effect.succeed(x * 2))
  .tap((x) => Effect.log(`Got: ${x}`))
  .orElseSucceed(() => 0)
  .runPromise();
```

Also available: `OptionExt`, `EitherExt` for Effect's Option and Either types.

---

## Track 2: Fx Compile-Away (Future)

The long-term vision is a zero-cost effect system that compiles away entirely.

### Fx<Value, Error, Requirements>

A type that describes effectful computation without runtime overhead:

```typescript
type Fx<A, E = never, R = never>
```

At the type level, tracks everything. At runtime after macro expansion, it's just `Promise<A>` or sync code.

### The fx() Block

```typescript
const fetchUser = (id: string) =>
  fx(function* () {
    const token = yield* auth.getToken();
    const user = yield* http.fetch<User>(`/api/users/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return user;
  });
```

**Compiles to:**

```typescript
const fetchUser = async (id: string) => {
  const token = await getToken();
  const user = await fetch(`/api/users/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  return user;
};
```

### When to Use Which?

| Scenario                                                           | Recommended                 | Why                           |
| ------------------------------------------------------------------ | --------------------------- | ----------------------------- |
| Need Effect ecosystem (Layers, fiber runtime, advanced scheduling) | Track 1 (@typesugar/effect) | Full Effect runtime preserved |
| Want zero runtime overhead, simple async/await output              | Track 2 (Fx)                | Compiles away entirely        |
| Gradual migration from Effect-TS                                   | Track 1 first               | Leverage existing Effect code |
| New project, maximum performance                                   | Track 2 when ready          | No framework runtime          |

---

## Summary

Track 1 makes Effect-TS ergonomic via compile-time macros:

- `@service` — generates Context.Tag + accessors
- `@layer` — declares layers with dependency tracking
- `resolveLayer<R>()` — automatic layer composition
- `let:/yield:` — enhanced do-notation with E/R inference
- `@derive(EffectSchema|Equal|Hash)` — auto-generated implementations
- Extension methods — fluent API via EffectExt/OptionExt/EitherExt

Track 2 provides zero-cost effects that compile to async/await (future implementation).

Both tracks share the same philosophy: **the compiler does the work, not the runtime**.

---

See also:

- [Fx](./fx.md) — the compile-away effect system vision
- [@typesugar/effect package](../../packages/effect/README.md) — implementation details
