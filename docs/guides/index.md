# Feature Guides

Deep-dive guides for typesugar features.

## Core Features

| Guide                                    | Description                                      |
| ---------------------------------------- | ------------------------------------------------ |
| [Compile-Time Evaluation](./comptime.md) | Run code at build time with `comptime()`         |
| [Derive Macros](./derive.md)             | Auto-generate implementations with `@derive()`   |
| [Typeclasses](./typeclasses.md)          | Scala 3-style ad-hoc polymorphism                |
| [Operator Overloading](./operators.md)   | Custom operators with `@operators()` and `ops()` |

## Developer Experience

| Guide                                                      | Description                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| [Developer Experience Overview](./developer-experience.md) | How error messages, import suggestions, and tooling work together |
| [Error Messages](./error-messages.md)                      | Rust-style errors with labeled spans and auto-fixes               |
| [Opt-Out Directives](./opt-out.md)                         | Disable transformations for debugging/interop                     |

## Advanced Features

| Guide                                                   | Description                                    |
| ------------------------------------------------------- | ---------------------------------------------- |
| [Tagged Templates](./tagged-templates.md)               | Type-safe SQL, regex, HTML, and units          |
| [Contracts](./contracts.md)                             | Design by contract with `requires:`/`ensures:` |
| [Functional Programming](./fp.md)                       | Option, Result, IO, and HKT                    |
| [Extension Methods](./extension-methods.md)             | Scala 3-style extension methods                |
| [Do-Notation](./do-notation.md)                         | Monadic comprehensions with `let:`/`yield:`    |
| [Conditional Compilation](./conditional-compilation.md) | Feature flags with `cfg()` and `@cfgAttr`      |

## Quick Reference

### Import Patterns

```typescript
// Compile-time evaluation
import { comptime } from "@typesugar/comptime";

// Derive macros
import { derive, Eq, Ord, Clone, Debug, Json } from "@typesugar/derive";

// Type reflection
import { typeInfo, fieldNames, validator } from "@typesugar/reflect";

// SQL
import { sql } from "@typesugar/sql";

// Typeclasses
import { typeclass, instance, deriving, summon } from "@typesugar/typeclass";

// Operators
import { operators, ops, pipe } from "@typesugar/operators";

// Contracts
import { requires, ensures, invariant } from "@typesugar/contracts";

// FP
import { Option, Some, None, Result, Ok, Err, IO } from "@typesugar/fp";
```

### Feature Matrix

| Feature         | Package                | Macro Type      |
| --------------- | ---------------------- | --------------- |
| `comptime()`    | `@typesugar/comptime`  | Expression      |
| `@derive()`     | `@typesugar/derive`    | Attribute       |
| `@typeclass`    | `@typesugar/typeclass` | Attribute       |
| `@operators()`  | `@typesugar/operators` | Attribute       |
| `ops()`         | `@typesugar/operators` | Expression      |
| `summon<T>()`   | `@typesugar/typeclass` | Expression      |
| `sql`           | `@typesugar/sql`       | Tagged Template |
| `requires:`     | `@typesugar/contracts` | Labeled Block   |
| `let:`/`yield:` | `@typesugar/std`       | Labeled Block   |
| `cfg()`         | `@typesugar/core`      | Expression      |
