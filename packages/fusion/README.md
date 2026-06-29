# @typesugar/fusion

> 📖 **Full documentation:** [Loop Fusion guide](https://typesugar.org/guides/fusion). The microsite is the canonical reference; this README is a quickstart.

Expression templates and loop fusion for TypeScript — iterator chains like `.filter().map().reduce()` execute in a single pass with no intermediate arrays.

> **Current Status:** Runtime fusion via `LazyPipeline` class. Single-pass iteration with no intermediate arrays is achieved, but the pipeline object itself exists at runtime. Phase 2 will add compile-time macro analysis to eliminate the pipeline class entirely.

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
