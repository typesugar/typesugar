/**
 * @typesugar/reflect Showcase
 *
 * Self-documenting examples of compile-time reflection: @reflect,
 * typeInfo<T>(), fieldNames<T>(), validator<T>(), sizeof<T>(), and
 * the TypeInfo/FieldInfo/MethodInfo metadata structures.
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
  reflect,
  typeInfo,
  fieldNames,
  validator,
  sizeof,
  type TypeInfo,
  type FieldInfo,
  type MethodInfo,
  type ParameterInfo,
  type ValidationResult,
} from "@typesugar/reflect";

// ============================================================================
// 1. @reflect DECORATOR — Compile-time metadata generation
// ============================================================================

// @reflect generates a companion metadata constant alongside the type.
// The generated constant is named __TypeName_meta__ and contains
// the full TypeInfo structure.

@reflect
interface User {
  id: number;
  name: string;
  email: string;
  age?: number;
}

// The transformer generates: export const __User_meta__ = { ... }
// This metadata is available at runtime for dynamic operations.

// ============================================================================
// 2. typeInfo<T>() — Get complete type structure
// ============================================================================

// typeInfo<T>() is a compile-time macro that extracts the full structure
// of a type from the TypeScript type checker and inlines it as a literal.

const userInfo = typeInfo<User>();

assert(userInfo.name === "User");
assert(userInfo.kind === "interface");
assert(userInfo.fields !== undefined);
assert(userInfo.fields!.length === 4);

// Field metadata includes name, type string, and modifiers
const idField = userInfo.fields!.find((f) => f.name === "id")!;
assert(idField.type === "number");
assert(idField.optional === false);

const ageField = userInfo.fields!.find((f) => f.name === "age")!;
assert(ageField.optional === true);
assert(ageField.type === "number");

// TypeInfo structure is fully typed
typeAssert<Extends<typeof userInfo, { name: string; kind: string; fields: FieldInfo[] }>>();

// ============================================================================
// 3. typeInfo<T>() ON DIFFERENT TYPE KINDS
// ============================================================================

// Works on interfaces, classes, and type aliases.

@reflect
interface Config {
  host: string;
  port: number;
  readonly secure: boolean;
}

const configInfo = typeInfo<Config>();
assert(configInfo.name === "Config");
assert(configInfo.kind === "interface");

const secureField = configInfo.fields!.find((f) => f.name === "secure")!;
assert(secureField.readonly === true);
assert(secureField.type === "boolean");

// Classes include both fields and methods
@reflect
class Calculator {
  result: number = 0;

  add(a: number, b: number): number {
    return a + b;
  }

  multiply(a: number, b: number): number {
    return a * b;
  }
}

const calcInfo = typeInfo<Calculator>();
assert(calcInfo.name === "Calculator");
assert(calcInfo.kind === "class");

// Methods have parameter info and return types
if (calcInfo.methods) {
  const addMethod = calcInfo.methods.find((m) => m.name === "add");
  assert(addMethod !== undefined);
  assert(addMethod!.parameters.length === 2);
  assert(addMethod!.returnType === "number");

  typeAssert<Extends<typeof addMethod, MethodInfo | undefined>>();
}

// ============================================================================
// 4. fieldNames<T>() — Get field names as a tuple
// ============================================================================

// fieldNames<T>() returns an array of field name strings.
// At compile time, this is inlined as a string literal array.

const userFields = fieldNames<User>();
assert(userFields.length === 4);
assert(userFields.includes("id"));
assert(userFields.includes("name"));
assert(userFields.includes("email"));
assert(userFields.includes("age"));

const configFields = fieldNames<Config>();
assert(configFields.length === 3);
assert(configFields[0] === "host");

// Useful for iteration, form generation, serialization keys, etc.
interface ApiPayload {
  action: string;
  timestamp: number;
  payload: string;
}
const payloadFields = fieldNames<ApiPayload>();
assert(payloadFields.length === 3);

// ============================================================================
// 5. validator<T>() — Generate runtime validators
// ============================================================================

// validator<T>() generates a function that validates unknown data
// against the type's structure, returning a ValidationResult.

const validateUser = validator<User>();

// Valid data passes
const validResult = validateUser({
  id: 1,
  name: "Alice",
  email: "alice@example.com",
  age: 30,
});
assert(validResult.success === true);
if (validResult.success) {
  assert(validResult.value.name === "Alice");
  typeAssert<Equal<typeof validResult.value, User>>();
}

// Invalid data fails with error messages
const invalidResult = validateUser({
  id: "not-a-number",
  name: 123,
  email: "alice@example.com",
});
assert(invalidResult.success === false);
if (!invalidResult.success) {
  assert(invalidResult.errors.length > 0);
  typeAssert<Extends<typeof invalidResult.errors, string[]>>();
}

// Non-objects fail immediately
const nullResult = validateUser(null);
assert(nullResult.success === false);

const primitiveResult = validateUser(42);
assert(primitiveResult.success === false);

// ValidationResult is a discriminated union
typeAssert<Equal<
  ValidationResult<User>,
  { success: true; value: User } | { success: false; errors: string[] }
>>();

// ============================================================================
// 6. sizeof<T>() — Compile-time property count
// ============================================================================

// sizeof<T>() returns the number of properties on a type as a numeric literal.
// Useful for compile-time assertions about type structure.

assert(sizeof<User>() === 4);
assert(sizeof<Config>() === 3);
assert(sizeof<ApiPayload>() === 3);

// Can be used in compile-time size checks
interface SmallType {
  x: number;
  y: number;
}
assert(sizeof<SmallType>() === 2);

// ============================================================================
// 7. METADATA STRUCTURES — TypeInfo, FieldInfo, MethodInfo
// ============================================================================

// The reflection types form a complete metadata model.

// TypeInfo covers all type shapes
typeAssert<Extends<TypeInfo["kind"],
  "interface" | "class" | "type" | "enum" | "primitive" | "union" | "intersection" | "array" | "tuple" | "function"
>>();

// FieldInfo captures field metadata
typeAssert<Equal<FieldInfo, {
  name: string;
  type: string;
  optional: boolean;
  readonly: boolean;
  defaultValue?: string;
}>>();

// MethodInfo captures method metadata
typeAssert<Equal<MethodInfo, {
  name: string;
  parameters: ParameterInfo[];
  returnType: string;
  isAsync: boolean;
  isStatic: boolean;
}>>();

// ParameterInfo captures parameter metadata
typeAssert<Equal<ParameterInfo, {
  name: string;
  type: string;
  optional: boolean;
  defaultValue?: string;
}>>();

// ============================================================================
// 8. REAL-WORLD EXAMPLE — Generic form generator
// ============================================================================

// Reflection enables metaprogramming patterns like form generation,
// ORM mapping, API documentation generation, etc.

@reflect
interface ContactForm {
  name: string;
  email: string;
  subject: string;
  message: string;
}

// Generate form field descriptors from type metadata
function generateFormFields(info: TypeInfo): Array<{ label: string; type: string; required: boolean }> {
  return (info.fields ?? []).map((field) => ({
    label: field.name.charAt(0).toUpperCase() + field.name.slice(1),
    type: field.type === "number" ? "number" : field.type === "boolean" ? "checkbox" : "text",
    required: !field.optional,
  }));
}

const formInfo = typeInfo<ContactForm>();
const fields = generateFormFields(formInfo);

assert(fields.length === 4);
assert(fields[0].label === "Name");
assert(fields[0].type === "text");
assert(fields[0].required === true);

// ============================================================================
// 9. REAL-WORLD EXAMPLE — API response validation pipeline
// ============================================================================

// Combine validator with type info for a complete validation pipeline.

@reflect
interface OrderResponse {
  orderId: string;
  total: number;
  items: number;
}

const validateOrder = validator<OrderResponse>();
const orderInfo = typeInfo<OrderResponse>();

function validateApiResponse<T>(
  data: unknown,
  validate: (data: unknown) => ValidationResult<T>,
  info: TypeInfo
): { valid: boolean; typeName: string; fieldCount: number; data?: T; errors?: string[] } {
  const result = validate(data);
  return {
    valid: result.success,
    typeName: info.name,
    fieldCount: info.fields?.length ?? 0,
    ...(result.success ? { data: result.value } : { errors: result.errors }),
  };
}

const goodResponse = validateApiResponse(
  { orderId: "ORD-123", total: 99.99, items: 3 },
  validateOrder,
  orderInfo
);
assert(goodResponse.valid === true);
assert(goodResponse.typeName === "OrderResponse");
assert(goodResponse.fieldCount === 3);
assert(goodResponse.data!.orderId === "ORD-123");

const badResponse = validateApiResponse(
  { orderId: 123, total: "free" },
  validateOrder,
  orderInfo
);
assert(badResponse.valid === false);
assert(badResponse.errors !== undefined);
assert(badResponse.errors!.length > 0);

// ============================================================================
// 10. REAL-WORLD EXAMPLE — diff two objects using reflection
// ============================================================================

function diff<T>(a: T, b: T, info: TypeInfo): Array<{ field: string; from: unknown; to: unknown }> {
  const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
  for (const field of info.fields ?? []) {
    const aVal = (a as Record<string, unknown>)[field.name];
    const bVal = (b as Record<string, unknown>)[field.name];
    if (aVal !== bVal) {
      changes.push({ field: field.name, from: aVal, to: bVal });
    }
  }
  return changes;
}

const oldUser: User = { id: 1, name: "Alice", email: "old@example.com", age: 25 };
const newUser: User = { id: 1, name: "Alice", email: "new@example.com", age: 26 };

const changes = diff(oldUser, newUser, typeInfo<User>());
assert(changes.length === 2);
assert(changes.some((c) => c.field === "email"));
assert(changes.some((c) => c.field === "age"));
