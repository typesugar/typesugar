# typesugar for Zod Users

This guide maps Zod concepts to their typesugar equivalents.

## Overview

| Zod                | typesugar                 |
| ------------------ | ------------------------- |
| Runtime validation | Compile-time + runtime    |
| Schema DSL         | TypeScript types + macros |
| `z.infer<T>`       | Direct types              |
| `safeParse`        | `validator<T>()`          |

## Basic Types

### Primitives

```typescript
// Zod
const schema = z.string();
const result = schema.parse(value);

// typesugar
const isString = validator<string>();
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
const isUser = validator<User>();
```

### Arrays

```typescript
// Zod
const schema = z.array(z.string());

// typesugar
const isStringArray = validator<string[]>();
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

// typesugar
import { validator } from "@typesugar/reflect";

const isUser = validator<User>();
if (isUser(data)) {
  console.log(data.name); // data is typed as User
} else {
  console.log("Invalid data");
}
```

### With Error Details

```typescript
// Zod provides detailed errors
const result = schema.safeParse(data);
result.error?.issues.forEach((issue) => {
  console.log(issue.path, issue.message);
});

// typesugar: use contracts for detailed checks
import { requires } from "@typesugar/contracts";

function processUser(data: unknown): User {
  requires: {
    (typeof data === "object" && data !== null, "must be object");
    ("name" in data && typeof data.name === "string", "name must be string");
    ("age" in data && typeof data.age === "number", "age must be number");
  }
  return data as User;
}
```

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
const isUser = validator<User>(); // derived from type
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
import { Refined, Positive } from "@typesugar/contracts-refined";
type PositiveNumber = Refined<number, Positive>;
```

### Branded Types

```typescript
// Zod
const UserId = z.string().brand<"UserId">();
type UserId = z.infer<typeof UserId>;

// typesugar
import { Newtype, newtype } from "@typesugar/type-system";
type UserId = Newtype<string, "UserId">;
const userId = newtype<UserId>("user-123");
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

const isResult = validator<Result>();
```

## Serialization

### JSON Parsing

```typescript
// Zod
const user = UserSchema.parse(JSON.parse(jsonString));

// typesugar
import { derive, Json } from "@typesugar/derive";

@derive(Json)
class User {
  constructor(
    public name: string,
    public age: number
  ) {}
}

const user = User.fromJson(jsonString);
```

## Async Validation

```typescript
// Zod
const schema = z.string().refine(async (val) => {
  return await checkDatabase(val);
});

// typesugar: use regular async functions
async function validate(value: string): Promise<boolean> {
  const isValid = validator<string>()(value);
  if (!isValid) return false;
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
const isUser = validator<User>();  // Generates inline checks
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
