# Effect-TS Integration

Make Effect-TS faster at compile time with zero-cost optimizations and Rust-quality diagnostics.

## Why Use @typesugar/effect?

Effect-TS provides structured concurrency, typed errors, and dependency injection — but abstractions have overhead:

| Abstraction | Runtime Cost |
| --- | --- |
| `Effect.gen` | Generator protocol: iterator objects, `.next()` calls |
| Schema combinators | Tree walk for every validation |
| Pipeline chains | Intermediate Effect allocations |

`@typesugar/effect` eliminates this overhead at compile time while preserving full fiber runtime semantics.

## Quick Start

```bash
npm install @typesugar/effect effect
```

```typescript
import { compiled, specializeSchema } from "@typesugar/effect";
import { Effect, Schema } from "effect";

// Generator → direct flatMap chain
class UserService {
  @compiled
  getWithPosts(id: string) {
    return Effect.gen(function* () {
      const user = yield* getUser(id);
      const posts = yield* getPosts(user.id);
      return { user, posts };
    });
  }
}

// Schema → direct type checks
const UserSchema = Schema.Struct({ name: Schema.String, age: Schema.Number });
const validateUser = specializeSchema(UserSchema);
```

---

## Zero-Cost Optimizations

### Generator Compilation

The `@compiled` decorator transforms `Effect.gen` into direct `flatMap` chains:

```typescript
// Before: Generator protocol overhead
Effect.gen(function* () {
  const x = yield* getX();
  const y = yield* getY(x);
  return x + y;
});

// After @compiled: Zero generator overhead
Effect.flatMap(getX(), (x) =>
  Effect.map(getY(x), (y) => x + y)
);
```

### Pipeline Fusion

The `@fused` decorator combines consecutive operations:

```typescript
// Before: 3 intermediate Effect objects
pipe(getData(), Effect.map(f), Effect.map(g), Effect.map(h));

// After @fused: Single Effect
pipe(getData(), Effect.map((x) => h(g(f(x)))));
```

### Schema Specialization

`specializeSchema()` compiles Schema to direct validation:

```typescript
// Before: Combinator tree walk
Schema.decodeSync(UserSchema)(input);

// After: Direct field checks
((input) => {
  if (typeof input !== "object" || input === null) throw ...;
  if (typeof input.name !== "string") throw ...;
  if (typeof input.age !== "number") throw ...;
  return input;
})(input);
```

---

## Rich Diagnostics

### Missing Service Layers

```
error[EFFECT001]: No layer provides `UserRepo`
  --> src/app.ts:15:5
   |
15 |   Effect.provide(program, appLayer)
   |   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ requires UserRepo
   |
   = note: Effect needs: UserRepo (not found), Database (found)
   = help: Add @layer(UserRepo) const userRepoLive = { ... }
```

### Circular Dependencies

```
error[EFFECT020]: Circular layer dependency detected
   |
   = note: AuthService → UserRepo → Database → AuthService
                                               ^^^^^^^^^^^ cycle
```

### Incomplete Error Handling

```
warning[EFFECT010]: Error handler doesn't cover all error types
   |
   = note: Unhandled: DbError, ValidationError
   = help: Add handlers for remaining error types
```

---

## Service & Layer System

### Define Services

```typescript
import { service } from "@typesugar/effect";

@service
interface HttpClient {
  get(url: string): Effect.Effect<Response, HttpError>;
  post(url: string, body: unknown): Effect.Effect<Response, HttpError>;
}
// Generates: HttpClientTag + accessor functions
```

### Define Layers

```typescript
import { layer } from "@typesugar/effect";

@layer(HttpClient)
const httpClientLive = {
  get: (url) => Effect.tryPromise(() => fetch(url)),
  post: (url, body) => Effect.tryPromise(() =>
    fetch(url, { method: "POST", body: JSON.stringify(body) })
  ),
};

@layer(UserRepo, { requires: [Database] })
const userRepoLive =
let: {
  db << Database;
}
yield: ({
  findById: (id) => db.query(...)
});
```

### Automatic Composition

```typescript
import { resolveLayer } from "@typesugar/effect";

const program: Effect<void, Error, UserRepo | HttpClient> = ...;

// Automatically resolves all required layers:
const runnable = program.pipe(
  Effect.provide(resolveLayer<UserRepo | HttpClient>())
);
```

---

## Testing

```typescript
import { mockService, testLayer, assertCalled } from "@typesugar/effect";

// Create mock
const mockUserRepo = mockService<UserRepo>({
  getUser: (id) => Effect.succeed({ id, name: "Test" }),
});

// Override per test
mockUserRepo.getUser.mockImplementation(() =>
  Effect.fail(new NotFound())
);

// Use in test
const result = await Effect.runPromise(
  pipe(program, Effect.provide(testLayer(UserRepo, mockUserRepo)))
);

// Verify
assertCalled(mockUserRepo, "getUser", ["123"]);
```

---

## Do-Notation

Enhanced do-notation with proper E/R type accumulation:

```typescript
let: {
  user << getUserById(id);    // Effect<User, NotFound, UserRepo>
  posts << getPosts(user.id); // Effect<Post[], DbError, PostRepo>
}
yield: ({ user, posts });
// Result: Effect<{ user, posts }, NotFound | DbError, UserRepo | PostRepo>
```

---

## Derive Macros

```typescript
import { EffectSchema, EffectEqual, EffectHash } from "@typesugar/effect";

@derive(EffectSchema)
interface User { id: string; name: string; }
// Generates: UserSchema

@derive(EffectEqual, EffectHash)
interface Point { x: number; y: number; }
// Generates: PointEqual, PointHash
```

---

## How It Works

`@typesugar/effect` uses TypeScript's compiler API to:

1. **Analyze** — Detect Effect patterns at compile time
2. **Transform** — Replace abstractions with optimized code
3. **Preserve** — Keep Effect's runtime semantics (fibers, interruption)
4. **Diagnose** — Emit rich errors with source locations

Your code runs on Effect's full fiber runtime — just faster.

---

## Learn More

- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/effect)
- [API Reference](/reference/packages#effect)
