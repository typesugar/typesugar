# @typesugar/typeclass

> 📖 **Full documentation:** [Typeclasses guide](https://typesugar.org/guides/typeclasses). The microsite is the canonical reference; this README is a quickstart.

Scala 3-style typeclasses with compile-time resolution — define typeclasses, provide instances (hand-written, `@derive`d, or `derived<TC<T>>()` for a type you don't own), and summon them with no runtime dictionary-passing overhead.

## Installation

```bash
npm install @typesugar/typeclass
```

## Quick Start

```typescript
import { summon } from "@typesugar/typeclass";

/** @typeclass */
interface Show<A> {
  show(a: A): string;
}

/** @impl Show<number> */
const showNumber: Show<number> = { show: (n) => `#${n}` };

summon<Show<number>>().show(42); // "#42" — instance resolved at compile time
```

Use `@op` JSDoc tags on typeclass methods (e.g. `/** @op + */`) to overload operators.

For a type from a library, declare a derived instance once in a module of your own and
import that module where it's used:

```typescript
export const cloneFeature = derived<Clone<Feature>>();
```

See [Instances for types you don't own](https://typesugar.org/guides/typeclasses#external-types).

## Documentation

- [Typeclasses guide](https://typesugar.org/guides/typeclasses) — full reference
- [Derive Macros guide](https://typesugar.org/guides/derive) · [Operators guide](https://typesugar.org/guides/operators)
- [JSDoc vs decorator syntax](https://typesugar.org/guides/jsdoc-vs-decorators)
