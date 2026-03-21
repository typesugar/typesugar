# Operator Overloading

typesugar provides operator overloading through two mechanisms:

1. **`@op` JSDoc on typeclass methods (standard operators)** — `+`, `-`, `*`, `/`, `===`, etc. dispatch to typeclass methods
2. **Preprocessor (`|>`, `::`, `<|`)** — Custom operators rewritten to `__binop__()` calls, resolved via typeclass `@op` or hardcoded defaults

## Standard Operators via @op JSDoc

The only way to enable standard JavaScript operators is through typeclass instances with `@op` JSDoc tags on method signatures:

```typescript
import { Numeric, numericRational, rational } from "@typesugar/std";

const a = rational(1n, 2n);
const b = rational(1n, 3n);

// Operators work automatically through Numeric typeclass
const sum = a + b; // Compiles to: numericRational.add(a, b)
const product = a * b; // Compiles to: numericRational.mul(a, b)
const comparison = a < b; // Compiles to: ordRational.compare(a, b) < 0
```

Typeclasses define methods with `@op` JSDoc tags, which the transformer uses to dispatch operators:

```typescript
/** @typeclass */
interface Numeric<A> {
  /** @op + */
  add(a: A, b: A): A;

  /** @op * */
  mul(a: A, b: A): A;

  /** @op - */
  sub(a: A, b: A): A;
}
```

This approach is **zero-cost** — the operator is transformed directly to the method call with no wrapper.

---

## Supported Operators

### Arithmetic

| Operator | Typical Method          | Example  |
| -------- | ----------------------- | -------- |
| `+`      | `add`, `plus`           | `a + b`  |
| `-`      | `sub`, `minus`          | `a - b`  |
| `*`      | `mul`, `times`, `scale` | `a * b`  |
| `/`      | `div`                   | `a / b`  |
| `%`      | `mod`, `rem`            | `a % b`  |
| `**`     | `pow`                   | `a ** b` |

### Comparison

| Operator | Typical Method              | Example   |
| -------- | --------------------------- | --------- |
| `===`    | `equals`, `eq`              | `a === b` |
| `!==`    | `notEquals`, `neq`          | `a !== b` |
| `<`      | `lessThan`, `lt`            | `a < b`   |
| `<=`     | `lessThanOrEqual`, `lte`    | `a <= b`  |
| `>`      | `greaterThan`, `gt`         | `a > b`   |
| `>=`     | `greaterThanOrEqual`, `gte` | `a >= b`  |

### Bitwise

| Operator | Typical Method | Example  |
| -------- | -------------- | -------- | --- | --- |
| `&`      | `and`          | `a & b`  |
| `        | `              | `or`     | `a  | b`  |
| `^`      | `xor`          | `a ^ b`  |
| `~`      | `not`          | `~a`     |
| `<<`     | `shl`          | `a << b` |
| `>>`     | `shr`          | `a >> b` |

## Operator Precedence

Operators respect JavaScript operator precedence:

```typescript
a + b * c; // → add(a, mul(b, c))
(a + b) * c; // → mul(add(a, b), c)
```

## Custom Operators (Preprocessor)

The preprocessor handles custom syntax (`|>`, `::`, `<|`) in `.sts` files. These are rewritten to `__binop__()` calls, which the transformer resolves via:

1. Typeclass `@op` annotations (e.g., `/** @op |> */` on a method)
2. Hardcoded defaults (e.g., `|>` → `right(left)`)

## Pipe Operator

The `pipe()` function chains operations:

```typescript
import { pipe } from "typesugar";

const result = pipe(
  5,
  (x) => x * 2,
  (x) => x + 1,
  (x) => x.toString()
);
// result: "11"
```

## Compose

Compose functions right-to-left:

```typescript
import { compose } from "typesugar";

const f = (x: number) => x * 2;
const g = (x: number) => x + 1;

const h = compose(f, g); // x => f(g(x))
h(5); // 12 (5 + 1 = 6, 6 * 2 = 12)
```

## Unary Operators

```typescript
/** @typeclass */
interface Negate<A> {
  /** @op - */
  negate(a: A): A;
}
```

When an instance exists, `-c` compiles to `negateInstance.negate(c)`.

## Comparison with @derive

`@op` and `@derive(Eq, Ord)` serve different purposes:

```typescript
// @derive generates the implementation
@derive(Eq, Ord)
class Point { ... }

// @op maps syntax to existing methods on typeclass definitions
@op is on the typeclass interface, not the class
```

## Type Safety

Operator dispatch is fully type-checked:

```typescript
// If Vec2 has Numeric instance, vec + 5 fails if add expects (Vec2, Vec2)
const sum = vec + other; // OK
const bad = vec + 5; // Type error if add expects Vec2
```

## Performance

Operators compile away completely:

```typescript
// Source
const result = a + b * c;

// Compiled
const result = numericInstance.add(a, numericInstance.mul(b, c));
```

No runtime overhead.

## Limitations

### What @op Doesn't Support

- Assignment operators (`+=`, `-=`, etc.)
- Increment/decrement (`++`, `--`)
- Logical operators (`&&`, `||`)
- Ternary operator (`? :`)

## Best Practices

### Do

- Use descriptive method names (`add`, `multiply`)
- Keep operator semantics intuitive
- Document what operators your type supports
- Use `@op` on typeclass methods for typeclass-based operator dispatch

### Don't

- Overload operators with surprising behavior
- Use operators everywhere (only where they improve readability)
