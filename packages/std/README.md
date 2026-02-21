# @typesugar/std

> Standard library extensions for TypeScript.

## Overview

`@typesugar/std` provides a comprehensive set of typeclasses, extension methods, data types, and macros for enriching basic TypeScript types. Draws from the best of Haskell, Scala, Rust, Kotlin, Swift, and commonly-requested JS/TS utilities.

## Installation

```bash
npm install @typesugar/std
# or
pnpm add @typesugar/std
```

## Usage

### Extension Methods (Scala 3-style)

Extension methods are import-scoped. Import a namespace or function from
`@typesugar/std` and the transformer automatically resolves undefined method
calls against what's in scope:

```typescript
import { extend } from "typesugar";
import { NumberExt, StringExt, ArrayExt } from "@typesugar/std";

// extend() with namespace imports
extend(42).clamp(0, 100); // → NumberExt.clamp(42, 0, 100)
extend(255).toHex(); // → NumberExt.toHex(255)
extend(7).isPrime(); // → NumberExt.isPrime(7)

extend("hello world").capitalize(); // → StringExt.capitalize("hello world")

extend([1, 2, 3, 4, 5]).chunk(2); // → ArrayExt.chunk([1, 2, 3, 4, 5], 2)
extend([3, 1, 4, 1, 5]).unique(); // → ArrayExt.unique([3, 1, 4, 1, 5])
```

Implicit extension rewriting (no `extend()` needed):

```typescript
import { NumberExt } from "@typesugar/std";

(42).clamp(0, 100); // → NumberExt.clamp(42, 0, 100)
(7).isPrime(); // → NumberExt.isPrime(7)
```

Bare function imports work too:

```typescript
import { clamp, isPrime } from "@typesugar/std";

(42).clamp(0, 100); // → clamp(42, 0, 100)
clamp(42, 0, 100); // also works as a direct call
```

### Ranges (Scala/Kotlin-style)

```typescript
import { range, rangeToArray } from "@typesugar/std";
rangeToArray(range(1, 10)); // [1, 2, ..., 9]
```

## FlatMap Typeclass

The `FlatMap` typeclass provides sequencing/chaining operations for type constructors. It's the minimal typeclass required for the `let:/yield:` do-notation macro.

```typescript
import { registerFlatMap, getFlatMap } from "@typesugar/std";

// Built-in instances for Array, Promise, Iterable, AsyncIterable
const arrayFlatMap = getFlatMap("Array");

// Register custom instances
registerFlatMap("Option", {
  map: (fa, f) => fa.map(f),
  flatMap: (fa, f) => fa.flatMap(f),
});
```

## let:/yield: Do-Notation Macro

Generic do-notation syntax that works with any type that has a `FlatMap` instance. Desugars `let: { x << expr }` blocks into flatMap chains.

### With Array

```typescript
let: {
  x << [1, 2, 3];
  y << [x * 10, x * 20];
}
yield: ({ x, y });

// Compiles to:
// [1, 2, 3].flatMap(x => [x * 10, x * 20].map(y => ({ x, y })))
// → [{ x: 1, y: 10 }, { x: 1, y: 20 }, { x: 2, y: 20 }, ...]
```

### With Promise

```typescript
let: {
  user << fetchUser(id);
  posts << fetchPosts(user.id);
}
yield: ({ user, posts });

// Compiles to:
// fetchUser(id).then(user => fetchPosts(user.id).then(posts => ({ user, posts })))
```

### With Custom Types

Any type with a registered `FlatMap` instance works with `let:/yield:`:

```typescript
import { registerFlatMap } from "@typesugar/std";

registerFlatMap("Option", {
  map: (fa, f) => fa.map(f),
  flatMap: (fa, f) => fa.flatMap(f),
});

// Now Option works with let:/yield:
let: {
  x << some(5);
  y << some(x * 2);
}
yield: ({ x, y });
```

## Extension Methods

Rich extension methods for every basic type:

| Type            | Methods                                                            |
| --------------- | ------------------------------------------------------------------ |
| **NumberExt**   | 45+ methods: `clamp`, `toHex`, `isPrime`, `times`, `abs`, ...      |
| **StringExt**   | 50+ methods: `capitalize`, `toSnakeCase`, `truncate`, `words`, ... |
| **ArrayExt**    | 50+ methods: `chunk`, `unique`, `groupBy`, `partition`, `zip`, ... |
| **ObjectExt**   | 30+ methods: `pick`, `omit`, `mapValues`, `deepMerge`, ...         |
| **BooleanExt**  | 20+ methods: `toInt`, `and`, `or`, `implies`, ...                  |
| **DateExt**     | 40+ methods: `addDays`, `startOfMonth`, `format`, `isWeekend`, ... |
| **MapExt**      | 15+ methods: `mapValues`, `filterKeys`, `merge`, ...               |
| **PromiseExt**  | 20+ methods: `tap`, `timeout`, `retry`, `mapError`, ...            |
| **FunctionExt** | 25+ methods: `memoize`, `debounce`, `throttle`, `compose`, ...     |

## Data Types

### Tuples

```typescript
import { pair, triple, fst, snd, bimap, swap } from "@typesugar/std";

const p = pair(1, "hello");
fst(p); // 1
snd(p); // "hello"
bimap(
  p,
  (x) => x + 1,
  (s) => s.toUpperCase()
); // [2, "HELLO"]
swap(p); // ["hello", 1]
```

### Range

```typescript
import { range, rangeToArray, rangeInclusive } from "@typesugar/std";

rangeToArray(range(1, 5)); // [1, 2, 3, 4]
rangeToArray(rangeInclusive(1, 5)); // [1, 2, 3, 4, 5]
rangeToArray(range(0, 10, 2)); // [0, 2, 4, 6, 8]
```

## API Reference

### Typeclasses

- `FlatMap<F>` — Sequencing for type constructors (map, flatMap)
- `flatMapArray`, `flatMapPromise`, `flatMapIterable`, `flatMapAsyncIterable` — Built-in instances
- `registerFlatMap(name, instance)` — Register a custom FlatMap instance
- `getFlatMap(name)` — Look up a FlatMap instance by name

### Macros

- `let:/yield:` — Do-notation for any type with a FlatMap instance

### Data Types

- `Pair<A, B>`, `Triple<A, B, C>` — Tuple types with utilities
- `Range` — Numeric ranges with iteration support

## License

MIT
