# Pattern Matching

Exhaustive pattern matching for discriminated unions with `match()`.

## Quick Start

```bash
npm install @typesugar/std
```

```typescript
import { match } from "@typesugar/std";

type Result<T, E> = { tag: "Ok"; value: T } | { tag: "Err"; error: E };

const message = match(result, {
  Ok: ({ value }) => `Got ${value}`,
  Err: ({ error }) => `Failed: ${error}`,
});
```

## Features

- **Exhaustiveness checking** — compile-time error if you miss a case
- **Type narrowing** — TypeScript knows the exact variant inside each arm
- **OR patterns** — match multiple cases with the same handler
- **Guards** — add conditions to pattern arms

## Usage

### Basic Pattern Matching

```typescript
type Shape =
  | { type: "circle"; radius: number }
  | { type: "rectangle"; width: number; height: number }
  | { type: "triangle"; base: number; height: number };

const area = match(shape, {
  circle: (s) => Math.PI * s.radius ** 2,
  rectangle: (s) => s.width * s.height,
  triangle: (s) => (s.base * s.height) / 2,
});
```

### Default Case

```typescript
const name = match(shape, {
  circle: () => "circle",
  _: () => "polygon", // matches rectangle, triangle
});
```

### OR Patterns

```typescript
const isRound = match(shape, {
  circle: () => true,
  "rectangle | triangle": () => false,
});
```

## Learn More

- [API Reference](/reference/packages#std)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/std)
