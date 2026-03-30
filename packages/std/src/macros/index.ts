/**
 * Standard Library Macros
 *
 * This module exports macros provided by @typesugar/std.
 *
 * ## Available Macros
 *
 * - `registerStdInstances()` - Register std typeclass instances for summon<>() resolution
 * - `let:/yield:` - Monadic do-notation for Promise, Array, Option, etc.
 * - `par:/yield:` - Applicative (parallel) comprehensions with Promise.all / .map().ap()
 */

export * from "./comprehension-utils.js";
export * from "./let-yield.js";
export * from "./par-yield.js";
export * from "./match.js";
export { registerStdInstances, registerStdInstancesMacro } from "./register-instances.js";
