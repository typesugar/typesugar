# @typesugar/effect

> Make Effect-TS faster at compile time. Rich diagnostics. Zero runtime cost.

## Why @typesugar/effect?

Effect-TS provides structured concurrency, typed errors, and dependency injection — but these abstractions have runtime overhead:

- **Generator protocol** in `Effect.gen` creates iterator objects and calls `.next()`
- **Combinator trees** in Schema walk nested structures at runtime
- **Pipeline chains** allocate intermediate Effect objects

`@typesugar/effect` eliminates this overhead **at compile time**, while providing Rust-quality error messages when something goes wrong.

### What You Get

```typescript
// Before: Generator overhead, intermediate allocations
const program = Effect.gen(function* () {
  const user = yield* getUser(id);
  const posts = yield* getPosts(user.id);
  return { user, posts };
});

// After @compiled: Direct flatMap chain, no generator object
const program = Effect.flatMap(getUser(id), (user) =>
  Effect.map(getPosts(user.id), (posts) => ({ user, posts }))
);
```

```
// Clear error messages when layers are missing:
error[EFFECT001]: No layer provides `UserRepo`
  --> src/app.ts:15:5
   |
15 |   const result = program.pipe(Effect.provide(appLayer))
   |                  ^^^^^^^ requires UserRepo
   |
   = note: Effect<void, Error, UserRepo | Database> needs layers for:
           - UserRepo (no layer found)
           - Database (provided by `databaseLive` at src/layers.ts:8)
   = help: Add a layer:
           @layer(UserRepo) const userRepoLive = { ... }
```

## Installation

```bash
npm install @typesugar/effect effect
# or
pnpm add @typesugar/effect effect
```

**Build tooling required**: `@typesugar/effect` runs as a TypeScript compiler plugin. You'll need to configure the transformer in your build tool (Vite, esbuild, webpack) and the language service plugin for IDE support. For teams with existing build systems this is straightforward, but it's not zero-configuration.

---

## Zero-Cost Optimizations

### `@compiled` — Eliminate Generator Overhead

The `@compiled` decorator transforms `Effect.gen` calls into direct `flatMap` chains:

```typescript
import { compiled } from "@typesugar/effect";

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

// Compiles to:
class UserService {
  getWithPosts(id: string) {
    return Effect.flatMap(getUser(id), (user) =>
      Effect.map(getPosts(user.id), (posts) => ({ user, posts }))
    );
  }
}
```

Or use `compileGen()` directly:

```typescript
import { compileGen } from "@typesugar/effect";

const program = compileGen(
  Effect.gen(function* () {
    const x = yield* getX();
    const y = yield* getY(x);
    return x + y;
  })
);
```

### `@fused` — Pipeline Fusion

The `@fused` decorator detects and fuses consecutive Effect operations:

```typescript
import { fused } from "@typesugar/effect";

class DataPipeline {
  @fused
  process(data: Data) {
    return pipe(getData(data), Effect.map(parse), Effect.map(validate), Effect.map(transform));
  }
}

// Compiles to (map∘map fusion):
class DataPipeline {
  process(data: Data) {
    return pipe(
      getData(data),
      Effect.map((x) => transform(validate(parse(x))))
    );
  }
}
```

Fusion rules applied:

- `map(map(fa, f), g)` → `map(fa, x => g(f(x)))`
- `flatMap(succeed(a), f)` → `f(a)`
- `flatMap(map(fa, f), g)` → `flatMap(fa, x => g(f(x)))`

### `specializeSchema` — Compile-Time Validation

Generate specialized validators from Effect Schema at compile time:

```typescript
import { specializeSchema } from "@typesugar/effect";
import { Schema } from "effect";

const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  age: Schema.Number,
});

// Generic combinator walk at runtime
const validateSlow = Schema.decodeSync(UserSchema);

// Direct field checks, no combinator overhead
const validateFast = specializeSchema(UserSchema);
```

The specialized validator compiles to direct type checks:

```typescript
const validateFast = (input: unknown): User => {
  if (typeof input !== "object" || input === null) {
    throw new Error("Expected object");
  }
  const obj = input as Record<string, unknown>;
  if (typeof obj.id !== "string") {
    throw new Error("Field 'id': expected string");
  }
  if (typeof obj.name !== "string") {
    throw new Error("Field 'name': expected string");
  }
  if (typeof obj.age !== "number") {
    throw new Error("Field 'age': expected number");
  }
  return input as User;
};
```

---

## Rich Diagnostics

### Service Resolution Errors

When a program requires services that aren't provided:

```
error[EFFECT001]: No layer provides `UserRepo`
  --> src/app.ts:15:5
   |
15 |   Effect.provide(program, appLayer)
   |   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ requires UserRepo
   |
   = note: Effect<void, Error, UserRepo | Database> needs:
           - UserRepo (no layer found)
           - Database (provided by databaseLive at src/layers.ts:8)
   = help: Add a layer with @layer(UserRepo)
```

### Layer Dependency Cycles

Circular dependencies are detected at compile time:

```
error[EFFECT020]: Circular layer dependency detected
  --> src/layers.ts
   |
   = note: Dependency cycle:
           AuthService → UserRepo → Database → AuthService
                                               ^^^^^^^^^^^ cycle
   |
 5 | @layer(AuthService, { requires: [UserRepo] })
   |        ^^^^^^^^^^^ depends on UserRepo
12 | @layer(UserRepo, { requires: [Database] })
   |        ^^^^^^^^ depends on Database
18 | @layer(Database, { requires: [AuthService] })
   |        ^^^^^^^^ depends on AuthService (creates cycle)
```

### Error Handler Completeness

Warns when error handlers don't cover all error types:

```
warning[EFFECT010]: Error handler doesn't cover all error types
  --> src/handler.ts:22:3
   |
22 |   Effect.catchTag("NotFound", () => Effect.succeed(null))
   |   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
   |
   = note: Unhandled: DbError, ValidationError
           from getUser() at line 12, validateInput() at line 14
   = help: Add handlers for DbError, ValidationError
```

### Schema Type Drift

Detects when types and schemas diverge:

```
error[EFFECT030]: Schema `UserSchema` is out of sync with type `User`
  --> src/models.ts:5:3
   |
 5 |   email: string;  // field added to interface
   |   ^^^^^ new field not in UserSchema
   |
   = help: Regenerate with @derive(EffectSchema) or update manually
```

---

## Service & Layer System

Beyond optimization, `@typesugar/effect` simplifies service definitions:

### `@service` — Zero-Boilerplate Services

```typescript
import { service } from "@typesugar/effect";

@service
interface HttpClient {
  get(url: string): Effect.Effect<Response, HttpError>;
  post(url: string, body: unknown): Effect.Effect<Response, HttpError>;
}

// Generates:
// - HttpClientTag (Context.Tag)
// - HttpClient namespace with accessor functions
```

### `@layer` — Declarative Dependencies

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
  findById: (id) => db.query(sql`SELECT * FROM users WHERE id = ${id}`)
});
```

### Layer Wiring — Two Approaches

Inspired by ZIO's `ZLayer.make`, `@typesugar/effect` offers two ways to compose layers:

#### `layerMake<R>(...)` — Explicit (ZIO-style)

List the layer values explicitly. The compiler resolves the dependency graph:

```typescript
import { layerMake } from "@typesugar/effect";

// You provide the ingredients, typesugar figures out the wiring
const appLayer = layerMake<UserRepo | HttpClient>(
  userRepoLive,    // requires Database
  databaseLive,    // no requirements
  httpClientLive,  // no requirements
);

// Compiles to:
// Layer.merge(
//   userRepoLive.pipe(Layer.provide(databaseLive)),
//   httpClientLive
// )
```

Missing dependencies produce clear errors:

```
error: Missing layers for:
  - Database (required by userRepoLive)
Add the missing layers to layerMake<R>() arguments.
```

#### `resolveLayer<R>()` — Implicit (from registered layers)

The compiler resolves layers automatically from `@layer` registrations
visible in your import scope:

```typescript
import { resolveLayer } from "@typesugar/effect";

const program: Effect<void, Error, UserRepo | HttpClient> = ...;

// Automatically finds and composes all required layers:
const runnable = program.pipe(
  Effect.provide(resolveLayer<UserRepo | HttpClient>())
);
```

Only layers from files in your import graph are considered — no global
action-at-a-distance.

#### Debug Tree

Both approaches support `{ debug: true }` to emit the resolved wiring
graph at compile time (like ZIO's `ZLayer.Debug.tree`):

```typescript
// See what the compiler resolved
const appLayer = layerMake<UserRepo | HttpClient>(
  userRepoLive, databaseLive, httpClientLive,
  { debug: true }
);

// Emits at compile time:
// Layer Wiring Graph
//
// ◑ userRepoLive
// ╰─◉ databaseLive
// ◉ httpClientLive
```

#### When to Use Which

| Approach | Best for |
| --- | --- |
| `layerMake<R>(...)` | Tests, app entry points, when you want to see exactly what's wired |
| `resolveLayer<R>()` | Large apps, rapid prototyping, when listing every layer is tedious |

---

## Testing Utilities

Mock Effect services with full type safety:

```typescript
import { mockService, testLayer, assertCalled } from "@typesugar/effect";

// Create typed mock
const mockUserRepo = mockService<UserRepo>({
  getUser: (id) => Effect.succeed({ id, name: "Test User" }),
});

// Override for specific test
mockUserRepo.getUser.mockImplementation(() => Effect.fail(new NotFound()));

// Create test layer
const TestUserRepo = testLayer(UserRepo, mockUserRepo);

// Run test
const result = await Effect.runPromise(pipe(program, Effect.provide(TestUserRepo)));

// Verify calls
assertCalled(mockUserRepo, "getUser", ["123"]);
```

---

## Do-Notation

Enhanced do-notation with proper E/R type inference:

```typescript
// Error and requirement types accumulate correctly:
let: {
  user << getUserById(id); // Effect<User, NotFound, UserRepo>
  posts << getPosts(user.id); // Effect<Post[], DbError, PostRepo>
}
yield: ({ user, posts });

// Result: Effect<{ user, posts }, NotFound | DbError, UserRepo | PostRepo>
```

---

## Derive Macros

Auto-generate Effect implementations:

```typescript
import { EffectSchema, EffectEqual, EffectHash } from "@typesugar/effect";

@derive(EffectSchema)
interface User {
  id: string;
  name: string;
  age: number;
}
// Generates: export const UserSchema = Schema.Struct({ ... })

@derive(EffectEqual, EffectHash)
interface Point {
  x: number;
  y: number;
}
// Generates: PointEqual and PointHash implementations
```

---

## API Reference

### Zero-Cost Macros

| Macro                      | Description                                       |
| -------------------------- | ------------------------------------------------- |
| `@compiled`                | Transform `Effect.gen` to direct `flatMap` chains |
| `compileGen()`             | Expression-level generator compilation            |
| `@fused`                   | Fuse consecutive Effect operations                |
| `fusePipeline()`           | Expression-level pipeline fusion                  |
| `specializeSchema()`       | Compile Schema to direct validation               |
| `specializeSchemaUnsafe()` | Compile Schema without error wrapping             |

### Diagnostics

| Code      | Category            | Severity | Description                          |
| --------- | ------------------- | -------- | ------------------------------------ |
| EFFECT001 | Service Resolution  | error    | No layer provides required service   |
| EFFECT002 | Service Resolution  | error    | Layer provides wrong service type    |
| EFFECT003 | Service Resolution  | warning  | Multiple layers provide same service |
| EFFECT010 | Error Completeness  | warning  | Unhandled error types                |
| EFFECT011 | Error Completeness  | info     | Redundant error handler              |
| EFFECT020 | Layer Dependency    | error    | Circular layer dependency            |
| EFFECT021 | Layer Dependency    | info     | Unused layer in composition          |
| EFFECT030 | Schema Drift        | error    | Schema/type drift detected           |
| EFFECT040 | Type Simplification | info     | Type could be simplified             |

### Service & Layer

| Export                     | Description                                                |
| -------------------------- | ---------------------------------------------------------- |
| `@service`                 | Generate Context.Tag and accessors                         |
| `@layer(Service, opts?)`   | Create layer with dependency tracking                      |
| `layerMake<R>(...layers)`  | ZIO-style explicit wiring from listed layers               |
| `resolveLayer<R>(opts?)`   | Implicit wiring from `@layer` registrations in import scope |
| `formatDebugTree()`        | Format resolved graph as a tree string                     |
| `serviceRegistry`          | Registered services                                        |
| `layerRegistry`            | Registered layers                                          |

### Testing

| Export                               | Description                          |
| ------------------------------------ | ------------------------------------ |
| `mockService<T>()`                   | Create typed mock with call tracking |
| `testLayer(tag, mock)`               | Create test layer from mock          |
| `combineLayers(...layers)`           | Combine test layers                  |
| `assertCalled(mock, method)`         | Verify method was called             |
| `assertNotCalled(mock, method)`      | Verify method was not called         |
| `assertCalledTimes(mock, method, n)` | Verify call count                    |

### Derive Macros

| Export                  | Description             |
| ----------------------- | ----------------------- |
| `@derive(EffectSchema)` | Generate Schema.Struct  |
| `@derive(EffectEqual)`  | Generate Equal instance |
| `@derive(EffectHash)`   | Generate Hash instance  |

---

## How It Works

`@typesugar/effect` uses TypeScript's compiler API to:

1. **Analyze** Effect patterns at compile time
2. **Transform** abstractions into direct code
3. **Emit** diagnostics with source locations and suggestions
4. **Preserve** Effect's runtime semantics (fibers, interruption, scheduling)

The optimization removes **abstraction overhead** while keeping **runtime behavior** intact. Your code runs on Effect's full fiber runtime — just faster.

---

## License

MIT
