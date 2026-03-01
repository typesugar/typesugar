# Operator Overloading

typesugar provides operator overloading through two mechanisms:

1. **Op\<\> typeclass return types (recommended)** — Operators automatically dispatch to typeclass methods
2. **`@operators()` and `ops()` (legacy)** — Explicit wrapper for class-specific operators

## Recommended: Op\<\> Typeclass Approach

The preferred way to enable operators is through typeclass instances with `Op<>` return types:

```typescript
import { Numeric, numericRational, rational } from "@typesugar/std";

const a = rational(1n, 2n);
const b = rational(1n, 3n);

// Operators work automatically through Numeric typeclass
const sum = a + b;        // Compiles to: numericRational.add(a, b)
const product = a * b;    // Compiles to: numericRational.mul(a, b)
const comparison = a < b; // Compiles to: ordRational.compare(a, b) < 0
```

Typeclasses define methods with `Op<>` return type annotations, which the transformer uses to dispatch operators:

```typescript
interface Numeric<A> {
  add(a: A, b: A): A & Op<"+">;  // a + b dispatches to add()
  mul(a: A, b: A): A & Op<"*">;  // a * b dispatches to mul()
  // ...
}
```

This approach is **zero-cost** — the operator is transformed directly to the method call with no wrapper.

---

## Legacy: @operators() and ops()

For class-specific operators without typeclasses, you can still use the legacy pattern:

### Basic Usage

```typescript
import { operators, ops } from "typesugar";

@operators({ "+": "add", "*": "scale", "==": "equals" })
class Vec2 {
  constructor(
    public x: number,
    public y: number
  ) {}

  add(other: Vec2): Vec2 {
    return new Vec2(this.x + other.x, this.y + other.y);
  }

  scale(n: number): Vec2 {
    return new Vec2(this.x * n, this.y * n);
  }

  equals(other: Vec2): boolean {
    return this.x === other.x && this.y === other.y;
  }
}

const a = new Vec2(1, 2);
const b = new Vec2(3, 4);

// Use ops() to enable operators
const sum = ops(a + b); // → a.add(b)
const scaled = ops(a * 2); // → a.scale(2)
const equal = ops(a == b); // → a.equals(b)
const complex = ops(a + b * 2); // → a.add(b.scale(2))
```

## Supported Operators

### Arithmetic

| Operator | Typical Method          | Example       |
| -------- | ----------------------- | ------------- |
| `+`      | `add`, `plus`           | `ops(a + b)`  |
| `-`      | `sub`, `minus`          | `ops(a - b)`  |
| `*`      | `mul`, `times`, `scale` | `ops(a * b)`  |
| `/`      | `div`                   | `ops(a / b)`  |
| `%`      | `mod`, `rem`            | `ops(a % b)`  |
| `**`     | `pow`                   | `ops(a ** b)` |

### Comparison

| Operator | Typical Method              | Example       |
| -------- | --------------------------- | ------------- |
| `==`     | `equals`, `eq`              | `ops(a == b)` |
| `!=`     | `notEquals`, `neq`          | `ops(a != b)` |
| `<`      | `lessThan`, `lt`            | `ops(a < b)`  |
| `<=`     | `lessThanOrEqual`, `lte`    | `ops(a <= b)` |
| `>`      | `greaterThan`, `gt`         | `ops(a > b)`  |
| `>=`     | `greaterThanOrEqual`, `gte` | `ops(a >= b)` |

### Bitwise

| Operator | Typical Method | Example       |
| -------- | -------------- | ------------- |
| `&`      | `and`          | `ops(a & b)`  |
| `\|`     | `or`           | `ops(a \| b)` |
| `^`      | `xor`          | `ops(a ^ b)`  |
| `~`      | `not`          | `ops(~a)`     |
| `<<`     | `shl`          | `ops(a << b)` |
| `>>`     | `shr`          | `ops(a >> b)` |

## Operator Precedence

ops() respects JavaScript operator precedence:

```typescript
ops(a + b * c); // → a.add(b.mul(c))
ops((a + b) * c); // → a.add(b).mul(c)
```

## Mixed Types

Methods can accept different types:

```typescript
@operators({ "*": "scale" })
class Vec2 {
  scale(n: number): Vec2 { ... }
  // Also supports Vec2 * Vec2
  scale(other: Vec2): Vec2 { ... }
}

ops(vec * 2)       // Vec2.scale(number)
ops(vec * other)   // Vec2.scale(Vec2)
```

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

### With Custom Types

```typescript
const processed = pipe(
  new Vec2(1, 1),
  (v) => v.add(new Vec2(2, 2)),
  (v) => v.scale(3),
  (v) => v.toString()
);
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
@operators({ "-": "negate", "!": "not" })
class Complex {
  negate(): Complex { ... }
  not(): Complex { ... }
}

ops(-c)  // → c.negate()
ops(!c)  // → c.not()
```

## Comparison with @derive

`@operators` and `@derive(Eq, Ord)` serve different purposes:

```typescript
// @derive generates the implementation
@derive(Eq, Ord)
class Point { ... }

// @operators maps syntax to existing methods
@operators({ "==": "equals", "<": "lessThan" })
class Point { ... }
```

You can use both:

```typescript
@derive(Eq, Ord)
@operators({ "==": "equals", "<": "lessThan" })
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

const p1 = new Point(1, 2);
const p2 = new Point(3, 4);
ops(p1 < p2); // true
```

## Type Safety

ops() is fully type-checked:

```typescript
@operators({ "+": "add" })
class Vec2 {
  add(other: Vec2): Vec2 { ... }
}

ops(vec + 5);  // Type error: number not assignable to Vec2
```

## Performance

ops() compiles away completely:

```typescript
// Source
const result = ops(a + b * c);

// Compiled
const result = a.add(b.mul(c));
```

No runtime overhead.

## Limitations

### What ops() Doesn't Support

- Assignment operators (`+=`, `-=`, etc.)
- Increment/decrement (`++`, `--`)
- Logical operators (`&&`, `||`)
- Ternary operator (`? :`)

### ops() Scope

ops() only transforms the expression inside:

```typescript
// Only the ops() part is transformed
const x = ops(a + b) + c; // → a.add(b) + c
```

To transform everything, nest or restructure:

```typescript
const x = ops(a + b + c); // → a.add(b).add(c)
```

## Best Practices

### Do

- Use descriptive method names (`add`, `multiply`)
- Keep operator semantics intuitive
- Document what operators your type supports
- Use ops() for math-heavy code

### Don't

- Overload operators with surprising behavior
- Use ops() everywhere (only where it improves readability)
- Forget that ops() is a macro (it must wrap the expression)
