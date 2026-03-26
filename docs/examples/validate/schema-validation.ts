//! Schema Validation
//! comptime() + typeInfo() generate validators from types at compile time

import { comptime, staticAssert, typeInfo } from "typesugar";

// Use typeInfo() to introspect types at compile time,
// then build validators from the generated metadata.

interface User {
  id: number;
  name: string;
  email: string;
  active: boolean;
}

// 👀 Check JS Output — typeInfo<User>() becomes a literal object
const userSchema = typeInfo<User>();
console.log("Schema:", userSchema.name, "—", userSchema.fields?.length, "fields");

// Build a validator from the compile-time schema
function makeValidator(schema: { fields?: Array<{ name: string; type: string }> }) {
  return (obj: unknown): boolean => {
    if (typeof obj !== "object" || obj === null) return false;
    for (const f of schema.fields ?? []) {
      if (f.type === "number" && typeof (obj as any)[f.name] !== "number") return false;
      if (f.type === "string" && typeof (obj as any)[f.name] !== "string") return false;
      if (f.type === "boolean" && typeof (obj as any)[f.name] !== "boolean") return false;
    }
    return true;
  };
}

const isUser = makeValidator(userSchema);

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

// Show the field types from compile-time reflection
for (const f of userSchema.fields ?? []) {
  console.log(`  ${f.name}: ${f.type}`);
}

// Try: add an "age" field to User and watch the validator update automatically
