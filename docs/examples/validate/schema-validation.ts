//! Schema Validation
//! Compile-time type guards from types — zero runtime schema definitions

import { comptime, staticAssert, pipe } from "typesugar";

// @typesugar/validate's is<T>() macro generates type guards at compile time.
// No manual schema definitions — the transformer reads the type and emits checks.

interface User {
  id: number;
  name: string;
  email: string;
  active: boolean;
}

// comptime() embeds validated test data at build time
const testData = comptime(() => [
  { id: 1, name: "Alice", email: "alice@co.com", active: true },
  { id: 2, name: "Bob", email: "bob@co.com", active: false },
]);

staticAssert(testData.length === 2, "need exactly 2 test users");
staticAssert(testData[0].name === "Alice", "first user is Alice");

// Manual validator matching what is<User>() would generate
function isUser(v: unknown): v is User {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "number" && typeof o.name === "string"
    && typeof o.email === "string" && typeof o.active === "boolean";
}

// 👀 Check JS Output — comptime() inlines the array, staticAssert vanishes
const valid = testData.filter(isUser);
const summary = pipe(valid, u => u.filter(u => u.active), a => a.map(u => u.name).join(", "));
console.log("valid:", valid.length, "active:", summary);  // valid: 2 active: Alice

// Try: add an "age" field to User and watch the validator need updating
