//! reflect & typeInfo
//! Compile-time reflection

import { reflect, typeInfo, fieldNames } from "typesugar";

// reflect(), typeInfo(), and fieldNames() extract type info at COMPILE TIME
// Check the JS Output - you'll see literal values, not runtime introspection!

interface User {
  id: number;
  name: string;
  email: string;
  age?: number;
}

// fieldNames<T>() extracts field names as string literals
// Compiles to: ["id", "name", "email", "age"]
const userFields = fieldNames<User>();
console.log("User fields:", userFields);

// typeInfo<T>() extracts detailed type information
// Compiles to a literal object with type metadata
const info = typeInfo<User>();
console.log("Type info:", JSON.stringify(info, null, 2));

// reflect<T>() creates runtime values from types
// Useful for validation, serialization, ORMs, etc.
class Product {
  id!: number;
  name!: string;
  price!: number;
  inStock!: boolean;
}

const productMeta = reflect<Product>();
console.log("Product fields:", productMeta);

// Practical use: auto-generate column names for a query
const columns = fieldNames<User>().join(", ");
console.log(`SELECT ${columns} FROM users`);
