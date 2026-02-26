/**
 * @typesugar/testing Showcase
 *
 * Self-documenting examples of compile-time testing superpowers for TypeScript.
 *
 * Type assertions used:
 *   typeAssert<Equal<A, B>>()        - A and B are the same type
 *   typeAssert<Extends<A, B>>()      - A is assignable to B
 *   typeAssert<Not<Equal<A, B>>>()   - A and B are DIFFERENT
 *   typeAssert<Not<Extends<A, B>>>() - A is NOT assignable to B
 *
 * Run:   typesugar run examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import {
  assert,
  staticAssert,
  typeAssert,
  assertType,
  typeInfo,
  forAll,
  type Equal,
  type Extends,
  type Not,
  type IsNever,
  type IsAny,
  type IsUnknown,
  // Not used in standalone showcase (require test framework):
  // - assertSnapshot: needs vitest/jest `expect` global
  // - testCases: decorator for test files, shown in comments only
} from "@typesugar/testing";

// ============================================================================
// 1. POWER ASSERTIONS — Sub-expression capture on failure
// ============================================================================

// assert() is the primary runtime assertion. It captures every sub-expression
// when the assertion fails, producing a diagram like:
//
//   Power Assert Failed
//
//     users.length === filtered.length
//
//   Sub-expressions:
//     users.length === filtered.length → false
//     users.length → 3
//     filtered.length → 2

const users = ["alice", "bob", "charlie"];
const active = ["alice", "charlie"];

assert(users.length > active.length);
assert(users[0] === "alice");
assert(active.includes("alice"));

// With a custom message
assert(users.length >= 1, "must have at least one user");

// Object property assertions
const config = { host: "localhost", port: 3000, debug: true };
assert(config.port > 0);
assert(config.host !== "");
assert(config.debug === true);

// ============================================================================
// 2. TYPE ASSERTIONS — Compile-time type relationship checks
// ============================================================================

// typeAssert<>() checks type relationships at compile time.
// If the type argument doesn't resolve to `true`, the BUILD fails.

// Exact equality
type UserId = number;
typeAssert<Equal<UserId, number>>();

// Subtype relationship
interface Animal { name: string }
interface Dog extends Animal { breed: string }
typeAssert<Extends<Dog, Animal>>();

// Negative assertions
typeAssert<Not<Equal<string, number>>>();
typeAssert<Not<Extends<Animal, Dog>>>();

// Special type checks
typeAssert<IsNever<never>>();
typeAssert<Not<IsAny<string>>>();
typeAssert<IsUnknown<unknown>>();

// Return type checking
const add = (a: number, b: number): number => a + b;
typeAssert<Equal<ReturnType<typeof add>, number>>();

// Generic result types
const items = [1, 2, 3].map(x => x.toString());
typeAssert<Equal<typeof items, string[]>>();

// ============================================================================
// 3. COMPILE-TIME ASSERTIONS — Fail the build, not the test
// ============================================================================

// staticAssert() evaluates at compile time. If the condition is false,
// the BUILD fails immediately. No runtime cost — expands to `void 0`.

staticAssert(1 + 1 === 2, "basic math must work");
staticAssert(10 > 5, "comparison sanity check");

// Useful for configuration validation
const MAX_RETRIES = 3 as const;
const TIMEOUT_MS = 5000 as const;
staticAssert(MAX_RETRIES > 0, "retries must be positive");
staticAssert(TIMEOUT_MS <= 30000, "timeout must be reasonable");

// ============================================================================
// 4. RUNTIME TYPE ASSERTIONS — Detailed field-level diagnostics
// ============================================================================

// assertType<T>(value) validates that a runtime value matches a type.
// Uses compile-time type info for field-level error messages:
//
//   Type assertion failed for 'User':
//     - Field 'id': expected number, got string
//     - Field 'name': missing (required)

interface User {
  id: number;
  name: string;
  email?: string;
}

const validUser: unknown = { id: 1, name: "Alice" };
assertType<User>(validUser);

const fullUser: unknown = { id: 2, name: "Bob", email: "bob@example.com" };
assertType<User>(fullUser);

// With custom message prefix
assertType<User>(validUser, "API response validation");

// ============================================================================
// 5. TYPE INFO — Compile-time type reflection
// ============================================================================

// typeInfo<T>() extracts structural type information at compile time.
// Returns a TypeInfo object with name, kind, and fields.

interface Product {
  sku: string;
  price: number;
  inStock: boolean;
  description?: string;
}

const productInfo = typeInfo<Product>();
assert(productInfo.name === "Product");
assert(productInfo.kind === "interface");
assert(productInfo.fields !== undefined);
assert(productInfo.fields!.length === 4);

// Check field metadata
const skuField = productInfo.fields!.find(f => f.name === "sku")!;
assert(skuField.type === "string");
assert(skuField.optional === false);

const descField = productInfo.fields!.find(f => f.name === "description")!;
assert(descField.optional === true);

// ============================================================================
// 6. SNAPSHOT TESTING — Source expression capture
// ============================================================================

// assertSnapshot() captures the source text of the expression at compile time.
// The snapshot label includes file location and expression text.
//
// Expands to:
//   expect(formatUser(user)).toMatchSnapshot("file.ts:42 — formatUser(user)")

function formatUser(u: User): string {
  return `${u.name} (#${u.id})`;
}

// Note: assertSnapshot requires a test framework (vitest/jest) to provide `expect`.
// In a test file, you would use:
//   assertSnapshot(formatUser({ id: 1, name: "Alice" }));
//   assertSnapshot(formatUser({ id: 2, name: "Bob" }), "admin user format");
//
// For standalone execution, we verify the function works:
assert(formatUser({ id: 1, name: "Alice" }) === "Alice (#1)");
assert(formatUser({ id: 2, name: "Bob" }) === "Bob (#2)");

// ============================================================================
// 7. PROPERTY-BASED TESTING — @derive(Arbitrary) + forAll()
// ============================================================================

// forAll() runs a property function over generated random values.
// Pair with @derive(Arbitrary) to auto-generate input data.
//
// @derive(Arbitrary)
// interface Point { x: number; y: number; }
// // Generates: arbitraryPoint(seed?) and arbitraryPointMany(count, seed?)

// Manual generator for this showcase
function arbitraryNumber(seed: number): number {
  const s = (seed * 1664525 + 1013904223) & 0xffffffff;
  return ((s >>> 0) / 0xffffffff) * 200 - 100;
}

// Basic property test (100 iterations by default)
forAll(arbitraryNumber, (n) => {
  assert(n >= -100 && n <= 100);
});

// With custom iteration count
forAll(arbitraryNumber, 500, (n) => {
  assert(isFinite(n));
});

// ============================================================================
// 8. PARAMETERIZED TESTS — @testCases decorator
// ============================================================================

// @testCases expands a single test function into multiple it() calls.
// Each element becomes a separate test with a descriptive name.
//
// @testCases([
//   { input: "",      expected: true },
//   { input: "hello", expected: false },
//   { input: "  ",    expected: true },
// ])
// function testIsBlank(input: string, expected: boolean) {
//   expect(isBlank(input)).toBe(expected);
// }
//
// Expands to:
//   it('testIsBlank (case #1: input="", expected=true)', () => { ... })
//   it('testIsBlank (case #2: input="hello", expected=false)', () => { ... })
//   it('testIsBlank (case #3: input="  ", expected=true)', () => { ... })

// ============================================================================
// 9. TYPE UTILITIES — Building blocks for typeAssert<>()
// ============================================================================

// The package re-exports type utilities from @typesugar/type-system:
//
//   Equal<A, B>      true if A and B are exactly the same type
//   Extends<A, B>    true if A is assignable to B
//   Not<T>           negation — true becomes false, false becomes true
//   And<A, B>        logical AND at the type level
//   Or<A, B>         logical OR at the type level
//   IsNever<T>       true if T is never
//   IsAny<T>         true if T is any
//   IsUnknown<T>     true if T is unknown

// Combining type utilities
typeAssert<Equal<
  Extract<"a" | "b" | "c", "a" | "c">,
  "a" | "c"
>>();

typeAssert<Not<Equal<
  { x: number },
  { x: string }
>>>();

// ============================================================================
// 10. REAL-WORLD PATTERNS — Combining macros effectively
// ============================================================================

// Pattern: Function contract testing
function divide(a: number, b: number): number {
  assert(b !== 0, "divisor cannot be zero");
  return a / b;
}

assert(divide(10, 2) === 5);
assert(divide(9, 3) === 3);
typeAssert<Equal<ReturnType<typeof divide>, number>>();

// Pattern: API response validation
interface ApiResponse<T> {
  data: T;
  status: number;
  timestamp: string;
}

type UserResponse = ApiResponse<User>;
typeAssert<Extends<UserResponse, { data: { id: number } }>>();
typeAssert<Extends<UserResponse, { status: number }>>();

// Pattern: Type-safe builder validation
interface BuilderConfig {
  host: string;
  port: number;
  ssl: boolean;
}

const builderResult: unknown = { host: "api.example.com", port: 443, ssl: true };
assertType<BuilderConfig>(builderResult);

const info = typeInfo<BuilderConfig>();
assert(info.fields!.every(f => !f.optional));
