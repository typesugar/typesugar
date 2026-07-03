# Do-Notation Comprehensions

Typesugar provides two labeled block macros for effect-based programming, with two naming styles:

- **`let:/yield:`** or **`seq:/yield:`** — Sequential (monadic) comprehensions with `flatMap` chains
- **`par:/yield:`** or **`all:/yield:`** — Parallel (applicative) comprehensions via the `ParCombine` typeclass

Naming convention:

- `seq:` / `par:` — effects-oriented (sequential vs parallel execution)
- `let:` / `all:` — binding-oriented (let-bindings vs combine-all)

- `let:` / `seq:` use the `FlatMap` typeclass (resolved from instances in scope)
- `par:` / `all:` use the `ParCombine` typeclass (resolved from instances in scope)

## Activation

Label syntax is import-scoped (PEP-052) — the comprehension labels only expand in files that import the activation marker:

```typescript
import "@typesugar/std/syntax/do";
```

Without this import the labels are left as ordinary JavaScript and the compiler warns (TS9224: `'let:' matches the letYield macro, but its label syntax is not activated in this file`) with a hint naming the import to add. Ordinary loop labels that happen to collide with a macro label (e.g. `all: for (...)`) are never hijacked and produce no warning.

### Instance Scoping

Instance resolution is scope-based too (no global registry): the `FlatMap`/`ParCombine` instance for a type must be declared in the file or exported by a module the file imports.

- **Std builtins** (`Array`, `Promise`, `Iterable`, `AsyncIterable`) ride the same marker — `import "@typesugar/std/syntax/do"` activates the labels AND brings their instances into scope, so the common case needs nothing extra.
- **Effect** — use `import "@typesugar/effect/syntax/do"` instead; one import activates the labels and provides the Effect instances (it re-exports the std builtins too).
- **fp types** (`Option`, `List`, `IO`) — any import from `@typesugar/fp` brings their instances into scope. (`Either` has no shipped instance — its `FlatMap` is a per-error-type factory; declare a local `@impl FlatMap<Either>` for your error type.)
- **Custom monads** — see [Custom Types](#custom-types) below.

If a comprehension's type has no instance in scope, the compiler errors (TS9225: `No FlatMap instance for 'X' is in scope`) with a hint naming the import to add.

## Quick Start

```typescript
import "@typesugar/std/syntax/do"; // activate let:/seq:/par:/all: label syntax
import { Option, Some, None } from "@typesugar/fp";

// Sequential: each binding can depend on previous bindings
let: {
  x << Some(10);
  y << Some(x * 2); // Uses x
}
yield: {
  x + y;
}
// Result: Some(30)

// Parallel: all bindings must be independent
par: {
  user << fetchUser(id);
  config << loadConfig();
  posts << fetchPosts();
}
yield: ({ user, config, posts });
// All three run concurrently via Promise.all
```

## The `let:/yield:` Macro

### Basic Binding

The `<<` operator binds the result of a monadic expression:

```typescript
let: {
  a << Some(10);
  b << Some(20);
  c << Some(30);
}
yield: {
  a + b + c;
}
```

This compiles to:

```typescript
Some(10).flatMap((a) => Some(20).flatMap((b) => Some(30).map((c) => a + b + c)));
```

### Dependent Bindings

Later bindings can reference earlier bindings:

```typescript
let: {
  user << fetchUser(id);
  posts << fetchPosts(user.id); // Uses user
}
yield: ({ user, posts });
```

### Guards with `if`

Filter values with `if` statements:

```typescript
let: {
  x << [1, 2, 3, 4, 5];
  if (x % 2 === 0) {
  } // Keep only even numbers
}
yield: {
  x;
}
// Result: [2, 4]
```

Guards emit a ternary that short-circuits on false:

```typescript
// Compiles to:
[1, 2, 3, 4, 5].map((x) => (x % 2 === 0 ? x : undefined));
```

### Fallback with `||` and `??`

Provide a fallback value when the primary effect fails:

```typescript
let: {
  config << loadConfig() || defaultConfig(); // Fallback on error
  value << parseValue(config) ?? Some(0); // Nullish coalescing fallback
}
yield: {
  value;
}
```

This wraps the expression with `.orElse()`:

```typescript
// Compiles to:
loadConfig()
  .orElse(() => defaultConfig())
  .flatMap((config) =>
    parseValue(config)
      .orElse(() => Some(0))
      .map((value) => value)
  );
```

### Discard Bindings with `_`

Execute an effect for side effects without using its result:

```typescript
let: {
  _ << log("Starting...");
  x << computation();
  _ << log("Done!");
}
yield: {
  x;
}
```

### Pure Map with `=`

Compute a pure value without unwrapping an effect:

```typescript
let: {
  x << Some(10);
  doubled = x * 2; // Pure computation, no flatMap
  y << Some(doubled);
}
yield: {
  y;
}
// Result: Some(20)
```

Pure map steps compile to IIFEs:

```typescript
// Compiles to:
Some(10).flatMap((x) => ((doubled) => Some(doubled).map((y) => y))(x * 2));
```

### Implicit Yield

Omit `yield:` to return the last binding directly:

```typescript
let: {
  a << Some(10);
  b << Some(20);
}
// No yield: — returns Some(20)
```

### Object Literals in Yield

Use parentheses for object literals (due to block syntax ambiguity):

```typescript
// Correct:
yield: ({ name, age });

// Wrong (parses as label, not object):
yield: {
  (name, age);
} // Error: comma expression, not object literal
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
  name << validateName(input.name);
  age << validateAge(input.age);
}
yield: ({ name, age });
```

For non-Promise types, this compiles to:

```typescript
validateName(input.name)
  .map((name) => (age) => ({ name, age }))
  .ap(validateAge(input.age));
```

### Promise.all for Parallel Execution

For Promises, `par:` emits `Promise.all`:

```typescript
par: {
  user << fetchUser(id);
  config << loadConfig();
  posts << fetchPosts();
}
yield: ({ user, config, posts });
```

Compiles to:

```typescript
Promise.all([fetchUser(id), loadConfig(), fetchPosts()]).then(([user, config, posts]) => ({
  user,
  config,
  posts,
}));
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
  name << validateName(""); // Error: "name required"
  email << validateEmail("bad"); // Error: "invalid email"
  age << validateAge(-5); // Error: "age must be positive"
}
yield: ({ name, email, age });

// Result: Failure(["name required", "invalid email", "age must be positive"])
```

### Restrictions in `par:` Blocks

Since applicative context doesn't support short-circuiting:

- **No guards**: `if (cond) {}` is not allowed
- **No fallbacks**: `<< expr || alt` is not allowed

The macro reports helpful errors:

```typescript
par: {
  x << getX();
  if (x > 0) {
  } // Error: par: blocks do not support guards. Use let: for sequential bindings.
}
```

### Independence Validation

The macro catches dependencies at compile time:

```typescript
par: {
  user << fetchUser(id);
  posts << fetchPosts(user.id); // Error: 'posts' references 'user' from a previous binding.
} //        Use let: for sequential/dependent bindings.
```

## Aliases: `seq:` and `all:`

`seq:` is an alias for `let:`; `all:` is an alias for `par:`. Use whichever style fits your code:

```typescript
// Same effect — choose based on preference
seq: {
  x << Some(1);
  y << Some(x * 2);
}
yield: {
  x + y;
}

// Equivalent to:
let: {
  x << Some(1);
  y << Some(x * 2);
}
yield: {
  x + y;
}
```

```typescript
all: {
  user << fetchUser(id);
  config << loadConfig();
}
yield: ({ user, config });

// Equivalent to:
par: {
  user << fetchUser(id);
  config << loadConfig();
}
yield: ({ user, config });
```

## Nesting: `par:` / `all:` Inside `let:` / `seq:`

You can nest `par:` / `all:` blocks inside `let:` / `seq:` for mixed sequential and parallel flows. Bindings from the inner block are in scope for the outer block:

```typescript
seq: {
  config << loadConfig(); // Sequential: load config first
  par: {
    users << fetchUsers(config); // Parallel: fetch these together
    products << fetchProducts(config);
  }
  // users and products are in scope
}
yield: {
  ({ config, users, products });
}
```

For object literal returns, use parentheses: `yield: { ({ a, b }) }`.

## Supported Types

### let: (FlatMap typeclass)

Built-in `FlatMap` instances:

| Type            | Method Used  |
| --------------- | ------------ |
| `Array`         | `.flatMap()` |
| `Promise`       | `.then()`    |
| `Iterable`      | `.flatMap()` |
| `AsyncIterable` | `.flatMap()` |

### par: (ParCombine typeclass)

| Type            | `par:` Behavior                                      |
| --------------- | ---------------------------------------------------- |
| `Promise`       | `Promise.all([...]).then(([a,b,c]) => expr)`         |
| `AsyncIterable` | Collect each via async iteration, then `Promise.all` |
| `Array`         | Cartesian product via `.reduce().map()`              |
| `Iterable`      | Collect to arrays, then cartesian product            |
| Other           | `.map().ap()` fallback (Option, Either, Validation)  |

### AsyncIterable with par:

For `par:` blocks, AsyncIterables are collected concurrently and combined via `Promise.all`:

```typescript
par: {
  users << streamUsers();
  events << streamEvents();
}
yield: ({ users, events });

// Compiles to: collect each async iterable, then:
// Promise.all([...]).then(([users, events]) => ({ users, events }))
```

**Note:** The result is a `Promise`, not an `AsyncIterable`. The entire stream is materialized into arrays. For element-wise streaming combination, use a zip combinator instead.

## Custom Types

Instance resolution is scope-based (PEP-052): declare a `FlatMap` instance with an `@impl` JSDoc tag on a const, and it's usable in any file that has it in scope — declared locally, or exported by a module the file imports. There is no registration call.

### FlatMap (for let:)

Declare an `@impl FlatMap<Type>` instance for custom monadic types:

```typescript
import "@typesugar/std/syntax/do";

class Task<T> {
  constructor(public readonly run: () => Promise<T>) {}

  map<U>(f: (t: T) => U): Task<U> {
    return new Task(() => this.run().then(f));
  }

  flatMap<U>(f: (t: T) => Task<U>): Task<U> {
    return new Task(() => this.run().then((t) => f(t).run()));
  }
}

/** @impl FlatMap<Task> */
export const flatMapTask = {
  map: (ta: Task<unknown>, f: (a: unknown) => unknown) => ta.map(f),
  flatMap: (ta: Task<unknown>, f: (a: unknown) => Task<unknown>) => ta.flatMap(f),
};

// Now works with do-notation — in this file, or in any file that
// imports the module exporting flatMapTask
let: {
  x << new Task(() => Promise.resolve(10));
  y << new Task(() => Promise.resolve(20));
}
yield: {
  x + y;
}
```

The instance can also be a non-exported local const — it's then in scope for that file only. To share it, export it and have consumers import the module (a side-effect import works: `import "./task-instances"`).

The `@impl` type name is matched by brand: for a comprehension over `Task<T>`, the resolver accepts `@impl FlatMap<Task>`, the HKT-tag spelling `@impl FlatMap<TaskF>`, or a phantom-tag type annotation `FlatMap<_TaskTag>`.

#### Custom Method Names: @do-methods

By default the macros emit receiver-method calls `.flatMap(...)` / `.map(...)`. If your type uses different method names or static combinators, add a `@do-methods` JSDoc tag next to `@impl`:

```typescript
/**
 * @impl FlatMap<MyMonad>
 * @do-methods bind=chain map=transform
 */
export const flatMapMyMonad = {
  map: (ma: MyMonad<unknown>, f: (a: unknown) => unknown) => ma.transform(f),
  flatMap: (ma: MyMonad<unknown>, f: (a: unknown) => MyMonad<unknown>) => ma.chain(f),
};

// let: over MyMonad now emits .chain(...) / .transform(...) calls
```

`@do-methods` takes whitespace-separated `key=value` pairs:

| Key         | Meaning                                                                                   | Default   |
| ----------- | ----------------------------------------------------------------------------------------- | --------- |
| `bind=`     | Method emitted for a monadic bind step (`x << e`)                                         | `flatMap` |
| `map=`      | Method emitted for the final mapping step                                                 | `map`     |
| `orElse=`   | Method for error recovery (`\|\|` / `??` fallbacks)                                       | —         |
| `all=`      | Static combinator that joins independent effects for `par:` (e.g. `all` for `Effect.all`) | —         |
| `style=`    | `method` (emit `fa.bind(f)`) or `static` (emit `Receiver.bind(fa, f)`)                    | `method`  |
| `receiver=` | Static-call receiver identifier (e.g. `Effect`); required for `style=static` and `all=`   | —         |

For example, the built-in Effect instance is declared as:

```typescript
/**
 * @impl FlatMap<Effect>
 * @do-methods bind=flatMap map=map orElse=catchAll style=static receiver=Effect
 */
export const flatMapEffect = { ... };
```

so `let:` over Effect emits static calls `Effect.flatMap(fa, f)` (preserving E/R type inference) instead of receiver methods.

### ParCombine (for par:)

Declare an `@impl ParCombine<Type>` instance the same way. `all=` + `receiver=` in `@do-methods` enable the zero-cost parallel join — `par:` then emits a single static `all` call instead of the generic `.map().ap()` applicative chain:

```typescript
/**
 * @impl ParCombine<MyEffect>
 * @do-methods map=map all=all style=static receiver=MyEffect
 */
export const parCombineMyEffect = {
  all: (effects: unknown[]) => MyEffect.all(effects),
  map: (combined: unknown, f: (a: unknown) => unknown) => MyEffect.map(combined, f),
};

// Now par: over MyEffect compiles to:
// MyEffect.map(MyEffect.all([myEffect1(), myEffect2()]), ([a, b]) => ({ a, b }))
par: {
  a << myEffect1();
  b << myEffect2();
}
yield: ({ a, b });
```

This is how the built-in instances achieve zero-cost output: `par:` over Promise emits `Promise.all([...]).then(...)`, and `par:` over Effect emits `Effect.map(Effect.all([...]), ([a, b]) => ...)`. Types without an `all=` combinator fall back to `.map().ap()` chains.

### How It Works Under the Hood

The comprehension macros infer the type constructor ("brand") of the effect expressions, then resolve the `FlatMap`/`ParCombine` instance from scope:

1. **Local scope** — top-level `@impl`/`@instance` declarations in the current file (exported or not).
2. **Imported modules** — exports of every module the file imports (side-effect imports and re-exports included), scanned for `@impl` tags and `FlatMap<...>`-typed annotations.

The resolved instance's `@do-methods` metadata drives code emission. If no instance is in scope, the macro reports error TS9225 (`No FlatMap instance for 'X' is in scope`) with a hint naming the import to add. There is no process-global registry — resolution is per-file, driven entirely by what the file imports.

## Before/After Comparison

### Nested Callbacks

```typescript
// Without do-notation:
fetchUser(id).then((user) =>
  fetchPosts(user.id).then((posts) =>
    fetchComments(posts[0].id).then((comments) => ({ user, posts, comments }))
  )
);

// With do-notation:
let: {
  user << fetchUser(id);
  posts << fetchPosts(user.id);
  comments << fetchComments(posts[0].id);
}
yield: ({ user, posts, comments });
```

### Parallel Fetch

```typescript
// Without do-notation:
Promise.all([fetchUser(id), loadConfig(), fetchPosts()]).then(([user, config, posts]) => ({
  user,
  config,
  posts,
}));

// With do-notation:
par: {
  user << fetchUser(id);
  config << loadConfig();
  posts << fetchPosts();
}
yield: ({ user, config, posts });
```

### Validation Accumulation

```typescript
// Without do-notation (manual applicative):
validateName(name)
  .map((n) => (e) => (a) => ({ name: n, email: e, age: a }))
  .ap(validateEmail(email))
  .ap(validateAge(age));

// With do-notation:
par: {
  n << validateName(name);
  e << validateEmail(email);
  a << validateAge(age);
}
yield: ({ name: n, email: e, age: a });
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
  x << Some(42); // x: number
  y << Some("hello"); // y: string
}
yield: ({ x, y }); // { x: number; y: string }
// Result: Option<{ x: number; y: string }>
```

## See Also

- [FlatMap Typeclass](../reference/typeclasses.md#flatmap) — The typeclass behind do-notation
- [Effect Integration](./effect.md#do-notation) — Using do-notation with Effect-TS (`import "@typesugar/effect/syntax/do"`)
- [Labeled Block Macros](../reference/macro-types.md#labeled-block-macros) — How the macros work
