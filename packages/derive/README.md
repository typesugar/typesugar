# @typesugar/derive

> Syntactic sugar for TypeScript with zero calories.

## Overview

Typeclass operations work automatically on any type with derivable structure:

```typescript
interface User {
  id: number;
  name: string;
  email: string;
}

const alice: User = { id: 1, name: "Alice", email: "alice@example.com" };
const bob: User = { id: 2, name: "Bob", email: "bob@example.com" };

// Operators just work — auto-derived, auto-specialized
alice === bob; // false (compiles to: alice.id === bob.id && ...)
alice < bob; // true  (lexicographic comparison)

// Methods just work too
alice.show(); // "User(id = 1, name = Alice, email = alice@example.com)"
alice.clone(); // deep copy
alice.toJson(); // JSON serialization
```

**No decorators. No imports.** The compiler derives typeclasses from type structure and inlines them to zero-cost code.

## Installation

```bash
npm install @typesugar/derive
# or
pnpm add @typesugar/derive
```

## Implicit Usage (Default)

Just use operators and methods on your types:

```typescript
interface Point {
  x: number;
  y: number;
}

const p1: Point = { x: 1, y: 2 };
const p2: Point = { x: 1, y: 2 };

p1 === p2; // true  — Eq typeclass
p1 < p2; // false — Ord typeclass
p1.show(); // "Point(x = 1, y = 2)" — Show typeclass
p1.clone(); // { x: 1, y: 2 } — Clone typeclass
p1.hash(); // 12345 — Hash typeclass
```

Everything compiles to direct code:

```typescript
// p1 === p2 compiles to:
p1.x === p2.x && p1.y === p2.y;
```

## Explicit Derivation (Optional)

Use `@derive()` to document capabilities in the type definition:

```typescript
import { derive } from "@typesugar/derive";

@derive(Eq, Ord, Clone, Debug, Hash, Default, Json, Builder)
interface User {
  id: number;
  name: string;
  email?: string;
}
```

This is **purely documentation** — the same operations work without the decorator.

## Available Typeclasses

### Eq — Equality

```typescript
interface Point {
  x: number;
  y: number;
}

p1 === p2; // true
p1.eq(p2); // true (method form)
```

### Ord — Ordering

```typescript
interface Version {
  major: number;
  minor: number;
}

v1 < v2; // true (lexicographic by field order)
v1.compare(v2); // -1
```

### Show — String Representation

```typescript
interface User {
  id: number;
  name: string;
}

user.show(); // "User(id = 1, name = Alice)"
```

### Clone — Deep Copy

```typescript
interface Config {
  settings: Map<string, string>;
}

const c2 = c1.clone(); // Deep copy
```

### Hash — Hash Code

```typescript
interface Point {
  x: number;
  y: number;
}

point.hash(); // Consistent number for hash maps
```

### Default — Default Value

```typescript
interface Options {
  enabled: boolean;
  count: number;
}

Options.default(); // { enabled: false, count: 0 }
```

### Json — Serialization

```typescript
interface User {
  id: number;
  name: string;
}

user.toJson(); // '{"id":1,"name":"Alice"}'
User.fromJson(json); // { id: 1, name: "Alice" }
```

### Builder — Fluent Builder

```typescript
interface User {
  id: number;
  name: string;
  email?: string;
}

new UserBuilder().withId(1).withName("Alice").build();
```

### TypeGuard — Runtime Type Check

```typescript
interface User {
  id: number;
  name: string;
}

if (User.isUser(data)) {
  console.log(data.name); // data is typed as User
}
```

## Custom Instances

When you need non-standard behavior:

```typescript
import { instance } from "@typesugar/typeclass";

interface User {
  id: number;
  name: string;
  passwordHash: string;  // Should not affect equality
}

@instance
const userEq: Eq<User> = {
  eq: (a, b) => a.id === b.id && a.name === b.name,
};
```

## API Reference

### Types

- `DeriveTypeInfo` — Type information passed to derive macros
- `DeriveFieldInfo` — Field information within `DeriveTypeInfo`

### Functions

- `createDerivedFunctionName(operation, typeName)` — Get the conventional function name for a derive operation

### Derive Macros

Use `@derive(Eq, Ord, Clone, ...)` in your code. The built-in derives are registered via the typeclass system. For custom derives, see [Writing Macros](/writing-macros/derive-macros).

## License

MIT
