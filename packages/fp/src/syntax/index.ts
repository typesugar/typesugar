/**
 * Syntax Module Index
 *
 * Re-exports do-comprehension and pipe utilities.
 */

export * from "./do.js";
export * from "./pipe.js";

// The same `Monad` and `IODo` as the package root exports (do.ts used to
// declare its own, so `.` and `./syntax` exported different things).
export type { Monad } from "../typeclasses/monad.js";
export { IODo } from "../io/io.js";
