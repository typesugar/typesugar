# Type Reflection

Compile-time type introspection with zero runtime overhead. Examine types, extract metadata, and generate validators.

## Quick Start

```bash
npm install @typesugar/reflect
```

```typescript
import { typeInfo, fieldNames, validator } from "@typesugar/reflect";

interface User {
  id: number;
  name: string;
  email?: string;
}

const fields = fieldNames<User>();
// Compiles to: ["id", "name", "email"]

const validateUser = validator<User>();
// Generates a runtime validator from the type
```

## Features

### typeInfo\<T\>() — Get Type Metadata

```typescript
const meta = typeInfo<User>();
// Compiles to:
// {
//   name: "User",
//   kind: "interface",
//   fields: [
//     { name: "id", type: "number", optional: false },
//     { name: "name", type: "string", optional: false },
//     { name: "email", type: "string", optional: true },
//   ]
// }
```

### fieldNames\<T\>() — Get Field Names

```typescript
const fields = fieldNames<User>();
// Compiles to: ["id", "name", "email"]
```

### validator\<T\>() — Generate Runtime Validator

```typescript
const validateUser = validator<User>();

const result = validateUser(unknownData);
if (result.success) {
  console.log(result.value.name); // Type-safe access
} else {
  console.log(result.errors);
}
```

### @reflect — Enable Reflection Metadata

```typescript
@reflect
interface User {
  id: number;
  name: string;
}

// Generates alongside the interface:
export const __User_meta__ = { /* metadata */ };
```

## Learn More

- [API Reference](/reference/packages#reflect)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/reflect)
