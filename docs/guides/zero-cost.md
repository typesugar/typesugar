# Zero-Cost, Seen

typesugar's headline claim is that everything compiles to **exactly what you'd
write by hand** — no runtime library, no wrapper objects, no dictionary passing.

This page shows the _actual_ output. Every "compiles to" block below is real
`typesugar expand --js` output, not a sketch. Run it yourself on any file:

```bash
typesugar expand src/yourfile.ts --js     # the JavaScript that ships
typesugar expand src/yourfile.ts --diff   # a unified diff against your source
```

Or paste any of these into the **[Playground](/playground)** and flip to the
transformed tab.

## Compile-time evaluation

`comptime()` runs at build time; only the result ships.

**You write:**

```typescript
import { comptime } from "typesugar";

const TABLE = comptime(() => Array.from({ length: 5 }, (_, i) => i * i));
```

**It compiles to:**

```javascript
const TABLE = [0, 1, 4, 9, 16];
```

The function, the loop, and `comptime` itself are gone.

## Derived typeclasses and operators

`@derive` generates the implementation from the type's structure, and operators
resolve to those generated functions — no runtime reflection. Operator rewriting
is opt-in per typeclass: the `@typesugar/std/syntax/eq/ops` import is what turns
`===` into a call to the derived `Eq`. Without it, `a === b` stays reference
equality.

**You write:**

```typescript
import { derive } from "typesugar";
import "@typesugar/std/syntax/eq/ops";

@derive(Eq, Clone)
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

const a = new Point(1, 2);
const b = new Point(1, 2);
const same = a === b; // true
```

**It compiles to:**

```javascript
import "@typesugar/std/syntax/eq/ops";
class Point {
  x;
  y;
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}
(function (Point) {
  Point.Eq = {
    equals: (a, b) => a.x === b.x && a.y === b.y,
    notEquals: (a, b) => !(a.x === b.x && a.y === b.y),
  };
})(Point || (Point = {}));
(function (Point) {
  Point.Clone = { clone: (a) => ({ x: a.x, y: a.y }) };
})(Point || (Point = {}));
const a = new Point(1, 2);
const b = new Point(1, 2);
const same = Point.Eq.equals(a, b); // `a === b` → the derived structural compare
```

The derived `Eq` compares `number` fields with `===` directly; no instance
lookup is left in the output.

## Zero-allocation data types

This is the one that surprises people. `@typesugar/fp`'s `Option` is `A | null`
at runtime — `Some(x)` _is_ `x`, `None` _is_ `null` — and its fluent methods are
rewritten to plain function calls. The "monad" allocates nothing.

**You write:**

```typescript
import { Some } from "@typesugar/fp/data/option";
import type { Option } from "@typesugar/fp/data/option";

const price: Option<number> = Some(42);
const doubled = price.map((n) => n * 2).getOrElse(() => 0);
```

**It compiles to:**

```javascript
import { getOrElse, map } from "@typesugar/fp/data/option";
const price = 42; // Some(42) is just 42 — no wrapper object
const doubled = getOrElse(
  map(price, (n) => n * 2),
  () => 0
); // .map().getOrElse() → function calls
```

No `Option` object is ever created; the method chain becomes direct calls.

## Why this matters

You get the ergonomics of rich abstractions — typeclasses, operators, monadic
data types, contracts, units — and ship the same code a careful engineer would
write by hand. See the [Architecture](../architecture.md) for how the transform
works, or browse runnable [examples](https://github.com/typesugar/typesugar/tree/main/examples).
