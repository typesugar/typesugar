# @typesugar/contracts-refined

> 📖 **Full documentation:** [Refined Contracts guide](https://typesugar.org/guides/contracts-refined). The microsite is the canonical reference; this README is a quickstart.

Bridges `@typesugar/type-system` refinement types with `@typesugar/contracts` compile-time verification.

## Installation

```bash
npm install @typesugar/contracts-refined
```

## Quick Start

```typescript
// In your entry point, import once to enable refined predicates for the prover:
import "@typesugar/contracts-refined";

import { Positive } from "@typesugar/type-system";
import { contract } from "@typesugar/contracts";

@contract
function add(a: Positive, b: Positive): number {
  requires: { a > 0 && b > 0 } // Proven by type, eliminated at compile-time
  ensures: { result > 0 }      // Also provable
  return a + b;
}
```

## Documentation

- [Refined Contracts guide](https://typesugar.org/guides/contracts-refined) — full reference
- [Design by Contract guide](https://typesugar.org/guides/contracts) — the `@contract` system
