# ttfx

> Type-safe macros for TypeScript — compile-time metaprogramming without the footguns.

## What is ttfx?

ttfx is a macro system for TypeScript that runs at compile time. Write expressive, high-level code that expands to efficient, type-safe JavaScript. No runtime overhead, no magic strings, no loss of type safety.

## Quick Example

```typescript
import { comptime } from "@ttfx/comptime";
import { derive } from "@ttfx/derive";
import { sql } from "@ttfx/sql";

// Compile-time evaluation
const buildTime = comptime(new Date().toISOString());

// Auto-generated implementations
@derive(Eq, Clone, Debug, Json)
class User {
  constructor(
    public id: number,
    public name: string,
  ) {}
}

// Type-safe SQL with compile-time validation
const query = sql`SELECT * FROM users WHERE id = ${userId}`;
```

## Features

- **Expression Macros** — `comptime()`, `typeInfo<T>()`, `summon<T>()`
- **Attribute Macros** — `@derive()`, `@reflect`, `@operators()`
- **Tagged Templates** — `sql\`\``, `regex\`\``, `html\`\``
- **Labeled Blocks** — `let: { } yield: { }`
- **Type Macros** — `Refined<T>`, `Opaque<T>`, `Phantom<S, T>`

## Getting Started

```bash
npm install @ttfx/ttfx @ttfx/transformer
```

See the [Getting Started Guide](./getting-started.md) for detailed setup instructions.

## Packages

### Core

| Package                                       | Description                  |
| --------------------------------------------- | ---------------------------- |
| [@ttfx/transformer](./packages/transformer)   | Core TypeScript transformer  |
| [@ttfx/core](./packages/core)                 | Macro registration and types |
| [@ttfx/ttfx](./packages/ttfx)                 | Umbrella package             |
| [unplugin-ttfx](./packages/unplugin-ttfx)     | Bundler plugins              |

### Macros

| Package                                   | Description                 |
| ----------------------------------------- | --------------------------- |
| [@ttfx/comptime](./packages/comptime)     | Compile-time evaluation     |
| [@ttfx/derive](./packages/derive)         | Auto-derive implementations |
| [@ttfx/reflect](./packages/reflect)       | Type reflection             |
| [@ttfx/operators](./packages/operators)   | Operator overloading        |
| [@ttfx/typeclass](./packages/typeclass)   | Scala-style typeclasses     |
| [@ttfx/specialize](./packages/specialize) | Zero-cost specialization    |

### Domain-Specific

| Package                                     | Description                         |
| ------------------------------------------- | ----------------------------------- |
| [@ttfx/sql](./packages/sql)                 | Type-safe SQL                       |
| [@ttfx/strings](./packages/strings)         | String validation macros            |
| [@ttfx/units](./packages/units)             | Physical units                      |
| [@ttfx/type-system](./packages/type-system) | Advanced types (HKT, Newtype, etc.) |
| [@ttfx/fp](./packages/fp)                   | Functional programming              |

### Adapters

| Package                                           | Description           |
| ------------------------------------------------- | --------------------- |
| [@ttfx/effect](./packages/effect) | Effect-TS integration |
| [@ttfx/kysely](./packages/kysely) | Kysely integration    |
| [@ttfx/react](./packages/react)                   | React macros          |
| [@ttfx/testing](./packages/testing)               | Testing macros        |

## Documentation

- [Getting Started](./getting-started.md)
- [Macro Types](./macro-types.md)
- [Writing Macros](./writing-macros.md)
- [Architecture](./architecture.md)
- [FAQ](./faq.md)

## License

MIT
