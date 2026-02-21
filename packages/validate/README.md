# @typesugar/validate

Zero-cost validation and schema macros for typesugar.

Compile-time type guards, assertions, and validation with rich error accumulation.

## Installation

```bash
npm install @typesugar/validate
```

Requires the typesugar transformer to be configured in your build.

## Usage

### Type Guards

Generate type guards at compile time:

```typescript
import { is } from "@typesugar/validate";

interface User {
  name: string;
  age: number;
  email?: string;
}

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

### Validation with Error Accumulation

Collect all validation errors instead of failing fast:

```typescript
import { validate } from "@typesugar/validate";

const validateUser = validate<User>();

const result = validateUser(data);
// result: ValidatedNel<ValidationError, User>

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

All validation logic is generated at compile time. The generated code is the same as if you wrote the checks by hand:

```typescript
// Generated code for is<User>()
function isUser(value: unknown): value is User {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as any).name === "string" &&
    typeof (value as any).age === "number" &&
    ((value as any).email === undefined || typeof (value as any).email === "string")
  );
}
```

## License

MIT
