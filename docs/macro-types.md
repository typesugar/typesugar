# Macro Types

typesugar supports several kinds of macros, each suited to different use cases.

## Expression Macros

Expression macros look like function calls and transform into different expressions.

### Syntax

```typescript
macroName(arg1, arg2, ...)
macroName<TypeArg>(arg1, arg2, ...)
```

### Examples

```typescript
import { comptime } from "typesugar";
import { typeInfo, fieldNames } from "@typesugar/reflect";
import { summon } from "@typesugar/typeclass";

// comptime — evaluate at compile time
const buildTime = comptime(new Date().toISOString());

// typeInfo — get type structure
const info = typeInfo<User>();

// fieldNames — get field names as tuple
const fields = fieldNames<User>(); // ["id", "name", "email"]

// summon — get typeclass instance
const showNumber = summon<Show<number>>();
```

### How They Work

The transformer:

1. Finds calls to registered macro functions
2. Extracts arguments (values and types)
3. Calls the macro's `expand()` function
4. Replaces the call with the returned AST

## Attribute Macros

Attribute macros use decorators to transform declarations.

### Syntax

```typescript
@macroName
@macroName(config)
```

### Examples

```typescript
import { derive } from "@typesugar/derive";
import { reflect } from "@typesugar/reflect";
import { typeclass, instance, derive } from "@typesugar/typeclass";

// @derive — auto-generate typeclass instances
@derive(Eq, Clone, Debug, Json)
class User {
  id: number;
  name: string;
}

// @reflect — enable type reflection (JSDoc form on interfaces)
/** @reflect */
interface Config {
  host: string;
  port: number;
}

// @typeclass — define a typeclass (use @op JSDoc on methods for operator dispatch)
/** @typeclass */
interface Show<A> {
  show(a: A): string;
}

// @impl (alias @instance) — provide a typeclass instance
/** @impl Show<number> */
const numberShow: Show<number> = { show: String };

// @derive — auto-derive typeclass instances
/** @derive(Show, Eq) */
interface Point {
  x: number;
  y: number;
}
```

> Interfaces, functions, and type aliases use the **JSDoc form**
> (`/** @macro */`) above. The decorator form works under TypeSugar too, but
> plain `tsc` flags it with TS1206 on non-class targets — see
> [JSDoc vs Decorator Syntax](./guides/jsdoc-vs-decorators.md).

### How They Work

The transformer:

1. Finds decorated declarations
2. Passes the declaration AST to the macro
3. The macro returns modified/additional declarations
4. Replaces the original with the expanded code

## Tagged Template Macros

Tagged template macros process template literals at compile time.

### Syntax

```typescript
macroName`template ${expr} literal`;
```

### Examples

```typescript
import { sql } from "@typesugar/sql";
import { regex, html } from "@typesugar/strings";
import { units } from "@typesugar/units";

// sql — type-safe SQL with compile-time validation
const query = sql`SELECT * FROM users WHERE id = ${userId}`;

// regex — compile-time validated regex
const pattern = regex`^[a-z]+@[a-z]+\.[a-z]{2,}$`;

// html — XSS-safe HTML templates
const page = html`<div>${userInput}</div>`;

// units — type-safe physical units
const speed = units`100 km/h`;
```

### How They Work

The transformer:

1. Finds tagged template expressions with registered tags
2. Extracts template strings and interpolated expressions
3. Calls the macro's `expand()` with both
4. Returns transformed code (often with compile-time validation)

## Labeled Block Macros

Labeled block macros use JavaScript's labeled statements for custom syntax.

### Syntax

```typescript
label: {
  // statements
}
continuation: {
  // result
}
```

### Examples

```typescript
import "@typesugar/std/syntax/do"; // activate let:/par: label syntax (PEP-052)

// let:/yield: — monadic do-notation (sequential, dependent)
const result = let: {
  user << fetchUser(id);
  posts << getPosts(user.id); // Can depend on previous bindings
  first = posts[0]; // Pure map step
}
yield: ({ user, first });

// Guards filter, for Array / Iterable / AsyncIterable (not Promise)
const evens = let: {
  n << [1, 2, 3, 4];
  if (n % 2 === 0) {
  }
}
yield: n * 10; // [20, 40]

// par:/yield: — applicative comprehension (parallel, independent)
const all = par: {
  user << fetchUser(id); // All bindings must be independent
  config << loadConfig();
  posts << fetchPosts();
}
yield: ({ user, config, posts });
// Compiles to Promise.all([...]).then(([user, config, posts]) => ...)
```

### Syntax in `let:` Blocks

| Syntax                    | Description                                        | Output                                     |
| ------------------------- | -------------------------------------------------- | ------------------------------------------ |
| `x << expr`               | Monadic bind                                       | `.flatMap(x => ...)`                       |
| `x << expr \|\| fallback` | Bind with fallback                                 | `expr.orElse(() => fallback).flatMap(...)` |
| `x << expr ?? fallback`   | Nullish coalescing fallback                        | Same as `\|\|`                             |
| `_ << expr`               | Discard binding                                    | `.flatMap(_ => ...)`                       |
| `x = expr`                | Pure map (no unwrap)                               | `((x) => ...)(expr)`                       |
| `if (cond) {}`            | Guard/filter (Array, Iterable, AsyncIterable only) | skips elements where `cond` is false       |

### Restrictions in `par:` Blocks

- **No guards**: `if (cond) {}` is not allowed (applicative can't short-circuit)
- **No fallbacks**: `|| fallback` is not allowed
- **Independence required**: Bindings cannot reference previous bindings

### How They Work

The transformer:

1. Finds labeled statements with registered labels (`let:`, `par:`)
2. Parses the block contents (bindings, guards, pure maps)
3. Validates constraints (e.g., independence for `par:`)
4. Transforms into standard JavaScript:
   - `let:` → `flatMap`/`map` chains
   - `par:` → `Promise.all` for Promises, `.map().ap()` for other types

## Derive Macros

Derive macros are a special case of attribute macros that generate implementations.

### Syntax

```typescript
@derive(Trait1, Trait2, ...)
```

### Available Derives

Each derive generates a companion instance on the type (`Config.Eq`, `Config.Ord`,
…). Method syntax such as `config.equals(other)` is rewritten to a call on that
companion only in files that import the syntax marker (`@typesugar/std/syntax/eq`,
`…/ord`, `…/clone`, `…/debug`, `…/json`, …).

| Derive      | Companion members                                                            |
| ----------- | ---------------------------------------------------------------------------- |
| `Eq`        | `Config.Eq.equals(a, b)`, `notEquals`                                        |
| `Ord`       | `Config.Ord.compare(a, b)` (`-1 \| 0 \| 1`), `lessThan`, `greaterThan`, …    |
| `Clone`     | `Config.Clone.clone(a)`                                                      |
| `Debug`     | `Config.Debug.debug(a): string`                                              |
| `Json`      | `Config.Json.toJson(a)` (a plain object), `fromJson(value)` (a parsed value) |
| `Default`   | `Config.Default.default()`                                                   |
| `Hash`      | `Config.Hash.hash(a): number`                                                |
| `TypeGuard` | `Config.TypeGuard.is(x): x is Config`                                        |
| `Arbitrary` | `arbitraryConfig` — a generator for property-based tests                     |

### Example

```typescript
import { derive, Eq, Ord, Clone, Debug, Json } from "typesugar";
import "@typesugar/std/syntax/eq";
import "@typesugar/std/syntax/ord";
import "@typesugar/std/syntax/clone";
import "@typesugar/std/syntax/debug";
import "@typesugar/std/syntax/json";

@derive(Eq, Ord, Clone, Debug, Json)
class Config {
  host: string = "localhost";
  port: number = 8080;
  secure: boolean = false;
}

const config = new Config();
config.equals(other); // → Config.Eq.equals(config, other)
config.compare(other); // → Config.Ord.compare(config, other)
config.clone(); // → Config.Clone.clone(config)
config.debug(); // 'Config { host: "localhost", port: 8080, secure: false }'
config.toJson(); // { host: "localhost", port: 8080, secure: false }
Config.fromJson(JSON.parse(text)); // validates fields; returns a plain object
```

## Type Macros

Type macros transform type annotations. `@typesugar/type-system` also provides
plain branded types for the same jobs, which need no macro:

### Examples

```typescript
import { refinement, type Refined, type Opaque, type Phantom } from "@typesugar/type-system";

// Refined types — types with predicates
type Port = Refined<number, "Port">;
const Port = refinement<number, "Port">((n) => n >= 0 && n <= 65535, "Port");
Port.is(8080); // true

// Opaque types — branded primitives
type UserId = Opaque<number, "UserId">;

// Phantom types — type-level state machines
type Door<State extends "open" | "closed" | "locked"> = Phantom<DoorData, State>;
```

## Choosing the Right Macro Type

| Use Case                   | Macro Type                  |
| -------------------------- | --------------------------- |
| Transform an expression    | Expression macro            |
| Add methods to a class     | Attribute macro (`@derive`) |
| Process a template literal | Tagged template macro       |
| Custom control flow        | Labeled block macro         |
| Constrain a type           | Type macro                  |

## Next Steps

- [Writing Macros](./writing-macros/) — Create your own macros
- [Architecture](./architecture.md) — How the transformer works
