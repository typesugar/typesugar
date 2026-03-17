# @typesugar/typeclass

> Scala 3-style typeclasses with compile-time resolution.

## Overview

`@typesugar/typeclass` brings Scala's powerful typeclass pattern to TypeScript. Define typeclasses, provide instances, auto-derive implementations, and summon instances at compile time — no runtime dictionary passing overhead.

## Installation

```bash
npm install @typesugar/typeclass
# or
pnpm add @typesugar/typeclass
```

## Usage

### Define a Typeclass (JSDoc Syntax — Preferred)

JSDoc tags work without the preprocessor and provide better tooling support:

```typescript
/** @typeclass */
interface Show<A> {
  show(a: A): string;
}

/** @typeclass */
interface Eq<A> {
  equals(a: A, b: A): boolean;
}

/** @typeclass */
interface Ord<A> extends Eq<A> {
  compare(a: A, b: A): -1 | 0 | 1;
}
```

### Operator Mapping with @op

Map typeclass methods to operators using `@op` JSDoc tags on method signatures:

```typescript
/** @typeclass */
interface Numeric<A> {
  /** @op + */
  add(a: A, b: A): A;

  /** @op * */
  mul(a: A, b: A): A;

  /** @op - */
  sub(a: A, b: A): A;
}
```

When an instance exists, operators compile to typeclass method calls:

```typescript
a + b; // Compiles to: numericInstance.add(a, b)
a * b; // Compiles to: numericInstance.mul(a, b)
```

### Provide Instances

```typescript
/** @impl Show<number> */
const numberShow: Show<number> = {
  show: (n) => n.toString(),
};

/** @impl Eq<string> */
const stringEq: Eq<string> = {
  equals: (a, b) => a === b,
};
```

For HKT typeclasses (Functor, Monad), use the same syntax — no `*F` companion needed:

```typescript
/** @impl Functor<Option> */
const optionFunctor = {
  map: (fa, f) => (fa === null ? null : f(fa)),
};

/** @impl Functor<Either<string>> */  // Partial application: fixes E, varies A
const eitherStringFunctor = { ... };
```

### Auto-Derive Instances

```typescript
/** @derive Eq, Ord, Show */
interface User {
  id: number;
  name: string;
}

// Generated instances use structural implementations:
// - userShow: Show<User>
// - userEq: Eq<User>
// - userOrd: Ord<User>
```

### Summon Instances

```typescript
import { summon } from "@typesugar/typeclass";

// Get a typeclass instance at compile time
const showNumber = summon<Show<number>>();
// Compiles to: numberShow

console.log(showNumber.show(42)); // "42"
```

### Extension Methods with extend()

```typescript
import { extend } from "@typesugar/typeclass";

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

## Alternative Syntax (Decorator)

If you're using the preprocessor, you can also use decorator syntax. This is rewritten to expression macros internally:

```typescript
@typeclass
interface Show<A> {
  show(a: A): string;
}

@impl(Show, Number)
const numberShow: Show<number> = {
  show: (n) => n.toString(),
};

@derive(Show, Eq)
interface User {
  id: number;
  name: string;
}
```

## API Reference

### JSDoc Tags (Preferred — No Preprocessor Required)

- `/** @typeclass */` — Define a typeclass interface
- `/** @impl TC<Type> */` — Provide a typeclass instance
- `/** @derive TC1, TC2, ... */` — Auto-derive typeclass instances
- `/** @op <symbol> */` — Map a method to an operator (+, -, \*, /, ===, etc.)

### Attribute Macros (Decorator Syntax)

- `@typeclass` — Define a typeclass interface (requires preprocessor)
- `@impl(TC, Type)` — Provide a typeclass instance
- `@derive(TC1, TC2, ...)` — Auto-derive typeclass instances

### Expression Macros

- `summon<TC<T>>()` — Get a typeclass instance at compile time
- `extend(value)` — Wrap a value with extension methods

### Functions

- `getTypeclasses()` — Get all registered typeclasses
- `getInstances()` — Get all registered instances
- `findInstance(typeclassName, forType)` — Find an instance
- `getTypeclass(name)` — Get a typeclass definition
- `clearRegistries()` — Clear all registries (for testing)

## Deprecated Syntax

The following patterns still work but are deprecated:

| Deprecated               | Preferred                  |
| ------------------------ | -------------------------- |
| `@instance`              | `@impl`                    |
| `Op<"+">` return type    | `@op +` JSDoc tag          |
| `instance("TC<T>", obj)` | `/** @impl TC<T> */` JSDoc |
| `typeclass("Name")`      | `/** @typeclass */` JSDoc  |

## Auto-Derivation

The following typeclasses support auto-derivation with `@derive`:

| Typeclass | Generated Implementation      |
| --------- | ----------------------------- |
| `Show`    | `JSON.stringify(a)`           |
| `Eq`      | Deep equality via JSON        |
| `Ord`     | Lexicographic JSON comparison |
| `Hash`    | djb2 hash of JSON string      |

## License

MIT
