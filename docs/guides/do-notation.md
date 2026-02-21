# Do-Notation

Do-notation provides clean syntax for chaining monadic operations.

## Basic Syntax

```typescript
import { Option, Some, None } from "@typesugar/fp";

let: {
  x << Some(1);
  y << Some(2);
  z << Some(3);
}
yield: {
  x + y + z;
}
// Result: Some(6)
```

## How It Works

The `let:` block binds values, and `yield:` produces the final result.

```typescript
// This:
let: {
  a << someOption;
  b << anotherOption;
}
yield: {
  a + b;
}

// Compiles to:
someOption.flatMap((a) => anotherOption.map((b) => a + b));
```

## With Option

```typescript
import { Option, Some, None } from "@typesugar/fp";

function divide(a: number, b: number): Option<number> {
  return b === 0 ? None : Some(a / b);
}

const result =
  let: {
    x << divide(10, 2);  // Some(5)
    y << divide(x, 2);   // Some(2.5)
  }
  yield: {
    y * 2  // 5
  }
// result: Some(5)
```

Short-circuits on None:

```typescript
const result =
  let: {
    x << divide(10, 0);  // None
    y << divide(x, 2);   // Never reached
  }
  yield: {
    y * 2
  }
// result: None
```

## With Result

```typescript
import { Result, Ok, Err } from "@typesugar/fp";

function parseNumber(s: string): Result<number, string> {
  const n = parseInt(s);
  return isNaN(n) ? Err("Invalid number") : Ok(n);
}

const result =
  let: {
    x << parseNumber("10");
    y << parseNumber("20");
  }
  yield: {
    x + y
  }
// result: Ok(30)
```

## With Promise

```typescript
const result = await (
  let: {
    user << fetchUser(42);
    posts << fetchPosts(user.id);
    comments << fetchComments(posts[0].id);
  }
  yield: {
    { user, posts, comments }
  }
);
```

## With Array

```typescript
const pairs =
  let: {
    x << [1, 2, 3];
    y << ["a", "b"];
  }
  yield: {
    [x, y] as const
  }
// [[1,"a"], [1,"b"], [2,"a"], [2,"b"], [3,"a"], [3,"b"]]
```

## Guards

Filter with `if`:

```typescript
const evens =
  let: {
    x << [1, 2, 3, 4, 5];
    if: x % 2 === 0;
  }
  yield: {
    x
  }
// [2, 4]
```

## Local Bindings

Use `=` for non-monadic bindings:

```typescript
let: {
  x << Some(10);
  doubled = x * 2; // Regular binding, not flatMap
  y << Some(doubled);
}
yield: {
  y;
}
// Some(20)
```

## Parallel Operations

Use `par:` for parallel execution:

```typescript
par: {
  user << fetchUser(42);
  config << fetchConfig();
  settings << fetchSettings();
}
yield: {
  {
    (user, config, settings);
  }
}
// All three fetch in parallel
```

## Custom FlatMap

Register FlatMap for custom types:

```typescript
import { registerFlatMap } from "@typesugar/std";

class MyMonad<T> {
  constructor(public value: T) {}
  bind<U>(f: (t: T) => MyMonad<U>): MyMonad<U> {
    return f(this.value);
  }
}

registerFlatMap<MyMonad<unknown>>("MyMonad", {
  flatMap: (ma, f) => ma.bind(f),
  map: (ma, f) => new MyMonad(f(ma.value)),
});

// Now works with do-notation
let: {
  x << new MyMonad(1);
  y << new MyMonad(2);
}
yield: {
  x + y;
}
```

## Supported Types

Built-in support for:

| Type      | FlatMap                |
| --------- | ---------------------- |
| `Option`  | Short-circuits on None |
| `Result`  | Short-circuits on Err  |
| `Either`  | Short-circuits on Left |
| `Promise` | Chains with await      |
| `Array`   | List comprehension     |
| `IO`      | Deferred execution     |

## Comparison

### Without Do-Notation

```typescript
fetchUser(42).flatMap((user) =>
  fetchPosts(user.id).flatMap((posts) =>
    fetchComments(posts[0].id).map((comments) => ({ user, posts, comments }))
  )
);
```

### With Do-Notation

```typescript
let: {
  user << fetchUser(42);
  posts << fetchPosts(user.id);
  comments << fetchComments(posts[0].id);
}
yield: {
  {
    (user, posts, comments);
  }
}
```

## Type Inference

Types are fully inferred:

```typescript
let: {
  x << Some(42); // x: number
  y << Some("hello"); // y: string
}
yield: {
  {
    (x, y);
  } // { x: number; y: string }
}
// Result: Option<{ x: number; y: string }>
```

## Best Practices

### Do

- Use for chains of 3+ operations
- Use `par:` for independent operations
- Use guards for filtering

### Don't

- Use for simple 1-2 operations (just use map/flatMap)
- Mix different monads in the same block
- Forget that early termination happens
