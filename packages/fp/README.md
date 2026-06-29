# @typesugar/fp

> 📖 **Full documentation:** [Functional Programming guide](https://typesugar.org/guides/fp). The microsite is the canonical reference; this README is a quickstart.

A functional programming toolkit (inspired by Scala's Cats): typeclasses (Functor, Monad, Applicative), data types (Option, Either, List, Validated), monad transformers, and a stack-safe IO. Data types use `@opaque` macros for **zero-cost dot syntax** — `Option<A>` is `A | null` at runtime, but you write `.map()`/`.flatMap()`/`.getOrElse()`.

## Installation

```bash
npm install @typesugar/fp
```

## Quick Start

```typescript
import { Some, None, pipe } from "@typesugar/fp";
import type { Option } from "@typesugar/fp";

// Dot syntax, zero-cost (compiles to plain null checks)
const result = Some(5)
  .map((n) => n * 2)
  .filter((n) => n > 5)
  .getOrElse(() => 0); // 10

// Or point-free with pipe
const doubled = pipe(5, (n) => n * 2); // 10
```

## Documentation

- [Functional Programming guide](https://typesugar.org/guides/fp) — Option, Either, IO, typeclasses, transformers
- [Zero-cost @opaque types](https://typesugar.org/guides/type-system)
- [Do-notation](https://typesugar.org/guides/do-notation) · [Pattern matching](https://typesugar.org/guides/match)
