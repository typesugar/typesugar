# typesugar for Zod Users

This guide maps Zod concepts to their typesugar equivalents. The validators come from
[`@typesugar/validate`](../guides/validate.md): `is<T>()` builds a type guard,
`validate<T>()` a validator that collects errors, and `assert<T>()` one that throws.
They are macros, generated from your TypeScript types at compile time.

## Overview

| Zod                       | typesugar                 |
| ------------------------- | ------------------------- |
| Runtime validation        | Compile-time + runtime    |
| Schema DSL                | TypeScript types + macros |
| `z.infer<T>`              | Direct types              |
| `safeParse`               | `validate<T>()`           |
| `schema.parse` as a guard | `is<T>()`                 |

## Basic Types

### Primitives

```typescript
// Zod
const schema = z.string();
const result = schema.parse(value);

// typesugar
import { is } from "@typesugar/validate";

const isString = is<string>();
if (isString(value)) {
  // value is typed as string
}
```

### Objects

```typescript
// Zod
const UserSchema = z.object({
  name: z.string(),
  age: z.number(),
});
type User = z.infer<typeof UserSchema>;

// typesugar
interface User {
  name: string;
  age: number;
}
const isUser = is<User>();
```

### Arrays

```typescript
// Zod
const schema = z.array(z.string());

// typesugar
const isStringArray = is<string[]>();
isStringArray(["a", 1]); // false
```

### Optionals

```typescript
// Zod
const schema = z.object({
  name: z.string(),
  age: z.number().optional(),
});

// typesugar
interface User {
  name: string;
  age?: number;
}
```

## Validation

### Runtime Checking

```typescript
// Zod
const result = UserSchema.safeParse(data);
if (result.success) {
  console.log(result.data.name);
} else {
  console.log(result.error);
}

// typesugar: a type guard
import { is } from "@typesugar/validate";

const isUser = is<User>();
if (isUser(data)) {
  console.log(data.name); // data is typed as User
} else {
  console.log("Invalid data");
}
```

`validator<T>()` from `@typesugar/reflect` is a different shape: it returns a result
object, `{ success: true, value } | { success: false, errors }`, so don't use it
directly in an `if` (the object is always truthy, so invalid data would pass):

```typescript
import { validator } from "@typesugar/reflect";

const r = validator<User>()(data);
if (r.success) {
  console.log(r.value.name);
}
```

### With Error Details

```typescript
// Zod provides detailed errors
const result = schema.safeParse(data);
result.error?.issues.forEach((issue) => {
  console.log(issue.path, issue.message);
});

// typesugar: validate<T>() accumulates errors with their paths
import { validate } from "@typesugar/validate";

const checkUser = validate<User>();
const result = checkUser({ name: 1 });
// → { error: { head: { path: "$.name", message: "expected string" }, tail: null } }
```

The result is a `ValidatedNel` from `@typesugar/fp`: a success value, or a non-empty
list of `{ path, message }` errors.

## Type Inference

### From Schema to Type

```typescript
// Zod: schema → type
const UserSchema = z.object({ name: z.string() });
type User = z.infer<typeof UserSchema>;

// typesugar: type → validator
interface User {
  name: string;
}
const isUser = is<User>(); // derived from type
```

### Fields Info

```typescript
// Zod
const keys = UserSchema.keyof();

// typesugar
import { fieldNames } from "@typesugar/reflect";
const keys = fieldNames<User>(); // ["name", "age"]
```

## Transformations

### Refinements

```typescript
// Zod
const PositiveNumber = z.number().positive();

// typesugar
import type { Positive } from "@typesugar/type-system";
type PositiveNumber = Positive; // = Refined<number, "Positive">
```

### Branded Types

```typescript
// Zod
const UserId = z.string().brand<"UserId">();
type UserId = z.infer<typeof UserId>;

// typesugar
import { wrap, type Newtype } from "@typesugar/type-system";
type UserId = Newtype<string, "UserId">;
const userId = wrap<UserId>("user-123");
```

## Unions

```typescript
// Zod
const Result = z.discriminatedUnion("status", [
  z.object({ status: z.literal("success"), data: z.string() }),
  z.object({ status: z.literal("error"), error: z.string() }),
]);

// typesugar
type Result = { status: "success"; data: string } | { status: "error"; error: string };

const isResult = is<Result>();
isResult({ status: "error", error: "x" }); // true
isResult({ status: "nope" }); // false
```

## Serialization

### JSON Parsing

```typescript
// Zod
const user = UserSchema.parse(JSON.parse(jsonString));

// typesugar
import { derive, Json } from "@typesugar/derive";
import "@typesugar/std/syntax/json"; // activates User.fromJson / user.toJson()

@derive(Json)
class User {
  constructor(
    public name: string,
    public age: number
  ) {}
}

// fromJson takes an already-parsed value, checks the required fields and their
// types (throws on a mismatch), and returns a plain object — not a User instance
const user = User.fromJson(JSON.parse(jsonString));
```

## Async Validation

```typescript
// Zod
const schema = z.string().refine(async (val) => {
  return await checkDatabase(val);
});

// typesugar: use regular async functions
const isString = is<string>();

async function checkValue(value: unknown): Promise<boolean> {
  if (!isString(value)) return false;
  return await checkDatabase(value);
}
```

## Key Differences

### Compile-Time vs Runtime

Zod is purely runtime. typesugar validates types at compile time and optionally at runtime:

```typescript
// This error is caught at compile time
const user: User = { name: 123 }; // Error: Type 'number' is not assignable to 'string'

// Runtime validation when needed
if (isUser(untrustedData)) {
  // Safe to use
}
```

### Bundle Size

Zod schemas add to bundle size. typesugar validators compile away:

```typescript
// Zod: schema code is in the bundle
const schema = z.object({ ... });  // Runtime code

// typesugar: compiled to optimized code
const isUser = is<User>();  // Generates inline checks
```

### Type-First

typesugar is type-first: define types, generate validators. Zod is schema-first.

## Migration Strategy

1. **Keep Zod for external data**: API responses, form inputs
2. **Use typesugar for internal types**: Domain models, configs
3. **Gradually migrate**: Replace schemas with types + validators
4. **Use refinement types**: For validated data guarantees

## When to Use Each

### Use Zod

- Heavy runtime validation needs
- Complex custom validators
- Form validation with detailed errors
- API input validation

### Use typesugar

- Type-safe domain modeling
- Compile-time type derivation
- Zero-runtime-cost abstractions
- Integration with typeclass system
