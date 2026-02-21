# Functional Programming

The `@typesugar/fp` package provides functional programming utilities with zero-cost abstractions.

## Option

Represents optional values without null/undefined:

```typescript
import { Option, Some, None } from "@typesugar/fp";

function findUser(id: number): Option<User> {
  const user = db.get(id);
  return user ? Some(user) : None;
}

const result = findUser(42)
  .map((user) => user.name)
  .getOrElse("Unknown");
```

### Creating Options

```typescript
Some(42); // Option<number> containing 42
None; // Empty Option
Option.from(value); // Some if value is truthy, None otherwise
Option.fromNullable(x); // Some if x is not null/undefined
```

### Methods

```typescript
const opt = Some(42);

opt.isSome(); // true
opt.isNone(); // false
opt.map((x) => x * 2); // Some(84)
opt.flatMap((x) => Some(x * 2)); // Some(84)
opt.filter((x) => x > 0); // Some(42)
opt.getOrElse(0); // 42
opt.getOrThrow(); // 42
opt.match({
  some: (x) => `Got ${x}`,
  none: () => "Nothing",
}); // "Got 42"
```

### Pattern Matching

```typescript
import { match } from "@typesugar/std";

const message = match(findUser(42), {
  some: (user) => `Hello, ${user.name}`,
  none: () => "User not found",
});
```

## Result

Represents success or failure:

```typescript
import { Result, Ok, Err } from "@typesugar/fp";

function parseNumber(s: string): Result<number, string> {
  const n = parseInt(s, 10);
  return isNaN(n) ? Err("Invalid number") : Ok(n);
}

const result = parseNumber("42")
  .map((n) => n * 2)
  .mapErr((e) => `Error: ${e}`);
```

### Creating Results

```typescript
Ok(42); // Success with value 42
Err("failed"); // Failure with error
Result.try(() => JSON.parse(s)); // Ok or Err based on exception
```

### Methods

```typescript
const res = Ok(42);

res.isOk(); // true
res.isErr(); // false
res.map((x) => x * 2); // Ok(84)
res.mapErr((e) => `Error: ${e}`); // Ok(42) (no change)
res.flatMap((x) => Ok(x * 2)); // Ok(84)
res.getOrElse(0); // 42
res.getOrThrow(); // 42
res.match({
  ok: (x) => `Got ${x}`,
  err: (e) => `Failed: ${e}`,
});
```

### Error Accumulation

```typescript
import { Validated, Valid, Invalid } from "@typesugar/fp";

function validateAge(age: number): Validated<string[], number> {
  return age >= 0 && age <= 150 ? Valid(age) : Invalid(["Age must be between 0 and 150"]);
}

function validateName(name: string): Validated<string[], string> {
  return name.length > 0 ? Valid(name) : Invalid(["Name cannot be empty"]);
}

const result = Validated.mapN(validateName(name), validateAge(age), (n, a) => ({
  name: n,
  age: a,
}));
// Collects all errors, doesn't short-circuit
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

## Either

Like Result, but for any two types:

```typescript
import { Either, Left, Right } from "@typesugar/fp";

type Response = Either<Error, Data>;

const response: Response = fetchData()
  .map((data) => processData(data))
  .mapLeft((err) => new Error(`Fetch failed: ${err}`));
```

## Higher-Kinded Types

typesugar supports HKTs for generic FP code:

```typescript
import { $, Functor, Monad } from "@typesugar/fp";

// Works with any Functor
function double<F>(F: Functor<F>, fa: $<F, number>): $<F, number> {
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
