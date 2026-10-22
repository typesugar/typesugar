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
//   ],
//   methods: [],
// }
```

Methods (a class's methods, an interface's method signatures) are listed in
`methods`, with the signature the type checker gives them, not in `fields`:

```typescript
class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}

const calc = typeInfo<Calculator>();
// calc.methods:
// [
//   {
//     name: "add",
//     parameters: [
//       { name: "a", type: "number", optional: false },
//       { name: "b", type: "number", optional: false },
//     ],
//     returnType: "number",
//     isAsync: false,
//     isStatic: false,
//   },
// ]
```

A function-valued property (`onDone: () => void`) is a field.

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

## Limitations

### validator\<T\>()

- The generated function returns a `ValidationResult<T>` object — it is **not** a type guard. The
  result is always truthy; check `result.success`.
- A `T` made only of primitives and literals (`string | number`, `"a" | "b"`,
  `boolean | undefined`, an enum) is checked as a whole: `validator<string | number>()`
  accepts any string or number and fails anything else with
  `Expected string | number, got object`.
- For an object type, only the **top level** of `T` is checked. Per field:
  - `string`, `number`, `boolean`, `bigint`, `symbol` — `typeof` check;
  - string/number/boolean literal types, literal unions and enums — `===` against each allowed value;
  - `null` / `undefined` members of a union (e.g. `string | null`) are accepted;
  - arrays and tuples — `Array.isArray` only (elements are not checked);
  - methods and function-typed fields — `typeof === "function"`;
  - nested objects/interfaces — non-null object only (their fields are not checked);
  - `any` / `unknown` — anything.
- Fields whose type cannot be checked at runtime (type parameters, intersections, ...) are not
  validated, and the macro reports a **warning** naming each one.
- Keys that are not identifiers (e.g. `"first-name"`) are handled.
- For deep validation (nested objects, array elements, branded types), use
  [`@typesugar/validate`](/guides/validate) instead.

## Learn More

- [API Reference](/reference/packages#reflect)
- [Validation guide](/guides/validate) — richer runtime validation and schema DSL
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/reflect)
