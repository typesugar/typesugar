# @typesugar/testing

> 📖 **Full documentation:** [Testing guide](https://typesugar.org/guides/testing). The microsite is the canonical reference; this README is a quickstart.

Compile-time testing macros — power assertions with sub-expression capture, compile-time assertions, parameterized tests, snapshot testing, and property-based testing.

## Installation

```bash
npm install @typesugar/testing
```

## Quick Start

```typescript
import { assert, staticAssert, typeAssert, type Equal } from "@typesugar/testing";

// Power assertion — captures sub-expression values on failure
assert(users.length === expected.length);

// Compile-time assertion — fails the BUILD, not the test
staticAssert(CONFIG.TIMEOUT > 0, "timeout must be positive");

// Type assertion — verifies types at compile time
typeAssert<Equal<ReturnType<typeof parse>, AST>>();
```

## Notes

- Expanded code imports small runtime helpers (`__powerAssertFail`, `__assertTypeCheck`,
  `__seededRandom`, `createMockObject`) from `@typesugar/testing`, so the package must be
  resolvable at test runtime — install it where your tests run, not only where they compile.
- `mock<T>()` / `@mock` expand to `createMockObject<T>([...method names])`; you can call
  `createMockObject` directly when the transformer is not configured.
- `assertSnapshot(expr)` keys snapshots by project-relative file path and expression text (no
  line number), so adding lines above a snapshot does not orphan it.

## Documentation

- [Testing guide](https://typesugar.org/guides/testing) — full reference
- [API Reference](https://typesugar.org/reference/packages#testing)
