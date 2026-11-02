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
import "@typesugar/contracts/syntax"; // turns on requires: / ensures: blocks

import { Positive } from "@typesugar/type-system";
import { contract } from "@typesugar/contracts";

@contract
function add(a: Positive, b: Positive): number {
  requires: { a > 0 && b > 0 }
  ensures: { result > 0 }
  return a + b;
}
```

With the default configuration, both conditions are emitted as runtime checks
(`throw new PreconditionError(...)` / `PostconditionError`). The refinement predicates
registered here are facts the contracts prover can use; see the
[Refined Contracts guide](https://typesugar.org/guides/contracts-refined) for when it can
remove a check it has proven.

## Documentation

- [Refined Contracts guide](https://typesugar.org/guides/contracts-refined) — full reference
- [Design by Contract guide](https://typesugar.org/guides/contracts) — the `@contract` system
