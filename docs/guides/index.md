# Feature Guides

Deep-dive guides for typesugar features, organized by category. Guides marked _(frozen)_
cover packages that are still published but not under active development
([PEP-048](https://github.com/typesugar/typesugar/blob/main/peps/PEP-048-package-triage.md)).

**New here?** [**Zero-Cost, Seen**](./zero-cost.md) shows the actual compiled
output (the headline claim, proven), and the
[runnable examples](https://github.com/typesugar/typesugar/tree/main/examples) —
including six full app scenarios (REST API, data pipeline, FP domain, …) — run
with `typesugar run`.

## Standard Library

Everyday features from `@typesugar/std`:

| Guide                                        | Description                                                 |
| -------------------------------------------- | ----------------------------------------------------------- |
| [Extension Methods](./extension-methods.md)  | UFCS, @opaque dot syntax, global augmentation               |
| [Pattern Matching](./pattern-matching.md)    | Scala-style structural patterns, exhaustiveness, extractors |
| [Pattern Matching (object form)](./match.md) | `match(value, { variant: handler })` dispatch               |
| [Do-Notation](./do-notation.md)              | Monadic `let:`/`yield:` and applicative `par:`/`yield:`     |
| [Standard Typeclasses](./std-typeclasses.md) | Eq, Ord, Hash, Show, Monoid, FlatMap                        |

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

| Guide                                                   | Description                                               |
| ------------------------------------------------------- | --------------------------------------------------------- |
| [Operators](./operators.md)                             | Operator overloading via `@op` JSDoc on typeclass methods |
| [Tagged Templates](./tagged-templates.md)               | Type-safe SQL, regex, HTML, and units                     |
| [String Macros](./strings.md)                           | `regex`, `html`, `raw` templates (frozen)                 |
| [Compile-Time Eval](./comptime.md)                      | Run code at build time with `comptime()`                  |
| [Conditional Compilation](./conditional-compilation.md) | Feature flags with `cfg()` and `@cfgAttr`                 |

## Type Safety & Contracts

Compile-time correctness guarantees:

| Guide                                   | Description                                    |
| --------------------------------------- | ---------------------------------------------- |
| [Contracts](./contracts.md)             | Design by contract with `requires:`/`ensures:` |
| [Refined Types](./contracts-refined.md) | Integration with refinement types              |
| [Type System](./type-system.md)         | Refined types, newtype, HKT, phantom types     |
| [Validation](./validate.md)             | Schema validation macros                       |
| [Units of Measure](./units.md)          | Type-safe physical units (frozen)              |

## Data Structures & Algorithms

Powerful abstractions with zero runtime cost:

| Guide                                          | Description                                             |
| ---------------------------------------------- | ------------------------------------------------------- |
| [Functional Programming](./fp.md)              | Option, Either, IO with @opaque dot syntax              |
| [Type Erasure](./erased.md)                    | dyn Trait for heterogeneous collections (frozen)        |
| [Loop Fusion](./fusion.md)                     | Single-pass iterator pipelines                          |
| [Parser Combinators](./parser.md)              | PEG grammar to parser (Boost.Spirit) (frozen)           |
| [Collections](/reference/packages#collections) | Typeclasses for collections, HashSet, HashMap (frozen)  |
| [Graph Algorithms](./graph.md)                 | GraphLike typeclass, BFS, DFS, Dijkstra, state machines |
| [Versioned Codecs](./codec.md)                 | Schema evolution (serde) (frozen)                       |
| [Math](./math.md)                              | Rational, complex, matrix, interval (frozen)            |
| [Object Mapping](./mapper.md)                  | Zero-cost struct transformation                         |

## Ecosystem Integrations

Supercharge your existing tools:

| Guide                    | Description                               |
| ------------------------ | ----------------------------------------- |
| [Effect-TS](./effect.md) | `@service`, `@layer`, `resolveLayer<R>()` |
| [SQL](./sql.md)          | Doobie-like type-safe SQL                 |

## Developer Experience

When something goes wrong, you should know exactly what happened and how to get the level of type safety you want:

| Guide                                           | Description                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| [Type Safety](./type-safety.md)                 | The three-layer model: build, IDE, CI                                     |
| [JSDoc vs Decorators](./jsdoc-vs-decorators.md) | When to use `/** @macro */` vs `@macro` — portability, TS1206, tsc-safety |
| [Overview](./developer-experience.md)           | How error messages, suggestions, and tooling work                         |
| [AI Assistants](./ai-assistants.md)             | Using typesugar with AI coding assistants                                 |
| [Error Messages](./error-messages.md)           | Error codes, notes, help and resolution traces                            |
| [Opt-Out Directives](./opt-out.md)              | Disable transformations for debugging                                     |
| [Testing](./testing.md)                         | Power assertions, property testing                                        |
| [Authoring Libraries](./authoring-libraries.md) | Ship a standalone+transformer library: macros vs runtime, packaging       |
| [Library Manifest](./library-manifest.md)       | Planned — not in 1.0                                                      |
| [Interactive Playground](./playground.md)       | Try code in-browser with runtime libraries, 30+ examples                  |

---

## Quick Reference

### Import Patterns

```typescript
// Standard library
import { clamp, abs, match } from "@typesugar/std";

// Derive macros (also exported by "@typesugar/derive")
import { derive, Eq, Ord, Clone, Debug, Json } from "typesugar";

// Typeclasses: /** @typeclass */ and /** @impl TC<T> */ are JSDoc tags, no import
// (also exported by "@typesugar/typeclass")
import { summon, derived, implicit } from "typesugar";

// Operators (pipe, compose)
import { pipe, compose } from "typesugar";

// Compile-time
import { comptime, includeStr, staticAssert } from "@typesugar/macros";

// Contracts
import { requires, ensures, invariant } from "@typesugar/contracts";

// FP
import { Some, None, Left, Right, IO, type Option, type Either } from "@typesugar/fp";

// SQL
import { sql, ConnectionIO } from "@typesugar/sql";

// Testing
import { assert, staticAssert, typeAssert, forAll } from "@typesugar/testing";
```

### Feature Matrix

| Feature         | Package                | Macro Type      |
| --------------- | ---------------------- | --------------- |
| `comptime()`    | `@typesugar/macros`    | Expression      |
| `@derive()`     | `@typesugar/derive`    | Attribute       |
| `@typeclass`    | `@typesugar/typeclass` | Attribute       |
| `summon<T>()`   | `@typesugar/typeclass` | Expression      |
| `match()`       | `@typesugar/std`       | Expression      |
| `sql`           | `@typesugar/sql`       | Tagged Template |
| `requires:`     | `@typesugar/contracts` | Labeled Block   |
| `let:`/`yield:` | `@typesugar/std`       | Labeled Block   |
| `par:`/`yield:` | `@typesugar/std`       | Labeled Block   |
| `cfg()`         | `@typesugar/macros`    | Expression      |
| `assert()`      | `@typesugar/testing`   | Expression      |
