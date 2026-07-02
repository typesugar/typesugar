# Typeclasses

typesugar provides Scala 3-style typeclasses with zero-cost specialization.

::: tip Try in Playground
**[Open in Playground →](https://typesugar.org/playground#code=eJxljkEOgjAQRfc9xeyABOLGjRsP4NrFGMUJNLQlnQ6JMdy9tAWJrl7%2Fy0z%2BdKgVHC4kKSvI2yC8oUZiaYZLFdheOvBYQy%2BKkS19g0BsrXIMOwhYi0vCWBj6Ux9BcfR7JtCi6cgzKs/O2rgZ8D9LYDaMGDIxh94%2BCQAhfZpPmdpOTPoPeQgP5ILY3J2ZRf2GZhwNvZ%2B9N17hDn8rWPP0lwlnFKj)** to see typeclasses in action.
:::

## What Are Typeclasses?

Typeclasses enable ad-hoc polymorphism — adding behavior to types without modifying them. Unlike inheritance, typeclasses:

- Work with types you don't control
- Support multiple implementations per type
- Enable generic programming without runtime overhead

## Defining a Typeclass

```typescript
import { typeclass, instance, summon } from "@typesugar/typeclass";

/** @typeclass */
interface Show<A> {
  show(a: A): string;
}
```

> On an `interface`, prefer the JSDoc form `/** @typeclass */` shown here: it is
> portable and type-checks cleanly under plain `tsc`. The decorator form
> `@typeclass interface Show<A> {}` also works under TypeSugar, but plain `tsc`
> flags it with TS1206. See [JSDoc vs Decorator Syntax](./jsdoc-vs-decorators.md).

<details>
<summary><strong>Try it</strong></summary>

<PlaygroundEmbed
  code="// Typeclasses define shared behavior
// Open in full playground to see typeclass syntax"
  mode=".ts"
  height="100px"
  title="Typeclass basics"
/>

</details>

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

Nothing is ambient (PEP-052): a type gets an instance only when you ask for
one, either with `@derive` or by writing an `@instance`/`@impl` by hand. There
is no "the compiler noticed a typeclass operation on a `Point` and synthesized
an instance from its fields" behavior — that would mean a type's behavior
depended on which files happen to import which typeclasses, which is exactly
the non-local, order-dependent resolution typesugar is designed to avoid.

### `@derive` (Required)

`@derive` generates an instance for every typeclass you list:

```typescript
import { derive } from "@typesugar/derive";

@derive(Eq, Ord)
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

summon<Eq<Point>>().equals(new Point(1, 2), new Point(1, 2)); // true
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

Typeclass methods are available as extension methods (`a.equals(b)` instead of
`Point.Eq.equals(a, b)`) — but, like operators, method syntax is import-scoped
(PEP-052): it activates only in files that import the typeclass's
`@syntax-methods` marker, or that declare the typeclass themselves. std ships
these markers for every typeclass it defines:

```typescript
import "@typesugar/std/syntax/eq"; // activates .equals() / .notEquals()

@derive(Eq)
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

new Point(1, 2).equals(new Point(1, 2)); // true
```

Without the `@typesugar/std/syntax/eq` import, `.equals()` stays a plain
(missing) method call — sugar is never ambient. The louder operator form
(`@typesugar/std/syntax/eq/ops`, enabling `===`) implies the method form (tier
3 ⊇ tier 2). See [Operator Syntax](#operator-syntax) below.

## Zero-Cost Specialization

Specialization is an always-on compiler optimization (PEP-053) — there is no
macro or annotation to request it. Any `@impl` instance's method bodies are
extracted from its own source, so a generic function called with a known
instance gets that instance's dictionary eliminated and its methods inlined
directly, automatically:

```typescript
/** @impl Numeric<Point> */
const numericPoint: Numeric<Point> = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
  mul: (a, b) => ({ x: a.x * b.x, y: a.y * b.y }),
};

function double<A>(a: A, N: Numeric<A>): A {
  return N.add(a, a);
}

double(p, numericPoint);

// Compiles to a hoisted, dedup'd specialization — no dictionary:
// (a) => ({ x: a.x + a.x, y: a.y + a.y })
```

Both the instance name (`numericPoint`) and companion-path access
(`Point.Numeric`) specialize.
If the transformer can't prove the inlining is sound (e.g. the function body
has a loop or try/catch), it falls back to dictionary passing — always
correct, just not zero-cost — and emits a TS9602 warning. Opt a call out
entirely with `// @no-specialize`. See the
[Specialization Guide](/guides/specialize) for details.

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

Mappable containers (uses HKT — see [Higher-Kinded Types](#higher-kinded-types) above).

```typescript
/** @typeclass */
interface Functor<F> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}
```

The `F<A>` syntax is rewritten to `Kind<F, A>` by the transformer. In raw `tsc` (without the transformer), use `Kind<F, A>` directly.

## Operator Syntax {#operator-syntax}

Typeclass methods can be mapped to operators using `@op` annotations. When you
write `a + b` and `a` has an instance of a typeclass with `@op +`, the
transformer rewrites it to a method call — **but only in files that activated
that typeclass's operator syntax** (PEP-052): either by declaring the
typeclass themselves ("you don't import what you define" — the examples
below are self-activating for exactly this reason), or by importing its
`@syntax-operators <TC>` marker (e.g. `@typesugar/std/syntax/eq/ops` for
std's `Eq`). Files that don't activate a typeclass's operator syntax keep
`+`/`===`/etc. as the native, unrewritten operator.

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
// Access via: Point.Numeric

const p1: Point = { x: 1, y: 2 };
const p2: Point = { x: 3, y: 4 };

// Written as:
const p3 = p1 + p2;

// Compiles to:
const p3 = Point.Numeric.add(p1, p2);
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

Typeclasses like Functor and Monad abstract over type constructors — `Option`, `Array`, `Either<string>`, etc. TypeScript doesn't natively support higher-kinded types, but typesugar makes them feel native.

Here's the full workflow — define a typeclass, implement it, use it generically:

```typescript
type Option<A> = A | null;
type Either<E, A> = { _tag: "Left"; error: E } | { _tag: "Right"; value: A };

/** @typeclass */
interface Functor<F> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}

/** @impl Functor<Option> */
const optionFunctor = {
  map: (fa, f) => (fa === null ? null : f(fa)),
};

/** @impl Functor<Either<string>> */
const eitherStringFunctor = {
  map: (fa, f) => (fa._tag === "Left" ? fa : { _tag: "Right", value: f(fa.value) }),
};

function lift<F, A, B>(F: Functor<F>, f: (a: A) => B): (fa: F<A>) => F<B> {
  return (fa) => F.map(fa, f);
}
```

No `Kind`, no `OptionF`, no `TypeFunction`, no `_`. Compare to Scala 3:

```scala
given Functor[Option] with
  extension [A](fa: Option[A]) def map[B](f: A => B): Option[B] = fa.map(f)
```

Equally concise.

### How It Works

The transformer handles the encoding behind the scenes via two mechanisms:

1. **`F<A>` rewriting (Tier 0)** — In typeclass bodies and generic functions, `F<A>` where `F` is a type parameter is rewritten to `Kind<F, A>` before type-checking. This is a pure AST operation — no TypeChecker needed.

2. **Implicit resolution in `@impl` (Tier 1)** — `@impl Functor<Option>` sees that `Option` is a generic type with one parameter, generates the HKT encoding internally, and registers the instance. No `OptionF` or `@hkt` annotation needed.

### Partial Application

For multi-parameter types, fix all parameters except the last:

```typescript
/** @impl Functor<Either<string>> */
const eitherStringFunctor = {
  map: (fa, f) => (fa._tag === "Left" ? fa : { _tag: "Right", value: f(fa.value) }),
};

/** @impl Functor<Either<number>> */
const eitherNumberFunctor = {
  map: (fa, f) => (fa._tag === "Left" ? fa : { _tag: "Right", value: f(fa.value) }),
};
```

`Either<string>` fixes `E = string` and varies `A` — this is the Scala convention (last parameter is the "hole").

### When You Need More Control

For types you don't own or edge cases where implicit resolution can't work, typesugar offers explicit tiers:

**Tier 2: `@hkt` on type definitions** — generates a companion type function:

```typescript
/** @hkt */
type Option<A> = A | null;
// Generates: interface OptionF extends TypeFunction { _: Option<this["__kind__"]> }
```

**Tier 3: `@hkt` with `_` marker** — for types you don't own:

```typescript
import type { _ } from "@typesugar/type-system";

/** @hkt */
type ArrayF = Array<_>;
// Generates: interface ArrayF extends TypeFunction { _: Array<this["__kind__"]> }
```

**Manual `TypeFunction`** — the escape hatch for full control:

```typescript
import type { Kind, TypeFunction } from "@typesugar/type-system";

interface ArrayF extends TypeFunction {
  _: Array<this["__kind__"]>;
}
```

Most users never need anything beyond Tier 0/1. The explicit tiers exist for library authors and edge cases.

### Summoning HKT Instances

```typescript
summon<Functor<Option>>().map(null, (x: number) => x); // null
summon<Functor<Array>>().map([1, 2, 3], (x) => x * 2); // [2, 4, 6]
```

## Migrating from `TypeFunction` to `@impl`

If you have existing code using manual `TypeFunction` interfaces:

**Before (manual boilerplate):**

```typescript
import { Kind, type TypeFunction } from "@typesugar/type-system";

interface OptionF extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: Option<this["__kind__"]>;
}

/** @impl Functor<OptionF> */
const optionFunctor: Functor<OptionF> = {
  map: (fa, f) => (fa === null ? null : f(fa)),
};
```

**After (zero boilerplate):**

```typescript
/** @impl Functor<Option> */
const optionFunctor = {
  map: (fa, f) => (fa === null ? null : f(fa)),
};
```

The migration is straightforward:

1. Remove the `*F` interface (`OptionF`, `EitherF`, etc.)
2. Change `@impl Functor<OptionF>` to `@impl Functor<Option>`
3. Remove the explicit type annotation — the macro infers it
4. Remove unused `Kind` and `TypeFunction` imports

Existing `TypeFunction` interfaces still work — this is backwards compatible. Migrate at your own pace.

## Instance Resolution

Instances are resolved at compile time:

1. Exact match for the type
2. Generic instance with inferred parameters
3. Derived instance from `@derive`

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
- Trust auto-specialization for hot paths — it's always on
- Derive instances where possible

### Don't

- Define duplicate instances
- Use typeclasses for simple runtime polymorphism
- Forget to export instances from your package
