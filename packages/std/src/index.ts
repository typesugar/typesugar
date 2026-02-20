/**
 * @typesugar/std — Standard Library
 *
 * A comprehensive set of typeclasses and extension methods for enriching
 * basic TypeScript types. Draws from the best of Haskell, Scala, Rust,
 * Kotlin, Swift, and the most-requested JS/TS utilities.
 *
 * ## Typeclasses
 *
 * Standard typeclasses with primitive instances:
 * - Bounded, Enum, Numeric, Integral, Fractional, Floating
 * - Parseable, Printable, Coercible, Defaultable, Copyable
 * - Sized, Identifiable, Reducible, Zippable, Splittable, Searchable
 *
 * ## Extension Methods
 *
 * Rich extension methods for every basic type:
 * - NumberExt (45+ methods), StringExt (50+ methods), ArrayExt (50+ methods)
 * - ObjectExt (30+ methods), BooleanExt (20+ methods), DateExt (40+ methods)
 * - MapExt (15+ methods), SetExt (12+ methods)
 * - PromiseExt (20+ methods), FunctionExt (25+ methods)
 *
 * ## Data Types
 *
 * - Pair, Triple (tuple utilities with bimap, swap, curry/uncurry)
 * - Range (Scala/Kotlin-style numeric ranges with iteration, filtering, mapping)
 *
 * @example
 * ```ts
 * import { extend } from '@typesugar/core';
 * import '@typesugar/std';
 *
 * // Extension methods on numbers
 * extend(42).clamp(0, 100);
 * extend(255).toHex();
 * extend(7).isPrime();
 *
 * // Extension methods on strings
 * extend("hello world").capitalize();
 * extend("camelCase").toSnakeCase();
 *
 * // Extension methods on arrays
 * extend([1, 2, 3, 4, 5]).chunk(2);
 * extend([3, 1, 4, 1, 5]).unique();
 *
 * // Ranges
 * import { range, rangeToArray } from '@typesugar/std';
 * rangeToArray(range(1, 10)); // [1, 2, ..., 9]
 * ```
 */

// Typeclasses
export * from "./typeclasses";

// Extension methods
export * from "./extensions";

// Data types
export * from "./data";

// Macros (let:/yield:)
export * from "./macros";

// Specialization support (FlatMap instances registered for specialize() macro)
export * from "./specialize";
