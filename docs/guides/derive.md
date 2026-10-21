# Derive

The `@derive()` decorator auto-generates typeclass instances from your type's structure — structural equality, cloning, serialization, and more, all with zero boilerplate.

::: tip Try in Playground
**[Open in Playground →](https://typesugar.org/playground#code=eJxljk0OgjAQhe9ziskmQMQNGyO4cOEBXLsYEZlAYtuS6WBi4t1tW0TFLJrMy_d%2B0mjQLDlcSFJWkNdBuEONxNJMliqwtbThsYZeFCNb%2BgaB2FqVMmxDaSwuCWNh6I8RBPnRb5lAi6Yjz6g8W2vjZsT%2FLIHZMKLLxBx6%2ByIAhPRpPmVqMzHpP%2BQhPJALYnN3ZhbVG5pxNPR%2B9t54hTv4VrDm6S8TzugD7JFF6g%3D%3D)** to see derive in action.
:::

## What `@derive` Does

`@derive` takes a list of typeclass names and generates instances for your type. The generated instances are attached to the type's companion and resolved from scope, so they work with `summon()`, operator overloading, and generic functions — just like hand-written instances.

```typescript
import { derive, summon, Eq, Clone, Debug, Json } from "typesugar";
import "@typesugar/std/syntax/eq/ops"; // activates === !== == != for Eq instances

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
u1 === u2; // true (compiles to User.Eq.equals(u1, u2))

// summon() retrieves the generated instance
const eq = summon<Eq<User>>();
eq.equals(u1, u2); // true

// Direct instance methods
const cloned = summon<Clone<User>>().clone(u1);
const debug = summon<Debug<User>>().debug(u1);
// "User { id: 1, name: \"Alice\", email: \"alice@example.com\" }"
```

### Imports and Activation

- The `@derive` decorator, `summon` and `implicit`, and the markers `Eq`, `Ord`, `Clone`, `Debug`, `Hash`, `Default`, `Json` and `TypeGuard` come from `typesugar`.
- The markers `Show`, `Semigroup` and `Monoid` also come from `typesugar` (they are values; `@derive(Show)` works even without importing one, because the transformer reads the name). To name the type in `summon<Show<Point>>()`, import `type Show` from `@typesugar/fp`, and `type Semigroup` / `type Monoid` from `@typesugar/std`.
- Operator and method sugar is import-scoped (PEP-052). Without the activation import, `u1 === u2` (and `u1 == u2`) stays reference equality and `u1 < u2` is a plain JavaScript comparison, and the transformer warns ([TS9804](../errors/TS9804.md)) with the import to add:

| Sugar                      | Activation import                               |
| -------------------------- | ----------------------------------------------- |
| `===`, `!==`, `==`, `!=`   | `import "@typesugar/std/syntax/eq/ops";`        |
| `<`, `>`, `<=`, `>=` (Ord) | `import "@typesugar/std/syntax/ord/ops";`       |
| `a + b` (Semigroup)        | `import "@typesugar/std/syntax/semigroup/ops";` |

`summon<...>()` and the companion (`User.Eq.equals(a, b)`) need no activation import.

The markers exported by `typesugar` are values, so plain `tsc` reports TS2749 ("refers to a value, but is being used as a type") on `summon<Eq<User>>()`; the transformer resolves it by name either way. In your own type signatures, import the typeclass type instead, e.g. `import type { Eq } from "@typesugar/std"`.

## Supported Typeclasses

### Eq — Structural Equality

Compares all fields for equality. Enables `===`, `!==`, `==` and `!=` operator
overloading. Comparisons with `null`/`undefined` (`p == null`) stay native; for
reference identity in a file with the activation import, use `Object.is(p1, p2)`,
which is a call and is never rewritten.

```typescript
import "@typesugar/std/syntax/eq/ops"; // activates === !== == != for Eq types

@derive(Eq)
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

const p1 = new Point(1, 2);
const p2 = new Point(1, 2);

// Operator overloading — compiles to Point.Eq.equals(p1, p2)
p1 === p2; // true

// Or use summon
summon<Eq<Point>>().equals(p1, p2); // true
```

### Ord — Ordering

Lexicographic comparison of fields. Enables `<`, `>`, `<=`, `>=` operator overloading.

```typescript
import "@typesugar/std/syntax/ord/ops"; // activates < <= > >= for Ord types

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

### Clone — Field-Wise Copy

Like Rust's `#[derive(Clone)]`: each field is cloned through its own `Clone`, so mutating the clone never changes the original.

| Field type                                      | How it is copied                                                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Primitives, literals, enums, functions          | As is                                                                                                                 |
| Arrays, readonly arrays, tuples                 | Element by element (`xs.slice()`, `xs.map((e) => ...)`)                                                               |
| `Date`, `Map`, `Set`, `RegExp`, typed arrays    | Into a new one (a `Map`'s keys are kept, its values cloned)                                                           |
| A type with a `Clone` instance in scope         | Through that instance (`Address.Clone.clone(a.address)`, or your `@impl`)                                             |
| Any other object type, or a discriminated union | Structurally, by these same rules, inlined (a union per variant)                                                      |
| `any`, `unknown`, `object`, type parameters     | By reference: there is no type to clone by. A `Clone<any>`/`Clone<unknown>` instance in scope is used if there is one |
| A class with no `Clone` instance                | By reference, with a warning: give it `@derive(Clone)` or an `@impl Clone<...>`                                       |

The copy starts as a spread of the original and then sets the fields that need cloning, so an optional field that is absent stays absent, and properties the type doesn't declare are kept (by reference). The result is a plain object, not a class instance (`c2 instanceof Config` is false).

```typescript
/** @derive(Clone) */
export interface Shape {
  id: number;
  points: number[][];
  bbox?: [number, number, number, number];
}
// Shape.Clone compiles to:
// { clone: (a: Shape): Shape => ({
//   ...a,
//   points: a.points.map(e => e.slice()),
//   ...(a.bbox && { bbox: a.bbox.slice() as typeof a.bbox }),
// }) }
```

A discriminated union becomes a `switch` on its discriminant, and a type that contains itself (a tree, or GeoJSON's `GeometryCollection` inside `Geometry`) becomes a local helper that calls itself; derivation itself never loops. A _value_ that contains itself (a cycle such as `node.parent.child === node`) is cloned until the stack overflows, as any field-wise clone would be; give such a type a hand-written `Clone`.

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
// { enabled: false, count: 0, name: "" } — a plain object, not an Options instance
```

### Json — Serialization and Deserialization

`toJson` produces a plain object. `fromJson` takes an already-parsed object (use `JSON.parse` on a string first), checks that every required field is present and has the right type, and throws otherwise (`Missing required field id`). Optional fields may be absent. It returns a plain object, not a class instance.

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
// { id: 1, name: "Alice" }

summon<Json<User>>().fromJson({}); // throws: Missing required field id
```

### Show — User-Facing Display

Human-readable string representation, as opposed to Debug's developer-focused format.

```typescript
import { derive, summon } from "typesugar";
import type { Show } from "@typesugar/fp";

@derive(Show)
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

summon<Show<Point>>().show(new Point(1, 2)); // "Point(x = 1, y = 2)"
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

summon<Semigroup<Stats>>().combine(new Stats(1, 10), new Stats(2, 20)); // { count: 3, total: 30 }
```

### Monoid — Semigroup with Identity

Extends Semigroup with an `empty` value. `@derive(Monoid)` also gives the type a `Semigroup` instance.

```typescript
@derive(Monoid)
class Stats {
  constructor(
    public count: number,
    public total: number
  ) {}
}

summon<Monoid<Stats>>().empty(); // { count: 0, total: 0 }
```

### Not Derivable

- **Functor** (and other typeclasses over type constructors) has no derivation: `@derive(Functor)` is a compile error, `Unknown derive: 'Functor'`. Write the instance by hand with `/** @impl Functor<Box> */`.
- **Builder** is not a derive. A builder accumulates partial state before producing a value, which doesn't map to a typeclass method signature.

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

When you derive a typeclass that has operator mappings, the operators work in any file that has the activation import (`@typesugar/std/syntax/eq/ops`, `.../ord/ops`; see [Imports and Activation](#imports-and-activation)):

| Typeclass | Operators                      |
| --------- | ------------------------------ |
| Eq        | `===`, `!==`, `==`, `!=`       |
| Ord       | `<`, `>`, `<=`, `>=`           |
| Hash      | (used by `HashSet`, `HashMap`) |

```typescript
import { derive, Eq, Ord } from "typesugar";
import "@typesugar/std/syntax/eq/ops";
import "@typesugar/std/syntax/ord/ops";

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

Every derived typeclass instance is attached to the type's companion and resolved from scope (PEP-052 — there is no global instance registry). Use `summon()` to retrieve it:

```typescript
@derive(Eq, Clone, Debug)
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

// Access via companion objects — instances live on the type
Point.Eq.equals(p1, p2);
Point.Clone.clone(p1);
Point.Debug.debug(p1);

// Or via summon()
summon<Eq<Point>>().equals(p1, p2);
```

In a generic function, use `implicit()` as the parameter default. `summon<Eq<A>>()` can't work there, because `A` is a type parameter with no instance of its own (it is a TS9001 error):

```typescript
import { implicit } from "typesugar";
import type { Eq } from "@typesugar/std";

// implicit() fills E at each call site from the caller's concrete A
function deduplicate<A>(items: A[], E: Eq<A> = implicit()): A[] {
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

Derives handle nested types. Eq compares nested fields structurally:

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

const p1 = new Person("Alice", new Address("NYC", "10001"));
const p2 = summon<Clone<Person>>().clone(p1);
summon<Eq<Person>>().equals(p1, p2); // true
p2.address === p1.address; // false — the Address is cloned through Address.Clone
```

## Types You Don't Own: `derived<TC<T>>()`

`@derive` goes on a declaration, so it can't be used on a type from a library (`Feature` from `@types/geojson`). `derived<TC<T>>()` runs the same derivation for such a type, once, in a module of your own; the `const` it initializes is the instance, which `summon`, `= implicit()` and method syntax find in every file that imports the module:

```typescript
// geo-instances.ts
import type { Feature, Point } from "geojson";
import type { Clone, Eq } from "@typesugar/std";
import { derived } from "typesugar";

export const cloneFeature = derived<Clone<Feature>>(); // what @derive(Clone) would generate
export const eqPoint = derived<Eq<Point>>();
```

It supports every typeclass in the table above, and field instances come from scope where it is written. See [Instances for types you don't own](./typeclasses.md#external-types) for the details: the `.d.ts`, generic types, and the errors.

`summon<Clone<Feature>>()` with no instance in scope still derives one in place, a new copy at each call, with a [TS9009](/errors/TS9009) warning. That fallback is deprecated; declare the instance with `@derive` or `derived` instead.

## Generic Types

Deriving for a generic class such as `Box<T>` is not yet supported: `@derive(Eq)` on it fails with `TS9106: Cannot derive Eq for 'Box'` (the trace notes `T lacks Eq`), and `summon<Eq<Box<number>>>()` is TS9001. Write those instances by hand for now. `derived<Eq<Box<number>>>()` derives one for a single instantiation; with a free type parameter it is [TS9011](/errors/TS9011).

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

| Old Pattern                                               | New Pattern                                                                            |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `@derive(Eq)` generating standalone `pointEq()` functions | `@derive(Eq)` generates companion instances — use `Point.Eq.equals(a, b)` or `a === b` |
| `@deriving(Show, Eq)`                                     | `@derive(Show, Eq)` — same behavior, `@deriving` is now a deprecated alias             |
| `pointEq(a, b)` standalone function                       | `Point.Eq.equals(a, b)` or operator overloading `a === b`                              |
| `clonePoint(p)` standalone function                       | `Point.Clone.clone(p)`                                                                 |
| `debugPoint(p)` standalone function                       | `Point.Debug.debug(p)`                                                                 |
| `import { eqPoint } from "./point"`                       | `import { Point } from "./point"` — instances come with the type                       |

`@deriving(...)` still works but emits a deprecation warning (`@deriving is deprecated: use @derive(...) (identical behaviour)`). Update to `@derive(...)` in new code.

## Best Practices

- **Use operator overloading** where available — `a === b` is clearer than `summon<Eq<Point>>().equals(a, b)`
- **Derive Eq before Ord** — Ord depends on Eq (handled automatically)
- **Use Debug for development, Show for user display, Json for serialization** — they serve different purposes
- **Keep derived types simple** — avoid circular references and non-serializable fields
- **Don't use Hash for security** — use crypto libraries for that
