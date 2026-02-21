/**
 * @typesugar/validate Showcase
 *
 * Self-documenting examples of schema validation macros and the
 * Schema typeclass for library-agnostic validation. Provides is<T>(),
 * assert<T>(), validate<T>() macros plus a Schema typeclass that
 * abstracts over Zod, Valibot, ArkType, and native validators.
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

import { assert, typeAssert, type Equal, type Extends, type Not } from "@typesugar/testing";

import {
  // Validation macros (compile-time, need transformer)
  // is,       // is<T>() — generates type guard
  // assert,   // assert<T>() — generates assertion
  // validate, // validate<T>() — generates validated result

  // Schema typeclass
  type Schema,
  type NativeSchema,
  type Validator,
  type ValidatorF,
  type AssertF,
  nativeSchema,

  // Derived operations (generic HKT)
  parseOrElse,
  parseMap,
  parseChain,
  parseAll,

  // Derived operations (native validators)
  nativeParseOrElse,
  nativeParseMap,
  nativeParseAll,

  // Schema constructors
  makeSchema,
  makeNativeSchema,

  // Error types
  type ValidationError,
} from "../src/index.js";

// ============================================================================
// 1. NATIVE VALIDATORS - Type Guards as Schema Instances
// ============================================================================

// Create type guard validators
const isNumber: Validator<number> = (value: unknown): value is number =>
  typeof value === "number" && !Number.isNaN(value);

const isString: Validator<string> = (value: unknown): value is string =>
  typeof value === "string";

const isPositive: Validator<number> = (value: unknown): value is number =>
  typeof value === "number" && value > 0;

// nativeSchema.parse validates and returns the value or throws
const num = nativeSchema.parse(isNumber, 42);
assert(num === 42);

const str = nativeSchema.parse(isString, "hello");
assert(str === "hello");

// Invalid input throws
let threw = false;
try {
  nativeSchema.parse(isNumber, "not a number");
} catch {
  threw = true;
}
assert(threw);

console.log("1. Native validators: type guard functions as schema instances");

// ============================================================================
// 2. SAFE PARSING - ValidatedNel Error Accumulation
// ============================================================================

// safeParse returns Valid or Invalid with accumulated errors
const validResult = nativeSchema.safeParse(isNumber, 42);
assert(validResult._tag === "Valid");
assert(validResult.value === 42);

const invalidResult = nativeSchema.safeParse(isNumber, "bad");
assert(invalidResult._tag === "Invalid");

// Errors carry path and message
if (invalidResult._tag === "Invalid") {
  const error: ValidationError = invalidResult.error.head;
  assert(error.path === "$");
  assert(typeof error.message === "string");
}

console.log("2. Safe parsing: ValidatedNel accumulates all errors");

// ============================================================================
// 3. DERIVED OPERATIONS (NATIVE) - Composable Validation Patterns
// ============================================================================

// parseOrElse — validate or return default
const orElse = nativeParseOrElse(nativeSchema);
assert(orElse(isNumber, 42, 0) === 42);
assert(orElse(isNumber, "bad", 0) === 0);

// parseMap — validate then transform
const pMap = nativeParseMap(nativeSchema);
const doubled = pMap(isNumber, 5, (n) => n * 2);
assert(doubled === 10);

// parseAll — validate array of values
const pAll = nativeParseAll(nativeSchema);
const nums = pAll(isNumber, [1, 2, 3]);
assert(nums.length === 3);
assert(nums[0] === 1);

// parseAll throws on first invalid
let allThrew = false;
try {
  pAll(isNumber, [1, "bad", 3]);
} catch {
  allThrew = true;
}
assert(allThrew);

console.log("3. Derived operations: parseOrElse, parseMap, parseAll for native validators");

// ============================================================================
// 4. SCHEMA TYPECLASS - Library-Agnostic Validation
// ============================================================================

// The Schema<F> typeclass abstracts over validation libraries.
// Any library that can parse unknown → A and safeParse unknown → ValidatedNel
// can be an instance.

// Create a custom Schema instance using makeNativeSchema
const customSchema = makeNativeSchema(
  (validator, data) => {
    if (validator(data)) return data;
    throw new Error("Custom validation failed");
  },
  (validator, data) => {
    if (validator(data)) {
      return { _tag: "Valid" as const, value: data };
    }
    return {
      _tag: "Invalid" as const,
      error: {
        head: { path: "$", message: "Custom validation failed" },
        tail: { _tag: "Nil" as const },
      },
    } as any;
  },
);

const customResult = customSchema.parse(isString, "works");
assert(customResult === "works");

console.log("4. Schema typeclass: library-agnostic validation interface");

// ============================================================================
// 5. COMPLEX VALIDATORS - Structured Data Validation
// ============================================================================

// Compose validators for complex types
interface User {
  name: string;
  age: number;
  email: string;
}

const isUser: Validator<User> = (value: unknown): value is User => {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.name === "string" &&
    typeof obj.age === "number" &&
    obj.age >= 0 &&
    typeof obj.email === "string" &&
    obj.email.includes("@")
  );
};

const validUser = nativeSchema.parse(isUser, {
  name: "Alice",
  age: 30,
  email: "alice@example.com",
});
assert(validUser.name === "Alice");
assert(validUser.age === 30);

// Invalid user
const badUserResult = nativeSchema.safeParse(isUser, {
  name: "Bob",
  age: -1,
  email: "not-an-email",
});
assert(badUserResult._tag === "Invalid");

// Array of users
const users = pAll(isUser, [
  { name: "Alice", age: 30, email: "alice@example.com" },
  { name: "Bob", age: 25, email: "bob@example.com" },
]);
assert(users.length === 2);

console.log("5. Complex validators: structured User data validation");

// ============================================================================
// 6. VALIDATION ERROR STRUCTURE
// ============================================================================

// ValidationError carries path and message for diagnostics
const err: ValidationError = {
  path: "user.address.zipCode",
  message: "Expected string, got number",
};
assert(err.path === "user.address.zipCode");
assert(err.message.includes("Expected"));

// Errors are useful for building detailed error reports
const errors: ValidationError[] = [
  { path: "name", message: "Required" },
  { path: "age", message: "Must be non-negative" },
  { path: "email", message: "Invalid format" },
];
assert(errors.length === 3);

// Build a formatted error report
const report = errors.map((e) => `${e.path}: ${e.message}`).join("; ");
assert(report.includes("name: Required"));
assert(report.includes("age: Must be non-negative"));

console.log("6. Validation errors: path + message for detailed diagnostics");

// ============================================================================
// 7. COMPILE-TIME MACROS (TRANSFORMER REQUIRED)
// ============================================================================

// These macros generate validators from TypeScript types at compile time:
//
// is<T>() — Generates a type guard function
//   const isUser = is<User>();
//   if (isUser(data)) { ... }
//
// assert<T>() — Generates an assertion function (throws on invalid)
//   const assertUser = assert<User>();
//   const user = assertUser(data);
//
// validate<T>() — Generates a ValidatedNel result
//   const validateUser = validate<User>();
//   const result = validateUser(data);
//   if (result._tag === "Valid") { ... }
//
// These are compile-time macros — they analyze the type T at build time
// and generate the validation logic. Without the transformer, calling
// them throws an error explaining the setup requirement.

console.log("7. Compile-time macros: is<T>(), assert<T>(), validate<T>() (need transformer)");

// ============================================================================
// 8. REAL-WORLD EXAMPLE - API Request Validation Pipeline
// ============================================================================

interface CreateOrderRequest {
  productId: string;
  quantity: number;
  customerId: string;
}

const isCreateOrderRequest: Validator<CreateOrderRequest> = (
  value: unknown,
): value is CreateOrderRequest => {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.productId === "string" &&
    obj.productId.length > 0 &&
    typeof obj.quantity === "number" &&
    obj.quantity > 0 &&
    Number.isInteger(obj.quantity) &&
    typeof obj.customerId === "string" &&
    obj.customerId.length > 0
  );
};

// Validate and transform in one pipeline
const processOrder = nativeParseMap(nativeSchema);
const orderSummary = processOrder(
  isCreateOrderRequest,
  { productId: "PROD-123", quantity: 3, customerId: "CUST-456" },
  (order) => `Order: ${order.quantity}x ${order.productId} for ${order.customerId}`,
);
assert(orderSummary.includes("PROD-123"));
assert(orderSummary.includes("3"));

// Validate with fallback
const safeOrder = nativeParseOrElse(nativeSchema);
const fallbackResult = safeOrder(
  isCreateOrderRequest,
  { bad: "data" },
  { productId: "DEFAULT", quantity: 1, customerId: "UNKNOWN" },
);
assert(fallbackResult.productId === "DEFAULT");

console.log("8. Real-world: API request validation with parse, map, fallback");

// ============================================================================
// SUMMARY
// ============================================================================

console.log("\n=== @typesugar/validate Showcase Complete ===");
console.log(`
Features demonstrated:
  1. Native validators (type guard functions)
  2. Safe parsing with ValidatedNel error accumulation
  3. Derived operations (parseOrElse, parseMap, parseAll)
  4. Schema typeclass (library-agnostic validation)
  5. Complex validators (structured data)
  6. ValidationError structure (path + message)
  7. Compile-time macros (is<T>(), assert<T>(), validate<T>())
  8. Real-world API request validation pipeline

Zero-cost philosophy:
  Schema<F> + specialize() compiles to direct library calls.
  Generic validation code has zero overhead after specialization.
`);
