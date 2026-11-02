# @typesugar/derive

> 📖 **Full documentation:** [Derive Macros guide](https://typesugar.org/guides/derive). The microsite is the canonical reference; this README is a quickstart.

Auto-derive typeclass instances (`Eq`, `Ord`, `Clone`, `Debug`, `Hash`, `Default`, `Json`, `TypeGuard`) from a type's structure. Each derive generates a plain-object instance in a companion namespace (`User.Eq`, `User.Clone`, ...), with the field logic inlined. `Clone` is field-wise, like Rust's `#[derive(Clone)]`: arrays and nested objects are copied, not shared. For a type you can't annotate (one from a library), `derived<Clone<Feature>>()` from `typesugar` generates the same instance.

## Installation

```bash
npm install @typesugar/derive
```

## Quick Start

```typescript
import { derive, Eq, Ord, Clone, Debug } from "@typesugar/derive";

@derive(Eq, Ord, Clone, Debug)
interface User {
  id: number;
  name: string;
}

const alice: User = { id: 1, name: "Alice" };
const bob: User = { id: 2, name: "Bob" };

User.Eq.equals(alice, bob); // false
User.Ord.compare(alice, bob); // -1 (fields compared in order)
User.Clone.clone(alice); // { id: 1, name: "Alice" }, a new object
User.Debug.debug(alice); // 'User { id: 1, name: "Alice" }'
```

`@derive(Eq)` generates:

```typescript
namespace User {
  export const Eq = {
    equals: (a: User, b: User): boolean => a.id === b.id && a.name === b.name,
    notEquals: (a: User, b: User): boolean => !(a.id === b.id && a.name === b.name),
  };
}
```

Operators and methods are opt-in per file through `@typesugar/std`'s activation imports:

```typescript
import "@typesugar/std/syntax/eq/ops"; // alice === bob  → User.Eq.equals(alice, bob)
import "@typesugar/std/syntax/ord/ops"; // alice < bob   → User.Ord.lessThan(alice, bob)
import "@typesugar/std/syntax/clone"; // alice.clone() → User.Clone.clone(alice)
import "@typesugar/std/syntax/debug"; // alice.debug() → User.Debug.debug(alice)
```

Without them, `alice === bob` is an ordinary reference comparison.

## Documentation

- [Derive Macros guide](https://typesugar.org/guides/derive) — full feature reference
- [Typeclasses guide](https://typesugar.org/guides/typeclasses) — how derivation resolves instances
- [JSDoc vs decorator syntax](https://typesugar.org/guides/jsdoc-vs-decorators)
