# Validation

Zero-cost validation and schema macros. Compile-time type guards, assertions, and validation with rich error accumulation.

## Quick Start

```bash
npm install @typesugar/validate
```

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

## Features

### Type Guards

Generate type guards at compile time:

```typescript
const isUser = is<User>();

if (isUser(data)) {
  // data is typed as User
  console.log(data.name);
}
```

### Assertions

Assert and narrow types with runtime checks:

```typescript
const assertUser = assert<User>();

const user = assertUser(data); // throws if invalid
console.log(user.name); // user is typed as User
```

### Validation with Error Accumulation

Collect all validation errors instead of failing fast:

```typescript
const validateUser = validate<User>();

const result = validateUser(data);
result.fold(
  (errors) => console.error("Validation failed:", errors),
  (user) => console.log("Valid user:", user.name)
);
```

## Schema DSL

Build schemas programmatically:

```typescript
import { Schema } from "@typesugar/validate";

const UserSchema = Schema.object({
  name: Schema.string().minLength(1),
  age: Schema.number().int().min(0).max(150),
  email: Schema.string().email().optional(),
});

const result = UserSchema.validate(data);
```

## Zero-Cost

All validation logic is generated at compile time:

```typescript
// Generated code for is<User>()
function isUser(value: unknown): value is User {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as any).name === "string" &&
    typeof (value as any).age === "number"
  );
}
```

## Learn More

- [API Reference](/reference/packages#validate)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/validate)
