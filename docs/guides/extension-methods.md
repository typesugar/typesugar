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

The transformer detects that `std.clamp` exists and has a compatible first parameter type.

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

### @extension Decorator (Per-Function Control)

For individual functions when you don't want a file-level directive:

```typescript
import { extension } from "typesugar";

@extension
export function volume(box: Box): number {
  return box.width * box.height * box.depth;
}

@extension
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
import { capitalize, titleCase, truncate, collapseWhitespace } from "@typesugar/std";

"hello".capitalize(); // "Hello"
"hello world".titleCase(); // "Hello World"
"  extra   spaces  ".collapseWhitespace(); // "extra spaces"
"hello world".truncate(8); // "hello..."
```

### Array Extensions

```typescript
import { head, tail, chunk, unique, groupBy } from "@typesugar/std";

[1, 2, 3].head(); // 1
[1, 2, 3].tail(); // [2, 3]
[1, 2, 3, 4, 5].chunk(2); // [[1, 2], [3, 4], [5]]
[1, 1, 2, 2, 3].unique(); // [1, 2, 3]
[1, 2, 3].groupBy((x) => x % 2); // { 1: [1, 3], 0: [2] }
```

### Range Extensions (Scala/Kotlin-style)

Create lazy ranges with fluent syntax, then chain transformations and queries:

```typescript
import { to, until, step, toArray, contains, first } from "@typesugar/std";

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

Ranges are lazy — they don't allocate arrays until you call `.toArray()`, `.map()`, or iterate.

## Resolution Order

When the transformer encounters `value.method()`:

1. **Native property**: If `value` has a property `method`, use it
2. **Type rewrite registry** (PEP-012): If the receiver type is `@opaque`, look up the method in the type rewrite registry and rewrite to the companion function
3. **Global augmentation**: If the method is declared via `declare global { interface T { ... } }`, the type checker sees it, and the transformer rewrites via `forceRewrite`
4. **Extension functions in scope**: Imported functions with matching first parameter
5. **Typeclass methods**: Auto-derived via `summon()`

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
import { format } from "@typesugar/std";
import { format } from "./my-date-utils";

date.format(pattern);
// Error: Ambiguous extension method 'format' for type 'Date'
// Two extensions match:
//   - format (from "@typesugar/std")
//   - format (from "./my-date-utils")
```

Fix by using qualified calls:

```typescript
import { format as stdFormat } from "@typesugar/std";
import { format as myFormat } from "./my-date-utils";

stdFormat(date, pattern); // Explicit choice
```

## Typeclass Extensions

Typeclass methods also work as extension methods:

```typescript
import { Show, Eq } from "@typesugar/std";

(42).show(); // "42" (from Show<number>)
"hi".show(); // "\"hi\""
point.equals(other); // Eq<Point>.equals
```

When you define a typeclass instance, its methods become callable as extensions:

```typescript
@typeclass
interface Printable<A> {
  print(a: A): void;
}

@instance
const PrintableNumber: Printable<number> = {
  print: (n) => console.log(n),
};

(42).print();  // Calls PrintableNumber.print(42)
```

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

The `extend()` wrapper exists but is rarely needed. It wraps a value so that all typeclass methods become callable:

```typescript
import { extend } from "typesugar";

// Explicit typeclass method access
extend(42).show(); // "42"
extend(point).equals(other); // true/false

// Common: just call methods directly (same effect, cleaner syntax)
(42).show();
point.equals(other);
```

Use `extend()` when:

- **Generic contexts**: Type parameter isn't concrete at the call site
- **Explicit intent**: Documentation or teaching
- **IDE exploration**: See all available typeclass methods via autocomplete

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

The same works for `Either`:

```typescript
import { Right, Left } from "@typesugar/fp";

Right<string, number>(42)
  .map((n) => n * 2)
  .flatMap((n) => (n > 50 ? Right(n) : Left("too small")))
  .getOrElse(() => -1);
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

### Implicit Conversions

SFINAE (PEP-011) allows implicit conversion between an `@opaque` type and its underlying representation:

```typescript
const nullable: number | null = getFromDatabase();
const opt: Option<number> = nullable; // No error — same representation
const raw: number | null = opt; // Also fine
```

No `fromNullable()` or `toNullable()` ceremony needed.

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
