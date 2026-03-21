//! reflect & typeInfo
//! Compile-time reflection — types become runtime values

import { reflect, typeInfo, fieldNames } from "typesugar";

// Three distinct macros, each with a different level of detail:
// - fieldNames<T>() → string[]         (just the names)
// - typeInfo<T>()   → { fields, kind } (names + types + structure)
// - reflect<T>()    → full metadata    (everything, for frameworks)

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

// 3. reflect — full metadata for form/ORM generation
class Product {
  id!: number;
  name!: string;
  price!: number;
  inStock!: boolean;
}

const meta = reflect<Product>();
console.log("\nProduct metadata:", meta);

// Practical: auto-generate form labels from field names
const labels = fieldNames<Product>().map(f =>
  f.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())
);
console.log("Form labels:", labels);

// Try: add a "role" field to User and watch the SELECT query update
