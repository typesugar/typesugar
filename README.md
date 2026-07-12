# typesugar

**TypeScript that F\*cks! Compile-time macros. Zero runtime. Full type safety.**

> _What if `===` just knew how to compare your types? What if `.clone()` worked on any struct? What if it all compiled to exactly what you'd write by hand?_

typesugar brings compile-time metaprogramming to TypeScript, drawing from the best ideas in Rust, Scala 3, and Zig — and making them feel native to the TypeScript ecosystem.

**[Try it in the Playground →](https://typesugar.org/playground)** — No installation required.

```typescript
import { derive, Eq, Ord, Clone, Json } from "@typesugar/std";
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
alice === bob; // false (compiles to: alice.id === bob.id && ...)
alice < bob; // true  (lexicographic field comparison)

// Method syntax too (activated by its marker import above)
alice.clone(); // deep copy
alice.toJson(); // JSON serialization

// All compile to direct code — no runtime dictionary, no overhead
```

## Why typesugar?

| Feature                  | typesugar                              | ts-macros               | Babel macros |
| ------------------------ | -------------------------------------- | ----------------------- | ------------ |
| **Typeclass syntax**     | `===`, `.equals()` via scoped imports  | No                      | No           |
| **Zero-cost**            | Auto-specialized to direct code        | No                      | No           |
| **Type-aware**           | Yes — reads the type checker           | No                      | No           |
| **Compile-time eval**    | Full JS via `vm` sandbox               | `$comptime` (similar)   | No           |
| **Tagged templates**     | First-class macro category             | Via expression macros   | No           |
| **Reflection**           | `typeInfo<T>()`, `validator<T>()`      | No                      | No           |
| **Operator overloading** | `+`, `*`, etc. via typeclass instances | No                      | No           |
| **Safety**               | Sandboxed, timeout, loud failures      | `$raw` runs unsandboxed | N/A          |

**Fast:** with the TS program cached (the editor/watch case), macro transformation
adds **~4 ms for a 50-line file** and **~12 ms for a 200-line file**; `comptime`
evaluates ~6M simple expressions/sec. See [docs/PERFORMANCE.md](docs/PERFORMANCE.md)
(run `pnpm bench` to reproduce).

## Packages

### Build Infrastructure

| Package                                           | Description                                      |
| ------------------------------------------------- | ------------------------------------------------ |
| [typesugar](packages/typesugar)                   | Umbrella package                                 |
| [@typesugar/core](packages/core)                  | Macro registration and types                     |
| [@typesugar/macros](packages/macros)              | Built-in macro implementations                   |
| [@typesugar/transformer](packages/transformer)    | TypeScript transformer (ts-patch)                |
| [unplugin-typesugar](packages/unplugin-typesugar) | Bundler plugins (Vite, esbuild, Rollup, Webpack) |
| [@typesugar/ts-plugin](packages/ts-plugin)        | TypeScript language service plugin               |

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

| Package                                            | Description                        |
| -------------------------------------------------- | ---------------------------------- |
| [@typesugar/vscode](packages/vscode)               | VS Code/Cursor extension           |
| [@typesugar/eslint-plugin](packages/eslint-plugin) | ESLint processor and rules         |
| [@typesugar/testing](packages/testing)             | Power assertions, property testing |

### Frozen

Not under active development ([PEP-048](peps/PEP-048-package-triage.md)) — these
remain in the repo and build, but are not part of typesugar's actively-maintained
surface and are excluded from release (except where a released package depends on
them).

| Package                                        | Description                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| [@typesugar/math](packages/math)               | Math types and typeclasses                                          |
| [@typesugar/units](packages/units)             | Type-safe physical units                                            |
| [@typesugar/parser](packages/parser)           | PEG parser generation                                               |
| [@typesugar/codec](packages/codec)             | Versioned codecs, schema evolution                                  |
| [@typesugar/collections](packages/collections) | HashSet/HashMap (still released — `@typesugar/graph` depends on it) |
| [@typesugar/erased](packages/erased)           | Type erasure / dyn Trait                                            |
| [@typesugar/strings](packages/strings)         | `regex`, `html`, `raw` tagged templates                             |
| [@typesugar/lsp-server](packages/lsp-server)   | Standalone LSP server (use `@typesugar/ts-plugin` instead)          |

## Getting Started

```bash
npm install typesugar @typesugar/transformer typescript
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

Derive instances with `@derive`, activate the syntax you want with an import,
and everything auto-specializes to eliminate overhead:

```typescript
import "@typesugar/std/syntax/eq/ops"; // activate Eq operator syntax
import "@typesugar/std/syntax/clone"; // activate Clone method syntax

@derive(Eq, Clone)
interface Point { x: number; y: number }

const p1: Point = { x: 1, y: 2 };
const p2: Point = { x: 1, y: 2 };

p1 === p2;    // Compiles to: p1.x === p2.x && p1.y === p2.y
p1.clone();   // Compiles to: { x: p1.x, y: p1.y }
```

### Type Reflection

```typescript
import { typeInfo, fieldNames, validator } from "@typesugar/reflect";

const fields = fieldNames<User>(); // ["id", "name", "email"]
const validate = validator<User>(); // Runtime validator from types
```

### Extension Methods

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

### Tagged Templates

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

// Provide a custom instance — attaches to Point companion
@instance
const serializePoint: Serialize<Point> = {
  serialize: (p) => new Uint8Array([p.x, p.y]),
  deserialize: (b) => ({ x: b[0], y: b[1] }),
};
// Access via: Point.Serialize.serialize(myPoint)

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
// Access via: Vec2.Semigroup.combine(a, b)

// Now + just works on Vec2
const a: Vec2 = { x: 1, y: 2 };
const b: Vec2 = { x: 3, y: 4 };
const c = a + b;  // Compiles to: { x: a.x + b.x, y: a.y + b.y }

```

### Effect-TS Integration

```typescript
import "@typesugar/std/syntax/do"; // activate let:/yield: label syntax
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

The canonical docs live on the microsite: **[typesugar.org](https://typesugar.org)**.

- **[Interactive Playground](https://typesugar.org/playground)** — try typesugar in your browser, full runtime libraries included
- [Getting Started](https://typesugar.org/getting-started/) — install, first macro, every build tool + editor setup
- [Guides](https://typesugar.org/guides/) — feature deep-dives (derive, typeclasses, comptime, operators, pattern matching, fp, contracts, units, …)
- [Writing Macros](https://typesugar.org/writing-macros/) · [Authoring Libraries](https://typesugar.org/guides/authoring-libraries)
- [Architecture](https://typesugar.org/architecture) · [Reference](https://typesugar.org/reference/) · [FAQ](https://typesugar.org/faq)
- [Performance](docs/PERFORMANCE.md) (repo) · run `pnpm bench` to reproduce

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

For more information, see: https://typesugar.org/errors/TS9001
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
