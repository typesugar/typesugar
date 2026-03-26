//! reflect & typeInfo
//! Compile-time reflection — types become runtime values

import { typeInfo, fieldNames } from "typesugar";

// Two compile-time reflection macros with different detail levels:
// - fieldNames<T>() → string[]         (just the names)
// - typeInfo<T>()   → { fields, kind } (names + types + structure)

interface User {
  id: number;
  name: string;
  email: string;
  role: "admin" | "user";
}

// 1. fieldNames — auto-generate SQL column lists
// 👀 Compiles to: ["id", "name", "email", "role"]
const cols = fieldNames<User>();
console.log(`SELECT ${cols.join(", ")} FROM users;`);

// 2. typeInfo — schema display with type details
// 👀 Compiles to: { name: "User", kind: "interface", fields: [...] }
const schema = typeInfo<User>();
console.log("\nSchema:", schema.name);
for (const f of schema.fields ?? []) {
  console.log(`  ${f.name}: ${f.type}`);
}

// 3. typeInfo on a class — same macro, different shape
class Product {
  id!: number;
  name!: string;
  price!: number;
  inStock!: boolean;
}

const meta = typeInfo<Product>();
console.log("\nProduct metadata:", meta);

// Practical: auto-generate form labels from field names
const labels = fieldNames<Product>().map(f =>
  f.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())
);
console.log("Form labels:", labels);

// Try: add a "role" field to Product and watch the form labels update
