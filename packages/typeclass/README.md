# @ttfx/typeclass

> Scala 3-style typeclasses with compile-time resolution.

## Overview

`@ttfx/typeclass` brings Scala's powerful typeclass pattern to TypeScript. Define typeclasses, provide instances, auto-derive implementations, and summon instances at compile time — no runtime dictionary passing overhead.

## Installation

```bash
npm install @ttfx/typeclass
# or
pnpm add @ttfx/typeclass
```

## Usage

### Define a Typeclass

```typescript
import { typeclass } from "@ttfx/typeclass";

@typeclass
interface Show<A> {
  show(a: A): string;
}

@typeclass
interface Eq<A> {
  equals(a: A, b: A): boolean;
}

@typeclass
interface Ord<A> extends Eq<A> {
  compare(a: A, b: A): -1 | 0 | 1;
}
```

### Provide Instances

```typescript
import { instance } from "@ttfx/typeclass";

@instance(Show, Number)
const numberShow: Show<number> = {
  show: (n) => n.toString(),
};

@instance(Eq, String)
const stringEq: Eq<string> = {
  equals: (a, b) => a === b,
};
```

### Auto-Derive Instances

```typescript
import { deriving } from "@ttfx/typeclass";

@deriving(Show, Eq, Ord)
interface User {
  id: number;
  name: string;
}

// Generated instances use JSON-based implementations:
// - userShow: Show<User>
// - userEq: Eq<User>
// - userOrd: Ord<User>
```

### Summon Instances

```typescript
import { summon } from "@ttfx/typeclass";

// Get a typeclass instance at compile time
const showNumber = summon<Show<number>>();
// Compiles to: numberShow

console.log(showNumber.show(42)); // "42"
```

### Extension Methods with extend()

```typescript
import { extend } from "@ttfx/typeclass";

// Add typeclass methods to a value
const result = extend(42).show();
// Compiles to: { value: 42, show: () => numberShow.show(42) }

console.log(result.show()); // "42"
```

## Implicit Extension Methods

The transformer can automatically rewrite method calls on types with typeclass instances:

```typescript
// If User has a Show instance:
user.show();
// Compiles to: userShow.show(user)
```

## API Reference

### Attribute Macros

- `@typeclass` — Define a typeclass interface
- `@instance(TC, Type)` — Provide a typeclass instance
- `@deriving(TC1, TC2, ...)` — Auto-derive typeclass instances

### Expression Macros

- `summon<TC<T>>()` — Get a typeclass instance at compile time
- `extend(value)` — Wrap a value with extension methods

### Functions

- `getTypeclasses()` — Get all registered typeclasses
- `getInstances()` — Get all registered instances
- `findExtensionMethod(typeName, methodName)` — Find an extension method
- `clearRegistries()` — Clear all registries (for testing)
- `register()` — Register macros (called automatically on import)

## Auto-Derivation

The following typeclasses support auto-derivation with `@deriving`:

| Typeclass | Generated Implementation      |
| --------- | ----------------------------- |
| `Show`    | `JSON.stringify(a)`           |
| `Eq`      | Deep equality via JSON        |
| `Ord`     | Lexicographic JSON comparison |
| `Hash`    | djb2 hash of JSON string      |

## License

MIT
