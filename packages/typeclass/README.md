# @typesugar/typeclass

> 📖 **Full documentation:** [Typeclasses guide](https://typesugar.org/guides/typeclasses). The microsite is the canonical reference; this README is a quickstart.

Scala 3-style typeclasses with compile-time resolution — define typeclasses, provide instances, auto-derive, and summon them with no runtime dictionary-passing overhead.

## Installation

```bash
npm install @typesugar/typeclass
```

## Quick Start

```typescript
import { instance, summon } from "@typesugar/typeclass";

/** @typeclass */
interface Show<A> {
  show(a: A): string;
}

@instance("Show<number>")
const showNumber: Show<number> = { show: (n) => `#${n}` };

summon<Show<number>>().show(42); // "#42" — instance resolved at compile time
```

Use `@op` JSDoc tags on typeclass methods (e.g. `/** @op + */`) to overload operators.

## Documentation

- [Typeclasses guide](https://typesugar.org/guides/typeclasses) — full reference
- [Derive Macros guide](https://typesugar.org/guides/derive) · [Operators guide](https://typesugar.org/guides/operators)
- [JSDoc vs decorator syntax](https://typesugar.org/guides/jsdoc-vs-decorators)
