/**
 * @typesugar/reflect - Compile-time Reflection Macros
 *
 * This package re-exports reflection functionality from @typesugar/macros.
 * It provides:
 * - @reflect decorator for enabling reflection on types
 * - typeInfo<T>() for getting type metadata
 * - fieldNames<T>() for getting field names
 * - validator<T>() for generating runtime type guards
 *
 * @example
 * ```typescript
 * import { reflect, typeInfo, fieldNames, validator } from "@typesugar/reflect";
 *
 * @reflect
 * interface User {
 *   name: string;
 *   age: number;
 * }
 *
 * const info = typeInfo<User>();
 * // { name: "User", fields: [{ name: "name", type: "string" }, ...] }
 *
 * const names = fieldNames<User>();
 * // ["name", "age"]
 *
 * const isUser = validator<User>();
 * if (isUser(data)) { ... }
 * ```
 *
 * @module
 */

// Re-export everything from @typesugar/macros that relates to reflection

// Runtime stubs
export { reflect, typeInfo, fieldNames, validator } from "@typesugar/macros";

// Macro definitions
export {
  reflectAttribute,
  typeInfoMacro,
  fieldNamesMacro,
  validatorMacro,
} from "@typesugar/macros";

// Type exports
export type {
  TypeInfo,
  FieldInfo,
  MethodInfo,
  ParameterInfo,
  ValidationResult,
} from "@typesugar/macros";
