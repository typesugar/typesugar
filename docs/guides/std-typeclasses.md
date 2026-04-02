# Standard Typeclasses

Overview of the standard typeclasses provided by `@typesugar/std`: Eq, Ord, Show, Monoid, and FlatMap.

## Quick Start

```bash
npm install @typesugar/std
```

```typescript
import { extend } from "typesugar";
import { Eq, Ord, Show, Monoid, FlatMap } from "@typesugar/std";

// Typeclasses are auto-derived for your types
interface Point {
  x: number;
  y: number;
}

const p1: Point = { x: 1, y: 2 };
const p2: Point = { x: 1, y: 2 };

p1 === p2; // Uses Eq — true
p1 < p2; // Uses Ord — lexicographic comparison
p1.show(); // Uses Show — "Point(x = 1, y = 2)"
```

## Available Typeclasses

### Eq — Equality

Structural equality comparison via `===`.

```typescript
// Auto-derived for any type with Eq fields
interface User {
  id: number;
  name: string;
}
user1 === user2; // Compiles to User.Eq.equals(user1, user2)
```

### Ord — Ordering

Comparison operations via `<`, `>`, `<=`, `>=`.

```typescript
// Lexicographic comparison by field order
user1 < user2; // Compares id first, then name
```

### Show — String Representation

Human-readable string conversion via `.show()`.

```typescript
point.show(); // "Point(x = 1, y = 2)"
```

### Monoid — Combining Values

Associative binary operation with identity via `+`.

```typescript
// Combine values of the same type
const combined = value1 + value2;
```

### FlatMap — Sequencing

Enables `let:/yield:` do-notation for any type.

```typescript
import { registerFlatMap } from "@typesugar/std";

// Built-in for Array, Promise, Iterable
// Register custom types:
registerFlatMap("Option", {
  map: (fa, f) => fa.map(f),
  flatMap: (fa, f) => fa.flatMap(f),
});
```

## Learn More

- [Extension Methods Guide](/guides/extension-methods)
- [Do-Notation Guide](/guides/do-notation)
- [API Reference](/reference/packages#std)
