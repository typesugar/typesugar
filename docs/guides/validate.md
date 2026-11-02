# Validation

Zero-cost validation macros and a library-agnostic `Schema` typeclass for typesugar. Compile-time type guards, assertions, and validation with rich error accumulation.

## Quick Start

```bash
npm install @typesugar/validate
```

Requires the typesugar transformer to be configured in your build.

```typescript
import { is, assert, validate } from "@typesugar/validate";

interface User {
  name: string;
  age: number;
  email?: string;
}

const isUser = is<User>();

if (isUser(data)) {
  console.log(data.name); // data is typed as User
}
```

## Macros

### Type Guards

Generate type guards at compile time:

```typescript
import { is } from "@typesugar/validate";

const isUser = is<User>();

if (isUser(data)) {
  // data is typed as User
  console.log(data.name);
}
```

### Assertions

Assert and narrow types with runtime checks:

```typescript
import { assert } from "@typesugar/validate";

const assertUser = assert<User>();

const user = assertUser(data); // throws if invalid
console.log(user.name); // user is typed as User
```

`assertType<T>()` is the same macro under another name (the name typescript-is and
typia use). Use it in files that also import `@typesugar/testing`'s `assert`; see
[Using validate and testing together](#using-validate-and-testing-together).

### Validation with Error Accumulation

Collect all validation errors instead of failing fast:

```typescript
import { validate } from "@typesugar/validate";

const validateUser = validate<User>();

const result = validateUser(data);
// result: ValidatedNel<ValidationError, User> — the @typesugar/fp shape:
//   valid:   { value: User }
//   invalid: { error: NonEmptyList<ValidationError> }  ({ head, tail }, Nil = null)

if (isValid(result)) {
  console.log("Valid user:", result.value.name);
} else {
  // every failing path is reported, e.g. { path: "$.age", message: "expected number" }
  for (let e: List<ValidationError> = result.error; e !== null; e = e.tail) {
    console.error(e.head.path, e.head.message);
  }
}
```

(`isValid` and `List` come from `@typesugar/fp`. `Validated` values are plain
data — there is no `.fold` method.)

### Checking a Value Directly

Pass the value as an argument to check it on the spot instead of getting a function back
(typia's `is<T>(input)` form). The argument is evaluated once.

```typescript
import { is, assert, validate } from "@typesugar/validate";

if (is<User>(data)) {
  console.log(data.name); // data is typed as User
}

const user = assert<User>(data); // returns data typed as User, or throws
const result = validate<User>(data); // ValidatedNel<ValidationError, User>
```

Passing more than one argument is a compile-time error.

## Using validate and testing together

`@typesugar/validate` and `@typesugar/testing` both have an `assert` macro:
validate's `assert<T>()` checks `unknown` data against a type, testing's
`assert(cond)` is a power assertion. Both packages can be loaded in one project
(for example validate in the app and testing in its tests). Each call expands the
macro of the package it was imported from, whichever package loaded first.

In a file that needs both, import validate's under its other name, `assertType`:

```typescript
import { assert } from "@typesugar/testing";
import { assertType } from "@typesugar/validate";

const assertUser = assertType<User>(); // validate's assertion function
assert(assertUser(data).name === "Ada"); // testing's power assert
```

Renaming the import (`import { assert as assertValid } from "@typesugar/validate"`)
or using a namespace (`import * as v from "@typesugar/validate"; v.assert<User>()`)
works too.

`@typesugar/testing` also has an `assertType<T>(value)` macro, a type-driven
assertion for tests. As with `assert`, the import decides which one a call uses.

## Schema Typeclass

The `Schema<F>` typeclass abstracts over validation libraries, enabling library-agnostic validation code with zero-cost specialization.

```typescript
import { Schema, NativeSchema, nativeSchema, Validator } from "@typesugar/validate";
```

### What is `Schema<F>`?

`Schema<F>` is a typeclass where `F` represents a type-level function for schema types.
The package ships one instance, for native validators:

- `Kind<ValidatorF, User>` = `(x: unknown) => x is User` (`nativeSchema`)

No Zod or Valibot instance ships with 1.0. To use one of those libraries, write
the instance yourself with `makeSchema` (see
[Creating Custom Schema Instances](#creating-custom-schema-instances)) over your
own type-level function, for example a `ZodF` where `Kind<ZodF, User>` =
`ZodType<User>`.

### Schema Interface

```typescript
interface Schema<F> {
  /** Parse data and return the validated value, or throw on failure */
  readonly parse: <A>(schema: Kind<F, A>, data: unknown) => A;

  /** Parse data and return a ValidatedNel with accumulated errors */
  readonly safeParse: <A>(schema: Kind<F, A>, data: unknown) => ValidatedNel<ValidationError, A>;
}
```

### Native Schema Instance

For validators generated by `is<T>()`:

```typescript
import { nativeSchema, Validator } from "@typesugar/validate";

// Use with native type guard validators
const isUser = is<User>();

// Parse or throw
const user = nativeSchema.parse(isUser, data);

// Parse with error accumulation
const result = nativeSchema.safeParse(isUser, data);
```

### Library-Agnostic Validation

Write validation code that works with any library:

```typescript
import { Schema } from "@typesugar/validate";

// Generic validation function
function processBody<F, A>(S: Schema<F>, schema: Kind<F, A>, data: unknown): A {
  return S.parse(schema, data);
}

// Passing a known dictionary auto-specializes the call at compile time
// when the instance's source is visible to the compiler (see Zero-Cost below):
// processBody(nativeSchema, isUser, data)
```

### Derived Operations

The following operations are derived from the base `Schema` interface:

```typescript
import {
  parseOrElse,
  parseMap,
  parseChain,
  parseAll,
  safeParseAll,
  nativeParseOrElse,
  nativeParseMap,
  nativeParseAll,
  nativeSafeParseAll,
} from "@typesugar/validate";

// Parse with fallback
const user = parseOrElse(S)(schema, data, defaultUser);

// Parse and transform
const name = parseMap(S)(schema, data, (user) => user.name);

// Chain parsers
const result = parseChain(S)(rawSchema, userSchema, data);

// Validate multiple values
const users = parseAll(S)(schema, dataArray);

// Validate multiple with error accumulation
const results = safeParseAll(S)(schema, dataArray);
```

### Creating Custom Schema Instances

```typescript
import { makeSchema, makeNativeSchema, ValidationError } from "@typesugar/validate";
import { ValidatedNel, Valid, invalidNel } from "@typesugar/fp";

// For HKT-style schemas
const mySchema = makeSchema<MySchemaF>(
  (schema, data) => schema.parse(data),
  (schema, data) => {
    try {
      return Valid(schema.parse(data));
    } catch (e) {
      return invalidNel({ path: "$", message: String(e) });
    }
  }
);

// For native validators
const myNativeSchema = makeNativeSchema(
  (validator, data) => {
    if (validator(data)) return data;
    throw new Error("Validation failed");
  },
  (validator, data) => {
    if (validator(data)) return Valid(data);
    return invalidNel({ path: "$", message: "Validation failed" });
  }
);
```

## Zero-Cost

All validation logic is generated at compile time. The generated code is the same as if you wrote the checks by hand:

```typescript
// Generated code for is<User>()
const isUser = (value: unknown): value is User => {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.name === "string" &&
    typeof value.age === "number" &&
    (value.email === undefined || typeof value.email === "string")
  );
};
```

A `Schema` instance passed to a generic function such as `processBody` above
is specialized (the dictionary is eliminated and `parse` is inlined) only when
the compiler can see the instance's source: an instance you declare with
`/** @impl Schema<...> */` in your own project, or `nativeSchema` when
`@typesugar/validate` is compiled from source in the same program. Across a
published package boundary it is **not** specialized yet: a `nativeSchema`
imported from the installed `@typesugar/validate` package keeps dictionary
passing (correct, just not zero-cost), and a TS9602 warning says so: the
package's `.d.ts` has no method bodies to inline.

## API Reference

### Macros

| Macro             | Description                                                       |
| ----------------- | ----------------------------------------------------------------- |
| `is<T>()`         | Generate a type guard `(x: unknown) => x is T`                    |
| `assert<T>()`     | Generate an assertion `(x: unknown) => T` that throws on failure  |
| `assertType<T>()` | Alias of `assert<T>()`                                            |
| `validate<T>()`   | Generate a validator returning `ValidatedNel<ValidationError, T>` |

Each macro also takes the value to check as its one argument: `is<T>(x)` returns
a boolean that narrows `x`, `assert<T>(x)` and `assertType<T>(x)` return `x` typed
as `T` or throw, and `validate<T>(x)` returns the `ValidatedNel`.

### Types

| Type              | Description                                  |
| ----------------- | -------------------------------------------- |
| `Schema<F>`       | Typeclass for validation libraries           |
| `NativeSchema`    | Specialized Schema for native validators     |
| `Validator<A>`    | Type guard function `(x: unknown) => x is A` |
| `ValidationError` | Error with `path` and `message` fields       |

### Functions

| Function                             | Description                                     |
| ------------------------------------ | ----------------------------------------------- |
| `nativeSchema`                       | Pre-built Schema instance for native validators |
| `makeSchema<F>(parse, safeParse)`    | Create a Schema instance                        |
| `makeNativeSchema(parse, safeParse)` | Create a NativeSchema instance                  |
| `parseOrElse(S)`                     | Parse with fallback value                       |
| `parseMap(S)`                        | Parse and transform result                      |
| `parseChain(S)`                      | Chain two parsers                               |
| `parseAll(S)`                        | Parse array of values                           |
| `safeParseAll(S)`                    | Parse array with error accumulation             |

## What gets checked

| Type                                              | Runtime check                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `string`, `number`, `boolean`, `bigint`, `symbol` | `typeof`                                                                             |
| literals, enums, `null`, `undefined`              | `===` against each allowed value                                                     |
| unions (incl. discriminated unions, `T \| null`)  | any member matches                                                                   |
| objects / interfaces                              | non-null object, then every property (optional ones may be absent), index signatures |
| methods / function types                          | `typeof === "function"`                                                              |
| arrays, tuples                                    | `Array.isArray`, tuple length, every element                                         |
| `Date`, `Map`, `Set`, `RegExp`, typed arrays, ... | `instanceof`                                                                         |
| recursive types                                   | a hoisted named helper per recursive type                                            |
| branded primitives (`string & { __brand: "X" }`)  | the primitive part only (brands have no runtime value)                               |

Types that cannot be checked precisely — type parameters, template literal
types, `unique symbol`, variadic tuples, and similar — are a **compile-time
error**. The generated check for them rejects every value, so an ignored
error fails closed rather than accepting anything.

## Current Limitations

- **Symbol-keyed and `#private` members are skipped**: they cannot be read off
  arbitrary input.
- **Class instances are checked structurally**: `is<MyClass>()` checks the
  fields and that methods are functions; it does not use `instanceof`.
- **Without `strictNullChecks`**, TypeScript erases `null`/`undefined` from
  types; the macro recovers them from the written type annotation of the
  property (or the type argument itself), but not through type aliases.

## Learn More

- [API Reference](/reference/packages#validate)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/validate)
