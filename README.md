# typesugar

**TypeScript that F\*cks! Compile-time macros. Zero runtime. Full type safety.**

> _What if `===` just knew how to compare your types? What if `.show()` worked on any struct? What if it all compiled to exactly what you'd write by hand?_

typesugar brings compile-time metaprogramming to TypeScript, drawing from the best ideas in Rust, Scala 3, and Zig — and making them feel native to the TypeScript ecosystem.

```typescript
// Define your types — no decorators needed
interface User {
  id: number;
  name: string;
  email: string;
}

const alice: User = { id: 1, name: "Alice", email: "alice@example.com" };
const bob: User = { id: 2, name: "Bob", email: "bob@example.com" };

// Operators just work — auto-derived, auto-specialized to zero-cost
alice === bob; // false (compiles to: alice.id === bob.id && ...)
alice < bob; // true  (lexicographic field comparison)

// Methods just work too
alice.show(); // "User(id = 1, name = Alice, email = alice@example.com)"
alice.clone(); // deep copy
alice.toJson(); // JSON serialization

// All compile to direct code — no runtime dictionary, no overhead
```

## Why typesugar?

| Feature                  | typesugar                              | ts-macros               | Babel macros |
| ------------------------ | -------------------------------------- | ----------------------- | ------------ |
| **Implicit typeclasses** | `===`, `.show()` just work             | No                      | No           |
| **Zero-cost**            | Auto-specialized to direct code        | No                      | No           |
| **Type-aware**           | Yes — reads the type checker           | No                      | No           |
| **Compile-time eval**    | Full JS via `vm` sandbox               | `$comptime` (similar)   | No           |
| **Tagged templates**     | First-class macro category             | Via expression macros   | No           |
| **Reflection**           | `typeInfo<T>()`, `validator<T>()`      | No                      | No           |
| **Operator overloading** | `+`, `*`, etc. via typeclass instances | No                      | No           |
| **Safety**               | Sandboxed, timeout, loud failures      | `$raw` runs unsandboxed | N/A          |

## Packages

### Build Infrastructure

| Package                                           | Description                                      |
| ------------------------------------------------- | ------------------------------------------------ |
| [typesugar](packages/typesugar)                   | Umbrella package                                 |
| [@typesugar/core](packages/core)                  | Macro registration and types                     |
| [@typesugar/transformer](packages/transformer)    | TypeScript transformer (ts-patch)                |
| [@typesugar/preprocessor](packages/preprocessor)  | Lexical preprocessor for custom syntax           |
| [unplugin-typesugar](packages/unplugin-typesugar) | Bundler plugins (Vite, esbuild, Rollup, Webpack) |
| [@typesugar/ts-plugin](packages/ts-plugin)        | TypeScript language service plugin               |

### Standard Library

| Package                        | Description                                                            |
| ------------------------------ | ---------------------------------------------------------------------- |
| [@typesugar/std](packages/std) | Extension methods, pattern matching, do-notation, standard typeclasses |

### Typeclasses & Derivation

| Package                                      | Description                                          |
| -------------------------------------------- | ---------------------------------------------------- |
| [@typesugar/typeclass](packages/typeclass)   | `@typeclass`, `@instance`, `summon()`                |
| [@typesugar/derive](packages/derive)         | `@derive(Eq, Clone, Debug, Json, ...)`               |
| [@typesugar/specialize](packages/specialize) | Zero-cost typeclass specialization                   |
| [@typesugar/reflect](packages/reflect)       | `typeInfo<T>()`, `fieldNames<T>()`, `validator<T>()` |

### Syntax Sugar

| Package                                      | Description                              |
| -------------------------------------------- | ---------------------------------------- |
| [@typesugar/operators](packages/operators)   | `@operators()`, `ops()`, `pipe()`        |
| [@typesugar/strings](packages/strings)       | `regex`, `html`, `json` tagged templates |
| [@typesugar/named-args](packages/named-args) | Kotlin-style named function arguments    |
| [@typesugar/comptime](packages/comptime)     | `comptime()` compile-time evaluation     |

### Type Safety & Contracts

| Package                                                    | Description                                |
| ---------------------------------------------------------- | ------------------------------------------ |
| [@typesugar/type-system](packages/type-system)             | Refined types, newtype, HKT, phantom types |
| [@typesugar/contracts](packages/contracts)                 | `requires:`, `ensures:`, `@invariant`      |
| [@typesugar/contracts-refined](packages/contracts-refined) | Refinement type integration                |
| [@typesugar/contracts-z3](packages/contracts-z3)           | Z3 SMT solver proofs                       |
| [@typesugar/validate](packages/validate)                   | Schema validation macros                   |
| [@typesugar/units](packages/units)                         | Type-safe physical units                   |

### Data Structures & Algorithms

| Package                                  | Description                                     |
| ---------------------------------------- | ----------------------------------------------- |
| [@typesugar/fp](packages/fp)             | Option, Either, IO, Result, List                |
| [@typesugar/hlist](packages/hlist)       | Heterogeneous lists (Boost.Fusion)              |
| [@typesugar/fusion](packages/fusion)     | Iterator fusion, expression templates (Blitz++) |
| [@typesugar/parser](packages/parser)     | PEG parser generation (Boost.Spirit)            |
| [@typesugar/graph](packages/graph)       | Graph algorithms, state machines (Boost.Graph)  |
| [@typesugar/erased](packages/erased)     | Type erasure / dyn Trait                        |
| [@typesugar/codec](packages/codec)       | Versioned codecs, schema evolution              |
| [@typesugar/geometry](packages/geometry) | Type-safe geometry (Boost.Geometry)             |
| [@typesugar/math](packages/math)         | Math types and typeclasses                      |
| [@typesugar/mapper](packages/mapper)     | Zero-cost object mapping                        |
| [@typesugar/symbolic](packages/symbolic) | Symbolic math, calculus, simplification         |

### Ecosystem Integrations

| Package                                        | Description                 |
| ---------------------------------------------- | --------------------------- |
| [@typesugar/effect](packages/effect)           | Effect-TS adapter           |
| [@typesugar/react](packages/react)             | Vue/Svelte-style reactivity |
| [@typesugar/sql](packages/sql)                 | Doobie-like SQL DSL         |
| [@typesugar/kysely-adapter](packages/kysely)   | Kysely integration          |
| [@typesugar/drizzle-adapter](packages/drizzle) | Drizzle integration         |

### Developer Experience

| Package                                                | Description                        |
| ------------------------------------------------------ | ---------------------------------- |
| [@typesugar/vscode](packages/vscode)                   | VS Code/Cursor extension           |
| [@typesugar/eslint-plugin](packages/eslint-plugin)     | ESLint processor and rules         |
| [@typesugar/prettier-plugin](packages/prettier-plugin) | Prettier formatting                |
| [@typesugar/testing](packages/testing)                 | Power assertions, property testing |

## Getting Started

```bash
npm install @typesugar/typesugar @typesugar/transformer
```

### Vite

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [typesugar()],
});
```

### ts-patch (for tsc)

```bash
npm install -D ts-patch
npx ts-patch install
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "plugins": [{ "transform": "@typesugar/transformer" }]
  }
}
```

## Features

### Compile-Time Evaluation

```typescript
import { comptime } from "@typesugar/comptime";

const fib10 = comptime(() => {
  const fib = (n: number): number => (n <= 1 ? n : fib(n - 1) + fib(n - 2));
  return fib(10);
}); // Compiles to: const fib10 = 55;
```

### Zero-Cost Typeclasses

Typeclasses are auto-derived from type structure and auto-specialized to eliminate overhead:

```typescript
interface Point { x: number; y: number }

const p1: Point = { x: 1, y: 2 };
const p2: Point = { x: 1, y: 2 };

// Just use them — the compiler handles derivation + specialization
p1 === p2;    // Compiles to: p1.x === p2.x && p1.y === p2.y
p1.show();    // Compiles to: `Point(x = ${p1.x}, y = ${p1.y})`
p1.clone();   // Compiles to: { x: p1.x, y: p1.y }

// Optional: @derive documents capabilities in the type definition
@derive(Show, Eq, Ord, Clone, Json)
interface User { id: number; name: string; }
```

### Type Reflection

```typescript
import { typeInfo, fieldNames, validator } from "@typesugar/reflect";

const fields = fieldNames<User>(); // ["id", "name", "email"]
const validate = validator<User>(); // Runtime validator from types
```

### Tagged Templates

```typescript
import { sql } from "@typesugar/sql";
import { regex, html, json } from "@typesugar/strings";
import { units } from "@typesugar/units";

const query = sql`SELECT * FROM ${table} WHERE id = ${id}`;
const pattern = regex`^[a-zA-Z]+$`; // Validated at compile time
const markup = html`<div>${userInput}</div>`; // XSS-safe
const speed = units`100 km/h`; // Dimensional analysis
```

### Typeclasses (Advanced)

For library authors — define new typeclasses that integrate with implicit resolution:

```typescript
import { typeclass, instance } from "@typesugar/typeclass";

// Define a typeclass
@typeclass
interface Serialize<A> {
  serialize(a: A): Uint8Array;
  deserialize(bytes: Uint8Array): A;
}

// Provide a custom instance when needed
@instance
const serializePoint: Serialize<Point> = {
  serialize: (p) => new Uint8Array([p.x, p.y]),
  deserialize: (b) => ({ x: b[0], y: b[1] }),
};

// Now it just works
const bytes = myPoint.serialize();  // Uses custom instance, zero-cost
```

### Operator Overloading

Standard operators resolve to typeclass methods automatically:

```typescript
interface Vec2 { x: number; y: number }

// Define how Vec2 handles + via the Semigroup typeclass
@instance
const vec2Semigroup: Semigroup<Vec2> = {
  combine: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
};

// Now + just works on Vec2
const a: Vec2 = { x: 1, y: 2 };
const b: Vec2 = { x: 3, y: 4 };
const c = a + b;  // Compiles to: { x: a.x + b.x, y: a.y + b.y }

// Custom operators for domain-specific types
@operators({ "*": "scale" })
class Matrix { /* ... */ }
```

### Effect-TS Integration

```typescript
import { service, layer, resolveLayer, EffectSchema } from "@typesugar/effect";
import { Effect } from "effect";

// Zero-boilerplate services
@service
interface UserRepo {
  findById(id: string): Effect.Effect<User, NotFound>
}

// Layers with dependency tracking
@layer(UserRepo, { requires: [Database] })
const userRepoLive =
let: {
  db << Database;
}
yield: ({ findById: (id) => db.query(...) })

// Automatic layer composition
const runnable = program.pipe(
  Effect.provide(resolveLayer<UserRepo | EmailService>())
);

// Auto-derive Effect Schema
@derive(EffectSchema)
interface User { id: string; name: string; }
// Generates: export const UserSchema = Schema.Struct({ ... })
```

## Documentation

See the [docs/](docs/) directory:

- [Getting Started](docs/getting-started.md)
- [Macro Types](docs/macro-types.md)
- [Writing Macros](docs/writing-macros.md)
- [Architecture](docs/architecture.md)
- [FAQ](docs/faq.md)
- [Vision](docs/vision/index.md) — Future features (reactivity, components, Fx effects, Effect-TS integration)

## Safety

- **Sandboxed** — `comptime` runs in a restricted `vm` context (no filesystem, network, or process access)
- **Timeout** — 5-second limit on compile-time evaluation
- **Loud failures** — failed expansions emit `throw new Error(...)` so bugs are never silent
- **Diagnostics** — all errors flow through the TypeScript diagnostic pipeline

## Developer Experience

### Rust-Style Error Messages

When something goes wrong, typesugar tells you exactly what happened, where, and how to fix it:

```
error[TS9001]: No instance found for `Eq<Color>`
  --> src/palette.ts:12:5
   |
10 |   interface Palette { primary: Color; accent: Color }
11 |
12 |   p1 === p2
   |      ^^^ Eq<Palette> requires Eq for all fields
   |
 8 |   interface Color { r: number; g: number; b: number }
   |   --------- field `primary` has type `Color`
   |
   = note: Auto-derivation requires Eq instances for all fields
   = help: Add @derive(Eq) to Color, or provide @instance Eq<Color>
   = suggestion: add-derive-eq
     + @derive(Eq)
     + interface Color { r: number; g: number; b: number }

For more information, see: https://typesugar.dev/errors/TS9001
```

Every error has a code (TS9001-TS9999), an explanation (`npx typesugar --explain TS9001`), and machine-applicable fixes that your IDE can apply automatically.

For typeclass resolution failures, you get a complete **resolution trace** showing each step attempted and why it failed — including per-field instance checks for auto-derivation. See the [error messages guide](docs/guides/error-messages.md) for details.

### "Did You Mean to Import...?"

Forgot an import? typesugar knows what's available and suggests it:

```
error[TS9061]: Macro `comptime` is not defined
  --> src/app.ts:3:15
   |
 3 |   const x = comptime(() => 1 + 1);
   |             ^^^^^^^
   |
   = help: Did you mean to import?
     + import { comptime } from "typesugar";
```

This works for macros, typeclasses, extension methods — anything in the typesugar ecosystem.

### Opt-Out Escape Hatches

Debugging something? Need to bypass typesugar for one file, one function, or one line?

```typescript
// Whole file — nothing gets transformed
"use no typesugar";

// Just this function
function debugMe() {
  "use no typesugar";
  const x = comptime(() => 1 + 1); // Left as-is
}

// Just this line
const slow = specialize(add); // @ts-no-typesugar

// Just extensions, keep macros working
("use no typesugar extensions");
```

Inspired by React Compiler's `"use no memo"`. See the [opt-out guide](docs/guides/opt-out.md) for all options.

### Tooling That Just Works

- **ESLint** — the `@typesugar/eslint-plugin` processor knows that typesugar imports are used by the transformer, so `no-unused-imports` won't flag them
- **Language service** — the TypeScript plugin suppresses false `TS6133` warnings specifically for typesugar imports (not everything — just typesugar)
- **Organize imports** — works correctly because the tools understand which imports the transformer consumes

No configuration needed. Install the plugin and everything cooperates.

## License

MIT
