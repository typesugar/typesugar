/**
 * Destructure Typeclass
 *
 * Provides the pattern matching extraction protocol, analogous to Scala's `unapply`.
 * A Destructure instance defines how to attempt extraction from an input value:
 * - Returns the extracted value on match
 * - Returns undefined on failure
 *
 * This is the foundation for extensible pattern matching. Built-in types
 * (Option, Either, Result) get auto-derived instances. Custom types can
 * provide manual instances via @impl.
 *
 * ## Design
 *
 * Uses `T | undefined` instead of `Option<T>` to avoid circular dependency
 * (Option itself needs Destructure) and to align with TypeScript conventions.
 *
 * ## Type Parameters
 *
 * - `Pattern` — The pattern constructor (e.g., `typeof Some`, `typeof Left`)
 * - `Input` — The type being matched against
 * - `Output` — The extracted value type on successful match
 *
 * ## Auto-Derivation
 *
 * Destructure auto-derives for any type with a Product or Sum generic instance:
 * - Product types: extract returns a tuple of field values in declaration order
 * - Sum variants: extract checks the discriminant and returns the variant payload
 * - Primitives: identity extraction
 *
 * @see PEP-008 for full design rationale
 */

import { typeclass } from "@typesugar/macros/runtime";

/**
 * Destructure typeclass — pattern matching extraction protocol.
 *
 * Analogous to Scala's `unapply`: attempts to extract a value from the input.
 * Returns the extracted value on match, or undefined on failure.
 *
 * @typeclass
 */
export interface Destructure<Pattern, Input, Output> {
  /**
   * Attempt to extract a value from the input.
   * @param input The value to match against
   * @returns The extracted value on match, or undefined on failure
   */
  extract(input: Input): Output | undefined;
}
typeclass("Destructure");
