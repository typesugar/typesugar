/**
 * Destructure Typeclass
 *
 * Provides the pattern matching extraction protocol, analogous to Scala's `unapply`.
 * A Destructure instance defines how to attempt extraction from an input value:
 * - Returns the extracted value on match
 * - Returns undefined on failure
 *
 * This is the foundation for extensible pattern matching. `Name(...)` in a
 * pattern (`match(x).case(Some(v))`, `case Point(x, y):` in a `match:` switch)
 * resolves the `Destructure<typeof Name, Input, Output>` instance by `Name`'s
 * symbol, never by its name: from the current file, the modules it imports,
 * or the module that declares `Name`. A name with no instance is a type
 * pattern (`instanceof Name`).
 *
 * - `@typesugar/fp` ships the instances for Some/None, Left/Right, Cons/Nil
 *   and Valid/Invalid next to those types.
 * - `@derive(Destructure)` on your own interface, object type alias or
 *   discriminated union generates a constructor function per extractor
 *   (`Point(x, y)`, one per variant for a union) and its instance.
 * - For a type you don't own, write the instance by hand with `@impl`.
 *   (`derived<Destructure<...>>()` is not supported: a pattern needs a value
 *   to name.)
 *
 * An instance with a `@destructure` descriptor (`not-null -> self`,
 * `kind = "circle" -> r`, `always -> x, y`, ...) is inlined: patterns compile
 * to the test and the field reads, and never call `extract`. Without one,
 * `extract` is called once and its result destructured.
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
 * @see https://typesugar.org/guides/pattern-matching#custom-extractors
 * @see PEP-008 for full design rationale
 */

import { typeclass } from "@typesugar/macros/runtime";

/**
 * Destructure typeclass — pattern matching extraction protocol.
 *
 * Analogous to Scala's `unapply`: attempts to extract a value from the input.
 * Returns the extracted value on match, or undefined on failure.
 *
 * `Name(...)` in a pattern resolves the instance by `Name`'s symbol, not its
 * name. `@typesugar/fp` ships instances for Some/None, Left/Right, Cons/Nil and
 * Valid/Invalid; `@derive(Destructure)` generates them for your own types; an
 * instance with a `@destructure` descriptor is inlined. See
 * https://typesugar.org/guides/pattern-matching#custom-extractors
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
