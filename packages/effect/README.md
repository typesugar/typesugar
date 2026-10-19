# @typesugar/effect

> 📖 **Full documentation:** [Effect-TS Integration guide](https://typesugar.org/guides/effect). The microsite is the canonical reference; this README is a quickstart.

Zero-boilerplate services, automatic layer wiring, and compile-time optimization for Effect-TS.

## Installation

```bash
npm install @typesugar/effect effect
```

## Quick Start

```typescript
import { Effect } from "effect";
import { service, layer, layerMake } from "@typesugar/effect";

@service
interface Database {
  query(sql: string): Effect.Effect<string>;
}

@service
interface UserRepo {
  findById(id: string): Effect.Effect<string>;
}

@layer(Database)
const databaseLive = {
  query: (sql: string) => Effect.succeed("rows for " + sql),
};

@layer(UserRepo, { requires: [Database] })
const userRepoLive = Effect.gen(function* () {
  const db = yield* DatabaseTag; // @service generates DatabaseTag
  return { findById: (id: string) => db.query("SELECT " + id) };
});

// Wires userRepoLive's Database requirement to databaseLive
const appLayer = layerMake<UserRepo | Database>(userRepoLive, databaseLive);

const program = Effect.flatMap(UserRepoTag, (repo) => repo.findById("42"));
Effect.runSync(Effect.provide(program, appLayer)); // "rows for SELECT 42"
```

`@service` generates a `Context.Tag` class (`DatabaseTag`) and a `Database` namespace of
accessors. `@layer` wraps the const in `Layer.succeed` / `Layer.effect`, and `layerMake`
composes the layers in dependency order (here
`userRepoLive.pipe(Layer.provideMerge(databaseLive))`). A missing layer is a compile error:
``[EFFECT001] No layer provides `Database` ``.

## Documentation

- [Effect-TS Integration guide](https://typesugar.org/guides/effect) — full reference
- [API Reference](https://typesugar.org/reference/packages#effect)
