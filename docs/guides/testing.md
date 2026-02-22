# Testing Macros

Compile-time testing superpowers: power assertions with sub-expression capture, compile-time assertions, parameterized tests, and property-based testing.

## Quick Start

```bash
npm install @typesugar/testing
```

```typescript
import { assert, staticAssert, typeAssert, type Equal } from "@typesugar/testing";

// Power assertion — captures sub-expression values on failure
assert(users.length === expected.length);

// Compile-time assertion — fails BUILD, not test
staticAssert(CONFIG.TIMEOUT > 0, "timeout must be positive");

// Type assertion — verifies types at compile time
typeAssert<Equal<ReturnType<typeof parse>, AST>>();
```

## Features

### assert() — Power Assertions

On failure, shows the value of every sub-expression.

```typescript
assert(users.length === filtered.length);

// On failure:
//   Power Assert Failed
//
//   users.length === filtered.length
//
//   Sub-expressions:
//     users.length === filtered.length → false
//     users.length → 3
//     filtered.length → 2
```

### staticAssert() — Compile-Time Assertions

Fail the BUILD, not the test. Zero runtime cost.

```typescript
staticAssert(3 + 4 === 7, "basic math must work");

// If false: BUILD FAILS
// If true: No runtime cost (expands to void 0)
```

### typeAssert() — Type-Level Assertions

```typescript
typeAssert<Equal<1 + 1, 2>>();
typeAssert<Extends<"hello", string>>();
typeAssert<Equal<ReturnType<typeof parse>, AST>>();
```

### @testCases() — Parameterized Tests

```typescript
@testCases([
  { input: "", expected: true },
  { input: "hello", expected: false },
  { input: "  ", expected: true },
])
function testIsBlank(input: string, expected: boolean) {
  expect(isBlank(input)).toBe(expected);
}

// Expands to three separate test cases
```

### forAll() — Property-Based Testing

```typescript
@derive(Arbitrary)
interface User { name: string; age: number; }

forAll(arbitraryUser, (user) => {
  expect(deserialize(serialize(user))).toEqual(user);
});
```

## Vitest Integration

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [typesugar()],
});
```

## Learn More

- [API Reference](/reference/packages#testing)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/testing)
