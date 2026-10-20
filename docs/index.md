---
layout: home

hero:
  name: typesugar
  text: Syntactic sugar for TypeScript with zero calories
  tagline: Typeclasses, operator overloading, pattern matching and more through compile-time macros and zero-cost abstractions.
  image:
    src: /logo.png
    alt: typesugar
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/
    - theme: alt
      text: Try in the Playground
      link: /playground
    - theme: alt
      text: View on GitHub
      link: https://github.com/typesugar/typesugar

features:
  - icon: 🔧
    title: Macro System
    details: 6 macro kinds to extend TypeScript with custom syntax that compiles away completely.
    link: /macro-types
    linkText: Explore macro kinds
  - icon: λ
    title: FP & Type Theory
    details: Typeclasses, monads, do-notation, refined types, and Coq-like contracts with compile-time proofs.
    link: /guides/typeclasses
    linkText: Read the guide
  - icon: ⚡
    title: Compile-Time Powers
    details: Run code at build time, embed files, tail-call optimization, conditional compilation.
    link: /guides/comptime
    linkText: Learn about comptime
  - icon: 📦
    title: Standard Library
    details: Pattern matching, extension methods on primitives, reflection, validation, derive macros.
    link: /guides/
    linkText: Browse the guides
  - icon: 🎯
    title: Developer Experience
    details: Rust-style error messages with resolution traces, opt-out directives, and ESLint/IDE integration that just works.
    link: /guides/developer-experience
    linkText: See the DX
  - icon: 🦀
    title: Inspired by the Best
    details: Scala 3 typeclasses, Rust derives, Zig comptime, C++ expression templates, Lisp quasi-quotation — brought to TypeScript.
    link: /architecture
    linkText: How it works
---

**Rust, Scala and Zig's best ideas, as macros that compile to plain TypeScript.**

## Quick Example

```typescript
import { derive, Eq, Ord, Clone, Json } from "typesugar";
// Opt the file into typeclass operator syntax (cats-style). Without these imports,
// `===` / `<` stay the vanilla TypeScript operators — sugar is never ambient.
import "@typesugar/std/syntax/eq/ops";
import "@typesugar/std/syntax/ord/ops";
// Method syntax (`.clone()` / `.toJson()`) is a separate, additive tier — it
// doesn't redefine any native operator, so it's its own (quieter) opt-in.
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
alice === bob; // Compiles to: User.Eq.equals(alice, bob)
alice < bob; // Compiles to: User.Ord.lessThan(alice, bob) (field by field)

// Method syntax is activated too (its own marker import, above)
alice.clone(); // Compiles to: User.Clone.clone(alice)
alice.toJson(); // A JSON-ready plain object: User.Json.toJson(alice)
```

**How it works:** activation is explicit and local (PEP-052). Importing
`@typesugar/std/syntax/eq/ops` opts _this file_ into `Eq`'s operator syntax; the
compiler then sees `===` on a `User`, resolves the `@derive(Eq)` instance **from
scope** (no global registry), and rewrites the operator to a direct call of the
generated `User.Eq.equals` — no runtime dictionary lookup. A file that doesn't import the syntax marker keeps native
`===`. Method syntax (`.clone()`, `.toJson()`) works the same way through its own
marker — additive, since it introduces a method name rather than redefining an
operator.

➡️ **Skeptical?** [**Zero-Cost, Seen**](/guides/zero-cost) shows the _actual_ compiled output — including `Option`'s `Some(42)` becoming literally `42`.

---

## Macro System

_Custom language features that compile away_

typesugar provides 6 kinds of macros, each triggered differently:

- **Expression macros** — `myMacro(...)` function calls
- **Attribute macros** — `@myDecorator` on classes, methods, properties
- **Derive macros** — `@derive(Eq, Clone)` generates implementations from type structure
- **Tagged template macros** — `` sql`SELECT * FROM users` `` with compile-time validation
- **Type macros** — `Refined<number, Positive>` at the type level
- **Labeled block macros** — `let: { } yield: { }` for custom control flow

```typescript
// In your macro package (loaded through its package.json "typesugar.macros" entry)
import { defineExpressionMacro, globalRegistry } from "@typesugar/core";

export const unlessMacro = defineExpressionMacro({
  name: "unless",
  module: "my-macros", // activates only when `unless` is imported from here
  expand(ctx, _call, [cond, body]) {
    const f = ctx.factory;
    return f.createConditionalExpression(cond, undefined, f.createVoidZero(), undefined, body);
  },
});
globalRegistry.register(unlessMacro);

// In user code: import { unless } from "my-macros";
unless(isLoggedIn, redirect("/login"));
// Compiles to: isLoggedIn ? void 0 : redirect("/login")
```

[Writing Macros Guide](/writing-macros/) · [Macro Types Reference](/macro-types) · [MacroContext Reference](/reference/macro-context)

---

## Functional Programming & Type Theory

_Typeclasses, monads, and proofs — for the nerds_

If you're into FP, typesugar has you covered:

- **Typeclasses** with implicit resolution and zero-cost specialization — Eq, Ord, Show, Functor, Monad, and more
- **Data types** — Option (null-based, zero-cost), Either, IO, Validated, List
- **Do-notation** via `let:/yield:` labeled blocks — works with any monad
- **HKT** with `F<A>` syntax — write generic code over type constructors
- **Refined types** — `Positive`, `Port`, `Email`, `NonEmpty<T>` with compile-time validation
- **Design by Contract** — `requires()`, `ensures()`, `@invariant` with compile-time proof elimination

```typescript
// Label syntax is opt-in per file, like operator syntax above
import "@typesugar/std/syntax/do"; // let:/yield: comprehensions
import "@typesugar/contracts/syntax"; // requires:/ensures: blocks

// HKT with F<A> syntax (the transformer rewrites F<A> to Kind<F, A>)
interface Functor<F> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}

// Do-notation for any monad (here: Promise)
const result = let: {
  user  << fetchUser(id);
  posts << fetchPosts(user.id);
  stats << computeStats(posts);
}
yield: ({ user, posts, stats });

// Contracts: checked at runtime unless proven at compile time
function sqrt(x: number): number {
  requires: { x >= 0 }
  ensures: { result >= 0 }
  return Math.sqrt(x);
}
sqrt(-1); // throws PreconditionError
```

[Typeclasses Guide](/guides/typeclasses) · [FP Guide](/guides/fp) · [Contracts Guide](/guides/contracts)

---

## Compile-Time Powers

_Run code at build time, not at runtime_

Move computation from runtime to compile time:

- **`comptime()`** — evaluate any expression at build time
- **`@tailrec`** — tail-call elimination for stack-safe recursion
- **`includeStr()` / `includeJson()`** — embed file contents at compile time
- **`staticAssert()`** — compile-time assertions that disappear in output
- **`cfg()` / `@cfgAttr`** — conditional compilation for feature flags
- **`"use no typesugar"`** — [opt-out directives](/guides/opt-out) for debugging and interop

```typescript
import { comptime, includeJson, includeStr } from "typesugar";

// Computed at compile time, inlined as a literal
const BUILD_TIME = comptime(() => new Date().toISOString()); // "2026-…Z"
const FIB_20 = comptime(() => {
  // comptime code only sees what is defined inside the block
  const fib = (n: number): number => (n <= 1 ? n : fib(n - 1) + fib(n - 2));
  return fib(20);
}); // → const FIB_20 = 6765;

// Stack-safe recursion via loop transformation
/** @tailrec */
function factorial(n: number, acc = 1): number {
  if (n <= 1) return acc;
  return factorial(n - 1, n * acc);
}
// Compiles to a labelled `while (true)` loop that reassigns n and acc

// Embed files at compile time
const SCHEMA = includeJson("./schema.json");
const TEMPLATE = includeStr("./email.html");
```

[Compile-Time Guide](/guides/comptime) · [Conditional Compilation](/guides/conditional-compilation)

---

## Standard Library

_TypeScript's missing standard library_

Batteries included for everyday TypeScript:

- **Extension methods** — `(42).clamp(0, 100)`, `"hello".capitalize()`, `[1,2,3].chunk(2)`
- **Pattern matching** — exhaustive `match()` with discriminated unions, guards, OR patterns
- **Reflection** — `typeInfo<T>()`, `fieldNames<T>()`, `validator<T>()` at compile time
- **Object mapping** — `transformInto()` for zero-cost struct-to-struct conversion
- **Derive macros** — `@derive(Eq, Ord, Clone, Debug, Hash, Json, Default, TypeGuard)`
- **Tagged templates** — `sql` with compile-time validation, and your own via tagged-template macros

```typescript
import { match, clamp, words, chunk } from "@typesugar/std";
import { derive, Eq, Clone, Debug, Json } from "typesugar";

// Pattern matching with exhaustiveness checking
type Result<T, E> = { tag: "Ok"; value: T } | { tag: "Err"; error: E };

const message = match(result)
  .case({ tag: "Ok", value: v })
  .then(`Got ${v}`)
  .case({ tag: "Err", error: e })
  .then(`Failed: ${e}`);

// Extension methods (activated by the named imports above)
const clamped = (255).clamp(0, 100); // 100
const ws = "hello world".words(); // ["hello", "world"]
const pairs = [1, 2, 3, 4, 5].chunk(2); // [[1, 2], [3, 4], [5]]

// Auto-derive common implementations
@derive(Eq, Clone, Debug, Json)
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}
```

[Pattern Matching](/guides/pattern-matching) · [Derive Guide](/guides/derive) · [Extension Methods](/guides/extension-methods)

---

## Data Structures & Algorithms

_Powerful abstractions with zero runtime cost_

Advanced data structures and algorithms following typesugar's zero-cost philosophy:

- **Fusion** — Single-pass iterator pipelines and expression templates (Blitz++)
- **Graph** — Graph algorithms and state machine verification (Boost.Graph)
- **Mapper** — Zero-cost struct-to-struct conversion with `transformInto()`

```typescript
import { lazy } from "@typesugar/fusion";

// Lazy iterator fusion — single pass, no intermediate arrays
const result = lazy([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  .filter((x) => x % 2 === 0)
  .map((x) => x * x)
  .take(3)
  .toArray();
// → [4, 16, 36] — single loop, early termination
```

[Fusion Guide](/guides/fusion) · [Graph Guide](/guides/graph) · [Mapper Guide](/guides/mapper)

---

## Framework Adapters

_Supercharge your existing tools_

typesugar integrates deeply with popular frameworks:

### Effect-TS

Reduce Effect boilerplate with macros. The `let:/yield:` do-notation works with Effect values.

```typescript
import "@typesugar/std/syntax/do";
import { Effect } from "effect";
import { service, layer, resolveLayer } from "@typesugar/effect";

@service
interface UserRepo {
  findById(id: string): Effect.Effect<string>;
}

@layer(UserRepo)
const userRepoLive = { findById: (id: string) => Effect.succeed("user " + id) };

const getPosts = (user: string) => Effect.succeed([`${user}'s post`]);

// Do-notation with Effect (compiles to Effect.flatMap / Effect.map)
const countPosts = (repo: UserRepo) => let: {
  user  << repo.findById("123");
  posts << getPosts(user);
}
yield: posts.length;

// UserRepoTag is generated by @service; resolveLayer wires the layers
const program = Effect.flatMap(UserRepoTag, countPosts);
Effect.runSync(program.pipe(Effect.provide(resolveLayer<UserRepo>()))); // 1
```

### Testing

Power assertions and property-based testing:

```typescript
import { assert, forAll } from "@typesugar/testing";
import { derive } from "typesugar";

// Power assertions show expression breakdown on failure
assert(user.age > 18 && user.name.length > 0);
// On failure:
//   assert(user.age > 18 && user.name.length > 0)
//          |    |   |    |
//          |    16  false|
//          |             false
//          {"age":16,"name":""}

// @derive(Arbitrary) generates arbitraryPoint from the field types
@derive(Arbitrary)
interface Point {
  x: number;
  y: number;
}

forAll(arbitraryPoint, (p) => assert(p.x + p.y === p.y + p.x));
forAll(arbitraryPoint, 1000, (p) => assert(p.x * 0 === 0)); // custom iteration count
```

[Effect Integration](/guides/effect) · [Testing Guide](/guides/testing)

---

## Developer Experience

_When something goes wrong, you should know exactly what happened and how to fix it._

### Rust-Style Errors

Every error has a code, and typeclass failures carry a resolution trace and a fix.
For `summon<Eq<Palette>>()` where `Palette` has a field of type `Color` with no `Eq`:

```
error [TS9001] No instance found for `Eq<Palette>`
  = note: resolution trace for Eq<Palette>:
  = note:   1. explicit-instance: Eq<Palette> — not found — no @impl/@instance value for this type in scope
  = note:   2. auto-derive via Generic: Eq<Palette> — FAILED — see child attempts
  = note:     derivation-strategy: Eq — ok
  = note:     generic-meta: GenericMeta for Palette: { primary: Color } — FAILED — one or more fields lack required instance
  = note:       field-check: field `primary`: Color — FAILED — Color lacks Eq
  = help: Add @derive(Eq) to Color, or provide @instance Eq<Color>
```

Look up any error code in the [error reference](/errors/) (`https://typesugar.org/errors/TS9001`).

### Opt-Out When You Need To

```typescript
"use no typesugar"; // whole file
function debug() {
  "use no typesugar";
} // one function
(42).clamp(0, 100); // @ts-no-typesugar  // one line
("use no typesugar extensions"); // just extensions
```

[Error Messages Guide](/guides/error-messages) · [Developer Experience Guide](/guides/developer-experience) · [Opt-Out Guide](/guides/opt-out) · [Error Reference](/errors/) · [Performance Architecture](/PERFORMANCE)

---

## Packages

### Build Infrastructure

| Package                                                   | Description                                         |
| --------------------------------------------------------- | --------------------------------------------------- |
| [typesugar](/reference/packages#typesugar)                | Umbrella package                                    |
| [@typesugar/core](/reference/packages#core)               | Macro registration and types                        |
| [@typesugar/macros](/reference/packages#macros)           | Built-in macro implementations                      |
| [@typesugar/transformer](/reference/packages#transformer) | TypeScript transformer (ts-patch, CLI)              |
| [unplugin-typesugar](/reference/packages#unplugin)        | Bundler plugins (Vite, esbuild, Rollup, Webpack)    |
| [@typesugar/ts-plugin](/reference/packages#ts-plugin)     | TypeScript language service plugin (editor support) |

### Standard Library

| Package                                   | Description                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| [@typesugar/std](/reference/packages#std) | Extension methods, pattern matching, do-notation, standard typeclasses |

### Typeclasses & Derivation

| Package                                               | Description                                          |
| ----------------------------------------------------- | ---------------------------------------------------- |
| [@typesugar/typeclass](/reference/packages#typeclass) | `@typeclass`, `@instance`, `summon()`                |
| [@typesugar/derive](/reference/packages#derive)       | `@derive(Eq, Clone, Debug, Json, ...)`               |
| [@typesugar/reflect](/reference/packages#reflect)     | `typeInfo<T>()`, `fieldNames<T>()`, `validator<T>()` |

### Type Safety & Contracts

| Package                                                               | Description                                |
| --------------------------------------------------------------------- | ------------------------------------------ |
| [@typesugar/type-system](/reference/packages#type-system)             | Refined types, newtype, HKT, phantom types |
| [@typesugar/contracts](/reference/packages#contracts)                 | `requires:`, `ensures:`, `@invariant`      |
| [@typesugar/contracts-refined](/reference/packages#contracts-refined) | Refinement type integration                |
| [@typesugar/validate](/reference/packages#validate)                   | Schema validation macros                   |

### Data Structures & Algorithms

| Package                                         | Description                           |
| ----------------------------------------------- | ------------------------------------- |
| [@typesugar/fp](/reference/packages#fp)         | Option, Either, IO, Result, List      |
| [@typesugar/fusion](/reference/packages#fusion) | Iterator fusion, expression templates |
| [@typesugar/graph](/reference/packages#graph)   | Graph algorithms, state machines      |
| [@typesugar/mapper](/reference/packages#mapper) | Zero-cost object mapping              |

### Ecosystem Integrations

| Package                                         | Description       |
| ----------------------------------------------- | ----------------- |
| [@typesugar/effect](/reference/packages#effect) | Effect-TS adapter |
| [@typesugar/sql](/reference/packages#sql)       | Doobie-like SQL   |

### Developer Experience

| Package                                                       | Description                           |
| ------------------------------------------------------------- | ------------------------------------- |
| [typesugar-vscode](/reference/packages#vscode)                | VS Code/Cursor extension (not on npm) |
| [@typesugar/eslint-plugin](/reference/packages#eslint-plugin) | ESLint processor and rules            |
| [@typesugar/testing](/reference/packages#testing)             | Power assertions, property testing    |

### Frozen

Not under active development ([PEP-048](https://github.com/typesugar/typesugar/blob/main/peps/PEP-048-package-triage.md)). These packages still build, but they are not part of typesugar's actively maintained surface.

| Package                                                                                       | Description                                          |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [@typesugar/math](/reference/packages#math)                                                   | Math types and typeclasses                           |
| [@typesugar/units](/reference/packages#units)                                                 | Type-safe physical units                             |
| [@typesugar/parser](/reference/packages#parser)                                               | PEG parser generation                                |
| [@typesugar/codec](/reference/packages#codec)                                                 | Versioned codecs, schema evolution                   |
| [@typesugar/collections](/reference/packages#collections)                                     | HashSet/HashMap (`@typesugar/graph` depends on it)   |
| [@typesugar/erased](/reference/packages#erased)                                               | Type erasure / dyn Trait                             |
| [@typesugar/strings](/reference/packages#strings)                                             | `regex`, `html`, `raw` tagged templates              |
| [@typesugar/lsp-server](https://github.com/typesugar/typesugar/tree/main/packages/lsp-server) | Standalone LSP server: deprecated, use the TS plugin |

[Full Package Reference](/reference/packages)

---

## Inspired by the Best

typesugar draws from the best ideas across language ecosystems:

| Language      | What it brings                                             | Packages                                           |
| ------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| Scala 3       | Typeclasses, extension methods, do-notation                | typeclass, std, fp, effect                         |
| Rust          | Derive macros, zero-cost specialization, serde             | derive, validate                                   |
| Zig           | Compile-time evaluation and reflection                     | macros (comptime), reflect                         |
| C++ / Boost   | Expression templates, graph algorithms                     | fusion, graph                                      |
| Lisp / Racket | Quasi-quotation for building generated code                | macros (`quote`)                                   |
| Haskell / ML  | Refinement types, type-level programming, property testing | contracts, contracts-refined, type-system, testing |

---

## Vision

Historical design documents (exploratory; not a description of shipped features):

- [Vision Index](/vision/) — Overview and philosophy
- [Reactivity](/vision/reactivity) — State model with type-aware auto-unwrapping
- [Effect Integration](/vision/effect-integration) — Deep Effect-TS integration
