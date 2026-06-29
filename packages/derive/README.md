# @typesugar/derive

> 📖 **Full documentation:** [Derive Macros guide](https://typesugar.org/guides/derive). The microsite is the canonical reference; this README is a quickstart.

Auto-derive typeclass instances (`Eq`, `Ord`, `Clone`, `Show`, `Debug`, `Json`, `Hash`) from a type's structure — inlined to zero-cost code. No runtime dictionaries.

## Installation

```bash
npm install @typesugar/derive
```

## Quick Start

```typescript
interface User {
  id: number;
  name: string;
}

const alice: User = { id: 1, name: "Alice" };
const bob: User = { id: 2, name: "Bob" };

alice === bob; // false — compiles to: alice.id === bob.id && alice.name === bob.name
alice < bob; // true  — lexicographic field comparison
alice.show(); // "User(id = 1, name = Alice)"
alice.clone(); // deep copy
```

Operators and methods are derived from the type structure and specialized at compile time.

## Documentation

- [Derive Macros guide](https://typesugar.org/guides/derive) — full feature reference
- [Typeclasses guide](https://typesugar.org/guides/typeclasses) — how derivation resolves instances
- [JSDoc vs decorator syntax](https://typesugar.org/guides/jsdoc-vs-decorators)
