//! Schema Validation
//! is<T>() and assert<T>() generate type guards from types at compile time

import { is, assert } from "@typesugar/validate";
import { comptime, staticAssert } from "typesugar";

// @typesugar/validate reads your TypeScript types at compile time
// and generates runtime validators — no manual schema definitions!

interface User {
  id: number;
  name: string;
  email: string;
  active: boolean;
}

// 👀 Check JS Output — is<User>() becomes a function that checks
// typeof id === "number" && typeof name === "string" && ...
const isUser = is<User>();

const testData = comptime(() => [
  { id: 1, name: "Alice", email: "alice@co.com", active: true },
  { id: 2, name: "Bob", email: "bob@co.com", active: false },
  { id: 3, name: "Bad", extra: true },  // invalid — missing fields
]);
staticAssert(testData.length === 3);

// Validate each record against the generated type guard
for (const item of testData) {
  console.log(`${JSON.stringify(item)}: valid=${isUser(item)}`);
}

// assert<T>() throws on invalid data — great for API boundaries
const assertUser = assert<User>();
try {
  const user = assertUser(testData[0]);
  console.log("\nAsserted user:", user.name, user.email);
} catch (e) {
  console.log("Assertion failed:", (e as Error).message);
}

// Try: add an "age" field to User and watch the validator update automatically
