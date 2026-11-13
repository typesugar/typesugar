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
- Macros inside `assert(...)` (`summon<…>()`, `extend(x).m()`, extension methods, operators)
  expand before the assertion is instrumented, so they work as they do anywhere else.
- `mock<T>(defaults?)` / `@mock` expand to `createMockObject<T>([...method names], defaults?)`; you
  can call `createMockObject` directly when the transformer is not configured. Function members of
  `defaults` become each method's persistent implementation (like `mockImplementation`, so
  `mockReset()` clears them); other members are copied onto the mock as plain properties.
  `defaults` is typed `Partial<T>`, so a wrong key or signature is a compile error.

  ```typescript
  const repo = mock<UserRepo>({ get: async (id) => ({ id }) });
  await repo.get("1"); // { id: "1" }, and repo._calls.get is [["1"]]
  repo.get.mockReturnValue(other); // overrides the default
  ```

- `assertSnapshot(expr)` keys snapshots by project-relative file path and expression text (no
  line number), so adding lines above a snapshot does not orphan it.

## Documentation

- [Testing guide](https://typesugar.org/guides/testing) — full reference
- [API Reference](https://typesugar.org/reference/packages#testing)
