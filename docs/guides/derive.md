# Derive Macros

The `@derive()` decorator auto-generates common implementations from your type's structure.

## Basic Usage

```typescript
import { derive, Eq, Clone, Debug, Json } from "@typesugar/derive";

@derive(Eq, Clone, Debug, Json)
class User {
  constructor(
    public id: number,
    public name: string,
    public email: string
  ) {}
}
```

This generates:

- `equals(other: User): boolean`
- `clone(): User`
- `debug(): string`
- `toJson(): string`
- `static fromJson(json: string): User`

## Available Derives

### Eq

Structural equality comparison.

```typescript
@derive(Eq)
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

const p1 = new Point(1, 2);
const p2 = new Point(1, 2);
p1.equals(p2); // true
```

Generated:

```typescript
equals(other: Point): boolean {
  return this.x === other.x && this.y === other.y;
}
```

### Ord

Ordering comparison (requires Eq).

```typescript
@derive(Eq, Ord)
class Version {
  constructor(
    public major: number,
    public minor: number
  ) {}
}

const v1 = new Version(1, 0);
const v2 = new Version(2, 0);
v1.compare(v2); // -1 (less than)
v1.lessThan(v2); // true
```

Generated methods:

- `compare(other): number` (-1, 0, or 1)
- `lessThan(other): boolean`
- `lessThanOrEqual(other): boolean`
- `greaterThan(other): boolean`
- `greaterThanOrEqual(other): boolean`

### Clone

Deep copy.

```typescript
@derive(Clone)
class Config {
  constructor(public settings: Map<string, string>) {}
}

const c1 = new Config(new Map([["key", "value"]]));
const c2 = c1.clone();
c2.settings.set("key", "modified");
c1.settings.get("key"); // "value" (unchanged)
```

### Debug

String representation for debugging.

```typescript
@derive(Debug)
class User {
  constructor(
    public id: number,
    public name: string
  ) {}
}

new User(1, "Alice").debug();
// 'User { id: 1, name: "Alice" }'
```

### Hash

Hash code generation.

```typescript
@derive(Hash)
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

new Point(1, 2).hashCode(); // consistent number
```

### Default

Default value construction.

```typescript
@derive(Default)
class Options {
  constructor(
    public enabled: boolean = true,
    public count: number = 0,
    public name: string = ""
  ) {}
}

Options.default(); // new Options(true, 0, "")
```

### Json

JSON serialization/deserialization.

```typescript
@derive(Json)
class User {
  constructor(
    public id: number,
    public name: string
  ) {}
}

const user = new User(1, "Alice");
const json = user.toJson(); // '{"id":1,"name":"Alice"}'
const parsed = User.fromJson(json); // User { id: 1, name: "Alice" }
```

### Builder

Fluent builder pattern.

```typescript
@derive(Builder)
class Request {
  constructor(
    public method: string,
    public url: string,
    public headers: Record<string, string>
  ) {}
}

const req = Request.builder()
  .method("GET")
  .url("/api/users")
  .headers({ "Content-Type": "application/json" })
  .build();
```

### TypeGuard

Runtime type checking.

```typescript
@derive(TypeGuard)
class User {
  constructor(
    public id: number,
    public name: string
  ) {}
}

function handle(data: unknown) {
  if (User.isUser(data)) {
    // data is typed as User
    console.log(data.name);
  }
}
```

## Combining Derives

Order doesn't matter (dependencies are resolved automatically):

```typescript
@derive(Eq, Ord, Clone, Debug, Hash, Json, Builder)
class Product {
  constructor(
    public id: string,
    public name: string,
    public price: number
  ) {}
}
```

## Sum Types (Discriminated Unions)

Derives work with discriminated unions:

```typescript
@derive(Eq, Debug, Json)
type Result<T, E> =
  | { tag: "ok"; value: T }
  | { tag: "err"; error: E };
```

The generated code handles each variant:

```typescript
function equals(a: Result<T, E>, b: Result<T, E>): boolean {
  if (a.tag !== b.tag) return false;
  if (a.tag === "ok") {
    return a.value === (b as { tag: "ok"; value: T }).value;
  }
  return a.error === (b as { tag: "err"; error: E }).error;
}
```

## Customizing Derives

### Field Exclusion

Use `@deriveIgnore` to exclude fields:

```typescript
import { derive, deriveIgnore, Eq, Clone } from "@typesugar/derive";

@derive(Eq, Clone)
class User {
  constructor(
    public id: number,
    public name: string,
    @deriveIgnore public cache?: Map<string, unknown>
  ) {}
}
```

### Custom Field Handling

Use `@deriveWith` for custom field logic:

```typescript
import { derive, deriveWith, Eq } from "@typesugar/derive";

@derive(Eq)
class Document {
  constructor(
    public id: string,
    @deriveWith({ eq: (a, b) => a.toLowerCase() === b.toLowerCase() })
    public title: string
  ) {}
}
```

## Nested Types

Derives handle nested types automatically:

```typescript
@derive(Eq, Clone)
class Address {
  constructor(
    public city: string,
    public zip: string
  ) {}
}

@derive(Eq, Clone)
class Person {
  constructor(
    public name: string,
    public address: Address
  ) {}
}

// Clone deep-copies the nested Address
const p1 = new Person("Alice", new Address("NYC", "10001"));
const p2 = p1.clone();
```

## Generic Types

Derives work with generics:

```typescript
@derive(Eq, Clone, Debug)
class Box<T> {
  constructor(public value: T) {}
}

const box1 = new Box(42);
const box2 = box1.clone();
box1.equals(box2); // true
```

## See Expanded Code

To see what @derive generates:

```bash
npx typesugar expand src/models.ts
```

## Performance

Derived methods are generated at compile time with optimal code:

- No reflection overhead
- No runtime type checking (except TypeGuard)
- Direct property access
- Inlined comparisons

## Best Practices

### Do

- Derive Eq before Ord
- Use Debug for development, Json for serialization
- Keep derived types simple (avoid circular references)

### Don't

- Derive on types with non-serializable fields (unless excluded)
- Use Hash for security purposes (use crypto)
- Expect Clone to handle exotic types (WeakMap, etc.)
