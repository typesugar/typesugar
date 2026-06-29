# @typesugar/type-system

> 📖 **Full documentation:** [Type System guide](https://typesugar.org/guides/type-system). The microsite is the canonical reference; this README is a quickstart.

Advanced type system extensions for TypeScript — refined types, newtypes, HKT, existentials, phantom types, effect tracking, and type-level arithmetic, all via compile-time macros.

## Installation

```bash
npm install @typesugar/type-system
```

## Quick Start

```typescript
import { type Newtype, wrap, unwrap, type Refined, refine } from "@typesugar/type-system";

// Zero-cost branding
type UserId = Newtype<number, "UserId">;
const id = wrap<UserId>(42);

// Compile-time validated refinements
type Port = Refined<number, "Port">;
const port = refine<Port>(8080); // ✓
const bad = refine<Port>(-1); // ✗ Compile error
```

## Documentation

- [Type System guide](https://typesugar.org/guides/type-system) — full reference
- [API Reference](https://typesugar.org/reference/packages#type-system)
