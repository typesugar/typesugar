# @typesugar/fusion

> 📖 **Full documentation:** [Loop Fusion guide](https://typesugar.org/guides/fusion). The microsite is the canonical reference; this README is a quickstart.

Expression templates and loop fusion for TypeScript — iterator chains like `.filter().map().reduce()` execute in a single pass with no intermediate arrays.

> **Current Status:** Runtime fusion via `LazyPipeline` (single pass, no intermediate arrays; the pipeline object exists at runtime). With the typesugar transformer, `fused(chain)` additionally compiles a chain into one loop: array/tuple receivers (`map`/`filter` → `reduce`/`find`/`some`/`every`/`forEach`, with normal `(value, index, array)` callback arguments) and `lazy(iterable)` roots (all LazyPipeline-compatible `map`/`filter`/`take` → terminal steps, with LazyPipeline semantics). Any chain it cannot fuse without changing its meaning is left as-is; without the transformer `fused` is the identity.

## Installation

```bash
npm install @typesugar/fusion
```

## Quick Start

```typescript
import { lazy } from "@typesugar/fusion";

// 1 pass, 0 intermediate arrays
const result = lazy(users)
  .filter((u) => u.active)
  .map((u) => u.score * 2)
  .reduce((a, b) => a + b, 0);
```

## Documentation

- [Loop Fusion guide](https://typesugar.org/guides/fusion) — full reference
