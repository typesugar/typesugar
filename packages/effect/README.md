# @typesugar/effect

> Deep Effect-TS integration with typesugar's compile-time macro system.

## Overview

`@typesugar/effect` provides comprehensive integration between typesugar and Effect-TS:

- **@service** — Zero-boilerplate service definitions with Context.Tag generation
- **@layer** — Declarative dependency injection with automatic registration
- **resolveLayer<R>()** — Automatic layer composition from dependency graph
- **Enhanced do-notation** — `let:/yield:` syntax with proper E/R type inference
- **@derive macros** — Auto-generate Schema, Equal, Hash implementations
- **Extension methods** — Fluent API for Effect types
- **Typeclass instances** — Bridge Effect to typesugar's generic FP typeclasses

## Installation

```bash
npm install @typesugar/effect
# or
pnpm add @typesugar/effect
```

Requires Effect-TS as a peer dependency:

```bash
npm install effect
```

## Quick Start

### @service — Define Services

```typescript
import { service } from "@typesugar/effect";

@service
interface HttpClient {
  get(url: string): Effect.Effect<Response, HttpError>
  post(url: string, body: unknown): Effect.Effect<Response, HttpError>
}

// Generates:
// - HttpClientTag (Context.Tag class)
// - HttpClient.get, HttpClient.post (accessor functions)
```

### @layer — Define Layers

```typescript
import { layer } from "@typesugar/effect";

@layer(HttpClient)
const httpClientLive = {
  get: (url) => Effect.tryPromise(() => fetch(url)),
  post: (url, body) => Effect.tryPromise(() => fetch(url, { method: "POST", body })),
};
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

### resolveLayer<R>() — Automatic Layer Composition

```typescript
import { resolveLayer } from "@typesugar/effect";

const program: Effect<void, Error, UserRepo | HttpClient> = ...;

// Automatically resolve and compose all required layers:
const runnable = program.pipe(
  Effect.provide(resolveLayer<UserRepo | HttpClient>())
);
```

### Do-Notation with E/R Inference

```typescript
// Error and requirement types are correctly accumulated:
let: {
  user << getUserById(id); // Effect<User, NotFound, UserRepo>
  posts << getPostsForUser(user.id); // Effect<Post[], DbError, PostRepo>
}
yield: ({ user, posts });

// Result type: Effect<{ user: User, posts: Post[] }, NotFound | DbError, UserRepo | PostRepo>
```

### @derive Macros

```typescript
import { EffectSchema, EffectEqual, EffectHash } from "@typesugar/effect";

@derive(EffectSchema)
interface User { id: string; name: string; age: number; }
// Generates: export const UserSchema = Schema.Struct({ ... })

@derive(EffectEqual)
interface Point { x: number; y: number; }
// Generates: export const PointEqual: Equal.Equal<Point> = { ... }

@derive(EffectHash)
interface Point { x: number; y: number; }
// Generates: export const PointHash: Hash.Hash<Point> = { ... }
```

### Extension Methods

```typescript
import { EffectExt, OptionExt, EitherExt } from "@typesugar/effect";

// Fluent method chaining (transformer rewrites to direct calls)
effect
  .map((x) => x + 1)
  .flatMap((x) => Effect.succeed(x * 2))
  .tap((x) => Effect.log(`Got: ${x}`))
  .orElseSucceed(() => 0);
```

### Typeclass Instances

```typescript
import { effectFunctor, effectMonad, effectMonadError, chunkFoldable } from "@typesugar/effect";

// Use with generic FP functions
const mapped = genericMap(effectFunctor<never, never>(), effect, f);
```

## API Reference

### Attribute Macros

| Macro                    | Description                                                  |
| ------------------------ | ------------------------------------------------------------ |
| `@service`               | Generate Context.Tag and accessor namespace for an interface |
| `@layer(Service, opts?)` | Wrap a const in Layer.succeed/effect/scoped                  |
| `@derive(EffectSchema)`  | Generate Effect Schema.Struct for a type                     |
| `@derive(EffectEqual)`   | Generate Equal.Equal instance for a type                     |
| `@derive(EffectHash)`    | Generate Hash.Hash instance for a type                       |

### Expression Macros

| Macro               | Description                                     |
| ------------------- | ----------------------------------------------- |
| `resolveLayer<R>()` | Automatically compose layers for requirements R |

### Registries

| Export                      | Description                        |
| --------------------------- | ---------------------------------- |
| `serviceRegistry`           | Map of registered services         |
| `layerRegistry`             | Map of registered layers           |
| `registerService(info)`     | Manually register a service        |
| `registerLayer(info)`       | Manually register a layer          |
| `getService(name)`          | Look up service metadata           |
| `getLayer(name)`            | Look up layer metadata             |
| `getLayersForService(name)` | Get all layers providing a service |

### Extension Namespaces

| Export      | Description                           |
| ----------- | ------------------------------------- |
| `EffectExt` | Extension methods for Effect.Effect   |
| `OptionExt` | Extension methods for Effect's Option |
| `EitherExt` | Extension methods for Effect's Either |

### Typeclass Instances

| Export                      | Description                   |
| --------------------------- | ----------------------------- |
| `effectFunctor<E, R>()`     | Functor for Effect.Effect     |
| `effectApplicative<E, R>()` | Applicative for Effect.Effect |
| `effectMonad<E, R>()`       | Monad for Effect.Effect       |
| `effectMonadError<E, R>()`  | MonadError for Effect.Effect  |
| `chunkFunctor`              | Functor for Chunk             |
| `chunkFoldable`             | Foldable for Chunk            |
| `chunkTraverse`             | Traverse for Chunk            |
| `effectOptionFunctor`       | Functor for Option            |
| `effectOptionMonad`         | Monad for Option              |
| `effectEitherFunctor<E>()`  | Functor for Either            |
| `effectEitherMonad<E>()`    | Monad for Either              |

### HKT Types

| Export                   | Description                    |
| ------------------------ | ------------------------------ |
| `EffectF<E, R>`          | HKT for Effect.Effect          |
| `ChunkF`                 | HKT for Chunk                  |
| `EffectOptionF<E, R>`    | HKT for Effect wrapping Option |
| `EffectEitherF<L, E, R>` | HKT for Effect wrapping Either |
| `StreamF<E, R>`          | HKT for Stream                 |

## Vision

See the [Effect Integration Vision Doc](../../docs/vision/effect-integration.md) for the full design including:

- Track 1: Deep Effect-TS integration (current implementation)
- Track 2: Fx compile-away system (future)

## License

MIT
