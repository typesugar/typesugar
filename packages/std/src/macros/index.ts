/**
 * Standard Library Macros
 *
 * This module exports macros provided by @typesugar/std.
 *
 * ## Available Macros
 *
 * - `registerStdInstances()` - Register std typeclass instances for summon<>() resolution
 * - `let:/yield:` - FlatMap-based do-notation for Promise, Array, etc.
 */

export * from "./let-yield.js";
export {
  registerStdInstances,
  registerStdInstancesMacro,
} from "./register-instances.js";
