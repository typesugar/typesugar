# @ttfx/derive

> Auto-derive common implementations for TypeScript types.

## Overview

`@ttfx/derive` provides Rust-style derive macros for TypeScript. Annotate your interfaces, classes, or type aliases with `@derive()` and the macro generates implementations at compile time — no runtime reflection, no code generation scripts.

## Installation

```bash
npm install @ttfx/derive
# or
pnpm add @ttfx/derive
```

## Usage

```typescript
import { derive } from "@ttfx/derive";

@derive(Eq, Ord, Clone, Debug, Hash, Default, Json, Builder)
interface User {
  id: number;
  name: string;
  email?: string;
}

// Generated functions:
// - userEq(a: User, b: User): boolean
// - userCompare(a: User, b: User): -1 | 0 | 1
// - cloneUser(value: User): User
// - debugUser(value: User): string
// - hashUser(value: User): number
// - defaultUser(): User
// - userToJson(value: User): string
// - userFromJson(json: string): User
// - class UserBuilder { withId(id: number): UserBuilder; ... build(): User; }
```

## Available Derives

### Eq

Generate an equality comparison function.

```typescript
@derive(Eq)
interface Point { x: number; y: number; }

// Generated:
function pointEq(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}
```

### Ord

Generate a comparison function for ordering.

```typescript
@derive(Ord)
interface Point { x: number; y: number; }

// Generated:
function pointCompare(a: Point, b: Point): -1 | 0 | 1 {
  if (a.x < b.x) return -1;
  if (a.x > b.x) return 1;
  if (a.y < b.y) return -1;
  if (a.y > b.y) return 1;
  return 0;
}
```

### Clone

Generate a deep clone function.

```typescript
@derive(Clone)
interface Point { x: number; y: number; }

// Generated:
function clonePoint(value: Point): Point {
  return { x: value.x, y: value.y };
}
```

### Debug

Generate a debug string representation.

```typescript
@derive(Debug)
interface Point { x: number; y: number; }

// Generated:
function debugPoint(value: Point): string {
  return `Point { x: ${JSON.stringify(value.x)}, y: ${JSON.stringify(value.y)} }`;
}

debugPoint({ x: 1, y: 2 }); // "Point { x: 1, y: 2 }"
```

### Hash

Generate a hash function (djb2-style).

```typescript
@derive(Hash)
interface Point { x: number; y: number; }

// Generated:
function hashPoint(value: Point): number {
  let hash = 5381;
  hash = ((hash << 5) + hash) + (value.x | 0);
  hash = ((hash << 5) + hash) + (value.y | 0);
  return hash >>> 0;
}
```

### Default

Generate a default value factory.

```typescript
@derive(Default)
interface Point { x: number; y: number; }

// Generated:
function defaultPoint(): Point {
  return { x: 0, y: 0 };
}
```

### Json

Generate JSON serialization and deserialization with validation.

```typescript
@derive(Json)
interface User { id: number; name: string; }

// Generated:
function userToJson(value: User): string {
  return JSON.stringify(value);
}

function userFromJson(json: string): User {
  const obj = JSON.parse(json);
  if (obj.id === undefined) throw new Error("Missing required field: id");
  if (typeof obj.id !== "number") throw new Error("Field id must be number");
  // ... more validation
  return obj as User;
}
```

### Builder

Generate a fluent builder pattern.

```typescript
@derive(Builder)
interface User { id: number; name: string; email?: string; }

// Generated:
class UserBuilder {
  private _id: number = 0;
  private _name: string = "";
  private _email: string | undefined = undefined;

  withId(id: number): UserBuilder { this._id = id; return this; }
  withName(name: string): UserBuilder { this._name = name; return this; }
  withEmail(email: string | undefined): UserBuilder { this._email = email; return this; }

  build(): User {
    return { id: this._id, name: this._name, email: this._email };
  }
}

// Usage:
const user = new UserBuilder().withId(1).withName("Alice").build();
```

### TypeGuard

Generate a runtime type guard function.

```typescript
@derive(TypeGuard)
interface User { id: number; name: string; }

// Generated:
function isUser(value: unknown): value is User {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj["id"] === "number"
      && typeof obj["name"] === "string";
}
```

## API Reference

### Types

- `DeriveTypeInfo` — Type information passed to derive macros
- `DeriveFieldInfo` — Field information within `DeriveTypeInfo`

### Functions

- `createDerivedFunctionName(operation, typeName)` — Get the conventional function name for a derive operation

### Derive Macros

- `EqDerive`, `OrdDerive`, `CloneDerive`, `DebugDerive`
- `HashDerive`, `DefaultDerive`, `JsonDerive`, `BuilderDerive`
- `TypeGuardDerive`

### Registration

- `register()` — Register all derive macros (called automatically on import)

## License

MIT
