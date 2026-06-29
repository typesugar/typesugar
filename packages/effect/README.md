# @typesugar/effect

> 📖 **Full documentation:** [Effect-TS Integration guide](https://typesugar.org/guides/effect). The microsite is the canonical reference; this README is a quickstart.

Zero-boilerplate services, automatic layer wiring, and compile-time optimization for Effect-TS.

## Installation

```bash
npm install @typesugar/effect effect
```

## Quick Start

```typescript
import { service, layer, layerMake, compiled } from "@typesugar/effect";
import { Effect } from "effect";

@service
interface UserRepo {
  findById(id: string): Effect.Effect<User, NotFound>;
}

@layer(UserRepo, { requires: [Database] })
const userRepoLive =
let: { db << Database; }
yield: ({ findById: (id) => db.query(sql`SELECT * FROM users WHERE id = ${id}`) });

const appLayer = layerMake<UserRepo | Database>(userRepoLive, databaseLive);
```

## Documentation

- [Effect-TS Integration guide](https://typesugar.org/guides/effect) — full reference
- [API Reference](https://typesugar.org/reference/packages#effect)
