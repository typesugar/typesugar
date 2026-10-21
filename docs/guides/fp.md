# Functional Programming

The `@typesugar/fp` package provides functional programming utilities with zero-cost abstractions. `Option<A>` uses `@opaque` type macros for dot-syntax methods — it's `A | null` at runtime, but TypeScript sees a rich interface. The other types (`Either`, `IO`, `List`, …) are plain data with standalone functions; they have no dot syntax.

## Option

Represents optional values. `Some(x)` wraps a value; `None` is empty. At runtime: `Some(42)` is `42`, `None` is `null`.

```typescript
import { Some, None, isSome } from "@typesugar/fp";
import type { Option } from "@typesugar/fp";

function findUser(id: number): Option<User> {
  const user = db.get(id);
  return user ? Some(user) : None;
}

// Dot syntax — methods resolve via type rewrite registry
const result = findUser(42)
  .map((user) => user.name)
  .getOrElse(() => "Unknown");
```

### Creating Options

```typescript
Some(42); // Option<number> containing 42
None; // Empty Option<never>

// From a nullable value: Option<number> and number | null are different types,
// so convert explicitly
import { fromNullable, toNullable } from "@typesugar/fp/data/option";

const nullable: number | null = getFromDb();
const opt: Option<number> = fromNullable(nullable);
const back: number | null = toNullable(opt);
```

Known issue: because `Some(42)` compiles to `42` while `Option<…>` annotations stay in the
output, expanded-output type checking (`strict: true`) reports errors such as `Type 'number' is
not assignable to type 'Option<number>'` in code that uses Option. The emitted JavaScript is
correct.

### Methods (Dot Syntax)

```typescript
const opt = Some(42);

isSome(opt); // true — type guard
opt.map((x) => x * 2); // Some(84)
opt.flatMap((x) => Some(x * 2)); // Some(84)
opt.filter((x) => x > 0); // Some(42)
opt.getOrElse(() => 0); // 42
opt.fold(
  () => "empty",
  (x) => `${x}`
); // "42"
opt.contains(42); // true
opt.toArray(); // [42]
```

### Chained Operations

```typescript
Some(5)
  .map((n) => n * 2)
  .filter((n) => n > 5)
  .getOrElse(() => 0);
// → 10

// Emitted JS: getOrElse(filter(map(5, n => n * 2), n => n > 5), () => 0)
```

## Either

Represents success (`Right`) or failure (`Left`). At runtime it is `{ right: value }` or `{ left: error }` — not `@opaque`, so there is no dot syntax: use the functions from `@typesugar/fp/data/either`.

```typescript
import { Right, Left, isRight } from "@typesugar/fp";
import type { Either } from "@typesugar/fp";
import * as E from "@typesugar/fp/data/either";

function parseNumber(s: string): Either<string, number> {
  const n = parseInt(s, 10);
  return isNaN(n) ? Left("Invalid number") : Right(n);
}

const result = E.getOrElse(
  E.flatMap(
    E.map(parseNumber("42"), (n) => n * 2),
    (n): Either<string, number> => (n > 50 ? Right(n) : Left("too small"))
  ),
  () => -1
); // 84
```

### Functions

```typescript
const res = Right<string, number>(42);

isRight(res); // true — type guard
E.map(res, (x) => x * 2); // Right(84), i.e. { right: 84 }
E.flatMap(res, (x) => Right(x * 2)); // Right(84)
E.getOrElse(res, () => 0); // 42
E.fold(
  res,
  (e) => `Error: ${e}`,
  (x) => `Got ${x}`
); // "Got 42"
```

### Error Accumulation

```typescript
import { validNel, invalidNel } from "@typesugar/fp";
import * as V from "@typesugar/fp/data/validated";

function validateAge(age: number) {
  return age >= 0 && age <= 150 ? validNel(age) : invalidNel("Age out of range");
}

function validateName(name: string) {
  return name.length > 0 ? validNel(name) : invalidNel("Name empty");
}

// Collects ALL errors, doesn't short-circuit
V.map2Nel(validateName(name), validateAge(age), (n, a) => ({ name: n, age: a }));
```

## IO

Represents effectful computations:

```typescript
import { IO, runIOSync } from "@typesugar/fp";

const getTime = IO.delay(() => new Date());
const log = (msg: string) => IO.delay(() => console.log(msg));

const program = IO.flatMap(getTime, (time) => log(`Current time: ${time}`));

// Nothing runs until:
runIOSync(program);
```

`IO.delay(thunk)` (also `IO.sync`) suspends a side effect. `IO.of(value)` / `IO.pure(value)`
wrap a value you already have — they take the value, not a thunk.

### Combining IO

```typescript
import * as fs from "node:fs";

const readFile = (path: string) => IO.delay(() => fs.readFileSync(path, "utf8"));
const writeFile = (path: string, content: string) =>
  IO.delay(() => fs.writeFileSync(path, content));

const copyFile = (src: string, dest: string) =>
  IO.flatMap(readFile(src), (content) => writeFile(dest, content));
```

## List

Immutable linked list:

```typescript
import { listOf, Cons, Nil } from "@typesugar/fp";
import type { List } from "@typesugar/fp";
import * as L from "@typesugar/fp/data/list";

const list: List<number> = listOf(1, 2, 3, 4, 5);

L.head(list); // Some(1), i.e. 1
L.tail(list); // List(2, 3, 4, 5) — typed List | undefined (undefined for an empty list)
L.map(list, (x) => x * 2); // List(2, 4, 6, 8, 10)
L.filter(list, (x) => x % 2 === 0); // List(2, 4)
L.foldLeft(list, 0, (a, b) => a + b); // 15
L.toArray(list); // [1, 2, 3, 4, 5]
```

`List` is a type only; build lists with `listOf(...)`, `listFromArray(arr)` or `Cons`/`Nil`.
A list is a plain `{ head, tail }` chain (`null` when empty), with no methods.

## How @opaque Works

`@typesugar/fp` data types use `@opaque` type macros (PEP-012):

```typescript
/** @opaque A | null */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
  flatMap<B>(f: (a: A) => Option<B>): Option<B>;
  getOrElse(defaultValue: () => A): A;
}
```

- **TypeScript sees**: Interface with methods (IDE completions, type inference)
- **Runtime**: `A | null` (zero allocations)
- **Transformer**: Rewrites `x.map(f)` → `map(x, f)`
- **Conversion**: `Option<T>` and `T | null` are not assignable to each other; use `fromNullable` / `toNullable`

### Publishing @opaque Types in Libraries

When you publish a library that uses `@opaque` types, run `typesugar-dts-transform` on your `dist/` directory as a post-build step. This rewrites opaque interfaces in `.d.ts` files to type aliases:

```typescript
// Before (tsc output):
/** @opaque A | null */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
}

// After (typesugar-dts-transform):
/** @opaque A | null */
export type Option<A> = A | null;
```

The `@opaque` JSDoc annotation is preserved. This enables two consumer experiences:

**Plain TypeScript consumers** see `A | null` and use standard null checks:

```typescript
import { findUser } from "my-lib";
const user = findUser("1"); // User | null
if (user !== null) console.log(user.name);
```

**TypeSugar consumers** get automatic discovery — the transformer reads the `@opaque` annotation from the imported `.d.ts`, registers the type rewrite, and enables dot syntax:

```typescript
import { findUser, map } from "my-lib";
const name: Option<string> = findUser("1").map((u) => u.name);
// Compiled: const name = map(findUser("1"), u => u.name)
```

Type annotations are kept as written, in every position (variables, parameters, returns,
properties, type arguments), for library and same-project opaque types alike:
`const x: Option<number> = Some(42)` → `const x: Option<number> = 42`. Expanded code is written
against the runtime view of an opaque type (`Option<number>` is `number | null`), which is how
`typesugar build --strict` and `strictOutput` check it, and the declarations emitted from the
expanded program keep `Option<number>`.

Add to your library's `package.json`:

```json
{
  "scripts": {
    "postbuild": "typesugar-dts-transform dist/"
  }
}
```

## Higher-Kinded Types

typesugar supports HKTs for generic FP code:

```typescript
import { optionFunctor, Some } from "@typesugar/fp";
import type { Functor, Kind } from "@typesugar/fp";

// Works with any Functor
function double<F>(F: Functor<F>, fa: Kind<F, number>): Kind<F, number> {
  return F.map(fa, (x) => x * 2);
}

double(optionFunctor, Some(21)); // Some(42), i.e. 42
```

`Functor`, `Monad` and `Kind` are types (`import type`); the instances are values such as
`optionFunctor` and `optionMonad`. Known issue: plain `tsc` reports TS2345 on
`double(optionFunctor, …)` because the concrete instance type doesn't unify with
`Functor<F>`; the transformer's build of the same code type-checks and runs.

## Zero-Cost Abstractions

All FP types compile to efficient JavaScript:

```typescript
// Source
const result = Some(42)
  .map((x) => x * 2)
  .flatMap((x) => Some(x + 1))
  .getOrElse(() => 0);

// Compiled — no Option object, no method dispatch: direct calls on the raw value
const result = getOrElse(
  flatMap(
    map(42, (x) => x * 2),
    (x) => x + 1
  ),
  () => 0
); // 85
```

## Do-Notation

Chain monadic operations cleanly. The label syntax is import-scoped (PEP-052) — activate it with `import "@typesugar/std/syntax/do";` at the top of the file. The `FlatMap` instances for the fp types (`Option`, `Either`, `List`, `IO`) are resolved from scope: any import from `@typesugar/fp` (which you already have for the types themselves) brings them in — no registration needed:

```typescript
import "@typesugar/std/syntax/do";

const result = let: {
  user << findUser(42);
  posts << fetchPosts(user.id);
  comments << fetchComments(posts[0].id);
}
yield: ({ user, posts, comments });
```

For `Option` this compiles to `flatMapOption.flatMap(findUser(42), user => …)`, importing
`flatMapOption` for you.

See [Do-Notation Guide](./do-notation.md).

## Pattern Matching

The constructors are extractor patterns for `match` from `@typesugar/std`. `@typesugar/fp`
ships a `Destructure` instance next to each of `Some`/`None`, `Left`/`Right`, `Cons`/`Nil`
and `Valid`/`Invalid`. A pattern compiles to an inlined test on the real representation
and a field read (`Left(err)` is `"left" in v`, then `err = v.left`); the instance's
`extract` is never called. Each pair covers its type, so no `.else()` is needed:

```typescript
import { match } from "@typesugar/std";
import { Left, Right } from "@typesugar/fp";

const message = match(parsed).case(Left(err)).then(`Error: ${err}`).case(Right(n)).then(`Got ${n}`);
```

See [Extractor Patterns](./pattern-matching.md#extractor-patterns).

## Comparison to Other Libraries

| Feature        | typesugar/fp | fp-ts           | Effect          |
| -------------- | ------------ | --------------- | --------------- |
| Zero-cost      | Yes          | No              | No              |
| HKT            | Yes          | Yes             | Yes             |
| Do-notation    | Yes (macro)  | Yes (generator) | Yes (generator) |
| Bundle size    | Minimal      | Large           | Large           |
| Learning curve | Moderate     | Steep           | Steep           |

## Best Practices

### Do

- Use Option instead of null/undefined
- Use Either for operations that can fail
- Use IO for side effects
- Trust auto-specialization for performance-critical code — it's always on

### Don't

- Overuse FP patterns where simple code works
- Forget that these are compile-time abstractions
- Mix null/undefined with Option (pick one)
