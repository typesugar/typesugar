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

// Side-effect import: register the ParCombine builders/instances used by the
// par:/yield: macro. This compile-time registration lives in `par-combine.ts`
// (which imports `typescript`); loading it here ensures it runs when the
// transformer loads this `./macros` entry (PEP-050 Case-1). The runtime
// instances are re-exported separately from the `typescript`-free
// `typeclasses/par-combine-instances.ts` by the `.` entry.
import "../typeclasses/par-combine.js";

export * from "./comprehension-utils.js";
export * from "./let-yield.js";
export * from "./par-yield.js";
export * from "./match.js";
export { registerStdInstances, registerStdInstancesMacro } from "./register-instances.js";
