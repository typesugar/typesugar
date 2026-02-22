# Effect-TS Integration

Deep Effect-TS integration with compile-time macros: zero-boilerplate services, automatic layer composition, enhanced do-notation, and derive macros.

## Quick Start

```bash
npm install @typesugar/effect effect
```

```typescript
import { service, layer, resolveLayer } from "@typesugar/effect";

@service
interface HttpClient {
  get(url: string): Effect.Effect<Response, HttpError>
}

@layer(HttpClient)
const httpClientLive = {
  get: (url) => Effect.tryPromise(() => fetch(url)),
};
```

## Features

### @service — Define Services

```typescript
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
@layer(UserRepo, { requires: [Database] })
const userRepoLive =
let: {
  db << Database;
}
yield: ({
  findById: (id) => db.query(sql`SELECT * FROM users WHERE id = ${id}`)
})
```

### resolveLayer\<R\>() — Automatic Layer Composition

```typescript
const program: Effect<void, Error, UserRepo | HttpClient> = ...;

// Automatically resolve and compose all required layers:
const runnable = program.pipe(
  Effect.provide(resolveLayer<UserRepo | HttpClient>())
);
```

### Enhanced Do-Notation

```typescript
// E/R types correctly accumulated:
let: {
  user << getUserById(id); // Effect<User, NotFound, UserRepo>
  posts << getPostsForUser(user.id); // Effect<Post[], DbError, PostRepo>
}
yield: ({ user, posts });
// Result: Effect<{ user, posts }, NotFound | DbError, UserRepo | PostRepo>
```

### @derive Macros

```typescript
@derive(EffectSchema)
interface User { id: string; name: string; age: number; }
// Generates: export const UserSchema = Schema.Struct({ ... })
```

## Learn More

- [API Reference](/reference/packages#effect)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/effect)
