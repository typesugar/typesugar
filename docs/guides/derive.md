# Derive

The `@derive()` decorator auto-generates typeclass instances from your type's structure — structural equality, cloning, serialization, and more, all with zero boilerplate.

::: tip Try in Playground
**[Open in Playground →](https://typesugar.org/playground#code=eJxljk0OgjAQhe9ziskmQMQNGyO4cOEBXLsYEZlAYtuS6WBi4t1tW0TFLJrMy_d%2B0mjQLDlcSFJWkNdBuEONxNJMliqwtbThsYZeFCNb%2BgaB2FqVMmxDaSwuCWNh6I8RBPnRb5lAi6Yjz6g8W2vjZsT%2FLIHZMKLLxBx6%2ByIAhPRpPmVqMzHpP%2BQhPJALYnN3ZhbVG5pxNPR%2B9t54hTv4VrDm6S8TzugD7JFF6g%3D%3D)** to see derive in action.
:::

## What `@derive` Does

`@derive` takes a list of typeclass names and generates instances for your type. The generated instances are registered with the typeclass system, so they work with `summon()`, operator overloading, and generic functions — just like hand-written instances.

```typescript
@derive(Eq, Clone, Debug, Json)
class User {
  constructor(
    public id: number,
    public name: string,
    public email: string
  ) {}
}

// Operator overloading: === uses structural equality
const u1 = new User(1, "Alice", "alice@example.com");
const u2 = new User(1, "Alice", "alice@example.com");
u1 === u2; // true (compiles to field-by-field comparison)

// summon() retrieves the generated instance
const eq = summon<Eq<User>>();
eq.equals(u1, u2); // true

// Direct instance methods
const cloned = summon<Clone<User>>().clone(u1);
const debug = summon<Debug<User>>().debug(u1);
// "User { id: 1, name: \"Alice\", email: \"alice@example.com\" }"
```

## Supported Typeclasses

### Eq — Structural Equality

Compares all fields for equality. Enables `===` operator overloading.

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

// Operator overloading — compiles to p1.x === p2.x && p1.y === p2.y
p1 === p2; // true

// Or use summon
summon<Eq<Point>>().equals(p1, p2); // true
```

### Ord — Ordering

Lexicographic comparison of fields. Enables `<`, `>`, `<=`, `>=` operator overloading.

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

summon<Ord<Version>>().compare(v1, v2); // -1 (less than)
v1 < v2; // true (operator overloading)
```

### Clone — Deep Copy

Shallow spread-copy for product types, switch-on-discriminant for sum types.

```typescript
@derive(Clone)
class Config {
  constructor(
    public host: string,
    public port: number
  ) {}
}

const c1 = new Config("localhost", 3000);
const c2 = summon<Clone<Config>>().clone(c1);
```

### Debug — Developer-Facing String Representation

Produces `TypeName { field: value }` format. Separate from Show (Debug is for developers, Show is for user-facing display — like Rust's `Debug` vs `Display`).

```typescript
@derive(Debug)
class User {
  constructor(
    public id: number,
    public name: string
  ) {}
}

summon<Debug<User>>().debug(new User(1, "Alice"));
// "User { id: 1, name: \"Alice\" }"
```

### Hash — Hash Code Generation

Produces a consistent integer hash from all fields. Enables use in `HashSet` and `HashMap`.

```typescript
@derive(Hash)
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

summon<Hash<Point>>().hash(new Point(1, 2)); // consistent number
```

### Default — Zero-Value Construction

Generates a factory that returns a value with zero-values for each field type (`0` for numbers, `""` for strings, `false` for booleans). Only works on product types — sum types have no single obvious default variant.

```typescript
@derive(Default)
class Options {
  constructor(
    public enabled: boolean,
    public count: number,
    public name: string
  ) {}
}

summon<Default<Options>>().default();
// Options { enabled: false, count: 0, name: "" }
```

### Json — Serialization and Deserialization

`toJson` produces a plain object, `fromJson` validates required fields and types.

```typescript
@derive(Json)
class User {
  constructor(
    public id: number,
    public name: string
  ) {}
}

const json = summon<Json<User>>().toJson(new User(1, "Alice"));
// { id: 1, name: "Alice" }

const user = summon<Json<User>>().fromJson({ id: 1, name: "Alice" });
// User { id: 1, name: "Alice" }
```

### Show — User-Facing Display

Human-readable string representation, as opposed to Debug's developer-focused format.

```typescript
@derive(Show)
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

summon<Show<Point>>().show(new Point(1, 2)); // "Point(1, 2)"
```

### TypeGuard — Runtime Type Checking

Generates an `is` method that validates an `unknown` value has the correct shape.

```typescript
@derive(TypeGuard)
class User {
  constructor(
    public id: number,
    public name: string
  ) {}
}

function handle(data: unknown) {
  if (summon<TypeGuard<User>>().is(data)) {
    console.log(data.name); // data is typed as User
  }
}
```

### Semigroup — Associative Combination

Combines two values of the same type.

```typescript
@derive(Semigroup)
class Stats {
  constructor(
    public count: number,
    public total: number
  ) {}
}

summon<Semigroup<Stats>>().combine(new Stats(1, 10), new Stats(2, 20)); // Stats { count: 3, total: 30 }
```

### Monoid — Semigroup with Identity

Extends Semigroup with an `empty` value.

```typescript
@derive(Monoid)
class Stats {
  constructor(
    public count: number,
    public total: number
  ) {}
}

summon<Monoid<Stats>>().empty(); // Stats { count: 0, total: 0 }
```

### Functor — Mappable Containers

For generic types with one type parameter.

```typescript
@derive(Functor)
class Box<T> {
  constructor(public value: T) {}
}

summon<Functor<Box>>().map(new Box(42), (n) => n.toString());
// Box { value: "42" }
```

### What About Builder?

Builder was intentionally excluded from the typeclass model. A builder accumulates partial state before producing a value, which is fundamentally stateful and doesn't map to a pure `A -> B` method signature. Use the standalone `@derive(Builder)` pattern if you need a fluent builder — it's not part of the typeclass system.

## Product Types vs Sum Types

**Product types** (classes, interfaces with fields) derive by operating on each field:

```typescript
@derive(Eq, Clone, Debug)
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}
```

**Sum types** (discriminated unions) derive by switching on the discriminant tag:

```typescript
@derive(Eq, Debug, Json)
type Shape =
  | { tag: "circle"; radius: number }
  | { tag: "rect"; width: number; height: number };
```

The generated Eq checks the tag first, then compares variant-specific fields. Debug formats each variant. Not all typeclasses support sum types — Default cannot derive for sum types because there's no single obvious default variant.

## Operator Overloading

When you derive a typeclass that has operator mappings, the operators work automatically:

| Typeclass | Operators                      |
| --------- | ------------------------------ |
| Eq        | `===`, `!==`                   |
| Ord       | `<`, `>`, `<=`, `>=`           |
| Hash      | (used by `HashSet`, `HashMap`) |

```typescript
@derive(Eq, Ord)
class Score {
  constructor(public value: number) {}
}

const a = new Score(10);
const b = new Score(20);

a === b; // false — structural equality
a < b; // true — lexicographic comparison
```

The typesugar transformer rewrites these operators to use the derived typeclass instances at compile time — no runtime dictionary lookups.

## Using `summon()` to Get Instances

Every derived typeclass instance is registered with the instance registry. Use `summon()` to retrieve it:

```typescript
@derive(Eq, Clone, Debug)
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

const eqPoint = summon<Eq<Point>>();
const clonePoint = summon<Clone<Point>>();
const debugPoint = summon<Debug<Point>>();

eqPoint.equals(p1, p2);
clonePoint.clone(p1);
debugPoint.debug(p1);
```

This is useful in generic functions:

```typescript
function deduplicate<A>(items: A[], E: Eq<A> = summon<Eq<A>>()): A[] {
  return items.filter((item, i) => items.findIndex((other) => E.equals(item, other)) === i);
}
```

## Combining Derives

List multiple typeclasses — order doesn't matter, dependencies are resolved automatically:

```typescript
@derive(Eq, Ord, Clone, Debug, Hash, Json)
class Product {
  constructor(
    public id: string,
    public name: string,
    public price: number
  ) {}
}
```

## Nested Types

Derives handle nested types automatically. If a field's type also has a derived instance, the derived implementation delegates to it:

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
const p2 = summon<Clone<Person>>().clone(p1);
```

## Generic Types

Derives work with generic type parameters:

```typescript
@derive(Eq, Clone, Debug)
class Box<T> {
  constructor(public value: T) {}
}

const box1 = new Box(42);
const box2 = summon<Clone<Box<number>>>().clone(box1);
summon<Eq<Box<number>>>().equals(box1, box2); // true
```

## See Expanded Code

To see what `@derive` generates:

```bash
npx typesugar expand src/models.ts
```

## Performance

Derived instances are generated at compile time with optimal code:

- No reflection overhead
- No runtime dictionary lookups (operator overloading is inlined)
- Direct property access
- Zero-cost specialization erases the typeclass abstraction entirely

## Migration from Old `@derive` / `@deriving`

If you're upgrading from an older version of typesugar:

| Old Pattern                                               | New Pattern                                                                                           |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `@derive(Eq)` generating standalone `pointEq()` functions | `@derive(Eq)` now generates typeclass instances — use `summon<Eq<Point>>().equals(a, b)` or `a === b` |
| `@deriving(Show, Eq)`                                     | `@derive(Show, Eq)` — same behavior, `@deriving` is now a deprecated alias                            |
| `pointEq(a, b)` standalone function                       | `summon<Eq<Point>>().equals(a, b)` or operator overloading `a === b`                                  |
| `clonePoint(p)` standalone function                       | `summon<Clone<Point>>().clone(p)`                                                                     |
| `debugPoint(p)` standalone function                       | `summon<Debug<Point>>().debug(p)`                                                                     |

`@deriving(...)` still works but emits a deprecation warning. Update to `@derive(...)` in new code.

## Best Practices

- **Use operator overloading** where available — `a === b` is clearer than `summon<Eq<Point>>().equals(a, b)`
- **Derive Eq before Ord** — Ord depends on Eq (handled automatically)
- **Use Debug for development, Show for user display, Json for serialization** — they serve different purposes
- **Keep derived types simple** — avoid circular references and non-serializable fields
- **Don't use Hash for security** — use crypto libraries for that
