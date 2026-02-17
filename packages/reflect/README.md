# @ttfx/reflect

> Compile-time type reflection macros.

## Overview

`@ttfx/reflect` provides compile-time type introspection capabilities. Examine types, extract metadata, and generate code based on type information — all at compile time with zero runtime overhead.

Inspired by Rust's proc_macro, Zig's @typeInfo, and Java/C# reflection (but without the runtime cost).

## Installation

```bash
npm install @ttfx/reflect
# or
pnpm add @ttfx/reflect
```

## Usage

### typeInfo<T>() — Get Type Metadata

```typescript
import { typeInfo } from "@ttfx/reflect";

interface User {
  id: number;
  name: string;
  email?: string;
}

const meta = typeInfo<User>();
// Compiles to:
// const meta = {
//   name: "User",
//   kind: "interface",
//   fields: [
//     { name: "id", type: "number", optional: false, readonly: false },
//     { name: "name", type: "string", optional: false, readonly: false },
//     { name: "email", type: "string", optional: true, readonly: false },
//   ]
// };
```

### fieldNames<T>() — Get Field Names

```typescript
import { fieldNames } from "@ttfx/reflect";

interface User {
  id: number;
  name: string;
}

const fields = fieldNames<User>();
// Compiles to: const fields = ["id", "name"];
```

### validator<T>() — Generate Runtime Validator

```typescript
import { validator, ValidationResult } from "@ttfx/reflect";

interface User {
  id: number;
  name: string;
  active?: boolean;
}

const validateUser = validator<User>();

// Usage:
const result = validateUser(unknownData);
if (result.success) {
  console.log(result.value.name); // Type-safe access
} else {
  console.log(result.errors); // ["Invalid type for field 'id': expected number"]
}
```

### @reflect — Enable Reflection Metadata

```typescript
import { reflect } from "@ttfx/reflect";

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
type ValidationResult<T> =
  | { success: true; value: T }
  | { success: false; errors: string[] };
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

## License

MIT
