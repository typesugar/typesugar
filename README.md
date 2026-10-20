# typesugar

**Syntactic sugar for TypeScript with zero calories.** Typeclasses, operator overloading, pattern matching and more through compile-time macros and zero-cost abstractions.

> _What if `===` just knew how to compare your types? What if `.clone()` worked on any struct? What if it all compiled to exactly what you'd write by hand?_

typesugar brings compile-time metaprogramming to TypeScript, drawing from the best ideas in Rust, Scala 3, and Zig — and making them feel native to the TypeScript ecosystem.

**[Try it in the Playground →](https://typesugar.org/playground)** — No installation required.

```typescript
import { derive, Eq, Ord, Clone, Json } from "typesugar";
// Opt the file into typeclass operator syntax (cats-style) — sugar is never ambient
import "@typesugar/std/syntax/eq/ops";
import "@typesugar/std/syntax/ord/ops";
// Method syntax is its own, quieter opt-in (no native operator is redefined)
import "@typesugar/std/syntax/clone";
import "@typesugar/std/syntax/json";

@derive(Eq, Ord, Clone, Json)
interface User {
  id: number;
  name: string;
  email: string;
}

const alice: User = { id: 1, name: "Alice", email: "alice@example.com" };
const bob: User = { id: 2, name: "Bob", email: "bob@example.com" };

// Operators are activated for this file and an instance is in scope, so they rewrite
alice === bob; // false (compiles to: User.Eq.equals(alice, bob))
alice < bob; // true  (compiles to: User.Ord.lessThan(alice, bob), field by field)

// Method syntax too (activated by its marker import above)
alice.clone(); // copy (compiles to: User.Clone.clone(alice))
alice.toJson(); // JSON-ready plain object (compiles to: User.Json.toJson(alice))

// Each one is a direct call to a function generated at compile time
```

## Why typesugar?

| Feature                  | typesugar                              | ts-macros               | Babel macros |
| ------------------------ | -------------------------------------- | ----------------------- | ------------ |
| **Typeclass syntax**     | `===`, `.equals()` via scoped imports  | No                      | No           |
| **Zero-cost**            | Direct calls; in-file instances inline | No                      | No           |
| **Type-aware**           | Yes — reads the type checker           | No                      | No           |
| **Compile-time eval**    | Full JS via `vm` sandbox               | `$comptime` (similar)   | No           |
| **Tagged templates**     | First-class macro category             | Via expression macros   | No           |
| **Reflection**           | `typeInfo<T>()`, `validator<T>()`      | No                      | No           |
| **Operator overloading** | `+`, `*`, etc. via typeclass instances | No                      | No           |
| **Safety**               | IO off by default, timeout, loud fails | `$raw` runs unsandboxed | N/A          |

**Fast:** with the TS program cached (the editor/watch case), macro transformation
adds **~4 ms for a 50-line file** and **~12 ms for a 200-line file**; `comptime`
evaluates ~6M simple expressions/sec. See [docs/PERFORMANCE.md](docs/PERFORMANCE.md)
(run `pnpm bench` to reproduce).

## Packages

### Build Infrastructure

| Package                                           | Description                                         |
| ------------------------------------------------- | --------------------------------------------------- |
| [typesugar](packages/typesugar)                   | Umbrella package                                    |
| [@typesugar/core](packages/core)                  | Macro registration and types                        |
| [@typesugar/macros](packages/macros)              | Built-in macro implementations                      |
| [@typesugar/transformer](packages/transformer)    | TypeScript transformer (ts-patch, CLI)              |
| [unplugin-typesugar](packages/unplugin-typesugar) | Bundler plugins (Vite, esbuild, Rollup, Webpack)    |
| [@typesugar/ts-plugin](packages/ts-plugin)        | TypeScript language service plugin (editor support) |

### Standard Library

| Package                        | Description                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| [@typesugar/std](packages/std) | Extension methods, exhaustive pattern matching, do-notation (let:/seq:, par:/all:), standard typeclasses |

### Typeclasses & Derivation

| Package                                    | Description                                          |
| ------------------------------------------ | ---------------------------------------------------- |
| [@typesugar/typeclass](packages/typeclass) | `@typeclass`, `@instance`, `summon()`                |
| [@typesugar/derive](packages/derive)       | `@derive(Eq, Clone, Debug, Json, ...)`               |
| [@typesugar/reflect](packages/reflect)     | `typeInfo<T>()`, `fieldNames<T>()`, `validator<T>()` |

### Type Safety & Contracts

| Package                                                    | Description                                |
| ---------------------------------------------------------- | ------------------------------------------ |
| [@typesugar/type-system](packages/type-system)             | Refined types, newtype, HKT, phantom types |
| [@typesugar/contracts](packages/contracts)                 | `requires:`, `ensures:`, `@invariant`      |
| [@typesugar/contracts-refined](packages/contracts-refined) | Refinement type integration                |
| [@typesugar/validate](packages/validate)                   | Schema validation macros                   |

### Data Structures & Algorithms

| Package                              | Description                                     |
| ------------------------------------ | ----------------------------------------------- |
| [@typesugar/fp](packages/fp)         | Option, Either, IO, Result, List                |
| [@typesugar/fusion](packages/fusion) | Iterator fusion, expression templates (Blitz++) |
| [@typesugar/graph](packages/graph)   | GraphLike typeclass, algorithms, state machines |
| [@typesugar/mapper](packages/mapper) | Zero-cost object mapping                        |

### Ecosystem Integrations

| Package                              | Description                              |
| ------------------------------------ | ---------------------------------------- |
| [@typesugar/effect](packages/effect) | Effect-TS services, layers, optimization |
| [@typesugar/sql](packages/sql)       | Doobie-like SQL DSL                      |

### Developer Experience

| Package                                            | Description                           |
| -------------------------------------------------- | ------------------------------------- |
| [typesugar-vscode](packages/vscode)                | VS Code/Cursor extension (not on npm) |
| [@typesugar/eslint-plugin](packages/eslint-plugin) | ESLint processor and rules            |
| [@typesugar/testing](packages/testing)             | Power assertions, property testing    |

### Frozen

Not under active development ([PEP-048](peps/PEP-048-package-triage.md)). These
packages still build and are published, but they are not part of typesugar's
actively maintained surface.

| Package                                        | Description                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| [@typesugar/math](packages/math)               | Math types and typeclasses                                          |
| [@typesugar/units](packages/units)             | Type-safe physical units                                            |
| [@typesugar/parser](packages/parser)           | PEG parser generation                                               |
| [@typesugar/codec](packages/codec)             | Versioned codecs, schema evolution                                  |
| [@typesugar/collections](packages/collections) | HashSet/HashMap (still released — `@typesugar/graph` depends on it) |
| [@typesugar/erased](packages/erased)           | Type erasure / dyn Trait                                            |
| [@typesugar/strings](packages/strings)         | `regex`, `html`, `raw` tagged templates                             |
| [@typesugar/lsp-server](packages/lsp-server)   | Standalone LSP server — not supported in 1.0; use the TS plugin     |

## Getting Started

```bash
npm install typesugar @typesugar/std @typesugar/transformer typescript
```

Fastest way in — no build config:

```bash
npx typesugar init              # wire typesugar into an existing project (recommended)
npx typesugar run src/main.ts   # compile + run in one step
```

Or explore in the browser: **[Interactive Playground →](https://typesugar.org/playground)** (no install).

📖 **Full setup** — Vite, esbuild, Webpack, tsc/ts-patch, Bun, Vitest, editor setup, and CI — lives on the microsite: **[Getting Started → typesugar.org](https://typesugar.org/getting-started/)**.

## Features

> The snippets below are a tour; each links to its full guide on [typesugar.org](https://typesugar.org).

### Compile-Time Evaluation

```typescript
import { comptime } from "typesugar";

const fib10 = comptime(() => {
  const fib = (n: number): number => (n <= 1 ? n : fib(n - 1) + fib(n - 2));
  return fib(10);
}); // Compiles to: const fib10 = 55;
```

### Zero-Cost Typeclasses

Derive instances with `@derive` and activate the syntax you want with an import.
Operators and methods compile to direct calls on the generated companion, with
no runtime dictionary lookup:

```typescript
import { derive, Eq, Clone } from "typesugar";
import "@typesugar/std/syntax/eq/ops"; // activate Eq operator syntax
import "@typesugar/std/syntax/clone"; // activate Clone method syntax

@derive(Eq, Clone)
interface Point { x: number; y: number }

const p1: Point = { x: 1, y: 2 };
const p2: Point = { x: 1, y: 2 };

p1 === p2;    // Compiles to: Point.Eq.equals(p1, p2)  → true
p1.clone();   // Compiles to: Point.Clone.clone(p1)    → { x: 1, y: 2 }
```

### Type Reflection

```typescript
import { typeInfo, fieldNames, validator } from "@typesugar/reflect";

const fields = fieldNames<User>(); // ["id", "name", "email"]
const validate = validator<User>(); // Runtime validator from types
validate(data); // { success: true, value } or { success: false, errors }
```

### Extension Methods

Any function whose first parameter matches the receiver type can be called as a method — Scala 3-style UFCS (Uniform Function Call Syntax):

```typescript
import { clamp, isEven, abs } from "@typesugar/std";

// These functions take `number` as their first parameter
// So they can be called as methods on numbers:
const n = -42;
n.abs(); // → abs(n) → 42
n.clamp(0, 100); // → clamp(n, 0, 100) → 0
(7).isEven(); // → isEven(7) → false

// Works for any type!
import { head, tail, chunk } from "@typesugar/std";

const arr = [1, 2, 3, 4, 5];
arr.head(); // → 1
arr.tail(); // → [2, 3, 4, 5]
arr.chunk(2); // → chunk(arr, 2) → [[1, 2], [3, 4], [5]]
```

For library authors — mark your functions as extensions explicitly:

```typescript
"use extension"; // All exports in this file become extension methods

export function distance(p: Point, other: Point): number {
  return Math.sqrt((p.x - other.x) ** 2 + (p.y - other.y) ** 2);
}

// Users can now write: p1.distance(p2)
```

### Tagged Templates

```typescript
import { sql, Fragment } from "@typesugar/sql";

const query = sql`SELECT * FROM ${Fragment.ident(table)} WHERE id = ${id}`;
// → { text: 'SELECT * FROM "users" WHERE id = $1', params: [5] }
```

Tagged templates are a first-class macro kind, so you can [write your own](https://typesugar.org/writing-macros/tagged-template-macros).

### Typeclasses (Advanced)

For library authors — define new typeclasses that integrate with implicit resolution:

```typescript
interface Point {
  x: number;
  y: number;
}

// Define a typeclass
/** @typeclass */
interface Serialize<A> {
  serialize(a: A): Uint8Array;
  deserialize(bytes: Uint8Array): A;
}

// Provide an instance — it attaches to the Point companion
/** @impl Serialize<Point> */
const serializePoint: Serialize<Point> = {
  serialize: (p) => new Uint8Array([p.x, p.y]),
  deserialize: (b) => ({ x: b[0], y: b[1] }),
};
// Access via: Point.Serialize.serialize(myPoint)

// Method syntax works in the file that declares the typeclass. Other files
// opt in by importing the typeclass's `@syntax-methods` marker module.
const myPoint: Point = { x: 3, y: 4 };
const bytes = myPoint.serialize(); // Compiles to: serializePoint.serialize(myPoint)
```

### Operator Overloading

Operators dispatch to typeclass methods tagged `/** @op */`, in files that import
the typeclass's `/ops` marker (or declare the typeclass):

```typescript
import { Semigroup } from "@typesugar/std";
import "@typesugar/std/syntax/semigroup/ops"; // activate `+` for Semigroup

interface Vec2 {
  x: number;
  y: number;
}

// Define how Vec2 handles + via the Semigroup typeclass
/** @impl Semigroup<Vec2> */
const vec2Semigroup: Semigroup<Vec2> = {
  combine: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
};

// Now + just works on Vec2
const a: Vec2 = { x: 1, y: 2 };
const b: Vec2 = { x: 3, y: 4 };
const c = a + b; // Compiles to: ({ x: a.x + b.x, y: a.y + b.y }) → { x: 4, y: 6 }
```

### Effect-TS Integration

```typescript
import { Effect } from "effect";
import { derive } from "typesugar";
import { service, layer, resolveLayer, EffectSchema } from "@typesugar/effect";

// Zero-boilerplate services (generates DatabaseTag / UserRepoTag)
@service
interface Database {
  query(sql: string): Effect.Effect<string>;
}

@service
interface UserRepo {
  findById(id: string): Effect.Effect<string>;
}

// Layers with dependency tracking
@layer(Database)
const databaseLive = {
  query: (sql: string) => Effect.succeed("rows for " + sql),
};

@layer(UserRepo, { requires: [Database] })
const userRepoLive = Effect.gen(function* () {
  const db = yield* DatabaseTag;
  return { findById: (id: string) => db.query("SELECT " + id) };
});

// Automatic layer composition
const program = Effect.flatMap(UserRepoTag, (repo) => repo.findById("42"));
const runnable = program.pipe(Effect.provide(resolveLayer<UserRepo>()));
Effect.runSync(runnable); // "rows for SELECT 42"

// Auto-derive Effect Schema
@derive(EffectSchema)
interface User { id: string; name: string; }
// Generates: export const UserSchema = Schema.Struct({ ... })
```

## Documentation

The canonical docs live on the microsite: **[typesugar.org](https://typesugar.org)**.

- **[Interactive Playground](https://typesugar.org/playground)** — try typesugar in your browser, full runtime libraries included
- [Getting Started](https://typesugar.org/getting-started/) — install, first macro, every build tool + editor setup
- [Guides](https://typesugar.org/guides/) — feature deep-dives (derive, typeclasses, comptime, operators, pattern matching, fp, contracts, units, …)
- [Writing Macros](https://typesugar.org/writing-macros/) · [Authoring Libraries](https://typesugar.org/guides/authoring-libraries)
- [Architecture](https://typesugar.org/architecture) · [Reference](https://typesugar.org/reference/) · [FAQ](https://typesugar.org/faq)
- [Performance](docs/PERFORMANCE.md) (repo) · run `pnpm bench` to reproduce

## Safety

- **IO off by default** — `comptime` runs in a `vm` context with no filesystem or environment access unless the block asks for it (`comptime({ fs: "read" }, () => ...)`). This is not a security boundary: comptime code runs with your build's privileges, so only build code you trust. See [docs/SECURITY.md](docs/SECURITY.md).
- **Timeout** — 5-second limit on compile-time evaluation
- **Loud failures** — failed expansions emit `throw new Error(...)` so bugs are never silent
- **Diagnostics** — all errors flow through the TypeScript diagnostic pipeline

## Developer Experience

### Rust-Style Error Messages

When something goes wrong, typesugar tells you exactly what happened, where, and how to fix it.
For `summon<Eq<Point>>()` where `Point` has a field of type `Color` with no `Eq`:

```
src/palette.ts(15,17): error TS9001: [typesugar] [TS9001] No instance found for `Eq<Point>`
  = note: resolution trace for Eq<Point>:
  = note:   1. explicit-instance: Eq<Point> — not found — no @impl/@instance value for this type in scope
  = note:   2. auto-derive via Generic: Eq<Point> — FAILED — see child attempts
  = note:     derivation-strategy: Eq — ok
  = note:     generic-meta: GenericMeta for Point: { x: number, y: number, color: Color } — FAILED — one or more fields lack required instance
  = note:       field-check: field `x`: number — ok — number has Eq
  = note:       field-check: field `y`: number — ok — number has Eq
  = note:       field-check: field `color`: Color — FAILED — Color lacks Eq
  = help: Add @derive(Eq) to Color, or provide @instance Eq<Color>
```

Every error has a code (TS9001-TS9999) with an explanation page at `https://typesugar.org/errors/<code>`, and many carry machine-applicable fixes that your IDE can apply.

For typeclass resolution failures, you get a complete **resolution trace** showing each step attempted and why it failed — including per-field instance checks for auto-derivation. See the [error messages guide](docs/guides/error-messages.md) for details.

### "Did You Mean to Import...?"

An unknown `@derive(...)` name gets a suggestion of which typesugar package
exports it, when one does. (Import suggestions for other undefined macros and
extension methods are not implemented yet.)

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
const raw = (42).clamp(0, 100); // @ts-no-typesugar

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
