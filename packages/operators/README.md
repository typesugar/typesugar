# @typesugar/operators

> Operator overloading macros for TypeScript.

## Overview

`@typesugar/operators` enables operator overloading in TypeScript through compile-time macro expansion. Define custom behavior for `+`, `-`, `*`, `/`, and other operators on your classes, with transformations happening at compile time — no runtime overhead.

## Installation

```bash
npm install @typesugar/operators
# or
pnpm add @typesugar/operators
```

## Usage

### Operator Overloading with @operators

```typescript
import { operators, ops } from "@typesugar/operators";

@operators({ "+": "add", "-": "sub", "*": "scale", "-unary": "negate" })
class Vec2 {
  constructor(
    public x: number,
    public y: number
  ) {}

  add(other: Vec2): Vec2 {
    return new Vec2(this.x + other.x, this.y + other.y);
  }

  sub(other: Vec2): Vec2 {
    return new Vec2(this.x - other.x, this.y - other.y);
  }

  scale(factor: number): Vec2 {
    return new Vec2(this.x * factor, this.y * factor);
  }

  negate(): Vec2 {
    return new Vec2(-this.x, -this.y);
  }
}

const a = new Vec2(1, 2);
const b = new Vec2(3, 4);

// Use ops() to enable operator transformation
const sum = ops(a + b); // Compiles to: a.add(b)
const diff = ops(a - b); // Compiles to: a.sub(b)
const scaled = ops(a * 2); // Compiles to: a.scale(2)
const neg = ops(-a); // Compiles to: a.negate()

// Complex expressions work too
const result = ops((a + b) * 3 - a);
// Compiles to: a.add(b).scale(3).sub(a)
```

### Supported Operators

| Operator    | Key        | Example Method |
| ----------- | ---------- | -------------- |
| `+`         | `"+"`      | `add`          |
| `-`         | `"-"`      | `sub`          |
| `*`         | `"*"`      | `mul`          |
| `/`         | `"/"`      | `div`          |
| `%`         | `"%"`      | `mod`          |
| `**`        | `"**"`     | `pow`          |
| `<`         | `"<"`      | `lt`           |
| `<=`        | `"<="`     | `lte`          |
| `>`         | `">"`      | `gt`           |
| `>=`        | `">="`     | `gte`          |
| `==`        | `"=="`     | `eq`           |
| `===`       | `"==="`    | `strictEq`     |
| `!=`        | `"!="`     | `neq`          |
| `!==`       | `"!=="`    | `strictNeq`    |
| `&`         | `"&"`      | `bitAnd`       |
| `\|`        | `"\|"`     | `bitOr`        |
| `^`         | `"^"`      | `bitXor`       |
| `<<`        | `"<<"`     | `shl`          |
| `>>`        | `">>"`     | `shr`          |
| `-` (unary) | `"-unary"` | `negate`       |
| `+` (unary) | `"+unary"` | `positive`     |
| `!`         | `"!"`      | `not`          |
| `~`         | `"~"`      | `bitNot`       |

### Function Composition with pipe()

```typescript
import { pipe } from "@typesugar/operators";

const double = (x: number) => x * 2;
const addOne = (x: number) => x + 1;
const square = (x: number) => x * x;

// pipe(value, f, g, h) compiles to h(g(f(value)))
const result = pipe(5, double, addOne, square);
// Compiles to: square(addOne(double(5)))
// Result: 121
```

### Function Composition with compose()

```typescript
import { compose } from "@typesugar/operators";

const double = (x: number) => x * 2;
const addOne = (x: number) => x + 1;

// compose(f, g) compiles to (x) => f(g(x))
const doubleThenAddOne = compose(addOne, double);
// Compiles to: (x) => addOne(double(x))

doubleThenAddOne(5); // 11
```

## API Reference

### Attribute Macros

- `@operators(mappings)` — Define operator-to-method mappings for a class

### Expression Macros

- `ops(expr)` — Transform operators in `expr` to method calls
- `pipe(value, ...fns)` — Pipe a value through functions left-to-right
- `compose(...fns)` — Compose functions right-to-left

### Functions

- `registerOperators(typeName, mappings)` — Programmatically register operator mappings
- `getOperatorMethod(typeName, operator)` — Look up the method for an operator
- `clearOperatorMappings()` — Clear all mappings (for testing)
- `register()` — Register all operator macros (called automatically on import)

## License

MIT
