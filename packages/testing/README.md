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

## Documentation

- [Testing guide](https://typesugar.org/guides/testing) — full reference
- [API Reference](https://typesugar.org/reference/packages#testing)
