# Pattern Matching (object form)

Dispatch on a discriminated union with `match(value, handlers)`. For exhaustiveness
checking and structural patterns, use the fluent `match().case()` API in
[Pattern Matching](./pattern-matching.md).

## Quick Start

```bash
npm install @typesugar/std
```

```typescript
import { match } from "@typesugar/std";

type Result<T, E> = { kind: "Ok"; value: T } | { kind: "Err"; error: E };

const message = match(result, {
  Ok: ({ value }) => `Got ${value}`,
  Err: ({ error }) => `Failed: ${error}`,
});
```

## Features

- **Type narrowing** — each handler receives the exact variant
- **Default case** — `_` catches every variant without its own handler
- **Compiles to a conditional chain** — the transformer inlines the dispatch; without it,
  `match` runs as an ordinary function with the same behaviour

This form is **not exhaustiveness-checked**: every handler is optional, so a missing
variant compiles and throws `Error("Non-exhaustive match: no handler for '…'")` at runtime.
Add a `_` handler, or use the fluent API when you want a compile-time error for a missing case.

The inlined dispatch reads the discriminant once (`const _k = _m.kind`), calls a handler
with no parameters without an argument, and type-checks under `strict: true`
(expanded-output type checking).

## Usage

### Basic Pattern Matching

Handlers are typed from a `kind` discriminant:

```typescript
type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "rectangle"; width: number; height: number }
  | { kind: "triangle"; base: number; height: number };

const area = match(shape, {
  circle: (s) => Math.PI * s.radius ** 2,
  rectangle: (s) => s.width * s.height,
  triangle: (s) => (s.base * s.height) / 2,
});
```

### Other discriminant names

For a union tagged by another property, pass its name as the third argument. In this
form each handler receives the whole union, not the narrowed variant:

```typescript
type Event = { type: "click"; x: number } | { type: "key"; key: string };

const label = match(event, { click: () => "click", key: () => "key" }, "type");
```

### Default Case

```typescript
const name = match(shape, {
  circle: () => "circle",
  _: () => "polygon", // matches rectangle, triangle
});
```

## Exhaustiveness and MatchError

The fluent `match().case().then().else()` API (see [Pattern Matching](./pattern-matching.md)) enforces compile-time exhaustiveness. Missing cases produce a [TS9226](../errors/TS9226.md) error (e.g. `Non-exhaustive match — missing cases: "green", "blue"`). When no pattern matches at runtime, the generated code throws `MatchError` with the unmatched value on `.value`.

## Learn More

- [PEP-008: Pattern Matching](https://github.com/typesugar/typesugar/blob/main/peps/PEP-008-pattern-matching.md) — Fluent API, exhaustiveness, MatchError, full pattern catalogue
- [API Reference](/reference/packages#std)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/std)
