/**
 * Type Reflection Example
 *
 * Demonstrates compile-time type introspection:
 * - typeInfo<T>() — get complete type structure
 * - fieldNames<T>() — get tuple of field names
 * - validator<T>() — generate runtime validators
 */

import {
  reflect,
  typeInfo,
  fieldNames,
  validator,
  TypeInfo,
  ValidationResult,
} from "@ttfx/reflect";

console.log("=== Type Reflection Example ===\n");

// --- Define Types ---

@reflect
interface User {
  id: number;
  name: string;
  email: string;
  age?: number;
  roles: string[];
}

@reflect
interface Post {
  id: number;
  title: string;
  content: string;
  authorId: number;
  published: boolean;
  tags: string[];
}

// --- typeInfo<T>() ---

console.log("--- typeInfo<T>() ---");

const userInfo: TypeInfo = typeInfo<User>();
console.log("User type info:");
console.log("  Name:", userInfo.name);
console.log("  Kind:", userInfo.kind);
console.log("  Fields:");
userInfo.fields.forEach((field) => {
  const optional = field.optional ? "?" : "";
  console.log(`    ${field.name}${optional}: ${field.type}`);
});

// --- fieldNames<T>() ---

console.log("\n--- fieldNames<T>() ---");

const userFields = fieldNames<User>();
console.log("User fields:", userFields);
// Type: ["id", "name", "email", "age", "roles"]

const postFields = fieldNames<Post>();
console.log("Post fields:", postFields);

// --- validator<T>() ---

console.log("\n--- validator<T>() ---");

const validateUser = validator<User>();

const validUser = {
  id: 1,
  name: "Alice",
  email: "alice@example.com",
  age: 30,
  roles: ["admin", "user"],
};

const invalidUser = {
  id: "not-a-number", // should be number
  name: 123,          // should be string
  email: "alice@example.com",
  roles: "admin",     // should be array
};

console.log("Valid user:", validateUser(validUser));
console.log("Invalid user:", validateUser(invalidUser as any));

// --- Validation with Details ---

console.log("\n--- Detailed Validation ---");

function validateWithDetails<T>(
  data: unknown,
  validate: (data: unknown) => ValidationResult
): void {
  const result = validate(data);

  if (result.valid) {
    console.log("✓ Valid");
  } else {
    console.log("✗ Invalid:");
    result.errors.forEach((error) => {
      console.log(`  - ${error.path}: ${error.message}`);
    });
  }
}

console.log("Checking valid user:");
validateWithDetails(validUser, validateUser);

console.log("\nChecking invalid user:");
validateWithDetails(invalidUser, validateUser);

// --- Using Type Info for Dynamic Operations ---

console.log("\n--- Dynamic Operations ---");

function printFields<T>(obj: T, info: TypeInfo): void {
  console.log(`${info.name} instance:`);
  info.fields.forEach((field) => {
    const value = (obj as any)[field.name];
    const displayValue = Array.isArray(value)
      ? `[${value.join(", ")}]`
      : String(value);
    console.log(`  ${field.name}: ${displayValue}`);
  });
}

printFields(validUser, userInfo);

// --- Method Reflection ---

console.log("\n--- Method Reflection ---");

@reflect
class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  multiply(a: number, b: number): number {
    return a * b;
  }
}

const calcInfo = typeInfo<Calculator>();
console.log("Calculator methods:");
calcInfo.methods?.forEach((method) => {
  const params = method.parameters
    .map((p) => `${p.name}: ${p.type}`)
    .join(", ");
  console.log(`  ${method.name}(${params}): ${method.returnType}`);
});
