# typesugar

**Syntactic sugar for TypeScript with zero calories.**

Operators and methods that just work, compiled to exactly what you'd write by hand.

typesugar brings compile-time metaprogramming to TypeScript, drawing from the best ideas in Rust, Scala 3, and Zig — and making them feel native to the TypeScript ecosystem.

**[Get Started](https://typesugar.org/getting-started/)** | **[Try it in the Playground](https://typesugar.org/playground)**

```typescript
// Define your types
interface User {
  id: number;
  name: string;
  email: string;
}

const alice: User = { id: 1, name: "Alice", email: "alice@example.com" };
const bob: User = { id: 2, name: "Bob", email: "bob@example.com" };

// Operators just work — auto-derived, auto-specialized
alice === bob; // Compiles to: alice.id === bob.id && alice.name === bob.name && ...
alice < bob; // Lexicographic comparison

// Methods just work too
alice.show(); // "User(id = 1, name = Alice, email = alice@example.com)"
alice.clone(); // Deep copy
alice.toJson(); // JSON serialization
```

**How it works:** The compiler sees `===` on a `User`, resolves the `Eq` typeclass, auto-derives an instance from the type's fields, and inlines the comparison directly — no dictionary lookup, no runtime cost.

## Inspired by the Best

typesugar draws from the best ideas across language ecosystems:

| Language     | What it brings                                             | Packages                                                 |
| ------------ | ---------------------------------------------------------- | -------------------------------------------------------- |
| Scala 3      | Typeclasses, extension methods, do-notation                | typeclass, std, fp, effect, operators                    |
| Rust         | Derive macros, zero-cost specialization, serde, dyn Trait  | derive, specialize, codec, erased, validate              |
| Zig          | Compile-time evaluation and reflection                     | comptime, reflect, preprocessor                          |
| C++ / Boost  | Expression templates, heterogeneous containers, parsers    | fusion, hlist, graph, parser, units                      |
| Haskell / ML | Refinement types, type-level programming, property testing | contracts, contracts-refined, type-system, testing, math |

## Packages

### Build Infrastructure

| Package                                           | Description                                      |
| ------------------------------------------------- | ------------------------------------------------ |
| [typesugar](packages/typesugar)                   | Umbrella package                                 |
| [@typesugar/core](packages/core)                  | Macro registration and types                     |
| [@typesugar/macros](packages/macros)              | Built-in macro implementations                   |
| [@typesugar/transformer](packages/transformer)    | TypeScript transformer (ts-patch)                |
| [@typesugar/preprocessor](packages/preprocessor)  | Lexical preprocessor for custom syntax           |
| [unplugin-typesugar](packages/unplugin-typesugar) | Bundler plugins (Vite, esbuild, Rollup, Webpack) |
| [@typesugar/ts-plugin](packages/ts-plugin)        | TypeScript language service plugin               |

### Standard Library

| Package                        | Description                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| [@typesugar/std](packages/std) | Extension methods, exhaustive pattern matching, do-notation (let:/seq:, par:/all:), standard typeclasses |

### Typeclasses & Derivation

| Package                                      | Description                                          |
| -------------------------------------------- | ---------------------------------------------------- |
| [@typesugar/typeclass](packages/typeclass)   | `@typeclass`, `@instance`, `summon()`                |
| [@typesugar/derive](packages/derive)         | `@derive(Eq, Clone, Debug, Json, ...)`               |
| [@typesugar/specialize](packages/specialize) | Zero-cost typeclass specialization                   |
| [@typesugar/reflect](packages/reflect)       | `typeInfo<T>()`, `fieldNames<T>()`, `validator<T>()` |

### Syntax Sugar

| Package                                | Description                             |
| -------------------------------------- | --------------------------------------- |
| [@typesugar/strings](packages/strings) | `regex`, `html`, `raw` tagged templates |

### Type Safety & Contracts

| Package                                                    | Description                                |
| ---------------------------------------------------------- | ------------------------------------------ |
| [@typesugar/type-system](packages/type-system)             | Refined types, newtype, HKT, phantom types |
| [@typesugar/contracts](packages/contracts)                 | `requires:`, `ensures:`, `@invariant`      |
| [@typesugar/contracts-refined](packages/contracts-refined) | Refinement type integration                |
| [@typesugar/validate](packages/validate)                   | Schema validation macros                   |
| [@typesugar/units](packages/units)                         | Type-safe physical units                   |

### Data Structures & Algorithms

| Package                                        | Description                                     |
| ---------------------------------------------- | ----------------------------------------------- |
| [@typesugar/fp](packages/fp)                   | Option, Either, IO, Result, List                |
| [@typesugar/hlist](packages/hlist)             | Heterogeneous lists (Boost.Fusion)              |
| [@typesugar/fusion](packages/fusion)           | Iterator fusion, expression templates (Blitz++) |
| [@typesugar/parser](packages/parser)           | PEG parser generation (Boost.Spirit)            |
| [@typesugar/collections](packages/collections) | Collection typeclasses, HashSet, HashMap        |
| [@typesugar/graph](packages/graph)             | GraphLike typeclass, algorithms, state machines |
| [@typesugar/erased](packages/erased)           | Type erasure / dyn Trait                        |
| [@typesugar/codec](packages/codec)             | Versioned codecs, schema evolution              |
| [@typesugar/math](packages/math)               | Math types and typeclasses                      |
| [@typesugar/mapper](packages/mapper)           | Zero-cost object mapping                        |
| [@typesugar/symbolic](packages/symbolic)       | Symbolic math, calculus, simplification         |

### Ecosystem Integrations

| Package                              | Description                              |
| ------------------------------------ | ---------------------------------------- |
| [@typesugar/effect](packages/effect) | Effect-TS services, layers, optimization |
| [@typesugar/sql](packages/sql)       | Doobie-like SQL DSL                      |

### Developer Experience

| Package                                                | Description                        |
| ------------------------------------------------------ | ---------------------------------- |
| [@typesugar/vscode](packages/vscode)                   | VS Code/Cursor extension           |
| [@typesugar/eslint-plugin](packages/eslint-plugin)     | ESLint processor and rules         |
| [@typesugar/prettier-plugin](packages/prettier-plugin) | Prettier formatting                |
| [@typesugar/testing](packages/testing)                 | Power assertions, property testing |

## Getting Started

```bash
npm install typesugar @typesugar/transformer
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

## File Extensions: `.ts` vs `.sts`

typesugar supports two file extensions:

| Extension        | Preprocessor | Custom Syntax                                                 |
| ---------------- | ------------ | ------------------------------------------------------------- |
| `.ts` / `.tsx`   | No           | JSDoc macros only (`/** @typeclass */`, `let:`, `comptime()`) |
| `.sts` / `.stsx` | Yes          | Full syntax (`\|>`, `::`, `F<_>`, `@typeclass` on interfaces) |

**Use `.ts`** for files that only use JSDoc-style macros — these work with plain `tsc` and all TypeScript tools.

**Use `.sts`** for files that use custom operators or syntax that would be invalid in standard TypeScript:

```typescript
// math.sts — needs preprocessor for |> operator
const result = data
  |> filter(x => x > 0)
  |> map(x => x * 2)
  |> sum;

// functor.sts — needs preprocessor for HKT syntax
type Functor<F<_>> = {
  map: <A, B>(fa: F<A>, f: (a: A) => B) => F<B>;
};
```

Add `.sts` files to your tsconfig.json:

```json
{
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.sts", "src/**/*.stsx"]
}
```

See the [migration guide](docs/migration/sts-migration.md) for details on converting existing files.

## Features

### Compile-Time Powers

_Run code at build time, not at runtime_

```typescript
import { comptime } from "typesugar";

const fib10 = comptime(() => {
  const fib = (n: number): number => (n <= 1 ? n : fib(n - 1) + fib(n - 2));
  return fib(10);
}); // Compiles to: const fib10 = 55;
```

### Zero-Cost Typeclasses

_Typeclasses, monads, and proofs — for the nerds_

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

### Standard Library

_TypeScript's missing standard library_

Any function whose first parameter matches the receiver type can be called as a method — Scala 3-style UFCS (Uniform Function Call Syntax):

```typescript
import { clamp, isEven, abs } from "@typesugar/std";

// These functions take `number` as their first parameter
// So they can be called as methods on numbers:
const n = -42;
n.abs(); // → Math.abs(n) → 42
n.clamp(0, 100); // → clamp(n, 0, 100) → 0
(7).isEven(); // → isEven(7) → false

// Works for any type!
import { head, tail, chunk } from "@typesugar/std";

const arr = [1, 2, 3, 4, 5];
arr.head(); // → 1
arr.tail(); // → [2, 3, 4, 5]
arr.chunk(2); // → [[1, 2], [3, 4], [5]]
```

For library authors — mark your functions as extensions explicitly:

```typescript
"use extension"; // All exports in this file become extension methods

export function distance(p: Point, other: Point): number {
  return Math.sqrt((p.x - other.x) ** 2 + (p.y - other.y) ** 2);
}

// Users can now write: p1.distance(p2)
```

### Syntax Sugar

_Custom language features that compile away_

```typescript
import { sql } from "@typesugar/sql";
import { regex, html } from "@typesugar/strings";
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

Operators resolve to typeclass methods automatically:

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

```

### Framework Adapters

_Supercharge your existing tools_

#### Effect-TS

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

- **[Interactive Playground](https://typesugar.org/playground)** — Try typesugar in your browser with full runtime library support (`@typesugar/fp`, `@typesugar/collections`, `@typesugar/graph`, and more)
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

_When something goes wrong, you should know exactly what happened and how to fix it._

### Rust-Style Errors

Every error shows the code, points at the problem, and suggests a fix:

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

Look up any error: `npx typesugar --explain TS9001`

### Import Suggestions

Missing an import? typesugar tells you where to find it:

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

### Opt-Out When You Need To

```typescript
"use no typesugar";             // whole file
function debug() { "use no typesugar"; }  // one function
specialize(add); // @ts-no-typesugar      // one line
("use no typesugar extensions");          // just extensions
```

### Tooling That Just Works

- **ESLint** — `@typesugar/eslint-plugin` understands that typesugar imports are consumed by the transformer
- **Language service** — the TypeScript plugin suppresses false `TS6133` warnings for typesugar imports
- **Organize imports** — works correctly because the tools understand which imports the transformer consumes

No configuration needed. Install the plugin and everything cooperates.

## License

MIT
