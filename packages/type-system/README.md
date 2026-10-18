# @typesugar/type-system

> 📖 **Full documentation:** [Type System guide](https://typesugar.org/guides/type-system). The microsite is the canonical reference; this README is a quickstart.

Advanced type system extensions for TypeScript — refined types, newtypes, HKT, existentials, phantom types, effect tracking, and type-level arithmetic, all via compile-time macros.

## Installation

```bash
npm install @typesugar/type-system
```

## Quick Start

```typescript
import { type Newtype, wrap, unwrap, Port } from "@typesugar/type-system";
import type { Add, Lt } from "@typesugar/type-system";

// Zero-cost branding
type UserId = Newtype<number, "UserId">;
const id = wrap<UserId>(42);

// Validated refinements
const port = Port.refine(8080); // ✓  Refined<number, "Port">
const bad = Port.refine(-1); // ✗ throws at runtime

// Type-level arithmetic (evaluated by the transformer)
type Seven = Add<3, 4>; // 7
type Yes = Lt<1, 2>; // true
```

Every macro in this package (`wrap`, `packExists`, `@existential`, `@pure`,
`@effect("io")`, `Add`/`Mul`/`Lt`/..., etc.) is scoped to
`@typesugar/type-system`: it only fires when the name is imported from this
package, so a same-named function or type from another library is never
rewritten.

## Documentation

- [Type System guide](https://typesugar.org/guides/type-system) — full reference
- [API Reference](https://typesugar.org/reference/packages#type-system)
