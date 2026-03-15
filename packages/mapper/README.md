# @typesugar/mapper

Zero-cost compile-time object mapping and transformation. Inspired by Scala's Chimney and .NET's AutoMapper, but fully integrated into TypeScript with zero runtime overhead.

## The Problem

Every application has DTO/entity boundaries. Converting between database records, API responses, and domain models requires tedious, error-prone boilerplate:

```typescript
// Without @typesugar/mapper — manual boilerplate everywhere
function toUserDTO(user: User): UserDTO {
  return {
    firstName: user.first_name,
    lastName: user.last_name,
    age: user.age,
    role: "user",
    fullName: `${user.first_name} ${user.last_name}`,
  };
}

// Repeated for every entity × every boundary
function toProductDTO(product: Product): ProductDTO {
  /* ... */
}
function toOrderDTO(order: Order): OrderDTO {
  /* ... */
}
function toCustomerDTO(customer: Customer): CustomerDTO {
  /* ... */
}
```

This boilerplate is:

- **Error-prone**: Field name typos compile but produce runtime bugs
- **Verbose**: Every mapping requires a dedicated function
- **Unmaintainable**: Adding fields requires updating multiple locations

## The Solution

`transformInto<From, To>()` is a compile-time macro that generates the mapping code for you:

```typescript
import { transformInto } from "@typesugar/mapper";

// Compiles to direct property assignments — zero runtime overhead
const dto = transformInto<User, UserDTO>(user, {
  rename: { firstName: "first_name", lastName: "last_name" },
  const: { role: "user" },
  compute: { fullName: (u) => `${u.first_name} ${u.last_name}` },
});
```

The compiler:

1. Validates that all target fields are mapped (build fails if not)
2. Transforms the call into a plain object literal
3. Inlines computed fields directly

**Result**: Type-safe, maintainable mapping with zero runtime cost.

## Installation

```bash
npm install @typesugar/mapper
# or
pnpm add @typesugar/mapper
```

Requires the typesugar transformer to be configured in your build tool.

## Quick Start

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

---

## Features

### Basic Mapping — Same Field Names

When source and target types have matching field names, no configuration is needed:

```typescript
interface UserEntity {
  name: string;
  email: string;
  age: number;
}

interface UserDTO {
  name: string;
  email: string;
  age: number;
}

const entity: UserEntity = { name: "Alice", email: "alice@example.com", age: 30 };
const dto = transformInto<UserEntity, UserDTO>(entity);
// dto is { name: "Alice", email: "alice@example.com", age: 30 }
```

### Field Renaming — `rename`

Map fields with different names between source and target:

```typescript
interface DbRecord {
  user_name: string;
  user_email: string;
  user_age: number;
}

interface ApiResponse {
  name: string;
  email: string;
  age: number;
}

const dbRow: DbRecord = { user_name: "Bob", user_email: "bob@x.co", user_age: 25 };

const response = transformInto<DbRecord, ApiResponse>(dbRow, {
  rename: {
    name: "user_name", // target field: source field
    email: "user_email",
    age: "user_age",
  },
});
// response is { name: "Bob", email: "bob@x.co", age: 25 }
```

The `rename` config uses **target keys** pointing to **source field names**.

### Computed Fields — `compute`

Derive target field values from source data using functions:

```typescript
interface FullName {
  firstName: string;
  lastName: string;
}

interface DisplayInfo {
  fullName: string;
  initials: string;
}

const name: FullName = { firstName: "Jane", lastName: "Doe" };

const display = transformInto<FullName, DisplayInfo>(name, {
  compute: {
    fullName: (src) => `${src.firstName} ${src.lastName}`,
    initials: (src) => `${src.firstName[0]}${src.lastName[0]}`,
  },
});
// display is { fullName: "Jane Doe", initials: "JD" }
```

Compute functions receive the entire source object and return the target field value.

### Constant Values — `const`

Inject fixed values for target fields that don't exist in the source:

```typescript
interface Input {
  value: number;
}

interface Output {
  value: number;
  source: string;
  version: number;
}

const input: Input = { value: 42 };

const output = transformInto<Input, Output>(input, {
  const: {
    source: "manual",
    version: 1,
  },
});
// output is { value: 42, source: "manual", version: 1 }
```

### Ignoring Fields — `ignore`

Skip source fields that shouldn't be mapped, or target fields that should be omitted:

```typescript
interface Verbose {
  id: number;
  name: string;
  internalCode: string;
  debugInfo: string;
}

interface Brief {
  id: number;
  name: string;
}

const verbose: Verbose = { id: 1, name: "Test", internalCode: "X", debugInfo: "..." };

const brief = transformInto<Verbose, Brief>(verbose, {
  ignore: {
    source: ["internalCode", "debugInfo"], // Don't complain about unmapped source fields
  },
});
// brief is { id: 1, name: "Test" }
```

Use `ignore.target` to exclude target fields from the output entirely:

```typescript
const partial = transformInto<Source, Target>(src, {
  ignore: {
    target: ["optionalField"], // Omit this field from output
  },
});
```

### Combined Configuration

All config options can be used together:

```typescript
interface OrderRow {
  order_id: number;
  total_cents: number;
  customer_name: string;
}

interface OrderSummary {
  id: number;
  totalFormatted: string;
  customer: string;
  currency: string;
}

const row: OrderRow = { order_id: 1001, total_cents: 4999, customer_name: "Charlie" };

const summary = transformInto<OrderRow, OrderSummary>(row, {
  rename: {
    id: "order_id",
    customer: "customer_name",
  },
  compute: {
    totalFormatted: (src) => `$${(src.total_cents / 100).toFixed(2)}`,
  },
  const: {
    currency: "USD",
  },
});
// summary is { id: 1001, totalFormatted: "$49.99", customer: "Charlie", currency: "USD" }
```

---

## Zero-Cost Guarantee

`transformInto()` is a compile-time macro. The function call is **completely erased** and replaced with a direct object literal.

**Source code:**

```typescript
const dto = transformInto<User, UserDTO>(user, {
  rename: { firstName: "first_name" },
  const: { role: "user" },
});
```

**Compiled output:**

```javascript
const dto = {
  firstName: user.first_name,
  age: user.age,
  role: "user",
};
```

No function calls, no runtime libraries, no overhead. The transformation is resolved entirely at compile time.

### Complex Source Expressions

When the source is not a simple identifier (e.g., a function call), the macro wraps the output in an IIFE to avoid evaluating the source multiple times:

```typescript
// Source code
const dto = transformInto<From, To>(getUser(), config);

// Compiled output (simplified)
const dto = (() => {
  const src = getUser();
  return { name: src.name, email: src.email };
})();
```

---

## Type Safety

The `TransformConfig<From, To>` type enforces that:

1. **Rename keys** are valid target field names
2. **Rename values** are valid source field names
3. **Compute functions** receive the correct source type and return the correct target field type
4. **Const values** match the target field types

```typescript
transformInto<User, UserDTO>(user, {
  rename: {
    firstName: "first_name",
    lastName: "typo_field", // ✗ Type error: "typo_field" not in keyof User
  },
  const: {
    role: 123, // ✗ Type error: number not assignable to string
  },
});
```

### Build-Time Validation

If a target field cannot be mapped (no matching source field, no rename, no compute, no const), the build fails:

```
error: Cannot map field 'missingField': No matching field 'missingField' in source type and no constant/compute rule provided.
```

---

## API Quick Reference

### Function

| Export                                     | Description                            |
| ------------------------------------------ | -------------------------------------- |
| `transformInto<From, To>(source, config?)` | Transform source object to target type |

### TransformConfig Properties

| Property        | Type                                         | Description                                           |
| --------------- | -------------------------------------------- | ----------------------------------------------------- |
| `rename`        | `{ [K in keyof To]?: keyof From }`           | Map target fields to differently-named source fields  |
| `compute`       | `{ [K in keyof To]?: (src: From) => To[K] }` | Derive target fields from source data                 |
| `const`         | `{ [K in keyof To]?: To[K] }`                | Inject constant values for target fields              |
| `ignore.source` | `(keyof From)[]`                             | Source fields to ignore (no "unmapped field" warning) |
| `ignore.target` | `(keyof To)[]`                               | Target fields to exclude from output                  |

---

## Comparison with Alternatives

### vs. Scala Chimney

Chimney is the inspiration for this library. Both provide:

- Compile-time transformation validation
- Automatic same-name field mapping
- Field renaming, computed fields, constants

**Differences:**

- Chimney uses Scala macros; @typesugar/mapper uses TypeScript's compiler API
- Chimney supports nested transformations and collections automatically; @typesugar/mapper is currently flat-only (nested support planned)
- Chimney has richer DSL (`withFieldRenamed`, `withFieldComputed`); @typesugar/mapper uses config objects

### vs. AutoMapper (.NET)

AutoMapper popularized the mapping library pattern:

- Convention-based mapping (flattening, naming conventions)
- Profile-based configuration
- Runtime reflection

**Differences:**

- AutoMapper runs at runtime; @typesugar/mapper is compile-time only
- AutoMapper uses reflection; @typesugar/mapper has zero runtime overhead
- AutoMapper supports complex scenarios (before/after maps, value resolvers); @typesugar/mapper is simpler

### vs. Manual Mapping

Manual mapping functions are:

- ✗ Verbose and repetitive
- ✗ Error-prone (typos, missing fields)
- ✗ Hard to maintain across many entities

@typesugar/mapper provides:

- ✓ Concise declaration
- ✓ Compile-time validation
- ✓ Zero runtime overhead (same as manual)

---

## Roadmap

Features planned for future releases:

- **Nested object transformation**: Recursively transform nested types
- **Collection mapping**: Map arrays/lists of objects
- **Partial mapping**: Create partial types from subsets
- **Bidirectional mapping**: Generate inverse transformations
- **Validation integration**: Combine with `@typesugar/validate`

---

## License

MIT
