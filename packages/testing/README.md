# @ttfx/testing

> Compile-time testing macros — power assertions, property-based testing, and more.

## Overview

`@ttfx/testing` provides compile-time testing superpowers: power assertions with sub-expression capture, compile-time assertions that fail the build, parameterized tests, snapshot testing with source capture, and property-based testing.

## Installation

```bash
npm install @ttfx/testing
# or
pnpm add @ttfx/testing
```

## Quick Start

```typescript
import {
  assert, // Power assertions with sub-expression capture
  staticAssert, // Compile-time assertions (fail BUILD, not test)
  typeAssert, // Type-level assertions
  type Equal, // Type equality check
  type Extends, // Type extends check
} from "@ttfx/testing";

// Runtime assertion — captures sub-expression values on failure
assert(users.length === expected.length);

// Compile-time assertion — fails the BUILD if false
staticAssert(CONFIG.TIMEOUT > 0, "timeout must be positive");

// Type assertion — verifies types at compile time
typeAssert<Equal<ReturnType<typeof parse>, AST>>();
```

## Usage

### assert() — Power Assertions

On failure, shows the value of every sub-expression.

```typescript
import { assert } from "@ttfx/testing";

assert(users.length === filtered.length);

// On failure:
//   Power Assert Failed
//
//   users.length === filtered.length
//
//   Sub-expressions:
//     users.length === filtered.length → false
//     users.length → 3
//     users → [{...}, {...}, {...}]
//     filtered.length → 2
//     filtered → [{...}, {...}]
```

### staticAssert() — Compile-Time Assertions

Fail the BUILD, not the test. Zero runtime cost.

```typescript
import { staticAssert } from "@ttfx/testing";

staticAssert(3 + 4 === 7, "basic math must work");
staticAssert(SUPPORTED_LOCALES.length > 0, "must have locales");

// If false: BUILD FAILS with the message
// If true: No runtime cost (expands to void 0)
```

### typeAssert() — Type-Level Assertions

Verify type relationships at compile time.

```typescript
import { typeAssert, Equal, Extends } from "@ttfx/testing";

typeAssert<Equal<1 + 1, 2>>();
typeAssert<Extends<"hello", string>>();
typeAssert<Equal<ReturnType<typeof parse>, AST>>();

// Build fails if type doesn't match
```

### @testCases() — Parameterized Tests

Expand one test function into multiple cases.

```typescript
import { testCases } from "@ttfx/testing";

@testCases([
  { input: "", expected: true },
  { input: "hello", expected: false },
  { input: "  ", expected: true },
])
function testIsBlank(input: string, expected: boolean) {
  expect(isBlank(input)).toBe(expected);
}

// Expands to:
// it('testIsBlank (case #1: input="", expected=true)', ...)
// it('testIsBlank (case #2: input="hello", expected=false)', ...)
// it('testIsBlank (case #3: input="  ", expected=true)', ...)
```

### assertSnapshot() — Source-Capturing Snapshots

Snapshot testing with compile-time source capture.

```typescript
import { assertSnapshot } from "@ttfx/testing";

assertSnapshot(formatUser(testUser));
// Label: "file.ts:42 — formatUser(testUser)"

assertSnapshot(renderComponent(props), "dark mode");
// Label: "file.ts:45 — renderComponent(props) [dark mode]"
```

### forAll() — Property-Based Testing

Test properties with auto-generated values.

```typescript
import { forAll } from "@ttfx/testing";
import { derive } from "@ttfx/derive";

@derive(Arbitrary)
interface User {
  name: string;
  age: number;
  active: boolean;
}

// Test that serialization round-trips
forAll(arbitraryUser, (user) => {
  expect(deserialize(serialize(user))).toEqual(user);
});

// With custom iteration count
forAll(arbitraryUser, 500, (user) => {
  expect(user.age).toBeGreaterThanOrEqual(0);
});

// On failure:
//   Property failed after 42 tests.
//   Failing input: {"name":"...","age":-1,...}
//   Error: Expected age >= 0
```

## Type Utilities

```typescript
import {
  Equal, // Type equality
  Extends, // Subtype check
  Not, // Negation
  And, // Conjunction
  Or, // Disjunction
  IsNever, // Check for never
  IsAny, // Check for any
  IsUnknown, // Check for unknown
} from "@ttfx/testing";

// Use with typeAssert
typeAssert<Equal<A, B>>();
typeAssert<Extends<Child, Parent>>();
typeAssert<Not<IsAny<T>>>();
typeAssert<And<Extends<A, B>, Extends<B, C>>>();
```

## Examples

See the [`examples/`](./examples/) directory for real-world patterns:

- **basic.ts** — Core testing patterns from dogfooding ttfx's own test suite

## API Reference

### Assertions

- `assert(condition, message?)` — Assert with sub-expression capture
- `staticAssert(condition, message?)` — Compile-time assertion
- `typeAssert<T extends true>()` — Type-level assertion
- `assertSnapshot(value, name?)` — Snapshot with source capture

### Deprecated Aliases

- `powerAssert` — Use `assert()` instead
- `comptimeAssert` — Use `staticAssert()` instead

### Parameterized Testing

- `@testCases(cases)` — Expand to multiple test cases

### Property-Based Testing

- `forAll(generator, property)` — Test property with 100 iterations
- `forAll(generator, count, property)` — Test property with custom count

### Type Utilities

- `Equal<A, B>` — True if A and B are the same type
- `Extends<A, B>` — True if A extends B
- `Not<T>` — Negate a boolean type
- `And<A, B>` — Conjunction of boolean types
- `Or<A, B>` — Disjunction of boolean types
- `IsNever<T>` — True if T is never
- `IsAny<T>` — True if T is any
- `IsUnknown<T>` — True if T is unknown

## Vitest Integration

To use `@ttfx/testing` macros in your vitest tests, add the ttfx transformer plugin to your `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import typemacro from "@ttfx/integrations/vite";

export default defineConfig({
  plugins: [typemacro()],
  test: {
    // your test config
  },
});
```

Then import and use the macros in your test files:

```typescript
import { describe, it } from "vitest";
import { assert, typeAssert, type Equal } from "@ttfx/testing";

describe("my tests", () => {
  it("uses power assertions", () => {
    assert(result.status === "success");
  });

  it("verifies types", () => {
    typeAssert<Equal<typeof result, MyType>>();
  });
});
```

## License

MIT
