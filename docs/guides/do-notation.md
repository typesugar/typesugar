# Do-Notation Comprehensions

Typesugar provides two labeled block macros for effect-based programming:

- **`let:/yield:`** — Sequential (monadic) comprehensions with `flatMap` chains
- **`par:/yield:`** — Parallel (applicative) comprehensions via the `ParCombine` typeclass

- `let:` uses the `FlatMap` typeclass (registered in the unified instance registry)
- `par:` uses the `ParCombine` typeclass (registered in the unified instance registry)

## Quick Start

```typescript
import { Option, Some, None } from "@typesugar/fp";

// Sequential: each binding can depend on previous bindings
let: {
  x << Some(10)
  y << Some(x * 2)  // Uses x
}
yield: { x + y }
// Result: Some(30)

// Parallel: all bindings must be independent
par: {
  user   << fetchUser(id)
  config << loadConfig()
  posts  << fetchPosts()
}
yield: ({ user, config, posts })
// All three run concurrently via Promise.all
```

## The `let:/yield:` Macro

### Basic Binding

The `<<` operator binds the result of a monadic expression:

```typescript
let: {
  a << Some(10)
  b << Some(20)
  c << Some(30)
}
yield: { a + b + c }
```

This compiles to:

```typescript
Some(10).flatMap(a =>
  Some(20).flatMap(b =>
    Some(30).map(c =>
      a + b + c)))
```

### Dependent Bindings

Later bindings can reference earlier bindings:

```typescript
let: {
  user  << fetchUser(id)
  posts << fetchPosts(user.id)  // Uses user
}
yield: ({ user, posts })
```

### Guards with `if`

Filter values with `if` statements:

```typescript
let: {
  x << [1, 2, 3, 4, 5]
  if (x % 2 === 0) {}  // Keep only even numbers
}
yield: { x }
// Result: [2, 4]
```

Guards emit a ternary that short-circuits on false:

```typescript
// Compiles to:
[1, 2, 3, 4, 5].map(x =>
  x % 2 === 0 ? x : undefined)
```

### Fallback with `||` and `??`

Provide a fallback value when the primary effect fails:

```typescript
let: {
  config << loadConfig() || defaultConfig()  // Fallback on error
  value  << parseValue(config) ?? Some(0)    // Nullish coalescing fallback
}
yield: { value }
```

This wraps the expression with `.orElse()`:

```typescript
// Compiles to:
loadConfig().orElse(() => defaultConfig()).flatMap(config =>
  parseValue(config).orElse(() => Some(0)).map(value => value))
```

### Discard Bindings with `_`

Execute an effect for side effects without using its result:

```typescript
let: {
  _ << log("Starting...")
  x << computation()
  _ << log("Done!")
}
yield: { x }
```

### Pure Map with `=`

Compute a pure value without unwrapping an effect:

```typescript
let: {
  x << Some(10)
  doubled = x * 2       // Pure computation, no flatMap
  y << Some(doubled)
}
yield: { y }
// Result: Some(20)
```

Pure map steps compile to IIFEs:

```typescript
// Compiles to:
Some(10).flatMap(x =>
  ((doubled) =>
    Some(doubled).map(y => y)
  )(x * 2))
```

### Implicit Yield

Omit `yield:` to return the last binding directly:

```typescript
let: {
  a << Some(10)
  b << Some(20)
}
// No yield: — returns Some(20)
```

### Object Literals in Yield

Use parentheses for object literals (due to block syntax ambiguity):

```typescript
// Correct:
yield: ({ name, age })

// Wrong (parses as label, not object):
yield: { name, age }  // Error: comma expression, not object literal
```

## The `par:/yield:` Macro

For independent operations that can run in parallel.

### Why Use `par:` Instead of `let:`?

1. **Parallel execution**: For Promises, `par:` emits `Promise.all([...])`, running all effects concurrently
2. **Error accumulation**: For Validation types, `par:` collects ALL errors instead of short-circuiting on the first
3. **Compile-time independence check**: The macro verifies that no binding depends on previous bindings

### Basic Applicative Combination

```typescript
par: {
  name << validateName(input.name)
  age  << validateAge(input.age)
}
yield: ({ name, age })
```

For non-Promise types, this compiles to:

```typescript
validateName(input.name)
  .map(name => age => ({ name, age }))
  .ap(validateAge(input.age))
```

### Promise.all for Parallel Execution

For Promises, `par:` emits `Promise.all`:

```typescript
par: {
  user   << fetchUser(id)
  config << loadConfig()
  posts  << fetchPosts()
}
yield: ({ user, config, posts })
```

Compiles to:

```typescript
Promise.all([fetchUser(id), loadConfig(), fetchPosts()])
  .then(([user, config, posts]) => ({ user, config, posts }))
```

**Parallel execution visualized:**

```
Sequential (let:):    [--fetchUser--][--loadConfig--][--fetchPosts--] = 300ms total
Parallel (par:):      [--fetchUser--]
                      [--loadConfig--]
                      [--fetchPosts--]                                = 100ms total
```

### Error Accumulation with Validation

Unlike monadic `let:` which stops at the first error, applicative `par:` collects all errors:

```typescript
// Using a Validation type that accumulates errors
par: {
  name  << validateName("")       // Error: "name required"
  email << validateEmail("bad")   // Error: "invalid email"
  age   << validateAge(-5)        // Error: "age must be positive"
}
yield: ({ name, email, age })

// Result: Failure(["name required", "invalid email", "age must be positive"])
```

### Restrictions in `par:` Blocks

Since applicative context doesn't support short-circuiting:

- **No guards**: `if (cond) {}` is not allowed
- **No fallbacks**: `<< expr || alt` is not allowed

The macro reports helpful errors:

```typescript
par: {
  x << getX()
  if (x > 0) {}  // Error: par: blocks do not support guards. Use let: for sequential bindings.
}
```

### Independence Validation

The macro catches dependencies at compile time:

```typescript
par: {
  user  << fetchUser(id)
  posts << fetchPosts(user.id)  // Error: 'posts' references 'user' from a previous binding.
}                                //        Use let: for sequential/dependent bindings.
```

## Supported Types

### let: (FlatMap typeclass)

Built-in `FlatMap` instances:

| Type            | Method Used       |
| --------------- | ----------------- |
| `Array`         | `.flatMap()`      |
| `Promise`       | `.then()`         |
| `Iterable`      | `.flatMap()`      |
| `AsyncIterable` | `.flatMap()`      |

### par: (ParCombine typeclass)

| Type            | `par:` Behavior                                      |
| --------------- | ---------------------------------------------------- |
| `Promise`       | `Promise.all([...]).then(([a,b,c]) => expr)`         |
| `AsyncIterable` | Collect each via async iteration, then `Promise.all` |
| `Array`         | Cartesian product via `.reduce().map()`              |
| `Iterable`      | Collect to arrays, then cartesian product            |
| Other           | `.map().ap()` fallback (Option, Either, Validation)   |

### AsyncIterable with par:

For `par:` blocks, AsyncIterables are collected concurrently and combined via `Promise.all`:

```typescript
par: {
  users  << streamUsers()
  events << streamEvents()
}
yield: ({ users, events })

// Compiles to: collect each async iterable, then:
// Promise.all([...]).then(([users, events]) => ({ users, events }))
```

**Note:** The result is a `Promise`, not an `AsyncIterable`. The entire stream is materialized into arrays. For element-wise streaming combination, use a zip combinator instead.

## Registering Custom Types

Both `FlatMap` and `ParCombine` are now part of the unified typeclass instance registry. The macros use `findInstance()` from `@typesugar/macros` to look up instances.

### FlatMap (for let:)

Register a `FlatMap` instance for custom monadic types using `registerFlatMap`:

```typescript
import { registerFlatMap } from "@typesugar/std";

class Task<T> {
  constructor(public readonly run: () => Promise<T>) {}

  map<U>(f: (t: T) => U): Task<U> {
    return new Task(() => this.run().then(f));
  }

  flatMap<U>(f: (t: T) => Task<U>): Task<U> {
    return new Task(() => this.run().then(t => f(t).run()));
  }

  ap<U>(this: Task<(t: T) => U>, ta: Task<T>): Task<U> {
    return new Task(async () => {
      const [f, a] = await Promise.all([this.run(), ta.run()]);
      return f(a);
    });
  }
}

registerFlatMap("Task", {
  map: (ta, f) => ta.map(f),
  flatMap: (ta, f) => ta.flatMap(f),
});

// Now works with do-notation
let: {
  x << new Task(() => Promise.resolve(10))
  y << new Task(() => Promise.resolve(20))
}
yield: { x + y }
```

#### Custom Method Names

Some types use different method names (e.g., `Promise` uses `then` instead of `flatMap`). You can specify custom method names:

```typescript
import { registerFlatMap } from "@typesugar/std";

registerFlatMap("MyMonad", {
  map: (ma, f) => ma.transform(f),
  flatMap: (ma, f) => ma.chain(f),
}, {
  methodNames: {
    bind: "chain",  // Use .chain() instead of .flatMap()
    map: "transform",  // Use .transform() instead of .map()
  }
});
```

### ParCombine (for par:)

Register a `ParCombine` instance for custom parallel combination using `registerParCombine`:

```typescript
import { registerParCombine } from "@typesugar/std";

registerParCombine("MyEffect", {
  all: (effects) => MyEffect.all(effects),
  map: (combined, f) => combined.map(f),
});

// Now par: works with MyEffect
par: {
  a << myEffect1()
  b << myEffect2()
}
yield: ({ a, b })
```

#### Zero-Cost Builders

For optimal code generation, `ParCombine` instances can provide a custom builder function that generates optimized AST directly. This is how the built-in Promise, Array, and AsyncIterable instances achieve zero-cost abstraction:

```typescript
import { registerParCombine, registerParCombineBuilder } from "@typesugar/std";
import type { ParCombineBuilder } from "@typesugar/macros";

// Register the typeclass instance
registerParCombine("MyEffect", {
  all: (effects) => MyEffect.all(effects),
  map: (combined, f) => combined.map(f),
});

// Optionally register a custom builder for zero-cost code generation
const myEffectBuilder: ParCombineBuilder = (ctx, bindings, returnExpr) => {
  // Generate optimized AST directly
  // ... custom code generation logic ...
};
registerParCombineBuilder("MyEffect", myEffectBuilder);
```

Types with a registered `ParCombine` instance get optimized code generation. Types without one fall back to `.map().ap()` chains.

### How It Works Under the Hood

Both `FlatMap` and `ParCombine` are registered as formal typeclasses in the unified instance registry (`instanceRegistry` from `@typesugar/macros`). The comprehension macros use:

- `findInstance("FlatMap", "TypeName")` — to check if a `FlatMap` instance exists
- `findInstance("ParCombine", "TypeName")` — to check if a `ParCombine` instance exists
- `getFlatMapMethodNames("TypeName")` — to resolve method names (with fallbacks for built-in types)
- `getParCombineBuilderFromRegistry("TypeName")` — to retrieve zero-cost builders

This unified approach means `FlatMap` and `ParCombine` instances are consistent with all other typeclasses in typesugar.

## Before/After Comparison

### Nested Callbacks

```typescript
// Without do-notation:
fetchUser(id)
  .then(user =>
    fetchPosts(user.id)
      .then(posts =>
        fetchComments(posts[0].id)
          .then(comments =>
            ({ user, posts, comments }))))

// With do-notation:
let: {
  user     << fetchUser(id)
  posts    << fetchPosts(user.id)
  comments << fetchComments(posts[0].id)
}
yield: ({ user, posts, comments })
```

### Parallel Fetch

```typescript
// Without do-notation:
Promise.all([
  fetchUser(id),
  loadConfig(),
  fetchPosts()
]).then(([user, config, posts]) =>
  ({ user, config, posts }))

// With do-notation:
par: {
  user   << fetchUser(id)
  config << loadConfig()
  posts  << fetchPosts()
}
yield: ({ user, config, posts })
```

### Validation Accumulation

```typescript
// Without do-notation (manual applicative):
validateName(name)
  .map(n => e => a => ({ name: n, email: e, age: a }))
  .ap(validateEmail(email))
  .ap(validateAge(age))

// With do-notation:
par: {
  n << validateName(name)
  e << validateEmail(email)
  a << validateAge(age)
}
yield: ({ name: n, email: e, age: a })
```

## Best Practices

### Do

- Use `let:` for sequential operations where each step depends on previous results
- Use `par:` for independent operations that can run concurrently
- Use guards (`if`) in `let:` for filtering
- Use fallbacks (`||`/`??`) in `let:` for error recovery
- Use parentheses for object literals in `yield:`

### Don't

- Mix different monadic types in the same block
- Use `par:` when operations depend on each other
- Use guards or fallbacks in `par:` blocks
- Forget that `let:` short-circuits on failure

## Type Inference

Types flow through comprehensions:

```typescript
let: {
  x << Some(42)        // x: number
  y << Some("hello")   // y: string
}
yield: ({ x, y })      // { x: number; y: string }
// Result: Option<{ x: number; y: string }>
```

## See Also

- [FlatMap Typeclass](../reference/typeclasses.md#flatmap) — The typeclass behind do-notation
- [Effect Integration](./effect-integration.md) — Using do-notation with Effect-TS
- [Labeled Block Macros](../reference/macro-types.md#labeled-block-macros) — How the macros work
