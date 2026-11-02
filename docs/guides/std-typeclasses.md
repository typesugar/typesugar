# Standard Typeclasses

Overview of the standard typeclasses provided by `@typesugar/std`: Eq, Ord, Show, Monoid, and FlatMap.

## Quick Start

```bash
npm install @typesugar/std
```

Nothing is derived automatically: you ask for instances with `@derive`, and
operator sugar (`===`, `<`, `+`) is switched on per typeclass with a
`@typesugar/std/syntax/<typeclass>/ops` import. Without that import the
operator keeps its plain JavaScript meaning.

```typescript
import { summon } from "typesugar";
import { type Show } from "@typesugar/std";
import "@typesugar/std/syntax/eq/ops";
import "@typesugar/std/syntax/ord/ops";

/** @derive(Eq, Ord, Show) */
interface Point {
  x: number;
  y: number;
}

const p1: Point = { x: 1, y: 2 };
const p2: Point = { x: 1, y: 3 };

p1 === p2; // Uses Eq — false (compiles to Point.Eq.equals(p1, p2))
p1 < p2; // Uses Ord — true: x ties, then y decides
summon<Show<Point>>().show(p1); // Uses Show — "Point(x = 1, y = 2)"
```

## Available Typeclasses

### Eq — Equality

Structural equality comparison via `===` and `!==`, after
`import "@typesugar/std/syntax/eq/ops"`.

```typescript
import "@typesugar/std/syntax/eq/ops";

/** @derive(Eq) */
interface User {
  id: number;
  name: string;
}
user1 === user2; // Compiles to User.Eq.equals(user1, user2)
```

### Ord — Ordering

Comparison operations via `<`, `>`, `<=`, `>=`, after
`import "@typesugar/std/syntax/ord/ops"`.

```typescript
// With /** @derive(Ord) */ on User: lexicographic comparison by field order
user1 < user2; // Compares id first, then name
```

### Show — String Representation

Human-readable string conversion. std ships no `.show()` method sugar, so call
the instance: `summon<Show<Point>>().show(point)` or the derived companion
`Point.Show.show(point)`.

```typescript
Point.Show.show(point); // "Point(x = 1, y = 2)"
```

### Monoid — Combining Values

Associative binary operation with identity. `+` dispatches to `combine` after
`import "@typesugar/std/syntax/monoid/ops"` (or `.../syntax/semigroup/ops` for a
`Semigroup` instance) when the type has an instance in scope.

```typescript
import { type Monoid } from "@typesugar/std";
import "@typesugar/std/syntax/monoid/ops";

interface Totals {
  count: number;
  sum: number;
}

/** @impl Monoid<Totals> */
const totalsMonoid: Monoid<Totals> = {
  empty: () => ({ count: 0, sum: 0 }),
  combine: (a, b) => ({ count: a.count + b.count, sum: a.sum + b.sum }),
};

const value1: Totals = { count: 1, sum: 10 };
const value2: Totals = { count: 2, sum: 5 };
const combined = value1 + value2; // { count: 3, sum: 15 }
```

### FlatMap — Sequencing

Enables `let:/yield:` do-notation for any type. Instance resolution is scope-based (PEP-052): the built-in instances for Array, Promise, Iterable, and AsyncIterable come with the `import "@typesugar/std/syntax/do"` marker, and custom types declare an `@impl`-tagged instance instead of calling a registration function:

```typescript
// Declare in this file, or export and import the module
/** @impl FlatMap<Option> */
export const flatMapOption = {
  map: (fa, f) => fa.map(f),
  flatMap: (fa, f) => fa.flatMap(f),
};
```

## Learn More

- [Extension Methods Guide](/guides/extension-methods)
- [Do-Notation Guide](/guides/do-notation)
- [API Reference](/reference/packages#std)
