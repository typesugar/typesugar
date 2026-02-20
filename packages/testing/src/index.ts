/**
 * @typesugar/testing — Compile-time testing superpowers for TypeScript
 *
 * Import from "@typesugar/testing" to use these macros in your test files.
 * The transformer will expand them at compile time.
 *
 * @example
 * ```typescript
 * import {
 *   assert,
 *   staticAssert,
 *   assertSnapshot,
 *   typeAssert,
 *   assertType,
 *   typeInfo,
 *   forAll,
 *   type Equal,
 *   type Extends,
 * } from "@typesugar/testing";
 *
 * // Power assertions — sub-expression capture on failure
 * assert(users.length === activeIds.filter(id => id > 0).length);
 *
 * // Compile-time assertions — fail the BUILD, not the test
 * staticAssert(3 + 4 === 7, "basic math must work");
 *
 * // Snapshot testing with source capture
 * assertSnapshot(formatUser(testUser));
 *
 * // Type-level assertions
 * typeAssert<Equal<ReturnType<typeof parse>, AST>>();
 *
 * // Runtime type assertions with detailed field-level diagnostics
 * assertType<User>(data);  // Throws with field-by-field error details
 *
 * // Compile-time type reflection
 * const info = typeInfo<User>();  // { name: "User", fields: [...] }
 *
 * // Property-based testing with @derive(Arbitrary)
 * forAll(arbitraryUser, (user) => {
 *   expect(deserialize(serialize(user))).toEqual(user);
 * });
 * ```
 *
 * For parameterized tests, use the @testCases decorator:
 * ```typescript
 * import { testCases } from "@typesugar/testing";
 *
 * @testCases([
 *   { input: "", expected: true },
 *   { input: "hello", expected: false },
 * ])
 * function testIsBlank(input: string, expected: boolean) {
 *   expect(isBlank(input)).toBe(expected);
 * }
 * ```
 *
 * For property-based testing, use @derive(Arbitrary):
 * ```typescript
 * import { derive } from "typesugar";
 *
 * @derive(Arbitrary)
 * interface User {
 *   name: string;
 *   age: number;
 *   active: boolean;
 * }
 * // Generates: arbitraryUser(seed?) and arbitraryUserMany(count, seed?)
 * ```
 *
 * @packageDocumentation
 */

// Declare global `expect` for runtime fallback (provided by vitest/jest)
declare const expect: any;

// Re-export type utilities from canonical location
export {
  type Equal,
  type Extends,
  type Not,
  type And,
  type Or,
  type IsNever,
  type IsAny,
  type IsUnknown,
  type Equals, // deprecated alias
} from "@typesugar/type-system";

// ============================================================================
// Type-Aware Assertion Diagnostics
// ============================================================================

/**
 * Type information structure used for enhanced assertion diagnostics.
 * Populated at compile time via the `typeInfo<T>()` macro.
 */
export interface TypeInfo {
  name: string;
  kind: "interface" | "class" | "type" | "enum" | "primitive" | "union" | "intersection" | "array" | "tuple" | "function";
  fields?: FieldInfo[];
  methods?: MethodInfo[];
  typeParameters?: string[];
}

export interface FieldInfo {
  name: string;
  type: string;
  optional: boolean;
  readonly: boolean;
}

export interface MethodInfo {
  name: string;
  parameters: ParameterInfo[];
  returnType: string;
  isAsync: boolean;
  isStatic: boolean;
}

export interface ParameterInfo {
  name: string;
  type: string;
  optional: boolean;
}

/**
 * Get compile-time type information for a type.
 *
 * This macro extracts structural type information at compile time,
 * enabling runtime validation with detailed field-level diagnostics.
 *
 * @example
 * ```typescript
 * interface User {
 *   id: number;
 *   name: string;
 *   email?: string;
 * }
 *
 * const info = typeInfo<User>();
 * // { name: "User", kind: "interface", fields: [
 * //   { name: "id", type: "number", optional: false, readonly: false },
 * //   { name: "name", type: "string", optional: false, readonly: false },
 * //   { name: "email", type: "string", optional: true, readonly: false }
 * // ]}
 * ```
 */
export function typeInfo<T>(): TypeInfo {
  // Placeholder — transformer replaces with actual type info
  throw new Error(
    "typeInfo() was called at runtime. " +
      "This indicates the typesugar transformer is not configured correctly."
  );
}

// ============================================================================
// Power Assertions
// ============================================================================

/**
 * Assert with sub-expression capture.
 *
 * On failure, prints a diagram showing the value of every sub-expression
 * in the assertion, similar to Rust's assert_eq!, Elixir's assert, and
 * Swift's #expect.
 *
 * @param condition - The boolean expression to assert
 * @param message - Optional failure message
 *
 * @example
 * ```typescript
 * assert(users.length === filtered.length);
 * // On failure:
 * //   Power Assert Failed
 * //
 * //   users.length === filtered.length
 * //
 * //   Sub-expressions:
 * //     users.length === filtered.length → false
 * //     users.length → 3
 * //     users → [{...}, {...}, {...}]
 * //     filtered.length → 2
 * //     filtered → [{...}, {...}]
 * ```
 */
export function assert(condition: boolean, message?: string): void {
  // Runtime fallback — the transformer replaces this with instrumented code
  if (!condition) {
    throw new Error(
      message ??
        "Power assertion failed (run with typesugar transformer for detailed output)",
    );
  }
}

/**
 * @deprecated Use `assert()` instead. This alias exists for backward compatibility.
 */
export const powerAssert = assert;

// ============================================================================
// Compile-Time Assertions
// ============================================================================

/**
 * Assert a condition at compile time.
 *
 * If the condition evaluates to false during compilation, the BUILD fails
 * with a clear error message. No runtime cost — expands to `void 0`.
 *
 * @param condition - A compile-time evaluable expression
 * @param message - Optional error message for build failure
 *
 * @example
 * ```typescript
 * staticAssert(3 + 4 === 7, "basic math");
 * staticAssert(SUPPORTED_LOCALES.length > 0, "must have locales");
 * ```
 */
export function staticAssert(_condition: boolean, _message?: string): void {
  // Placeholder — transformer evaluates at compile time
}

/**
 * @deprecated Use `staticAssert()` instead. This alias exists for backward compatibility.
 */
export const comptimeAssert = staticAssert;

// ============================================================================
// Parameterized Tests
// ============================================================================

/**
 * Expand a single test function into multiple parameterized test cases.
 *
 * Each element in the array becomes a separate `it()` test case with a
 * descriptive name showing the parameter values.
 *
 * @param cases - Array of test case objects whose keys match the function parameters
 *
 * @example
 * ```typescript
 * @testCases([
 *   { input: "", expected: true },
 *   { input: "hello", expected: false },
 *   { input: "  ", expected: true },
 * ])
 * function testIsBlank(input: string, expected: boolean) {
 *   expect(isBlank(input)).toBe(expected);
 * }
 * // Expands to:
 * // it('testIsBlank (case #1: input="", expected=true)', () => { ... })
 * // it('testIsBlank (case #2: input="hello", expected=false)', () => { ... })
 * // it('testIsBlank (case #3: input="  ", expected=true)', () => { ... })
 * ```
 */
export function testCases(
  _cases: Array<Record<string, unknown>>,
): MethodDecorator & ClassDecorator & PropertyDecorator {
  // Placeholder decorator — processed by transformer
  return (() => {}) as any;
}

// ============================================================================
// Snapshot Testing
// ============================================================================

/**
 * Snapshot testing with compile-time source expression capture.
 *
 * The macro captures the source text of the expression at compile time,
 * so the snapshot label includes both the file location and the expression
 * that produced the value.
 *
 * @param value - The value to snapshot
 * @param name - Optional snapshot name
 *
 * @example
 * ```typescript
 * assertSnapshot(formatUser(testUser));
 * // Expands to: expect(formatUser(testUser)).toMatchSnapshot("file.ts:42 — formatUser(testUser)")
 *
 * assertSnapshot(renderComponent(props), "dark mode");
 * // Expands to: expect(renderComponent(props)).toMatchSnapshot("file.ts:45 — renderComponent(props) [dark mode]")
 * ```
 */
export function assertSnapshot<T>(value: T, name?: string): void {
  // Runtime fallback — works with vitest/jest but without source capture
  const label = name ?? "snapshot";
  (expect as any)(value).toMatchSnapshot(label);
}

// ============================================================================
// Type Assertions
// ============================================================================

/**
 * Assert a type relationship at compile time.
 *
 * The type argument must resolve to the literal type `true`.
 * If it resolves to `false`, the build fails with a clear error.
 *
 * Use with `Equal<A, B>` and `Extends<A, B>` type utilities.
 *
 * @example
 * ```typescript
 * typeAssert<Equal<1 + 1, 2>>();                    // passes
 * typeAssert<Extends<"hello", string>>();            // passes
 * typeAssert<Equal<ReturnType<typeof fn>, number>>(); // passes if fn returns number
 * ```
 */
export function typeAssert<_T extends true>(): void {
  // Type-level only — no runtime effect
}

// ============================================================================
// Runtime Type Assertions with Detailed Diagnostics
// ============================================================================

/**
 * Assert that a value matches a type at runtime with detailed diagnostics.
 *
 * Uses compile-time type information from `typeInfo<T>()` to validate
 * the value's structure. On failure, provides field-level diagnostics
 * showing exactly what's wrong.
 *
 * @param value - The value to validate
 * @param message - Optional custom error message prefix
 *
 * @example
 * ```typescript
 * interface User {
 *   id: number;
 *   name: string;
 *   email?: string;
 * }
 *
 * // Passes silently if value matches User
 * assertType<User>({ id: 1, name: "Alice" });
 *
 * // Fails with detailed diagnostics:
 * // "Type assertion failed for 'User':
 * //   - Field 'id': expected number, got string
 * //   - Field 'name': missing (required)"
 * assertType<User>({ id: "not-a-number" });
 * ```
 */
export function assertType<T>(value: unknown, message?: string): asserts value is T {
  // Runtime fallback — transformer replaces with instrumented code
  // This basic implementation validates primitive types only
  if (typeof value !== "object" || value === null) {
    const msg = message
      ? `${message}: expected object, got ${value === null ? "null" : typeof value}`
      : `Type assertion failed: expected object, got ${value === null ? "null" : typeof value}`;
    throw new Error(msg);
  }
  // Note: Full field-level validation requires the transformer.
  // This fallback only checks that the value is a non-null object.
}

// ============================================================================
// Property-Based Testing
// ============================================================================

/**
 * Run a property-based test with auto-generated values.
 *
 * Pairs with `@derive(Arbitrary)` to generate random inputs and test
 * that a property holds for all of them.
 *
 * @param generator - A function that produces random values (from @derive(Arbitrary))
 * @param countOrProperty - Either the number of iterations or the property function
 * @param property - The property function (if count is provided)
 *
 * @example
 * ```typescript
 * // Basic usage (100 iterations by default)
 * forAll(arbitraryUser, (user) => {
 *   expect(deserialize(serialize(user))).toEqual(user);
 * });
 *
 * // With custom iteration count
 * forAll(arbitraryUser, 500, (user) => {
 *   expect(user.age).toBeGreaterThanOrEqual(0);
 * });
 * ```
 */
export function forAll<T>(
  generator: (seed: number) => T,
  countOrProperty: number | ((value: T) => void),
  property?: (value: T) => void,
): void {
  // Runtime fallback
  const count = typeof countOrProperty === "number" ? countOrProperty : 100;
  const prop =
    typeof countOrProperty === "function" ? countOrProperty : property!;

  for (let i = 0; i < count; i++) {
    const value = generator(i);
    try {
      prop(value);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Property failed after ${i + 1} tests.\n` +
          `Failing input: ${JSON.stringify(value)}\n` +
          `Error: ${err}`,
      );
    }
  }
}

// ============================================================================
// Macro Definitions (for tooling)
// ============================================================================

export {
  assertMacro,
  staticAssertMacro,
  comptimeAssertMacro,
  assertSnapshotMacro,
  typeAssertMacro,
  assertTypeMacro,
  typeInfoMacro,
  forAllMacro,
  testCasesAttribute,
  ArbitraryDerive,
  powerAssertMacro,
} from "./macro.js";
