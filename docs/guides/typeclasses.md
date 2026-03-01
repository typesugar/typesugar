# Typeclasses

typesugar provides Scala 3-style typeclasses with zero-cost specialization.

## What Are Typeclasses?

Typeclasses enable ad-hoc polymorphism — adding behavior to types without modifying them. Unlike inheritance, typeclasses:

- Work with types you don't control
- Support multiple implementations per type
- Enable generic programming without runtime overhead

## Defining a Typeclass

```typescript
import { typeclass, instance, summon } from "@typesugar/typeclass";

@typeclass
interface Show<A> {
  show(a: A): string;
}
```

This generates:

- A namespace `Show` with helper methods
- Type-level machinery for instance resolution

## Creating Instances

```typescript
@instance
const ShowNumber: Show<number> = {
  show: (n) => n.toString(),
};

@instance
const ShowString: Show<string> = {
  show: (s) => `"${s}"`,
};

@instance
const ShowBoolean: Show<boolean> = {
  show: (b) => b ? "true" : "false",
};
```

## Using Typeclasses

### Summoning Instances

```typescript
const showNum = summon<Show<number>>();
showNum.show(42); // "42"

const showStr = summon<Show<string>>();
showStr.show("hello"); // "\"hello\""
```

### Generic Functions

```typescript
function print<A>(value: A, S: Show<A> = summon<Show<A>>()): void {
  console.log(S.show(value));
}

print(42); // "42"
print("hello"); // "\"hello\""
```

### With @implicits

The `@implicits` decorator auto-fills typeclass parameters:

```typescript
import { implicits } from "@typesugar/typeclass";

@implicits
function print<A>(value: A, S: Show<A>): void {
  console.log(S.show(value));
}

// S is filled automatically
print(42);      // "42"
print("hello"); // "\"hello\""
```

## Deriving Instances

### Auto-Derivation (Default)

Typeclass instances are auto-derived by default — no annotation needed. When the compiler sees a typeclass operation on a type, it inspects the type's fields and synthesizes an implementation:

```typescript
interface Point {
  x: number;
  y: number;
}

const p = { x: 1, y: 2 };
p.show(); // "Point(x = 1, y = 2)" — auto-derived from field structure
```

### Explicit @deriving (Documentation)

`@deriving` documents which typeclasses a type supports. The compiler would auto-derive them anyway, but the annotation makes intent visible to human readers:

```typescript
import { deriving } from "@typesugar/typeclass";

@deriving(Show, Eq, Ord)
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

summon<Show<Point>>().show(new Point(1, 2));
// "Point(x = 1, y = 2)"
```

### For Generics

```typescript
@instance
function ShowArray<A>(SA: Show<A>): Show<A[]> {
  return {
    show: (arr) => `[${arr.map(a => SA.show(a)).join(", ")}]`,
  };
}

summon<Show<number[]>>().show([1, 2, 3]);
// "[1, 2, 3]"
```

## Extension Methods

Typeclass methods work as extension methods — just call them directly:

```typescript
import { Show } from "@typesugar/std";

(42).show(); // "42"
"hi".show(); // "\"hi\""
[1, 2].show(); // "[1, 2]"
```

The transformer detects `.show()` on a type, finds the `Show` instance, and rewrites to a direct call.

## Zero-Cost Specialization

The `specialize()` macro inlines typeclass method calls:

```typescript
import { specialize } from "@typesugar/specialize";

const showPoint = specialize((p: Point) => {
  return summon<Show<Point>>().show(p);
});

// Compiles to direct code, no dictionary lookup:
// (p: Point) => `Point(x = ${p.x}, y = ${p.y})`
```

## Common Typeclasses

### Eq

Equality comparison.

```typescript
@typeclass
interface Eq<A> {
  equals(a: A, b: A): boolean;
}
```

### Ord

Ordering.

```typescript
@typeclass
interface Ord<A> extends Eq<A> {
  compare(a: A, b: A): -1 | 0 | 1;
}
```

### Semigroup

Associative combination.

```typescript
@typeclass
interface Semigroup<A> {
  combine(a: A, b: A): A;
}

@instance
const SemigroupString: Semigroup<string> = {
  combine: (a, b) => a + b,
};
```

### Monoid

Semigroup with identity.

```typescript
@typeclass
interface Monoid<A> extends Semigroup<A> {
  empty: A;
}

@instance
const MonoidString: Monoid<string> = {
  combine: (a, b) => a + b,
  empty: "",
};
```

### Functor

Mappable containers.

```typescript
@typeclass
interface Functor<F> {
  map<A, B>(fa: $<F, A>, f: (a: A) => B): $<F, B>;
}
```

## Higher-Kinded Types

typesugar supports HKTs for typeclasses over type constructors using phantom kind markers:

```typescript
import { Kind, type TypeFunction, summonHKT } from "@typesugar/type-system";

interface ArrayF extends TypeFunction {
  _: Array<this["__kind__"]>;
}

@instance
const FunctorArray: Functor<ArrayF> = {
  map: (fa, f) => fa.map(f),
};

summonHKT<Functor<ArrayF>>().map([1, 2, 3], x => x * 2);
// [2, 4, 6]
```

## Instance Resolution

Instances are resolved at compile time:

1. Exact match for the type
2. Generic instance with inferred parameters
3. Derived instance from `@deriving`

If no instance is found, you get a compile error.

## Coherence

typesugar enforces coherence: only one instance per type per typeclass. Defining multiple instances for the same type is a compile error.

```typescript
// Error: Duplicate instance for Show<number>
@instance
const ShowNumber2: Show<number> = {
  show: (n) => `num(${n})`,
};
```

## Comparison to Other Systems

| Feature           | typesugar            | Scala 3  | Haskell  | Rust     |
| ----------------- | -------------------- | -------- | -------- | -------- |
| Zero-cost         | Yes (via specialize) | Partial  | No       | Yes      |
| HKT               | Yes                  | Yes      | Yes      | No       |
| Orphan instances  | Allowed              | Allowed  | Allowed  | No       |
| Coherence         | Enforced             | Optional | Enforced | Enforced |
| Extension methods | Yes                  | Yes      | No       | Yes      |

## Best Practices

### Do

- Define typeclasses in shared packages
- Use `@implicits` for cleaner call sites
- Use `specialize()` for hot paths
- Derive instances where possible

### Don't

- Define duplicate instances
- Use typeclasses for simple runtime polymorphism
- Forget to export instances from your package
