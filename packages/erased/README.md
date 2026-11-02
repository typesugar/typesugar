# @typesugar/erased

> 📖 **Full documentation:** [Type Erasure guide](https://typesugar.org/guides/erased). The microsite is the canonical reference; this README is a quickstart.

> Status: experimental — API may change before 1.0.

Typeclass-based type erasure for heterogeneous collections — `dyn Trait` for TypeScript.

## Installation

```bash
npm install @typesugar/erased
```

## Quick Start

```typescript
import { showable, show, showAll } from "@typesugar/erased";

const items = [
  showable(42, (n) => `num:${n}`),
  showable("hello", (s) => `str:${s}`),
  showable(true, (b) => (b ? "yes" : "no")),
];

show(items[0]); // "num:42"
showAll(items); // ["num:42", "str:hello", "yes"]
```

## Documentation

- [Type Erasure guide](https://typesugar.org/guides/erased) — full reference
- [API Reference](https://typesugar.org/reference/packages#erased)
