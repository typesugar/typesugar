# Extension Methods

typesugar supports Scala 3-style extension methods — call methods on types that don't natively have them, with zero runtime cost. This is Uniform Function Call Syntax (UFCS) for TypeScript.

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
import { capitalize, titleCase, strip, truncate } from "@typesugar/std";

"hello".capitalize(); // "Hello"
"hello world".titleCase(); // "Hello World"
"  hi  ".strip(); // "hi"
"hello".truncate(3); // "hel..."
```

### Array Extensions

```typescript
import { head, tail, chunk, unique, groupBy } from "@typesugar/std";

[1, 2, 3].head(); // 1
[1, 2, 3].tail(); // [2, 3]
[1, 2, 3, 4, 5].chunk(2); // [[1, 2], [3, 4], [5]]
[1, 1, 2, 2, 3].unique(); // [1, 2, 3]
[1, 2, 3].groupBy((x) => x % 2); // Map { 1: [1, 3], 0: [2] }
```

## Resolution Order

When the transformer encounters `value.method()`:

1. **Native property**: If `value` has a property `method`, use it
2. **Extension functions in scope**: Imported functions with matching first parameter
3. **Typeclass methods**: Auto-derived via `summon()`

Extensions take priority over typeclasses because concrete functions are more specific.

```typescript
import { clamp } from "@typesugar/std";

(42).clamp(0, 100);
// 1. number has no property 'clamp'
// 2. Found: clamp(number, number, number) in imports
// → clamp(42, 0, 100)
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

The `extend()` wrapper exists but is rarely needed. Use it for:

- **Disambiguation**: Multiple typeclasses define the same method name
- **Generic contexts**: Type parameter isn't concrete at the call site
- **Explicit intent**: Documentation or teaching

```typescript
import { extend } from "@typesugar/typeclass";
import { Functor, Applicative } from "@typesugar/fp";

// Rare: disambiguate when multiple typeclasses have .map()
extend(value, Functor).map(f);

// Common: just call methods directly
value.show();
value.clone();
```

## Legacy: registerExtensions() (Deprecated)

The older `registerExtensions()` and `registerExtension()` macros are still supported:

```typescript
import { registerExtensions, registerExtension } from "typesugar";

registerExtensions<number>(MathExt);
registerExtension<string>(myStringFunction);
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
