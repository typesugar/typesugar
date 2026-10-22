# Extension Methods

typesugar supports Scala 3-style extension methods — call methods on types that don't natively have them, with zero runtime cost. This is Uniform Function Call Syntax (UFCS) for TypeScript.

::: tip Try in Playground
**[Open in Playground →](https://typesugar.org/playground#code=eJxLSS1OUcjMK0ktLlFwzCsuycnMS9dRSM7PS0nNK1HIzC3IL0pVyE0syczPAwCfKw0V)** to see extension methods in action.
:::

## How It Works

Any imported function whose first parameter matches the receiver type can be called as a method. Just import and call:

```typescript
import { clamp, abs, capitalize, head } from "@typesugar/std";

// Functions become methods automatically
(-5).abs(); // → abs(-5) → Math.abs(-5) → 5
(42).clamp(0, 100); // → clamp(42, 0, 100) → 42
"hello".capitalize(); // → capitalize("hello") → "Hello"
[1, 2, 3].head(); // → head([1, 2, 3]) → 1

// Direct calls still work
clamp(42, 0, 100); // → 42
```

The transformer detects method calls, looks up matching extension functions from your imports, and rewrites to direct function calls — zero wrapper overhead.

## Creating Extensions

### The Simple Rule

Any function whose first parameter type matches the receiver type works as an extension:

```typescript
// my-extensions.ts
export function double(n: number): number {
  return n * 2;
}

export function greet(name: string): string {
  return `Hello, ${name}!`;
}
```

Usage:

```typescript
import { double, greet } from "./my-extensions";

(42).double(); // → double(42) → 84
"Alice".greet(); // → greet("Alice") → "Hello, Alice!"
```

### Namespace Imports

Namespace imports also work — extensions activate for any function accessible in scope:

```typescript
import * as std from "@typesugar/std";

(42).clamp(0, 100); // → std.clamp(42, 0, 100)
"hello".capitalize(); // → std.capitalize("hello")
```

The transformer detects that `std.clamp` exists and has a compatible first parameter type. (The
same function reached through both a named and a namespace import counts once.)

**Trade-off:** Named imports enable better tree-shaking and make dependencies explicit. Namespace imports are convenient but may include unused code in the bundle.

### "use extension" Directive (Recommended for Libraries)

For libraries and modules where you want to be explicit that all exports are intended as extensions:

```typescript
// my-extensions.ts
"use extension";

export function distance(p: Point, other: Point): number {
  return Math.sqrt((p.x - other.x) ** 2 + (p.y - other.y) ** 2);
}

export function midpoint(p: Point, other: Point): Point {
  return { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 };
}
```

Usage:

```typescript
import { distance, midpoint } from "./my-extensions";

p1.distance(p2); // → distance(p1, p2)
p1.midpoint(p2); // → midpoint(p1, p2)
```

### @extension (Per-Function Control)

For individual functions when you don't want a file-level directive. The decorator form is
TS1206 under plain `tsc` (decorators aren't allowed on functions); the JSDoc form
`/** @extension */` does the same and is `tsc`-clean (see
[JSDoc vs Decorators](./jsdoc-vs-decorators.md)):

```typescript
import { extension } from "typesugar";

@extension
export function volume(box: Box): number {
  return box.width * box.height * box.depth;
}

/** @extension */
export function surface(box: Box): number {
  return 2 * (box.width * box.height + box.height * box.depth + box.width * box.depth);
}
```

## Built-in Extensions

### Number Extensions

```typescript
import { clamp, abs, ceil, floor, sqrt, isEven, isPrime } from "@typesugar/std";

(-5).abs(); // Math.abs(-5) → 5
(42).clamp(0, 100); // clamp to range → 42
(3.7).ceil(); // Math.ceil(3.7) → 4
(3.7).floor(); // Math.floor(3.7) → 3
(16).sqrt(); // Math.sqrt(16) → 4
(42).isEven(); // true
(7).isPrime(); // true
```

### String Extensions

```typescript
import { capitalize, camelCase, kebabCase, truncate } from "@typesugar/std";

"hello".capitalize(); // "Hello"
"hello world".camelCase(); // "helloWorld"
"hello world".kebabCase(); // "hello-world"
"hello world".truncate(8); // "hello..."
```

### Array Extensions

```typescript
import { head, tail, chunk, unique, groupBy } from "@typesugar/std";

[1, 2, 3].head(); // 1
[1, 2, 3].tail(); // [2, 3]
[1, 2, 3, 4, 5].chunk(2); // [[1, 2], [3, 4], [5]]
[1, 1, 2, 2, 3].unique(); // [1, 2, 3]
[1, 2, 3].groupBy((x) => x % 2); // { 0: [2], 1: [1, 3] }
```

### Range Extensions (Scala/Kotlin-style)

Create ranges with fluent syntax, then chain transformations and queries. Import every
function you call as a method — the import is what enables the method syntax:

```typescript
import {
  to,
  until,
  step,
  toArray,
  reversed,
  contains,
  first,
  forEach,
  map,
  filter,
} from "@typesugar/std";

// Create ranges
(1).to(10); // Range { 1..10 inclusive }
(1).until(10); // Range { 1..<10 exclusive }

// Chain transformations
(0).to(100).step(10).toArray(); // [0, 10, 20, ..., 100]
(1).to(5).reversed().toArray(); // [5, 4, 3, 2, 1]

// Queries
(1).to(100).contains(42); // true
(1).to(10).first(); // 1

// Iteration
(1).to(5).forEach((n) => console.log(n));
(1).to(5).map((n) => n * n); // [1, 4, 9, 16, 25]
(1).to(10).filter((n) => n % 2 === 0); // [2, 4, 6, 8, 10]
```

A `Range` is a plain `{ start, end, step, inclusive }` object, so it doesn't allocate an array
until you call `.toArray()`, `.map()` or `.filter()`. It is not iterable: use `.forEach()` or
`.toArray()` rather than `for...of`.

## Resolution Order

When the transformer encounters `value.method()`:

1. **Native property**: If `value` has a property `method`, use it
2. **Type rewrite registry** (PEP-012): If the receiver type is `@opaque`, look up the method in the type rewrite registry and rewrite to the companion function
3. **Global augmentation**: If the method is declared via `declare global { interface T { ... } }`, the type checker sees it, and the transformer rewrites via `forceRewrite`
4. **Extension functions in scope**: Imported functions with matching first parameter
5. **Typeclass methods**: Rewritten to a call on the instance in scope (an `@impl` or `derived<TC<T>>()` value, or a `@derive`d companion such as `Point.Show`) — `p.show()` → `Point.Show.show(p)`. There is no runtime `Show.summon`; `summon<Show<Point>>()` is a compile-time macro.

Type rewrite registry (step 2) has highest priority for `@opaque` types because the registry is authoritative. Global augmentation (step 3) handles built-in type extensions from `@typesugar/std`.

```typescript
import { clamp } from "@typesugar/std";

(42).clamp(0, 100);
// 1. number has no property 'clamp' (natively)
// 2. Not an @opaque type
// 3. Found via global augmentation: Number.clamp()
// → clamp(42, 0, 100)
```

```typescript
import { Some } from "@typesugar/fp";
import type { Option } from "@typesugar/fp";

Some(5).map((n) => n * 2);
// 1. Option has no native property 'map'
// 2. Type rewrite registry: Option.map → map(receiver, ...args)
// → map(Some(5), n => n * 2)
```

## Ambiguity Detection

If multiple extension functions match the same receiver type and method name, the transformer emits a compile error:

```typescript
import * as dateA from "./date-utils-a";
import * as dateB from "./date-utils-b";

date.format(pattern);
// Error: Ambiguous extension method 'format' for type 'Date'. Multiple extensions match:
//   - dateA.format (from "./date-utils-a")
//   - dateB.format (from "./date-utils-b")
// Use an explicit qualifier or rename one of the imports to disambiguate.
```

Fix by using qualified calls:

```typescript
dateA.format(date, pattern); // Explicit choice
```

## Typeclass Extensions

Typeclass methods also work as extension methods on types that have an instance — a
`@derive`d companion, an `@impl` value, or a `derived<TC<T>>()` const for a type you don't
own. For the standard typeclasses, the method syntax is
off until you import the typeclass's activation module (PEP-052):

```typescript
import "@typesugar/std/syntax/eq"; // enables .equals() / .notEquals()

/** @derive(Eq) */
interface Point {
  x: number;
  y: number;
}

point.equals(other); // → Point.Eq.equals(point, other)
```

The activation modules are `@typesugar/std/syntax/<typeclass>` (`eq`, `ord`, `clone`, `debug`,
`default`, `json`, …). Method sugar is not provided for primitives: `(42).equals(42)` is not
rewritten.

When you define a typeclass and an instance in your own code, its methods become callable as
extensions with no activation import:

```typescript
/** @typeclass */
interface Printable<A> {
  print(a: A): string;
}

interface Money {
  cents: number;
}

/** @impl Printable<Money> */
const printableMoney: Printable<Money> = {
  print: (m) => `$${(m.cents / 100).toFixed(2)}`,
};

const price: Money = { cents: 1999 };
price.print(); // → printableMoney.print(price) → "$19.99"
```

An instance is used only for the type it is declared for, compared by identity. If you import
`showColor` (an `@impl Show<Color>` for a numeric enum `Color`), `color.show()` becomes
`showColor.show(color)`, but `n.show()` on a `number` is not rewritten to it, even though a
`number` can be assigned to `Color`.
An instance for a union type serves a value narrowed to its members too: with
`@impl Describe<Shape>` and `type Shape = Circle | Square`, `t.describe()` inside
`if (t.kind === "circle")` becomes `describeShape.describe(t)`.

## Generic Extensions

Extensions work with generic types:

```typescript
"use extension";

export function first<T>(arr: T[]): T | undefined {
  return arr[0];
}

export function mapTo<T, U>(arr: T[], value: U): U[] {
  return arr.map(() => value);
}
```

Usage:

```typescript
import { first, mapTo } from "./generic-ext";

[1, 2, 3].first(); // 1
["a", "b"].first(); // "a"
[1, 2, 3].mapTo("x"); // ["x", "x", "x"]
```

## When to Use `extend()`

`extend(value).method(args)` is rarely needed. It calls `method` on `value` through a typeclass
instance or an extension, the same as method syntax does:

```typescript
import "@typesugar/std/syntax/eq";
import { extend } from "typesugar";

// Explicit typeclass method access
extend(point).equals(other); // → Point.Eq.equals(point, other)

// Common: just call methods directly (same effect, cleaner syntax)
point.equals(other);
```

`extend(value).method(args)` is a call form, not a wrapper: it compiles to a direct call on the
instance or extension (`Point.Eq.equals(point, other)`), and no object exists at run time that
could stand for `extend(point)`. So `extend()` must be followed by the method call in the same
expression. `const e = extend(point); e.equals(other)` is an error that says what to write
instead: `extend(point).equals(other)`, method syntax `point.equals(other)`, or the instance
itself, `const E = summon<Eq<Point>>(); E.equals(point, other)`.

It works on concrete types only. On an unconstrained type parameter (`function f<T>(x: T)`)
there is no instance to choose, and `extend(x).show()` is an error. Take the instance as a
parameter instead (`S: Show<T> = implicit()`; see [Generic Functions](./typeclasses.md#generic-functions-implicit)).

Use `extend()` when you want the typeclass dispatch to be explicit at the call site, for example
in documentation or teaching.

## Legacy: registerExtensions() (Deprecated)

The older `registerExtensions()` and `registerExtension()` macros are still supported:

```typescript
import { registerExtensions, registerExtension } from "typesugar";

registerExtensions("number", MathExt);
registerExtension("string", myStringFunction);
```

Prefer the `"use extension"` directive for new code.

## Best Practices

### Do

- Use `"use extension"` directive for extension modules
- Keep extension functions pure
- Document extensions in your package README
- Use descriptive names that won't conflict

### Don't

- Shadow built-in methods unintentionally (check `Object.prototype`, `Array.prototype`, etc.)
- Create extensions with side effects
- Export functions that aren't meant to be called as methods

## Comparison to Other Languages

| Feature           | typesugar               | Scala 3    | Kotlin       | C#           |
| ----------------- | ----------------------- | ---------- | ------------ | ------------ |
| Syntax            | `x.method()`            | `x.method` | `x.method()` | `x.Method()` |
| Import-scoped     | Yes                     | Yes        | Yes          | Yes          |
| Typeclass-derived | Yes                     | Yes        | No           | No           |
| Zero-cost         | Yes                     | Yes        | Yes          | Yes          |
| File directive    | Yes (`"use extension"`) | No         | No           | No           |

## @opaque Type Macros (PEP-012)

For types you define with `@opaque`, methods are resolved via the **type rewrite registry** — no import of individual extension functions needed. Just importing the type's constructors is enough:

```typescript
import { Some, None } from "@typesugar/fp";
import type { Option } from "@typesugar/fp";

// Before PEP-012: namespace imports required
// import * as O from "@typesugar/fp/data/option";
// O.map(Some(5), n => n * 2);

// After PEP-012: dot syntax works directly
Some(5).map((n) => n * 2); // → map(Some(5), n => n * 2)
Some(3).flatMap((n) => Some(n * 10)); // → flatMap(Some(3), n => Some(n * 10))
Some("hi").getOrElse(() => ""); // → getOrElse(Some("hi"), () => "")
```

Chain operations fluently:

```typescript
const result = Some(5)
  .map((n) => n * 2)
  .filter((n) => n > 5)
  .getOrElse(() => 0);
// Compiles to: getOrElse(filter(map(5, n => n * 2), n => n > 5), () => 0)
```

`Either` is not `@opaque`, so it has no dot syntax: `Right(42).map(...)` is a type error and
a runtime `TypeError`. Use the functions from `@typesugar/fp/data/either`:

```typescript
import { Right, Left, type Either } from "@typesugar/fp";
import * as E from "@typesugar/fp/data/either";

E.getOrElse(
  E.flatMap(
    E.map(Right<string, number>(42), (n) => n * 2),
    (n): Either<string, number> => (n > 50 ? Right(n) : Left("too small"))
  ),
  () => -1
); // 84
```

### How @opaque Works

The `@opaque` JSDoc macro on an interface tells the system:

1. **TypeScript sees**: The interface with all its methods (IDE completions, type inference)
2. **Runtime uses**: The underlying type (`A | null` for Option, tagged union for Either)
3. **Transformer rewrites**: `.method(args)` → `standaloneFn(receiver, args)`

```typescript
/** @opaque A | null */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
  flatMap<B>(f: (a: A) => Option<B>): Option<B>;
  getOrElse(defaultValue: () => A): A;
  // ...
}
```

Within the defining module, the type is "transparent" — implementations can use `=== null` directly without fighting the type system.

### Converting to and from the representation

An `Option<number>` and a `number | null` are the same value at runtime, but not the same type:
assigning one to the other is a type error. Convert explicitly:

```typescript
import * as O from "@typesugar/fp/data/option";

const nullable: number | null = getFromDatabase();
const opt: Option<number> = O.fromNullable(nullable);
const raw: number | null = O.toNullable(opt);
```

## Global Augmentation (Built-in Types)

For methods on built-in types (`Number`, `String`, `Array`, etc.), `@typesugar/std` uses global augmentation:

```typescript
// In @typesugar/std (behind the scenes):
declare global {
  interface Number {
    clamp(min: number, max: number): number;
    isEven(): boolean;
    abs(): number;
    // ...
  }
  interface String {
    capitalize(): string;
    camelCase(): string;
    // ...
  }
  interface Array<T> {
    head(): T | undefined;
    chunk(size: number): T[][];
    // ...
  }
}
```

TypeScript sees the methods; the transformer rewrites to function calls. No prototype mutation.

## Zero-Cost Guarantee

Extension methods compile away completely:

```typescript
// Source
import { clamp } from "@typesugar/std";
(42).clamp(0, 100);

// Compiled output
clamp(42, 0, 100);
```

No runtime wrappers, no prototype pollution, no indirection.
