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
 * ## Macros
 *
 * - `match()` — zero-cost pattern matching with exhaustiveness checking
 * - `when()` / `otherwise()` — guard arm constructors
 * - `isType()` — compile-time type guards (typeof/instanceof/null)
 * - `P` — array/structural pattern helpers (P.empty, P.length, P.between, etc.)
 * - `let:` / `yield:` — do-notation for monadic types
 *
 * @example
 * ```ts
 * import { clamp, toHex, isPrime } from '@typesugar/std';
 * import { capitalize, toSnakeCase } from '@typesugar/std';
 * import { chunk, unique } from '@typesugar/std';
 * import { match } from '@typesugar/std';
 *
 * // Extension methods on numbers (import-scoped)
 * (42).clamp(0, 100);
 * (255).toHex();
 * (7).isPrime();
 *
 * // Extension methods on strings
 * "hello world".capitalize();
 * "camelCase".toSnakeCase();
 *
 * // Extension methods on arrays
 * [1, 2, 3, 4, 5].chunk(2);
 * [3, 1, 4, 1, 5].unique();
 *
 * // Ranges (extension method API)
 * (1).to(10);      // Range [1, 10]
 * (1).until(10);   // Range [1, 10)
 *
 * // Pattern matching (fluent API)
 * const area = match(shape)
 *   .case({ kind: 'circle' }).then(({ radius }) => Math.PI * radius ** 2)
 *   .case({ kind: 'square' }).then(({ side }) => side ** 2)
 *   .else(() => 0);
 * ```
 */

// Runtime extension registration (populates registry when importing from dist)
import "./register-extensions.js";

// Typeclasses
export * from "./typeclasses";

// Extension methods
export * from "./extensions";

// Data types
export * from "./data";

// Macros (let:/yield:, match/when/otherwise/isType/P)
export * from "./macros";

// Specialization support (FlatMap instances registered for specialize() macro)
export * from "./specialize";
