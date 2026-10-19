# @typesugar/std

> 📖 **Full documentation:** [Standard Library guides](https://typesugar.org/guides/std-typeclasses). The microsite is the canonical reference; this README is a quickstart.

> Standard library extensions for TypeScript.

## Overview

`@typesugar/std` provides a comprehensive set of typeclasses, extension methods, data types, and macros for enriching basic TypeScript types. Draws from the best of Haskell, Scala, Rust, Kotlin, Swift, and commonly-requested JS/TS utilities.

## Installation

```bash
npm install @typesugar/std
# or
pnpm add @typesugar/std
```

## Usage

### Extension Methods (Dot Syntax via Global Augmentation)

With PEP-012 Wave 8, importing `@typesugar/std` adds type-checked methods to `Number`, `String`, `Array`, `Map`, `Promise`, `Date`, and `Boolean` via global augmentation. The transformer rewrites dot-syntax calls to standalone function calls — zero runtime overhead. Import each function you call with dot syntax (or `import * as std from "@typesugar/std"`); the import is what the transformer resolves the method against.

```typescript
import { clamp, isEven, abs, capitalize, head } from "@typesugar/std";

// Dot syntax — type-checked, zero-cost
(-5).abs(); // → abs(-5) → 5
(42).clamp(0, 100); // → clamp(42, 0, 100) → 42
(7).isEven(); // → isEven(7) → false
"hello".capitalize(); // → capitalize("hello") → "Hello"
[1, 2, 3].head(); // → head([1, 2, 3]) → 1

// Direct calls still work
clamp(42, 0, 100); // → 42
```

**Math.\* methods on numbers:**

```typescript
import { abs, ceil, floor, sqrt, sin, cos } from "@typesugar/std";

(-5).abs(); // 5
(3.7).ceil(); // 4
(3.7).floor(); // 3
(16).sqrt(); // 4
(0).sin(); // 0
```

**How it works:** `@typesugar/std` declares `declare global { interface Number { clamp(min: number, max: number): number; ... } }` so TypeScript sees the methods. The transformer rewrites `(42).clamp(0, 100)` → `clamp(42, 0, 100)` — no prototype mutation, no runtime cost.

**Augmented types:** Number, String, Array, Map, Promise, Date, Boolean. A method the type already has natively (`[1, 2].map(...)`) is never rewritten.
**Not augmented (intentionally):** Set (conflicts with ES2025 Set methods), Object, Function (too broad).

### Ranges (Scala/Kotlin-style)

Create ranges with fluent extension methods on numbers:

```typescript
import { to, until, step, toArray, contains, first, forEach, map, filter } from "@typesugar/std";

// Inclusive range (like Scala's 1 to 10)
(1).to(10).toArray(); // [1, 2, 3, ..., 10]

// Exclusive range (like Kotlin's 1 until 10)
(1).until(10).toArray(); // [1, 2, 3, ..., 9]

// With step
(0).to(10).step(2).toArray(); // [0, 2, 4, 6, 8, 10]

// Queries
(1).to(100).contains(42); // true
(1).to(10).first(); // 1

// Iteration
(1).to(5).forEach((n) => console.log(n)); // prints 1, 2, 3, 4, 5
(1).to(5).map((n) => n * n); // [1, 4, 9, 16, 25]
(1).to(10).filter((n) => n % 2 === 0); // [2, 4, 6, 8, 10]
```

**Legacy function-based API (deprecated — use `.to()` / `.until()` above):**

```typescript
import { range, rangeToArray, rangeInclusive } from "@typesugar/std";
rangeToArray(range(1, 10)); // [1, 2, ..., 9]
rangeToArray(rangeInclusive(1, 10)); // [1, 2, ..., 10]
```

## Standard Typeclasses

`@typesugar/std` exports core typeclasses that power operator dispatch and auto-derivation:

| Typeclass                      | Purpose                                              |
| ------------------------------ | ---------------------------------------------------- |
| `Eq<A>`                        | Equality with `===` / `!==` operator dispatch        |
| `Hash<A>`                      | Hashing for HashMap/HashSet                          |
| `Ord<A>`                       | Total ordering with `<` / `<=` / `>` / `>=` dispatch |
| `Semigroup<A>`                 | Associative combine with `+` dispatch                |
| `Monoid<A>`                    | Semigroup with identity element                      |
| `Numeric<A>`                   | Arithmetic with `+` / `-` / `*` dispatch             |
| `Fractional<A>`, `Integral<A>` | `/` (and `%` for `Integral`) dispatch                |
| `FlatMap<F>`                   | Sequencing for do-notation                           |

Operator dispatch is off until a file imports the typeclass's activation module, for
example `import "@typesugar/std/syntax/eq/ops";` for `===` / `!==`, or
`import "@typesugar/std/syntax/semigroup/ops";` for `+`. Without it, `a === b` stays a
plain reference comparison. The method forms (`a.equals(b)`) need
`import "@typesugar/std/syntax/eq";`.

### Hash (NEW)

`Hash` produces hash codes for use in hash-based collections. It enables `@typesugar/collections` (HashSet, HashMap).

```typescript
interface Hash<A> {
  hash(a: A): number;
}
```

**Law:** `Eq.equals(a, b) => Hash.hash(a) === Hash.hash(b)` — equal values must have equal hashes.

**Primitive instances:** `hashNumber`, `hashString`, `hashBoolean`, `hashBigInt`, `hashDate`

**Combinators:** `makeHash(fn)`, `hashBy(f, H)`, `hashArray(H)`

## FlatMap Typeclass

The `FlatMap` typeclass provides sequencing/chaining operations for type constructors. It's the minimal typeclass required for the `let:/yield:` and `par:/yield:` do-notation macros.

Instance resolution is scope-based (PEP-052) — there is no global registry. The built-in instances for Array, Promise, Iterable, and AsyncIterable come with the `import "@typesugar/std/syntax/do"` marker you already add for the label syntax. Custom types declare an `@impl`-tagged instance:

```typescript
// Declare in the using file, or export it and import the module
/** @impl FlatMap<Option> */
export const flatMapOption = {
  map: (fa, f) => fa.map(f),
  flatMap: (fa, f) => fa.flatMap(f),
};
```

## Do-Notation Macros

Two labeled block macros with aliases for effect-based programming:

- **`let:/yield:`** or **`seq:/yield:`** — Sequential (monadic) comprehensions with `flatMap` chains
- **`par:/yield:`** or **`all:/yield:`** — Parallel (applicative) comprehensions with `Promise.all` or `.map()/.ap()`

`seq:` and `all:` are aliases; you can nest `par:`/`all:` blocks inside `let:`/`seq:` for mixed flows.

### `let:/yield:` — Sequential Comprehensions

Bindings can depend on previous bindings. Supports guards, fallbacks, discard bindings, and pure map steps. Every file that uses the syntax needs the activation import `import "@typesugar/std/syntax/do";`, and the comprehension is an expression: assign it, return it, or use it as an arrow body (a bare one at statement position is reported as TS9222, "result discarded").

```typescript
import "@typesugar/std/syntax/do";

const result = let: {
  user << fetchUser(id); // Monadic bind
  posts << fetchPosts(user.id); // Depends on user
  first = posts[0]; // Pure map step
}
yield: ({ user, first });

// Compiles to:
// const result = fetchUser(id).then(user =>
//   fetchPosts(user.id).then(posts => (first => ({ user, first }))(posts[0])));
```

`yield: <expr>` and `yield: { <expr> }` mean the same thing.

#### Guards

Guards (`if (cond) {}`) filter, so they work for Array, Iterable and AsyncIterable, not Promise:

```typescript
const evens = let: {
  x << [1, 2, 3, 4];
  if (x % 2 === 0) {
  } // Guard
}
yield: x * 10;
// → [1, 2, 3, 4].flatMap(x => x % 2 === 0 ? [x * 10] : [])   // [20, 40]
```

#### orElse Fallback

```typescript
const config = let: {
  config << loadConfig() || defaultConfig(); // Fallback on error
}
yield: config;
// → loadConfig().catch(_ => defaultConfig()).then(config => config)
```

#### Discard Binding

```typescript
const x = let: {
  _ << log("Starting..."); // Execute but discard result
  x << computation();
}
yield: x;
```

### `par:/yield:` — Parallel Comprehensions

All bindings must be independent. Uses `Promise.all` for Promises, `.map()/.ap()` for other applicative types.

```typescript
const all = par: {
  user << fetchUser(id);
  config << loadConfig();
  posts << fetchPosts();
}
yield: ({ user, config, posts });

// Compiles to:
// const all = Promise.all([fetchUser(id), loadConfig(), fetchPosts()])
//   .then(([user, config, posts]) => ({ user, config, posts }));
```

**Why `par:` instead of `let:`?**

1. **Parallel execution**: Promises run concurrently via `Promise.all`
2. **Error accumulation**: Validation types collect ALL errors, not just the first
3. **Compile-time independence check**: The macro catches dependencies at build time

### With Custom Types

Any type with a `FlatMap` instance in scope works with both macros — declared locally with an `@impl` JSDoc tag, or exported by a module the file imports (no registration call):

```typescript
import "@typesugar/std/syntax/do";

interface Box<A> {
  value: A;
}
const box = <A>(value: A): Box<A> => ({ value });

/**
 * @impl FlatMap<Box>
 * @do-methods style=static receiver=flatMapBox
 */
export const flatMapBox = {
  map: <A, B>(fa: Box<A>, f: (a: A) => B): Box<B> => box(f(fa.value)),
  flatMap: <A, B>(fa: Box<A>, f: (a: A) => Box<B>): Box<B> => f(fa.value),
};

// Now Box works with let:/yield:
const r = let: {
  x << box(5);
  y << box(x * 2);
}
yield: ({ x, y });
// → flatMapBox.flatMap(box(5), x => flatMapBox.map(box(x * 2), y => ({ x, y })))   // { value: { x: 5, y: 10 } }
```

The optional `@do-methods` tag next to `@impl` customizes emission (`bind=` / `map=` / `orElse=` method names, `style=static receiver=X` for static combinators as above, and `all=` to enable the zero-cost parallel join for `par:`). Without it, the macro calls `.flatMap` / `.map` as methods on the value. `@typesugar/fp`'s Option, Either, IO and List instances already carry these tags.

## Extension Methods

Rich extension methods for every basic type:

| Type            | Methods                                                            |
| --------------- | ------------------------------------------------------------------ |
| **NumberExt**   | 45+ methods: `clamp`, `toHex`, `isPrime`, `times`, `abs`, ...      |
| **StringExt**   | 50+ methods: `capitalize`, `toSnakeCase`, `truncate`, `words`, ... |
| **ArrayExt**    | 50+ methods: `chunk`, `unique`, `groupBy`, `partition`, `zip`, ... |
| **ObjectExt**   | 30+ methods: `pick`, `omit`, `mapValues`, `deepMerge`, ...         |
| **BooleanExt**  | 20+ methods: `toInt`, `and`, `or`, `implies`, ...                  |
| **DateExt**     | 40+ methods: `addDays`, `startOfMonth`, `format`, `isWeekend`, ... |
| **MapExt**      | 15+ methods: `mapValues`, `filterKeys`, `merge`, ...               |
| **PromiseExt**  | 20+ methods: `tap`, `timeout`, `retry`, `mapError`, ...            |
| **FunctionExt** | 25+ methods: `memoize`, `debounce`, `throttle`, `compose`, ...     |

## Pattern Matching

Scala-style pattern matching with **compile-time exhaustiveness checking** and zero runtime overhead, via a fluent API in any `.ts` file.

### Fluent API

```typescript
import { match } from "@typesugar/std";

type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "square"; side: number }
  | { kind: "rect"; w: number; h: number };

const area = match(shape)
  .case({ kind: "circle", radius: r })
  .then(Math.PI * r ** 2)
  .case({ kind: "square", side: s })
  .then(s ** 2)
  .case({ kind: "rect", w, h })
  .then(w * h);
// Compile error if you miss a variant. Zero runtime overhead.
```

### Pattern Types

The fluent API supports all structural patterns — literals, variable binding, wildcards, arrays/tuples, objects, discriminated unions, type patterns (`String(s)`, `Date(d)`), OR patterns (`.or()`), AS patterns (`.as()`), regex, nested patterns, and extractors via the `Destructure` typeclass.

### Exhaustiveness

Every `match()` is always exhaustive. Missing cases produce a compile error:

```
error TS9226: [typesugar] [TS9226] Non-exhaustive match — missing cases: "blue"
  = help: Add the missing cases or use .else() / _ to handle remaining values.
```

Use `.else(value)` as a catch-all. When no pattern matches at runtime, the generated code throws `MatchError`.

See the [Pattern Matching Guide](../../docs/guides/pattern-matching.md) for the full pattern catalogue and optimization details.

## Data Types

### Tuples

```typescript
import { pair, triple, fst, snd, bimap, swap } from "@typesugar/std";

const p = pair(1, "hello");
fst(p); // 1
snd(p); // "hello"
bimap(
  p,
  (x) => x + 1,
  (s) => s.toUpperCase()
); // [2, "HELLO"]
swap(p); // ["hello", 1]
```

### Range

Ranges are lazy — they don't allocate arrays until materialized. Use `.to()` and `.until()` extension methods on numbers for fluent syntax:

```typescript
import { to, until, step, reversed, toArray, contains } from "@typesugar/std";

// Create ranges (lazy)
const r1 = (1).to(10); // Range { 1..10 inclusive }
const r2 = (1).until(10); // Range { 1..<10 exclusive }

// Transform ranges (returns new Range)
const r3 = (0).to(100).step(10); // Range { 0, 10, 20, ..., 100 }
const r4 = (1).to(5).reversed(); // Range { 5, 4, 3, 2, 1 }

// Materialize
(1).to(5).toArray(); // [1, 2, 3, 4, 5]

// Query
(1).to(100).contains(42); // true
(1).to(10).size(); // 10
(1).to(10).first(); // 1
(1).to(10).last(); // 10
(1).to(10).isEmpty(); // false

// Iterate
(1).to(5).forEach((n, i) => console.log(`${i}: ${n}`));
(1).to(5).map((n) => n * n); // [1, 4, 9, 16, 25]
(1).to(10).filter((n) => n % 2 === 0); // [2, 4, 6, 8, 10]
(1).to(5).reduce(0, (sum, n) => sum + n); // 15
```

**Legacy function-based API (deprecated — use `.to()` / `.until()` above):**

```typescript
import { range, rangeToArray, rangeInclusive, rangeBy } from "@typesugar/std";

rangeToArray(range(1, 5)); // [1, 2, 3, 4]
rangeToArray(rangeInclusive(1, 5)); // [1, 2, 3, 4, 5]
rangeToArray(rangeBy(range(0, 10), 2)); // [0, 2, 4, 6, 8]
```

## API Reference

### Typeclasses

- `Eq<A>` — Equality comparison (`===` / `!==`)
- `Hash<A>` — Hash codes for hash-based collections
- `Ord<A>` — Total ordering (`<` / `<=` / `>` / `>=`)
- `Semigroup<A>` — Associative binary operation (`+`)
- `Monoid<A>` — Semigroup with identity
- `Numeric<A>` — Full arithmetic operations
- `hashNumber`, `hashString`, `hashBoolean`, `hashBigInt`, `hashDate` — Primitive Hash instances
- `makeHash(fn)`, `hashBy(f, H)`, `hashArray(H)` — Hash combinators
- `FlatMap<F>` — Sequencing for type constructors (map, flatMap)
- `flatMapArray`, `flatMapPromise`, `flatMapIterable`, `flatMapAsyncIterable` — Built-in instances (exported by the `@typesugar/std/syntax/do` marker; custom instances are declared with `@impl` JSDoc tags and resolved from scope, PEP-052)

### Macros

- `let:/yield:` or `seq:/yield:` — Sequential (monadic) do-notation with guards, fallbacks, and discard bindings
- `par:/yield:` or `all:/yield:` — Parallel (applicative) comprehensions with Promise.all / .map().ap()

### Data Type Exports

- `MatchError` — Runtime error thrown when a match is non-exhaustive and no arm matches (extends `Error`, has `.value` property)
- `Pair<A, B>`, `Triple<A, B, C>` — Tuple types with utilities
- `Range` — Numeric ranges with iteration support
  - Creation: `to(n, end)`, `until(n, end)` (extension methods on number)
  - Transform: `step(r, s)`, `reversed(r)` (extension methods on Range)
  - Materialize: `toArray(r)`, `iterator(r)`
  - Query: `contains(r, v)`, `first(r)`, `last(r)`, `size(r)`, `isEmpty(r)`
  - Iterate: `forEach(r, fn)`, `map(r, fn)`, `filter(r, fn)`, `reduce(r, init, fn)`

## License

MIT
