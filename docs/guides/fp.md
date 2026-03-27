# Functional Programming

The `@typesugar/fp` package provides functional programming utilities with zero-cost abstractions. `Option<A>` uses `@opaque` type macros for dot-syntax methods — it's `A | null` at runtime, but TypeScript sees a rich interface. Other types like `Either` use structural discriminated unions.

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

// Implicit conversion via SFINAE — no fromNullable() needed
const nullable: number | null = getFromDb();
const opt: Option<number> = nullable; // Just works
```

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

Represents success (`Right`) or failure (`Left`). Uses a structural discriminated union — not `@opaque` (Either allocates real objects, unlike Option's zero-cost `null` encoding).

```typescript
import { Right, Left, isRight } from "@typesugar/fp";
import type { Either } from "@typesugar/fp";

function parseNumber(s: string): Either<string, number> {
  const n = parseInt(s, 10);
  return isNaN(n) ? Left("Invalid number") : Right(n);
}

// Dot syntax — chain validations fluently
const result = parseNumber("42")
  .map((n) => n * 2)
  .flatMap((n) => (n > 50 ? Right(n) : Left("too small")))
  .getOrElse(() => -1);
```

### Methods (Dot Syntax)

```typescript
const res = Right<string, number>(42);

isRight(res); // true — type guard
res.map((x) => x * 2); // Right(84)
res.flatMap((x) => Right(x * 2)); // Right(84)
res.getOrElse(() => 0); // 42
res.fold(
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
import { IO } from "@typesugar/fp";

const getTime = IO.of(() => new Date());
const log = (msg: string) => IO.of(() => console.log(msg));

const program = getTime.flatMap((time) => log(`Current time: ${time}`));

// Nothing runs until:
program.unsafeRun();
```

### Combining IO

```typescript
const readFile = (path: string) => IO.of(() => fs.readFileSync(path, "utf8"));
const writeFile = (path: string, content: string) => IO.of(() => fs.writeFileSync(path, content));

const copyFile = (src: string, dest: string) =>
  readFile(src).flatMap((content) => writeFile(dest, content));
```

## List

Immutable linked list:

```typescript
import { List, Cons, Nil } from "@typesugar/fp";

const list = List.of(1, 2, 3, 4, 5);

list.head(); // Some(1)
list.tail(); // List(2, 3, 4, 5)
list.map((x) => x * 2); // List(2, 4, 6, 8, 10)
list.filter((x) => x % 2 === 0); // List(2, 4)
list.foldLeft(0, (a, b) => a + b); // 15
```

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
- **SFINAE**: `Option<T>` and `T | null` are implicitly convertible

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

Type annotations are preserved for library-imported opaque types (since the `.d.ts` alias is valid):
`const x: Option<number> = Some(42)` → `const x: Option<number> = 42`

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
import { $, Functor, Monad } from "@typesugar/fp";

// Works with any Functor
function double<F>(F: Functor<F>, fa: Kind<F, number>): Kind<F, number> {
  return F.map(fa, (x) => x * 2);
}

double(FunctorOption, Some(21)); // Some(42)
double(FunctorArray, [1, 2, 3]); // [2, 4, 6]
```

## Zero-Cost Abstractions

All FP types compile to efficient JavaScript:

```typescript
// Source
const result = Some(42)
  .map((x) => x * 2)
  .flatMap((x) => Some(x + 1))
  .getOrElse(0);

// Compiled (with specialize)
const result = 42 * 2 + 1;
```

Use `specialize()` for hot paths:

```typescript
import { specialize } from "@typesugar/specialize";

const process = specialize((opt: Option<number>) => opt.map((x) => x * 2).getOrElse(0));
```

## Do-Notation

Chain monadic operations cleanly:

```typescript
let: {
  user << findUser(42);
  posts << fetchPosts(user.id);
  comments << fetchComments(posts[0].id);
}
yield: {
  {
    (user, posts, comments);
  }
}
```

See [Do-Notation Guide](./do-notation.md).

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
- Use Result for operations that can fail
- Use IO for side effects
- Use specialize() for performance-critical code

### Don't

- Overuse FP patterns where simple code works
- Forget that these are compile-time abstractions
- Mix null/undefined with Option (pick one)
