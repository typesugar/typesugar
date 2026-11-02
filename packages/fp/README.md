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

// Dot syntax on a zero-cost Option (Some(5) is just 5 at runtime). The method calls
// compile to calls of the standalone functions:
// getOrElse(filter(map(5, (n) => n * 2), (n) => n > 5), () => 0)
// imported from "@typesugar/fp/data/option".
const result = Some(5)
  .map((n) => n * 2)
  .filter((n) => n > 5)
  .getOrElse(() => 0); // 10

// Or point-free with pipe
const doubled = pipe(5, (n) => n * 2); // 10
```

The constructors are also extractor patterns for `match` from `@typesugar/std`: fp ships a
`Destructure` instance for each of `Some`/`None`, `Left`/`Right`, `Cons`/`Nil` and
`Valid`/`Invalid`, and the pattern compiles to the test on the real representation:

```typescript
import { match } from "@typesugar/std";

declare const opt: Option<number>;
match(opt)
  .case(Some(v))
  .then(v * 2)
  .case(None)
  .then(0);
// if (_opt != null) { const v = _opt as unknown as number; return v * 2; } return 0;
```

`Some` and `None` cover `Option`, so the `None` arm needs no test and there is no
`MatchError` (nor an import of `@typesugar/std`) in the output. `Option` is `@opaque`, so
`v` is asserted to the payload type `number`, which `_opt != null` alone doesn't give the
type checker.

## Documentation

- [Functional Programming guide](https://typesugar.org/guides/fp) — Option, Either, IO, typeclasses, transformers
- [Zero-cost @opaque types](https://typesugar.org/guides/type-system)
- [Do-notation](https://typesugar.org/guides/do-notation) · [Pattern matching](https://typesugar.org/guides/pattern-matching)
