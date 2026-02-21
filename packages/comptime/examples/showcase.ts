/**
 * @typesugar/comptime Showcase
 *
 * Self-documenting examples of compile-time evaluation, sandbox safety,
 * and value serialization.
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

import { comptime, jsToComptimeValue } from "../src/index.js";

// ============================================================================
// 1. COMPTIME BASICS - Evaluate at Compile Time
// ============================================================================

// comptime(() => expr) evaluates the arrow function body during compilation
// and replaces the call with the resulting literal. Without the transformer,
// the runtime placeholder throws — so we test the supporting infrastructure.

// Verify comptime is a function with the expected signature
typeAssert<Equal<typeof comptime, {
  <T>(expr: () => T): T;
  <T>(expr: T): T;
}>>();

// The runtime placeholder should throw (transformer not active in tests)
let threwAtRuntime = false;
try {
  comptime(() => 42);
} catch (e) {
  threwAtRuntime = true;
  assert(
    (e as Error).message.includes("called at runtime"),
    "error message explains transformer is needed"
  );
}
assert(threwAtRuntime, "comptime() throws when transformer is not configured");

// ============================================================================
// 2. JS-TO-COMPTIME-VALUE - Primitive Serialization
// ============================================================================

// jsToComptimeValue converts JS values to the internal ComptimeValue AST
// representation, used by the macro to embed results in compiled output.

const numVal = jsToComptimeValue(42);
assert(numVal.kind === "number" && numVal.value === 42, "number → ComptimeValue");

const strVal = jsToComptimeValue("hello");
assert(strVal.kind === "string" && strVal.value === "hello", "string → ComptimeValue");

const boolVal = jsToComptimeValue(true);
assert(boolVal.kind === "boolean" && boolVal.value === true, "boolean → ComptimeValue");

const nullVal = jsToComptimeValue(null);
assert(nullVal.kind === "null", "null → ComptimeValue");

const undefVal = jsToComptimeValue(undefined);
assert(undefVal.kind === "undefined", "undefined → ComptimeValue");

// ============================================================================
// 3. JS-TO-COMPTIME-VALUE - BigInt Support
// ============================================================================

const bigintVal = jsToComptimeValue(BigInt(9007199254740993));
assert(bigintVal.kind === "bigint", "bigint → ComptimeValue");
if (bigintVal.kind === "bigint") {
  assert(bigintVal.value === 9007199254740993n, "bigint value preserved");
}

// ============================================================================
// 4. JS-TO-COMPTIME-VALUE - Arrays
// ============================================================================

const arrVal = jsToComptimeValue([1, "two", true, null]);
assert(arrVal.kind === "array", "array → ComptimeValue");
if (arrVal.kind === "array") {
  assert(arrVal.elements.length === 4, "array preserves length");
  assert(arrVal.elements[0].kind === "number", "array element 0 is number");
  assert(arrVal.elements[1].kind === "string", "array element 1 is string");
  assert(arrVal.elements[2].kind === "boolean", "array element 2 is boolean");
  assert(arrVal.elements[3].kind === "null", "array element 3 is null");
}

// Nested arrays
const nestedArr = jsToComptimeValue([[1, 2], [3, 4]]);
assert(nestedArr.kind === "array", "nested array → ComptimeValue");
if (nestedArr.kind === "array") {
  assert(nestedArr.elements[0].kind === "array", "nested array element is array");
}

// Empty array
const emptyArr = jsToComptimeValue([]);
assert(emptyArr.kind === "array", "empty array → ComptimeValue");
if (emptyArr.kind === "array") {
  assert(emptyArr.elements.length === 0, "empty array has no elements");
}

// ============================================================================
// 5. JS-TO-COMPTIME-VALUE - Objects
// ============================================================================

const objVal = jsToComptimeValue({ name: "Alice", age: 30, active: true });
assert(objVal.kind === "object", "object → ComptimeValue");
if (objVal.kind === "object") {
  assert(objVal.properties.get("name")?.kind === "string", "object string field");
  assert(objVal.properties.get("age")?.kind === "number", "object number field");
  assert(objVal.properties.get("active")?.kind === "boolean", "object boolean field");
}

// Nested objects
const nestedObj = jsToComptimeValue({
  user: { name: "Bob" },
  scores: [95, 87, 92],
});
assert(nestedObj.kind === "object", "nested object → ComptimeValue");
if (nestedObj.kind === "object") {
  assert(nestedObj.properties.get("user")?.kind === "object", "nested object field");
  assert(nestedObj.properties.get("scores")?.kind === "array", "nested array field");
}

// ============================================================================
// 6. JS-TO-COMPTIME-VALUE - Circular Reference Detection
// ============================================================================

const circular: Record<string, unknown> = { name: "loop" };
circular.self = circular;

const circularResult = jsToComptimeValue(circular);
assert(circularResult.kind === "object", "circular object starts as object");
if (circularResult.kind === "object") {
  const selfRef = circularResult.properties.get("self");
  assert(selfRef?.kind === "error", "circular reference detected as error");
  if (selfRef?.kind === "error") {
    assert(
      selfRef.message.includes("Circular reference"),
      "error message mentions circular reference"
    );
  }
}

// Circular array
const circularArr: unknown[] = [1, 2];
circularArr.push(circularArr);

const circularArrResult = jsToComptimeValue(circularArr);
assert(circularArrResult.kind === "array", "circular array starts as array");
if (circularArrResult.kind === "array") {
  assert(circularArrResult.elements[2]?.kind === "error", "circular array ref detected");
}

// ============================================================================
// 7. JS-TO-COMPTIME-VALUE - Unsupported Types
// ============================================================================

const fnVal = jsToComptimeValue(() => 42);
assert(fnVal.kind === "error", "function → error ComptimeValue");
if (fnVal.kind === "error") {
  assert(fnVal.message.includes("function"), "error mentions function type");
}

const symVal = jsToComptimeValue(Symbol("test"));
assert(symVal.kind === "error", "symbol → error ComptimeValue");
if (symVal.kind === "error") {
  assert(symVal.message.includes("symbol"), "error mentions symbol type");
}

// ============================================================================
// 8. REAL-WORLD EXAMPLE - Compile-Time Lookup Tables
// ============================================================================

// In practice, comptime() is used to precompute data structures that would
// otherwise be built at startup. Here we show the pattern:

// This is what comptime(() => { ... }) produces after compilation:
// The arrow function runs at compile time, and the result is embedded.

const FIBONACCI_TABLE = [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181];

assert(FIBONACCI_TABLE[0] === 0, "fib(0) = 0");
assert(FIBONACCI_TABLE[10] === 55, "fib(10) = 55");
assert(FIBONACCI_TABLE[19] === 4181, "fib(19) = 4181");
assert(FIBONACCI_TABLE.length === 20, "precomputed 20 fibonacci numbers");

// Verify the serializer can handle the table
const tableVal = jsToComptimeValue(FIBONACCI_TABLE);
assert(tableVal.kind === "array", "fibonacci table serializes as array");
if (tableVal.kind === "array") {
  assert(tableVal.elements.length === 20, "all 20 elements serialized");
  assert(
    tableVal.elements.every((e) => e.kind === "number"),
    "all elements are numbers"
  );
}

// Build-time config pattern
const BUILD_CONFIG = {
  version: "2.1.0",
  features: ["auth", "cache", "metrics"],
  limits: { maxRetries: 3, timeoutMs: 5000 },
};

const configVal = jsToComptimeValue(BUILD_CONFIG);
assert(configVal.kind === "object", "build config serializes as object");
if (configVal.kind === "object") {
  const features = configVal.properties.get("features");
  assert(features?.kind === "array", "features field is array");
  const limits = configVal.properties.get("limits");
  assert(limits?.kind === "object", "nested config is object");
}
