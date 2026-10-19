# Effect-TS Integration

Zero-boilerplate services, automatic layer wiring, and compile-time optimization for Effect-TS — with compile-time errors for missing layers and dependency cycles.

## Why Use @typesugar/effect?

Effect-TS provides structured concurrency, typed errors, and dependency injection. `@typesugar/effect` makes it easier to use and faster at runtime:

- **`@service`** — Define services without `Context.Tag` boilerplate
- **`@layer`** — Declare dependencies; the compiler wires them
- **`layerMake` / `resolveLayer`** — ZIO-style layer composition with clear errors when something's missing
- **`@compiled`** _(experimental)_ — Eliminate generator overhead in `Effect.gen` at compile time
- **`@fused`** _(experimental)_ — Fuse consecutive pipeline operations
- **`specializeSchema`** _(experimental)_ — Compile Effect Schema to direct validation

Effect's abstractions are powerful but have overhead:

| Abstraction        | Runtime Cost                                          |
| ------------------ | ----------------------------------------------------- |
| `Effect.gen`       | Generator protocol: iterator objects, `.next()` calls |
| Schema combinators | Tree walk for every validation                        |
| Pipeline chains    | Intermediate Effect allocations                       |

`@typesugar/effect` eliminates this overhead at compile time while preserving full fiber runtime semantics.

## Installation

```bash
npm install @typesugar/effect effect
# or
pnpm add @typesugar/effect effect
```

**Build tooling required**: `@typesugar/effect` runs as a TypeScript compiler plugin. You'll need to configure the transformer in your build tool (Vite, esbuild, webpack) and the language service plugin for IDE support. For teams with existing build systems this is straightforward, but it's not zero-configuration.

## Quick Start

```typescript
import { service, layer, layerMake, compiled, specializeSchema } from "@typesugar/effect";
import { Effect, Schema } from "effect";

interface User {
  id: string;
  name: string;
}

// @service — one decorator, you get the Tag and accessors
@service
interface Database {
  query(sql: string): Effect.Effect<User[]>;
}

@service
interface UserRepo {
  findById(id: string): Effect.Effect<User | undefined>;
}

// @layer — declare what a layer provides and what it needs
@layer(Database)
const databaseLive = {
  query: (sql: string) => Effect.succeed([{ id: "1", name: "Ada" }]),
};

@layer(UserRepo, { requires: [Database] })
const userRepoLive = Effect.gen(function* () {
  const db = yield* DatabaseTag; // the Tag @service generated
  return {
    findById: (id: string) =>
      Effect.map(db.query(`SELECT * FROM users WHERE id = '${id}'`), (rows) => rows[0]),
  };
});

// layerMake — you list layers, typesugar composes them
const appLayer = layerMake<UserRepo | Database>(userRepoLive, databaseLive);

// @compiled — Effect.gen without generator overhead
class UserService {
  @compiled
  getName(id: string) {
    return Effect.gen(function* () {
      const user = yield* UserRepo.findById(id);
      return user?.name ?? "unknown";
    });
  }
}

// specializeSchema — Schema validation compiled to direct type checks (schema written inline)
const validateUser = specializeSchema(Schema.Struct({ name: Schema.String, age: Schema.Number }));

const program = new UserService().getName("1");
Effect.runPromise(Effect.provide(program, appLayer)).then(console.log); // "Ada"
```

A layer that needs another service gets it with `yield* <Service>Tag` inside `Effect.gen`. Inside a `let:` block (with `import "@typesugar/effect/syntax/do"`) you can bind the Tag directly, even when `@service` generated it in the same file: `db << DatabaseTag` compiles to `Effect.flatMap(DatabaseTag, (db) => …)`.

When a layer is missing, you get a compile error naming it. Leaving `databaseLive` out of `layerMake` above gives:

```
error: [EFFECT001] No layer provides `Database`
  = note: required by userRepoLive
  = help: Add a layer providing Database to the layerMake<R>() arguments.
```

---

## Service & Layer System

The main value: define services and layers with minimal boilerplate, let the compiler handle wiring.

### `@service` — Zero-Boilerplate Services

```typescript
import { service } from "@typesugar/effect";

@service
interface HttpClient {
  get(url: string): Effect.Effect<Response, HttpError>;
  post(url: string, body: unknown): Effect.Effect<Response, HttpError>;
}

// Generates:
// - export class HttpClientTag extends Context.Tag("HttpClient")<HttpClientTag, { readonly get: ...; readonly post: ... }>() {}
//   (the shape reuses your signatures as written: optional/rest params and method generics are kept)
// - export namespace HttpClient { Tag, get, post }  — accessors via Effect.serviceFunctionEffect
// `Context`/`Effect` are imported for you if the file doesn't already import them from "effect".
```

Provide the service with the Tag: `Effect.provideService(program, HttpClientTag, impl)` or
`Layer.succeed(HttpClientTag, impl)`.

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
const userRepoLive = Effect.gen(function* () {
  const db = yield* DatabaseTag;
  return { findById: (id: string) => db.query(`SELECT * FROM users WHERE id = '${id}'`) };
});
```

A plain object becomes `Layer.succeed(HttpClientTag, { ... })`; an `Effect` body becomes `Layer.effect(UserRepoTag, ...)`.

### Layer Wiring — Two Approaches

Inspired by ZIO's `ZLayer.make`, `@typesugar/effect` offers two ways to compose layers.

#### `layerMake<R>(...)` — Explicit (ZIO-style)

List the layers explicitly, as `@layer` consts or ordinary `Layer` values. The compiler resolves the dependency graph:

```typescript
import { layerMake } from "@typesugar/effect";

// You provide the ingredients, typesugar figures out the wiring
const appLayer = layerMake<UserRepo | HttpClient>(
  userRepoLive, // requires Database
  databaseLive, // no requirements
  httpClientLive // no requirements
);

// Compiles to (each layer is fed its dependencies with Layer.provideMerge,
// so transitive dependencies are wired and every service is in the output):
// userRepoLive.pipe(
//   Layer.provideMerge(httpClientLive.pipe(Layer.provideMerge(databaseLive)))
// )
```

Each missing dependency is a compile error:

```
error: [EFFECT001] No layer provides `Database`
  = note: required by userRepoLive
  = help: Add a layer providing Database to the layerMake<R>() arguments.
```

#### `resolveLayer<R>()` — Implicit (from registered layers)

The compiler resolves layers automatically from `@layer` registrations visible in your import scope:

```typescript
import { resolveLayer } from "@typesugar/effect";

const program: Effect<void, Error, UserRepo | HttpClient> = ...;

// Automatically finds and composes all required layers:
const runnable = program.pipe(
  Effect.provide(resolveLayer<UserRepo | HttpClient>())
);
```

Only layers from files in your import graph are considered — no global action-at-a-distance. If the
only layer for a required service is declared in a file you don't import, that is a compile error
naming the layer and its file (there is no fallback to "any registered layer"). Layers declared in
another file are only known once that file has been transformed in the same process.

#### Layer Dependency Resolution

Layer wiring is built on a dependency graph. The `layer-graph` module defines a `layerGraphLike` — a `GraphLike` instance for the layer dependency graph — and uses `topoSortG` from `@typesugar/graph` to resolve the correct composition order. Cycles are detected via `detectCycles` before composition. Both `layerMake` and `resolveLayer` use this shared graph logic.

#### Debug Tree

Both approaches support `{ debug: true }` to emit the resolved wiring graph at compile time (like ZIO's `ZLayer.Debug.tree`):

```typescript
// See what the compiler resolved
const appLayer = layerMake<UserRepo | HttpClient>(userRepoLive, databaseLive, httpClientLive, {
  debug: true,
});

// Reports a compile-time warning:
// Layer Wiring Graph
//
// ◉ httpClientLive
// ◑ userRepoLive
// ╰─◉ databaseLive
```

You can also format a resolved graph yourself with `formatDebugTree()` from `@typesugar/effect/macros`.

#### When to Use Which

| Approach            | Best for                                                           |
| ------------------- | ------------------------------------------------------------------ |
| `layerMake<R>(...)` | Tests, app entry points, when you want to see exactly what's wired |
| `resolveLayer<R>()` | Large apps, rapid prototyping, when listing every layer is tedious |

---

## Zero-Cost Optimizations

### `@compiled` — Eliminate Generator Overhead

> **Experimental.** `@compiled`, `compileGen()`, `@fused`, `fusePipeline()` and `specializeSchema()`
> rewrite your code's structure; read the limits below before relying on them.

The `@compiled` decorator transforms `Effect.gen` calls into direct `flatMap` chains. Only
straight-line generator bodies are supported: top-level `const x = yield* e`, `yield* e`,
`return ...`, and ordinary statements (kept, in order). A `yield*` inside `if`/loops/`try` or an
expression, `this`/`arguments`, or a generator with parameters is a compile error and the
`Effect.gen` is left as written. The chain is wrapped in `Effect.suspend` so, like `Effect.gen`,
nothing runs until the Effect is executed.

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
    return Effect.suspend(() =>
      Effect.flatMap(getUser(id), (user) =>
        Effect.map(getPosts(user.id), (posts) => ({ user, posts }))
      )
    );
  }
}
```

Or use `compileGen()` directly for expression-level compilation:

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

The `@fused` decorator detects and fuses nested, data-first Effect operations (the data-last
`pipe(x, Effect.map(f), ...)` form is not fused):

```typescript
import { fused } from "@typesugar/effect";

class DataPipeline {
  @fused
  process(data: Data) {
    return Effect.map(Effect.map(Effect.map(getData(data), parse), validate), transform);
  }
}

// Compiles to (map∘map fusion; parse/validate/transform are each evaluated once):
// Effect.map(getData(data), compose(parse, compose(validate, transform)))
// where compose(f, g) = ((f, g) => (x) => g(f(x)))(f, g)
```

Fusion rules applied:

- `map(map(fa, f), g)` → `map(fa, compose(f, g))`
- `flatMap(map(fa, f), g)` → `flatMap(fa, compose(f, g))`

(`flatMap(succeed(a), f)` is deliberately NOT rewritten to `f(a)`: that would run `f` when the
Effect is built instead of when it runs.)

For expression-level fusion without the decorator, use `fusePipeline()`.

### `specializeSchema` — Compile-Time Validation

Generate specialized validators from Effect Schema at compile time:

```typescript
import { specializeSchema } from "@typesugar/effect";
import { Schema } from "effect";

// Generic combinator walk at runtime
const validateSlow = Schema.decodeUnknownSync(UserSchema);

// Direct field checks — the schema must be written INLINE so the macro can see it
const validateFast = specializeSchema(
  Schema.Struct({ id: Schema.String, name: Schema.String, age: Schema.Number })
);
// → (input: unknown) => typeof input === "object" && input !== null && !Array.isArray(input)
//      ? { "id": typeof input["id"] === "string" ? input["id"] : throw..., ... }
//      : throw...
```

Specialized checks are generated for `String`, `Number`, `Boolean`, `BigIntFromSelf`,
`SymbolFromSelf`, `Undefined`, `Null`, `Unknown`, `Struct` (identifier or quoted keys,
`optional(...)` fields), `Array`, `Tuple`, `NullOr` and `Literal(a, b, ...)`. Anything else —
`Schema.BigInt`/`Schema.Date` (transformations from string), `Union`, refinements, a schema
variable — is decoded with `Schema.decodeUnknownSync(<that sub-schema>)`, built once. Failures
throw a plain `Error` naming the path, not a `ParseError`.

`specializeSchemaUnsafe(schema, input)` decodes one value directly (the input expression is
evaluated once).

---

## Wiring Diagnostics

Layer wiring errors carry an `EFFECTnnn` code in the message (and a numeric `TS99xx` code for tooling).

### Missing Layers (EFFECT001)

`layerMake` and `resolveLayer` report one error per service no layer provides:

```
error: [EFFECT001] No layer provides `Database`
  = note: required by userRepoLive
  = help: Add a layer providing Database to the layerMake<R>() arguments.
```

### Layer Dependency Cycles (EFFECT020)

Circular dependencies are detected at compile time:

```
error: [EFFECT020] Circular layer dependency detected
  = note: Dependency cycle: A → B → A
```

### Planned

Error-handler completeness (EFFECT010, warning when `catchTag` handlers don't cover every error type), schema drift (EFFECT030, a schema out of sync with its type) and the other codes in the [table below](#diagnostics) are planned — not in 1.0. Their codes are reserved but the compiler does not report them.

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

// Create test layer (a real Layer.succeed for the service's Tag)
const TestUserRepo = testLayer(UserRepoTag, mockUserRepo);

// Run test
const result = await Effect.runPromise(pipe(program, Effect.provide(TestUserRepo)));

// Verify calls
assertCalled(mockUserRepo, "getUser", ["123"]);
```

`succeedMock(v)`, `failMock(e)` and `dieMock(d)` return mocks whose result is a real
`Effect.succeed`/`Effect.fail`/`Effect.die`. Combine multiple test layers with `combineLayers(...)`
(`Layer.mergeAll`), and assert call behavior with `assertNotCalled(mock, method)` and `assertCalledTimes(mock, method, n)`.

---

## Do-Notation

Enhanced do-notation with proper E/R type inference. One import is the whole setup:

```typescript
import "@typesugar/effect/syntax/do";
```

This activates the `let:/seq:/par:/all:` label syntax (PEP-052) AND brings the Effect `FlatMap`/`ParCombine` instances into scope — instance resolution is scope-based, so this marker replaces the old global registration. (It re-exports the std builtin instances too, so mixed Effect + Promise files need only this one import.) Error and requirement types accumulate correctly:

```typescript
let: {
  user << getUserById(id); // Effect<User, NotFound, UserRepo>
  posts << getPosts(user.id); // Effect<Post[], DbError, PostRepo>
}
yield: ({ user, posts });

// Result: Effect<{ user, posts }, NotFound | DbError, UserRepo | PostRepo>
```

`par:` over Effect joins independent effects with `Effect.all`:

```typescript
par: {
  user << getUser(id);
  config << getConfig();
}
yield: ({ user, config });

// Compiles to:
// Effect.map(Effect.all([getUser(id), getConfig()]), ([user, config]) => ({ user, config }))
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
// Generates:
//   export const PointEqual = (self: Point, that: Point): boolean =>
//     Equal.equals(self["x"], that["x"]) && Equal.equals(self["y"], that["y"]);   // an Equivalence<Point>
//   export const PointHash = (self: Point): number =>
//     Hash.combine(Hash.hash(self["y"]))(Hash.combine(Hash.hash(self["x"]))(Hash.string("Point")));
```

Effect 3's `Equal`/`Hash` are interfaces a value implements on itself, not type-class instances,
so these derives produce an `Equivalence` and a hash function rather than `Equal.Equal<T>` objects.
`@derive(EffectSchema)` references other types' schemas via `Schema.suspend(() => XSchema)`, so
recursive types work; a discriminated union must be declared from named variant types
(`type Shape = Circle | Rect`).

---

## API Reference

### Service & Layer

| Export                    | Description                                                 |
| ------------------------- | ----------------------------------------------------------- |
| `@service`                | Generate Context.Tag and accessors                          |
| `@layer(Service, opts?)`  | Create layer with dependency tracking                       |
| `layerMake<R>(...layers)` | ZIO-style explicit wiring from listed layers                |
| `resolveLayer<R>(opts?)`  | Implicit wiring from `@layer` registrations in import scope |
| `formatDebugTree()`       | Format resolved graph as a tree string (`/macros` only)     |
| `serviceRegistry`         | Registered services (`/macros` only)                        |
| `layerRegistry`           | Registered layers (`/macros` only)                          |

The last three are exported from `@typesugar/effect/macros`, not the package root.

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

| Code      | Category            | Severity | Description                          | Status  |
| --------- | ------------------- | -------- | ------------------------------------ | ------- |
| EFFECT001 | Service Resolution  | error    | No layer provides required service   | Emitted |
| EFFECT002 | Service Resolution  | error    | Layer provides wrong service type    | Planned |
| EFFECT003 | Service Resolution  | warning  | Multiple layers provide same service | Planned |
| EFFECT010 | Error Completeness  | warning  | Unhandled error types                | Planned |
| EFFECT011 | Error Completeness  | info     | Redundant error handler              | Planned |
| EFFECT020 | Layer Dependency    | error    | Circular layer dependency            | Emitted |
| EFFECT021 | Layer Dependency    | info     | Unused layer in composition          | Planned |
| EFFECT030 | Schema Drift        | error    | Schema/type drift detected           | Planned |
| EFFECT040 | Type Simplification | info     | Type could be simplified             | Planned |

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

| Export                  | Description               |
| ----------------------- | ------------------------- |
| `@derive(EffectSchema)` | Generate Schema.Struct    |
| `@derive(EffectEqual)`  | Generate an `Equivalence` |
| `@derive(EffectHash)`   | Generate a hash function  |

---

## How It Works

`@typesugar/effect` uses TypeScript's compiler API to:

1. **Analyze** Effect patterns at compile time
2. **Transform** abstractions into direct code
3. **Report** wiring errors (missing layers, cycles) at compile time
4. **Preserve** Effect's runtime semantics (fibers, interruption, scheduling)

The optimization removes **abstraction overhead** while keeping **runtime behavior** intact. Your code runs on Effect's full fiber runtime — just faster.

---

## Learn More

- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/effect)
- [API Reference](/reference/packages#effect)
