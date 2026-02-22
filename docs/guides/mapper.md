# Object Mapping

Zero-cost compile-time object mapping and transformation. Inspired by Scala's Chimney.

## Quick Start

```bash
npm install @typesugar/mapper
```

```typescript
import { transformInto } from "@typesugar/mapper";

interface User {
  first_name: string;
  last_name: string;
  age: number;
}

interface UserDTO {
  firstName: string;
  lastName: string;
  age: number;
  role: string;
}

const user: User = { first_name: "John", last_name: "Doe", age: 30 };

const dto = transformInto<User, UserDTO>(user, {
  rename: {
    firstName: "first_name",
    lastName: "last_name",
  },
  const: {
    role: "user",
  },
});

// dto is { firstName: "John", lastName: "Doe", age: 30, role: "user" }
```

## Features

- **Zero-cost** — All transformations are evaluated at compile time and inlined
- **Type-safe** — Compile-time validation. Fails build if a target field is not mapped
- **No decorators needed** — Works with plain interfaces and types

## How It Works

The macro analyzes source and target types at compile time:

1. Fields with matching names are copied automatically
2. `rename` maps target field names to source field names
3. `const` provides constant values for fields not in the source
4. Missing mappings cause compile-time errors

## Learn More

- [API Reference](/reference/packages#mapper)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/mapper)
