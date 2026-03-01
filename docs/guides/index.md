# Feature Guides

Deep-dive guides for typesugar features, organized by category.

## Standard Library

Everyday features from `@typesugar/std`:

| Guide                                        | Description                                             |
| -------------------------------------------- | ------------------------------------------------------- |
| [Extension Methods](./extension-methods.md)  | Scala 3-style methods on primitives                     |
| [Pattern Matching](./match.md)               | Exhaustive `match()` with discriminated unions          |
| [Do-Notation](./do-notation.md)              | Monadic `let:`/`yield:` and applicative `par:`/`yield:` |
| [Standard Typeclasses](./std-typeclasses.md) | Eq, Ord, Show, Monoid, FlatMap                          |

## Typeclasses & Derivation

The framework for ad-hoc polymorphism:

| Guide                             | Description                                          |
| --------------------------------- | ---------------------------------------------------- |
| [Typeclasses](./typeclasses.md)   | Scala 3-style implicit resolution                    |
| [Derive Macros](./derive.md)      | Auto-generate implementations with `@derive()`       |
| [Specialization](./specialize.md) | Zero-cost typeclass inlining                         |
| [Reflection](./reflect.md)        | `typeInfo<T>()`, `fieldNames<T>()`, `validator<T>()` |

## Syntax Sugar

New language features — the "typesugar" in typesugar:

| Guide                                                   | Description                                      |
| ------------------------------------------------------- | ------------------------------------------------ |
| [Operators](./operators.md)                             | Custom operators with `@operators()` and `ops()` |
| [Tagged Templates](./tagged-templates.md)               | Type-safe SQL, regex, HTML, and units            |
| [String Macros](./strings.md)                           | `regex`, `html`, `raw` templates                 |
| [Compile-Time Eval](./comptime.md)                      | Run code at build time with `comptime()`         |
| [Conditional Compilation](./conditional-compilation.md) | Feature flags with `cfg()` and `@cfgAttr`        |

## Type Safety & Contracts

Compile-time correctness guarantees:

| Guide                                   | Description                                    |
| --------------------------------------- | ---------------------------------------------- |
| [Contracts](./contracts.md)             | Design by contract with `requires:`/`ensures:` |
| [Refined Types](./contracts-refined.md) | Integration with refinement types              |
| [Type System](./type-system.md)         | Refined types, newtype, HKT, phantom types     |
| [Validation](./validate.md)             | Schema validation macros                       |
| [Units of Measure](./units.md)          | Type-safe physical units                       |

## Data Structures & Algorithms

Powerful abstractions with zero runtime cost:

| Guide                             | Description                             |
| --------------------------------- | --------------------------------------- |
| [Functional Programming](./fp.md) | Option, Either, IO, and HKT             |
| [HList](./hlist.md)               | Heterogeneous lists (Boost.Fusion)      |
| [Type Erasure](./erased.md)       | dyn Trait for heterogeneous collections |
| [Loop Fusion](./fusion.md)        | Single-pass iterator pipelines          |
| [Parser Combinators](./parser.md) | PEG grammar to parser (Boost.Spirit)    |
| [Graph Algorithms](./graph.md)    | BFS, DFS, Dijkstra, state machines      |
| [Versioned Codecs](./codec.md)    | Schema evolution (serde)                |
| [Math](./math.md)                 | Rational, complex, matrix, interval     |
| [Object Mapping](./mapper.md)     | Zero-cost struct transformation         |
| [Symbolic Math](./symbolic.md)    | Calculus, simplification, rendering     |

## Ecosystem Integrations

Supercharge your existing tools:

| Guide                    | Description                               |
| ------------------------ | ----------------------------------------- |
| [Effect-TS](./effect.md) | `@service`, `@layer`, `resolveLayer<R>()` |
| [React](./react.md)      | Vue/Svelte-style reactivity               |
| [SQL](./sql.md)          | Doobie-like type-safe SQL                 |

## Developer Experience

When something goes wrong, you should know exactly what happened:

| Guide                                     | Description                                       |
| ----------------------------------------- | ------------------------------------------------- |
| [Overview](./developer-experience.md)     | How error messages, suggestions, and tooling work |
| [Error Messages](./error-messages.md)     | Rust-style errors with labeled spans              |
| [Opt-Out Directives](./opt-out.md)        | Disable transformations for debugging             |
| [Testing](./testing.md)                   | Power assertions, property testing                |
| [Library Manifest](./library-manifest.md) | Publishing typesugar-powered libraries            |

---

## Quick Reference

### Import Patterns

```typescript
// Standard library
import { NumberExt, match, registerFlatMap } from "@typesugar/std";

// Derive macros
import { derive, Eq, Ord, Clone, Debug, Json } from "@typesugar/derive";

// Typeclasses
import { typeclass, instance, deriving, summon } from "@typesugar/typeclass";

// Operators (legacy pattern, prefer Op<> typeclass)
import { operators, ops, pipe } from "typesugar";

// Compile-time
import { comptime, includeStr, static_assert } from "@typesugar/comptime";

// Contracts
import { requires, ensures, invariant } from "@typesugar/contracts";

// FP
import { Option, Some, None, Result, Ok, Err, IO } from "@typesugar/fp";

// SQL
import { sql, ConnectionIO } from "@typesugar/sql";

// Testing
import { assert, staticAssert, typeAssert, forAll } from "@typesugar/testing";
```

### Feature Matrix

| Feature         | Package                | Macro Type      |
| --------------- | ---------------------- | --------------- |
| `comptime()`    | `@typesugar/comptime`  | Expression      |
| `@derive()`     | `@typesugar/derive`    | Attribute       |
| `@typeclass`    | `@typesugar/typeclass` | Attribute       |
| `@operators()`  | `typesugar` (legacy)   | Attribute       |
| `ops()`         | `typesugar` (legacy)   | Expression      |
| `summon<T>()`   | `@typesugar/typeclass` | Expression      |
| `match()`       | `@typesugar/std`       | Expression      |
| `sql`           | `@typesugar/sql`       | Tagged Template |
| `requires:`     | `@typesugar/contracts` | Labeled Block   |
| `let:`/`yield:` | `@typesugar/std`       | Labeled Block   |
| `par:`/`yield:` | `@typesugar/std`       | Labeled Block   |
| `cfg()`         | `@typesugar/core`      | Expression      |
| `assert()`      | `@typesugar/testing`   | Expression      |
