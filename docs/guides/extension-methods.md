# Extension Methods

typesugar supports Scala 3-style extension methods — call methods on types that don't natively have them, with zero runtime cost.

## How It Works

Extension methods work implicitly. Just import a namespace or function and call methods directly:

```typescript
import { NumberExt, StringExt, ArrayExt } from "@typesugar/std";

// Methods on primitives just work
(42).clamp(0, 100); // → NumberExt.clamp(42, 0, 100)
"hello".capitalize(); // → StringExt.capitalize("hello")
[1, 2, 3].sum(); // → ArrayExt.sum([1, 2, 3])
```

The transformer detects method calls on types, looks up matching extension methods from your imports, and rewrites to direct function calls — zero wrapper overhead.

## Two Types of Extensions

### 1. Typeclass Extensions

Methods from typeclass instances:

```typescript
import { Show, Eq } from "@typesugar/std";

(42).show(); // "42" (from Show<number>)
"hi".show(); // "\"hi\""
point.equals(p); // Eq<Point>.equals
```

### 2. Standalone Extensions

Methods added to specific types via namespaces:

```typescript
import { NumberExt, StringExt } from "@typesugar/std";

(42).clamp(0, 100); // NumberExt.clamp
"hello".capitalize(); // StringExt.capitalize
```

## Built-in Extensions

### Number Extensions

```typescript
import { NumberExt } from "@typesugar/std";

(42).clamp(0, 100); // Clamp to range
(42).times(fn); // Call fn 42 times
(3.14159).round(2); // 3.14
(42).isEven(); // true
(42).isOdd(); // false
(7).isPrime(); // true
```

### String Extensions

```typescript
import { StringExt } from "@typesugar/std";

"hello".capitalize(); // "Hello"
"hello world".titleCase(); // "Hello World"
"  hi  ".strip(); // "hi"
"hello".reverse(); // "olleh"
"hello".truncate(3); // "hel..."
```

### Array Extensions

```typescript
import { ArrayExt } from "@typesugar/std";

[1, 2, 3].first(); // Some(1)
[1, 2, 3].last(); // Some(3)
[1, 2, 3].isEmpty(); // false
[1, 2, 3].nonEmpty(); // true
[1, 2, 3].partition((x) => x > 1); // [[2, 3], [1]]
[1, 2, 3].groupBy((x) => x % 2); // Map { 1: [1, 3], 0: [2] }
```

## Creating Extensions

### For Concrete Types

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

// Automatically discovered from imports
(42).double(); // → double(42) → 84
"Alice".greet(); // → greet("Alice") → "Hello, Alice!"
```

### Extension Namespaces

```typescript
// math-ext.ts
export const MathExt = {
  square(n: number): number {
    return n * n;
  },
  cube(n: number): number {
    return n * n * n;
  },
};
```

Usage:

```typescript
import { MathExt } from "./math-ext";

(3).square(); // 9
(3).cube(); // 27
```

### Registering Extensions Explicitly

```typescript
import { registerExtensions, registerExtension } from "@typesugar/std";

registerExtensions<number>(MathExt);
registerExtension<string>(myStringFunction);
```

## How Resolution Works

When the transformer encounters `value.method()` where `method` doesn't exist on the type:

1. **Typeclass registry**: Check if any typeclass instance provides `method`
2. **Standalone registry**: Check explicit `registerExtensions()` calls
3. **Import scan**: Check all imports for a matching function

```typescript
import { clamp } from "@typesugar/std";

(42).clamp(0, 100);
// 1. No typeclass has clamp for number
// 2. No explicit registration
// 3. Found: clamp(number, number, number) in imports
// → clamp(42, 0, 100)
```

## Typeclass Extensions

When you define a typeclass instance, its methods become extensions:

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

## Precedence

1. **Own methods**: Type's own methods always win
2. **Typeclass methods**: Checked first for polymorphism
3. **Standalone extensions**: Import-scoped functions

```typescript
class MyClass {
  show(): string {
    return "own method";
  }
}

// This calls the class method, not Show<MyClass>.show
new MyClass().show();
```

## Generic Extensions

```typescript
function first<T>(arr: T[]): T | undefined {
  return arr[0];
}

// Works with any array
[1, 2, 3].first(); // 1
["a", "b"].first(); // "a"
```

## When to Use `extend()`

The `extend()` wrapper exists but is rarely needed. Use it for:

- **Disambiguation** — multiple typeclasses define the same method name
- **Generic contexts** — type parameter isn't concrete at the call site
- **Explicit intent** — documentation or teaching

```typescript
import { extend } from "@typesugar/typeclass";
import { Functor, Applicative } from "@typesugar/fp";

// Rare: disambiguate when multiple typeclasses have .map()
extend(value, Functor).map(f);

// Common: just call methods directly
value.show();
value.clone();
```

## Best Practices

### Do

- Use namespaces to organize related extensions
- Keep extension functions pure
- Document extensions in your package

### Don't

- Shadow built-in methods unintentionally
- Create extensions with side effects
- Register the same extension twice

## Comparison to Other Languages

| Feature           | typesugar    | Scala 3    | Kotlin       | C#           |
| ----------------- | ------------ | ---------- | ------------ | ------------ |
| Syntax            | `x.method()` | `x.method` | `x.method()` | `x.Method()` |
| Import-scoped     | Yes          | Yes        | Yes          | Yes          |
| Typeclass-derived | Yes          | Yes        | No           | No           |
| Zero-cost         | Yes          | Yes        | Yes          | Yes          |
