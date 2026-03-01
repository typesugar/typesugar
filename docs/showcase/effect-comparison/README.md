# @typesugar/effect Showcase

> Side-by-side comparisons showing how typesugar improves Effect-TS code.

This showcase demonstrates the **zero-cost optimizations** and **developer experience improvements** that `@typesugar/effect` brings to Effect-TS applications.

## What's Inside

| Example                                      | What it Shows                                          |
| -------------------------------------------- | ------------------------------------------------------ |
| [http-server/](./http-server/)               | Service definitions, layers, and automatic composition |
| [validation/](./validation/)                 | Schema validation with compile-time specialization     |
| [generator-overhead/](./generator-overhead/) | Effect.gen optimization with `@compiled`               |

---

## Quick Overview

### Before: Plain Effect-TS

```typescript
// Boilerplate for every service
class UserRepo extends Context.Tag("UserRepo")<
  UserRepo,
  {
    readonly findById: (id: string) => Effect.Effect<User | null, DbError>;
    readonly save: (user: User) => Effect.Effect<User, DbError>;
  }
>() {}

// Manual layer wiring
const UserRepoLive = Layer.effect(
  UserRepo,
  Effect.gen(function* () {
    const db = yield* Database;
    return {
      findById: (id) => db.query(`SELECT * FROM users WHERE id = $1`, [id]),
      save: (user) => db.query(`INSERT INTO users ...`, [user]),
    };
  })
);

// Manual layer composition
const AppLayer = UserRepoLive.pipe(Layer.provide(DatabaseLive), Layer.provide(LoggerLive));
```

### After: With @typesugar/effect

```typescript
// Clean interface — macro generates Tag and accessors
@service
interface UserRepo {
  findById(id: string): Effect.Effect<User | null, DbError>
  save(user: User): Effect.Effect<User, DbError>
}

// Declarative dependencies — macro wraps in Layer.effect
@layer(UserRepo, { requires: [Database] })
const userRepoLive =
let: {
  db << Database;
}
yield: ({
  findById: (id) => db.query(`SELECT * FROM users WHERE id = $1`, [id]),
  save: (user) => db.query(`INSERT INTO users ...`, [user]),
});

// Automatic resolution — analyzes dependency graph
const AppLayer = resolveLayer<UserRepo | Logger>()
```

---

## Zero-Cost Guarantee

Every optimization compiles away completely:

| Feature              | Before (runtime)                    | After (compiled)       |
| -------------------- | ----------------------------------- | ---------------------- |
| `@compiled`          | Generator protocol, `.next()` calls | Direct `flatMap` chain |
| `@fused`             | Intermediate Effect allocations     | Single fused operation |
| `specializeSchema()` | Combinator tree walk                | Direct type checks     |
| `@service`           | Same as plain Effect                | Same as plain Effect   |
| `@layer`             | Same as plain Effect                | Same as plain Effect   |

The macros transform your code at compile time. **At runtime, there's no typesugar — just optimized Effect code.**

---

## Rich Diagnostics

When things go wrong, you get Rust-quality error messages:

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
```

---

## Examples in Detail

### 1. HTTP Server with Services

**[http-server/before.ts](./http-server/before.ts)** — Standard Effect-TS patterns
**[http-server/after.ts](./http-server/after.ts)** — Same functionality with @typesugar/effect

Shows:

- `@service` eliminates Context.Tag boilerplate
- `@layer` with declarative dependencies
- `resolveLayer<R>()` for automatic composition
- Rich error messages when layers are missing

### 2. Schema Validation

**[validation/before.ts](./validation/before.ts)** — Runtime Schema decoding
**[validation/after.ts](./validation/after.ts)** — Compile-time specialized validators

Shows:

- `specializeSchema()` generates direct type checks
- No combinator tree walk at runtime
- Same types, zero overhead

### 3. Generator Overhead

**[generator-overhead/before.ts](./generator-overhead/before.ts)** — Effect.gen with generator protocol
**[generator-overhead/after.ts](./generator-overhead/after.ts)** — `@compiled` direct flatMap chains

Shows:

- `@compiled` eliminates generator object allocation
- Nested generators become nested flatMap
- `@fused` combines consecutive operations

---

## Try It Yourself

```bash
# Install
npm install @typesugar/effect effect

# Run the examples
cd docs/showcase/effect-comparison
npx ts-node http-server/after.ts

# See the compiled output
npx typesugar compile http-server/after.ts --emit
```

---

## Expected Performance Impact

The optimizations eliminate specific categories of overhead:

| Optimization         | What's Eliminated                                      | Expected Impact                                |
| -------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| `@compiled`          | Generator protocol (iterator objects, `.next()` calls) | Reduced allocation per `Effect.gen` call       |
| `@fused`             | Intermediate Effect objects in pipeline chains         | Fewer allocations proportional to chain length |
| `specializeSchema()` | Combinator tree walk for each validation               | Direct field checks instead of tree traversal  |

Actual improvement depends on your workload. CPU-bound code with tight Effect loops benefits most; I/O-bound code where network latency dominates will see minimal difference.

---

## When to Use @typesugar/effect

**Use it when:**

- You want cleaner service/layer definitions
- Performance matters (high-throughput APIs, hot paths)
- You want better error messages during development

**Skip it if:**

- You're just prototyping (plain Effect is fine)
- Your app is I/O bound (network latency dominates)
- You prefer explicit over implicit

The beauty is you can adopt incrementally — `@compiled` works on individual functions, `specializeSchema()` on specific schemas.
