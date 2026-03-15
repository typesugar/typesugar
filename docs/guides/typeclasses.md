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

### With `= implicit()`

Mark typeclass parameters with `= implicit()` to have them auto-filled:

```typescript
import { implicit } from "@typesugar/typeclass";

function print<A>(value: A, S: Show<A> = implicit()): void {
  console.log(S.show(value));
}

// S is filled automatically
print(42); // "42"
print("hello"); // "\"hello\""

// Or pass explicitly to override
print(42, customShow);
```

`= implicit()` is a default parameter marker — you can see from the signature which params are implicit, and override any of them by passing an argument explicitly. It's valid TypeScript even without the transformer (it just throws at runtime).

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

### Auto-Specialization with `@specialize`

Mark instances with `@specialize` to enable automatic inlining at call sites:

```typescript
/**
 * @impl Numeric<Point>
 * @specialize
 */
const numericPoint: Numeric<Point> = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
  mul: (a, b) => ({ x: a.x * b.x, y: a.y * b.y }),
};
```

When generic functions are called with `@specialize` instances, method bodies are inlined:

```typescript
function double<A>(a: A, N: Numeric<A>): A {
  return N.add(a, a);
}

// Call with @specialize instance:
double(p, numericPoint);

// Compiles to:
({ x: p.x + p.x, y: p.y + p.y });
```

The `@specialize` annotation tells the transformer to extract method bodies from the instance
definition and inline them at call sites — no runtime dictionary lookup.

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
  map<A, B>(fa: Kind<F, A>, f: (a: A) => B): Kind<F, B>;
}
```

## Operator Syntax {#operator-syntax}

Typeclass methods can be mapped to operators using `@op` annotations. When you write `a + b` and `a` has an instance of a typeclass with `@op +`, the transformer rewrites it to a method call.

### Defining Operator Mappings

Use JSDoc `@op` annotations on method signatures:

```typescript
/** @typeclass */
interface Numeric<A> {
  /** @op + */ add(a: A, b: A): A;
  /** @op - */ sub(a: A, b: A): A;
  /** @op * */ mul(a: A, b: A): A;
  /** @op / */ div(a: A, b: A): A;
}

/** @typeclass */
interface Eq<A> {
  /** @op === */ equals(a: A, b: A): boolean;
  /** @op !== */ notEquals(a: A, b: A): boolean;
}

/** @typeclass */
interface Ord<A> {
  /** @op < */ lt(a: A, b: A): boolean;
  /** @op <= */ lte(a: A, b: A): boolean;
  /** @op > */ gt(a: A, b: A): boolean;
  /** @op >= */ gte(a: A, b: A): boolean;
}
```

### Using Operators

Once you have a typeclass with `@op` annotations and an instance for your type, standard operators automatically rewrite:

```typescript
interface Point {
  x: number;
  y: number;
}

/** @impl Numeric<Point> */
const numericPoint: Numeric<Point> = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
  mul: (a, b) => ({ x: a.x * b.x, y: a.y * b.y }),
  div: (a, b) => ({ x: a.x / b.x, y: a.y / b.y }),
};

const p1: Point = { x: 1, y: 2 };
const p2: Point = { x: 3, y: 4 };

// Written as:
const p3 = p1 + p2;

// Compiles to:
const p3 = numericPoint.add(p1, p2);
```

### Supported Operators

| Operator | Description           |
| -------- | --------------------- |
| `+`      | Addition              |
| `-`      | Subtraction           |
| `*`      | Multiplication        |
| `/`      | Division              |
| `%`      | Modulo                |
| `**`     | Exponentiation        |
| `===`    | Strict equality       |
| `!==`    | Strict inequality     |
| `==`     | Loose equality        |
| `!=`     | Loose inequality      |
| `<`      | Less than             |
| `<=`     | Less than or equal    |
| `>`      | Greater than          |
| `>=`     | Greater than or equal |
| `&`      | Bitwise AND           |
| `\|`     | Bitwise OR            |
| `^`      | Bitwise XOR           |
| `<<`     | Left shift            |
| `>>`     | Right shift           |

### Ambiguity Resolution

If multiple typeclasses define the same operator (e.g., `Semigroup` and `Numeric` both use `+`), the compiler reports an ambiguity error when both instances exist for a type. Choose one by:

1. Only defining an instance for one typeclass
2. Using explicit method calls instead of operators

## Higher-Kinded Types

typesugar supports HKTs for typeclasses over type constructors. **Tier 1** (recommended) requires no boilerplate — the macro resolves the type constructor automatically:

```typescript
/** @impl Functor<Option> */
const optionFunctor = {
  map: (fa, f) => (fa === null ? null : f(fa)),
};

/** @impl Functor<Array> */
const arrayFunctor = {
  map: (fa, f) => fa.map(f),
};

// Partial application: fix E=string, vary A
/** @impl Functor<Either<string>> */
const eitherStringFunctor = {
  map: (fa, f) => (fa._tag === "Left" ? fa : { _tag: "Right", value: f(fa.value) }),
};

summon<Functor<Option>>().map(null, (x: number) => x);  // null
summon<Functor<Array>>().map([1, 2, 3], x => x * 2);   // [2, 4, 6]
```

No `OptionF`, `ArrayF`, or `@hkt` needed. The macro resolves `Option`, `Array`, and `Either<string>` via the TypeChecker and generates the encoding internally.

For types you don't own, use the explicit `TypeFunction` interface:

```typescript
import { Kind, type TypeFunction } from "@typesugar/type-system";

interface ArrayF extends TypeFunction {
  _: Array<this["__kind__"]>;
}

@instance
const FunctorArray: Functor<ArrayF> = {
  map: (fa, f) => fa.map(f),
};
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
- Use `= implicit()` for cleaner call sites
- Use `specialize()` for hot paths
- Derive instances where possible

### Don't

- Define duplicate instances
- Use typeclasses for simple runtime polymorphism
- Forget to export instances from your package
