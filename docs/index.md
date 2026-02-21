---
layout: home

hero:
  name: typesugar
  text: Syntactic sugar for TypeScript with zero calories
  tagline: Operators and methods that just work, compiled to exactly what you'd write by hand.
  image:
    src: /logo.png
    alt: typesugar
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/
    - theme: alt
      text: View on GitHub
      link: https://github.com/dpovey/typesugar

features:
  - icon: 🔧
    title: Macro System
    details: 6 macro kinds to extend TypeScript with custom syntax that compiles away completely.
  - icon: λ
    title: FP & Type Theory
    details: Typeclasses, monads, do-notation, refined types, and Coq-like contracts with Z3 proofs.
  - icon: ⚡
    title: Compile-Time Powers
    details: Run code at build time, embed files, tail-call optimization, conditional compilation.
  - icon: 📦
    title: Standard Library
    details: Pattern matching, extension methods on primitives, reflection, validation, derive macros.
  - icon: 🎯
    title: Developer Experience
    details: Rust-style error messages, "did you mean?" import suggestions, opt-out directives, and ESLint/IDE integration that just works.
  - icon: 🦀
    title: Inspired by the Best
    details: Scala 3 typeclasses, Rust derives, Zig comptime, C++ expression templates — brought to TypeScript.
---

## Quick Example

```typescript
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
// Define a simple expression macro
defineSyntaxMacro("unless", {
  arms: [
    {
      pattern: "$cond:expr, $body:expr",
      expand: "($cond) ? undefined : ($body)",
    },
  ],
});

// Use it
unless(isLoggedIn, redirect("/login"));
// Compiles to: (isLoggedIn) ? undefined : (redirect("/login"))
```

[Writing Macros Guide](/writing-macros/) · [Macro Types Reference](/reference/macro-context)

---

## Functional Programming & Type Theory

_Typeclasses, monads, and proofs — for the nerds_

If you're into FP, typesugar has you covered:

- **Typeclasses** with implicit resolution and zero-cost specialization — Eq, Ord, Show, Functor, Monad, and more
- **Data types** — Option (null-based, zero-cost), Either, IO, Validated, List
- **Do-notation** via `let:/yield:` labeled blocks — works with any monad
- **HKT** with `F<_>` syntax — write generic code over type constructors
- **Refined types** — `Positive`, `Port`, `Email`, `NonEmpty<T>` with compile-time validation
- **Design by Contract** — `requires()`, `ensures()`, `@invariant` with Z3 SMT solver proofs

```typescript
// HKT with F<_> syntax
interface Functor<F<_>> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}

// Do-notation for any monad
const result = let: {
  user  << fetchUser(id);
  posts << fetchPosts(user.id);
  stats << computeStats(posts);
}
yield: { { user, posts, stats } };

// Contracts with compile-time proof elimination
function sqrt(x: number): number {
  requires: { x >= 0 }
  ensures: { result => result >= 0 }
  return Math.sqrt(x);
}
```

[Typeclasses Guide](/guides/typeclasses) · [FP Guide](/guides/fp) · [Contracts Guide](/guides/contracts)

---

## Compile-Time Powers

_Run code at build time, not at runtime_

Move computation from runtime to compile time:

- **`comptime()`** — evaluate any expression at build time
- **`@tailrec`** — tail-call elimination for stack-safe recursion
- **`includeStr()` / `includeJson()`** — embed file contents at compile time
- **`static_assert()`** — compile-time assertions that disappear in output
- **`cfg()` / `@cfgAttr`** — conditional compilation for feature flags
- **`collectTypes()`** — introspect your entire project at compile time
- **`"use no typesugar"`** — [opt-out directives](/guides/opt-out) for debugging and interop

```typescript
// Computed at compile time, inlined as a literal
const BUILD_TIME = comptime(new Date().toISOString());
const FIB_50 = comptime(fibonacci(50));

// Stack-safe recursion via loop transformation
@tailrec
function factorial(n: number, acc = 1): number {
  if (n <= 1) return acc;
  return factorial(n - 1, n * acc);
}
// Compiles to: while(true) { if (n <= 1) return acc; acc = n * acc; n = n - 1; }

// Embed files at compile time
const SCHEMA = includeJson("./schema.json");
const TEMPLATE = includeStr("./email.html");
```

[Compile-Time Guide](/guides/comptime) · [Conditional Compilation](/guides/conditional-compilation)

---

## Standard Library

_TypeScript's missing standard library_

Batteries included for everyday TypeScript:

- **Extension methods** — `(42).clamp(0, 100)`, `"hello".capitalize()`, `[1,2,3].sum()`
- **Pattern matching** — exhaustive `match()` with discriminated unions, guards, OR patterns
- **Reflection** — `typeInfo<T>()`, `fieldNames<T>()`, `validator<T>()` at compile time
- **Object mapping** — `transformInto()` for zero-cost struct-to-struct conversion
- **Derive macros** — `@derive(Eq, Ord, Clone, Debug, Hash, Json, Builder, TypeGuard)`
- **Tagged templates** — `sql`, `regex`, `html`, `fmt` with compile-time validation

```typescript
// Pattern matching with exhaustiveness checking
type Result<T, E> = { tag: "Ok"; value: T } | { tag: "Err"; error: E };

const message = match(result, {
  Ok: ({ value }) => `Got ${value}`,
  Err: ({ error }) => `Failed: ${error}`,
});

// Extension methods on primitives
const clamped = (255).clamp(0, 100); // 100
const words = "hello world".words(); // ["hello", "world"]
const total = [1, 2, 3, 4, 5].sum(); // 15

// Auto-derive common implementations
@derive(Eq, Clone, Debug, Json)
class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}
```

[Pattern Matching](/guides/typeclasses#pattern-matching) · [Derive Guide](/guides/derive) · [Extension Methods](/guides/extension-methods)

---

## C++ / Boost Inspired

_The best of template metaprogramming, brought to TypeScript_

Eight new packages inspired by Boost and C++ template techniques, all following typesugar's zero-cost philosophy:

- **HList** — Heterogeneous lists with compile-time type tracking (Boost.Fusion)
- **Parser** — Compile-time parser generation from PEG grammars (Boost.Spirit)
- **Fusion** — Single-pass iterator pipelines and expression templates (Blitz++)
- **Graph** — Graph algorithms and state machine verification (Boost.Graph)
- **Erased** — Typeclass-based type erasure for heterogeneous collections (dyn Trait)
- **Codec** — Versioned serialization with schema evolution (Boost.Serialization)
- **Named Args** — Named function arguments with compile-time validation (Boost.Parameter)
- **Geometry** — Type-safe geometry with coordinate system safety (Boost.Geometry)

```typescript
// Lazy iterator fusion — single pass, no intermediate arrays
const result = lazy([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  .filter(x => x % 2 === 0)
  .map(x => x * x)
  .take(3)
  .toArray();
// → [4, 16, 36] — single loop, early termination

// PEG grammar → recursive descent parser
const csv = grammar`
  file   = record ("\\n" record)*
  record = field ("," field)*
  field  = quoted | unquoted
  quoted = '"' (!'"' .)* '"'
  unquoted = (!',' !'\\n' .)*
`;

// Type-safe geometry — can't mix 2D/3D or coordinate systems
const p = point2d(1, 2);
const v = vec2(3, 4);
const moved = translate(p, v); // Point2D
```

[HList Guide](/guides/hlist) · [Parser Guide](/guides/parser) · [Fusion Guide](/guides/fusion) · [Graph Guide](/guides/graph)

---

## Framework Adapters

_Supercharge your existing tools_

typesugar integrates deeply with popular frameworks:

### Effect-TS

Reduce Effect boilerplate with macros. The `let:/yield:` do-notation works seamlessly with Effect.

```typescript
@service
class UserService {
  getUser(id: string) { return Effect.succeed({ id, name: "Alice" }); }
}

@layer
class UserServiceLive implements UserService {
  getUser(id: string) { return Effect.succeed({ id, name: "Alice" }); }
}

// Do-notation with Effect
const program = let: {
  user  << UserService.getUser("123");
  posts << PostService.getPosts(user.id);
}
yield: { posts.length };
```

### Kysely

Type-safe SQL with the `ksql` tagged template:

```typescript
const query = ksql<DB>`
  SELECT ${ref$("id")}, ${ref$("name")}
  FROM ${table$("users")}
  WHERE ${ref$("age")} > ${lit$(18)}
`;
```

### React

Vue/Svelte-style reactivity with compile-time dependency tracking:

```tsx
function Counter() {
  const count = state(0);
  const doubled = derived(() => count.value * 2);

  return (
    <div>
      <p>Count: {count.value}</p>
      <p>Doubled: {doubled.value}</p>
      <button onClick={() => count.value++}>Increment</button>
    </div>
  );
}
```

### Testing

Power assertions and property-based testing:

```typescript
// Power assertions show expression breakdown on failure
assert(user.age > 18 && user.name.length > 0);
// On failure:
//   assert(user.age > 18 && user.name.length > 0)
//          |    |   |     |    |    |      |
//          |    16  false |    ""   0      false
//          { age: 16, name: "" }

class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

// forAll auto-derives Arbitrary generators from field types
forAll(Point, (p) => p.x + p.y === p.y + p.x);
forAll(Point, 1000, (p) => p.x * 0 === 0); // custom iteration count
```

[Effect Integration](/guides/effect) · [Testing Guide](/guides/testing)

---

## Developer Experience

_When something goes wrong, you should know exactly what happened and how to fix it._

### Rust-Style Errors

Every error shows the code, points at the problem, and suggests a fix:

```
error[TS9101]: Cannot auto-derive Eq<UserProfile>: field `metadata` has type `unknown` which lacks Eq
  --> src/user.ts:5:3
   |
 3 |   interface UserProfile {
 4 |     id: number;
 5 |     metadata: unknown;
   |     ^^^^^^^^ this field prevents auto-derivation
   |
   = note: `unknown` cannot implement Eq — it could be anything
   = help: Use a concrete type instead of `unknown`, or provide @instance Eq<UserProfile>
```

Look up any error: `npx typesugar --explain TS9101`

### Import Suggestions

Missing an import? typesugar tells you where to find it:

```
error[TS9062]: Method `clamp` does not exist on type `number`
  --> src/math.ts:7:20
   |
 7 |   const safe = value.clamp(0, 100);
   |                      ^^^^^
   |
   = help: Did you mean to import?
     + import { NumberExt } from "@typesugar/std";
```

### Opt-Out When You Need To

```typescript
"use no typesugar";                     // whole file
function debug() { "use no typesugar"; } // one function
specialize(add); // @ts-no-typesugar     // one line
"use no typesugar extensions";           // just extensions
```

[Error Messages Guide](/guides/error-messages) · [Developer Experience Guide](/guides/developer-experience) · [Opt-Out Guide](/guides/opt-out) · [Error Reference](/errors/)

---

## Packages

| Core | Features | Adapters | C++ Inspired |
| --- | --- | --- | --- |
| [@typesugar/transformer](/reference/packages#transformer) | [@typesugar/fp](/reference/packages#fp) | [@typesugar/effect](/reference/packages#effect) | [@typesugar/hlist](/reference/packages#hlist) |
| [@typesugar/core](/reference/packages#core) | [@typesugar/typeclass](/reference/packages#typeclass) | [@typesugar/kysely](/reference/packages#kysely) | [@typesugar/parser](/reference/packages#parser) |
| [unplugin-typesugar](/reference/packages#unplugin) | [@typesugar/std](/reference/packages#std) | [@typesugar/react](/reference/packages#react) | [@typesugar/fusion](/reference/packages#fusion) |
| | [@typesugar/contracts](/reference/packages#contracts) | [@typesugar/testing](/reference/packages#testing) | [@typesugar/graph](/reference/packages#graph) |
| | [@typesugar/type-system](/reference/packages#type-system) | | [@typesugar/erased](/reference/packages#erased) |
| | [@typesugar/derive](/reference/packages#derive) | | [@typesugar/codec](/reference/packages#codec) |
| | | | [@typesugar/named-args](/reference/packages#named-args) |
| | | | [@typesugar/geometry](/reference/packages#geometry) |

[Full Package Reference](/reference/packages)

---

## Vision

Long-term vision documents for typesugar's future:

- [Vision Index](/vision/) — Overview, philosophy, roadmap
- [Reactivity](/vision/reactivity) — State model with type-aware auto-unwrapping
- [Effect Integration](/vision/effect-integration) — Deep Effect-TS integration
