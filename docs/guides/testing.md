# Testing Macros

Compile-time testing superpowers: power assertions with sub-expression capture, compile-time assertions that fail the build, parameterized tests, snapshot testing with source capture, and property-based testing.

`@typesugar/testing` provides these features as macros that expand at compile time, so most of them carry zero runtime cost beyond the assertion itself.

## Quick Start

```bash
npm install @typesugar/testing
# or
pnpm add @typesugar/testing
```

```typescript
import {
  assert, // Power assertions with sub-expression capture
  staticAssert, // Compile-time assertions (fail BUILD, not test)
  typeAssert, // Type-level assertions
  type Equal, // Type equality check
  type Extends, // Type extends check
} from "@typesugar/testing";

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
import { assert } from "@typesugar/testing";

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
import { staticAssert } from "@typesugar/testing";

staticAssert(3 + 4 === 7, "basic math must work");
staticAssert(SUPPORTED_LOCALES.length > 0, "must have locales");

// If false: BUILD FAILS with the message
// If true: No runtime cost (expands to void 0)
```

### typeAssert() — Type-Level Assertions

Verify type relationships at compile time. The build fails if the type doesn't match.

```typescript
import { typeAssert, Equal, Extends } from "@typesugar/testing";

typeAssert<Equal<1 + 1, 2>>();
typeAssert<Extends<"hello", string>>();
typeAssert<Equal<ReturnType<typeof parse>, AST>>();
```

### @testCases() — Parameterized Tests

Expand one test function into multiple cases.

```typescript
import { testCases } from "@typesugar/testing";

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

Snapshot testing with compile-time source capture. The snapshot label is derived from the source location and the expression being snapshotted.

```typescript
import { assertSnapshot } from "@typesugar/testing";

assertSnapshot(formatUser(testUser));
// Label: "file.ts:42 — formatUser(testUser)"

assertSnapshot(renderComponent(props), "dark mode");
// Label: "file.ts:45 — renderComponent(props) [dark mode]"
```

### forAll() — Property-Based Testing

Test properties with auto-generated values. Combine with `@derive(Arbitrary)` from `@typesugar/derive` to generate inputs for your own types.

```typescript
import { forAll } from "@typesugar/testing";
import { derive } from "@typesugar/derive";

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

These type-level helpers compose with `typeAssert` to express type relationships.

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
} from "@typesugar/testing";

// Use with typeAssert
typeAssert<Equal<A, B>>();
typeAssert<Extends<Child, Parent>>();
typeAssert<Not<IsAny<T>>>();
typeAssert<And<Extends<A, B>, Extends<B, C>>>();
```

## Vitest Integration

To use `@typesugar/testing` macros in your vitest tests, add the typesugar transformer plugin to your `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [typesugar()],
  test: {
    // your test config
  },
});
```

Then import and use the macros in your test files:

```typescript
import { describe, it } from "vitest";
import { assert, typeAssert, type Equal } from "@typesugar/testing";

describe("my tests", () => {
  it("uses power assertions", () => {
    assert(result.status === "success");
  });

  it("verifies types", () => {
    typeAssert<Equal<typeof result, MyType>>();
  });
});
```

## Examples

See the [`examples/`](https://github.com/typesugar/typesugar/tree/main/packages/testing/examples) directory for real-world patterns:

- **basic.ts** — Core testing patterns from dogfooding typesugar's own test suite

## API Reference

### Assertions

- `assert(condition, message?)` — Assert with sub-expression capture
- `staticAssert(condition, message?)` — Compile-time assertion
- `typeAssert<T extends true>()` — Type-level assertion
- `assertSnapshot(value, name?)` — Snapshot with source capture

#### Deprecated Aliases

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

## Learn More

- [API Reference](/reference/packages#testing)
