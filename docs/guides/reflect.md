# Type Reflection

Compile-time type introspection with zero runtime overhead. Examine types, extract metadata, and generate validators and other code from type information — all at compile time.

Inspired by Rust's `proc_macro`, Zig's `@typeInfo`, and Java/C# reflection, but without the runtime cost.

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
//     { name: "id", type: "number", optional: false, readonly: false },
//     { name: "name", type: "string", optional: false, readonly: false },
//     { name: "email", type: "string", optional: true, readonly: false },
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
import { validator, ValidationResult } from "@typesugar/reflect";

interface User {
  id: number;
  name: string;
  active?: boolean;
}

const validateUser = validator<User>();

const result = validateUser(unknownData);
if (result.success) {
  console.log(result.value.name); // Type-safe access
} else {
  console.log(result.errors); // ["Invalid type for field 'id': expected number"]
}
```

### @reflect — Enable Reflection Metadata

```typescript
import { reflect } from "@typesugar/reflect";

@reflect
interface User {
  id: number;
  name: string;
}

// Generates alongside the interface:
export const __User_meta__ = {
  name: "User",
  kind: "interface",
  fields: [
    { name: "id", type: "number", optional: false, readonly: false },
    { name: "name", type: "string", optional: false, readonly: false },
  ],
  methods: [],
  typeParameters: [],
};
```

## Type Information Structure

### TypeInfo

```typescript
interface TypeInfo {
  name: string;
  kind:
    | "interface"
    | "class"
    | "type"
    | "enum"
    | "primitive"
    | "union"
    | "intersection"
    | "array"
    | "tuple"
    | "function";
  fields?: FieldInfo[];
  methods?: MethodInfo[];
  typeParameters?: string[];
  extends?: string[];
  modifiers?: string[];
}
```

### FieldInfo

```typescript
interface FieldInfo {
  name: string;
  type: string;
  optional: boolean;
  readonly: boolean;
  defaultValue?: string;
}
```

### MethodInfo

```typescript
interface MethodInfo {
  name: string;
  parameters: ParameterInfo[];
  returnType: string;
  isAsync: boolean;
  isStatic: boolean;
}
```

### ValidationResult

```typescript
type ValidationResult<T> = { success: true; value: T } | { success: false; errors: string[] };
```

## API Reference

### Expression Macros

- `typeInfo<T>()` — Get compile-time type information
- `fieldNames<T>()` — Get field names as an array
- `validator<T>()` — Generate a runtime validator function

### Attribute Macros

- `@reflect` — Enable compile-time reflection metadata generation

### Functions

- `register()` — Register all reflection macros (called automatically on import)

## Limitations

### validator\<T\>()

- `validator<T>()` currently validates **primitive fields only** (`string`, `number`, `boolean`).
- Fields with array types, nested object types, union types, and intersection types are **silently skipped** during validation — no error is reported for those fields regardless of the input value.
- For complex validation needs (nested objects, arrays, unions, branded types), use [`@typesugar/validate`](/guides/validate) instead.

## Learn More

- [API Reference](/reference/packages#reflect)
- [Validation guide](/guides/validate) — richer runtime validation and schema DSL
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/reflect)
