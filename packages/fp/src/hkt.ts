/**
 * Higher-Kinded Types for @ttfx/fp
 *
 * This module defines type-level functions for @ttfx/fp data types using the
 * indexed-access HKT encoding from `@ttfx/type-system`.
 *
 * ## Zero-Cost Philosophy
 *
 * The HKT encoding exists only at the type level. At runtime:
 * - Type-level functions (`OptionF`, `EitherF`) are erased completely
 * - `$<OptionF, number>` resolves to `Option<number>` (no wrapper)
 * - The `specialize` macro inlines dictionary methods at call sites
 * - No closures, no indirect dispatch, no dictionary objects in hot paths
 *
 * ## How it works
 *
 * ```typescript
 * // Define a type-level function
 * interface OptionF { _: Option<this["_"]> }
 *
 * // $<OptionF, number> evaluates to Option<number>
 * // by intersecting OptionF with { readonly _: number } and looking up ["_"]
 * ```
 *
 * ## Multi-arity type constructors
 *
 * For types with multiple parameters (Either<E, A>, State<S, A>), we fix all
 * but one parameter and vary the rightmost:
 *
 * ```typescript
 * interface EitherF<E> { _: Either<E, this["_"]> }
 * // $<EitherF<string>, number> = Either<string, number>
 * ```
 */

// Re-export core HKT infrastructure from type-system
export type { $, Kind } from "@ttfx/type-system";
export { unsafeCoerce } from "@ttfx/type-system";

// ============================================================================
// Import actual data types from their modules
// These are plain discriminated unions (no methods) — importing them
// instead of declaring shadow interfaces avoids infinite type recursion.
// ============================================================================

import type { Option } from "./data/option.js";
import type { Either } from "./data/either.js";
import type { List } from "./data/list.js";
import type { NonEmptyList } from "./data/nonempty-list.js";
import type { Validated } from "./data/validated.js";

// Class-based types need to be imported from their modules too
import type { State } from "./data/state.js";
import type { Reader } from "./data/reader.js";
import type { Writer } from "./data/writer.js";
import type { IO } from "./io/io.js";
import type { Resource } from "./io/resource.js";

// Re-export the data types for convenience
export type { Option, Either, List, NonEmptyList, Validated };
export type { State, Reader, Writer, IO, Resource };

// ============================================================================
// Type-Level Functions for Built-in Types
// ============================================================================

/**
 * Type-level function for `Array<A>`.
 *
 * @example
 * ```typescript
 * type NumberArray = $<ArrayF, number>; // Array<number>
 * ```
 */
export interface ArrayF {
  _: Array<this["_"]>;
}

/**
 * Type-level function for `Promise<A>`.
 *
 * @example
 * ```typescript
 * type AsyncNumber = $<PromiseF, number>; // Promise<number>
 * ```
 */
export interface PromiseF {
  _: Promise<this["_"]>;
}

// ============================================================================
// Type-Level Functions for @ttfx/fp Data Types
// ============================================================================

/**
 * Type-level function for `Option<A>`.
 *
 * @example
 * ```typescript
 * type MaybeNumber = $<OptionF, number>; // Option<number>
 * ```
 */
export interface OptionF {
  _: Option<this["_"]>;
}

/**
 * Type-level function for `Either<E, A>` with E fixed.
 *
 * @example
 * ```typescript
 * type StringResult<A> = $<EitherF<string>, A>; // Either<string, A>
 * ```
 */
export interface EitherF<E> {
  _: Either<E, this["_"]>;
}

/**
 * Type-level function for `List<A>`.
 *
 * @example
 * ```typescript
 * type NumberList = $<ListF, number>; // List<number>
 * ```
 */
export interface ListF {
  _: List<this["_"]>;
}

/**
 * Type-level function for `NonEmptyList<A>`.
 *
 * @example
 * ```typescript
 * type NonEmptyNumbers = $<NonEmptyListF, number>; // NonEmptyList<number>
 * ```
 */
export interface NonEmptyListF {
  _: NonEmptyList<this["_"]>;
}

/**
 * Type-level function for `Validated<E, A>` with E fixed.
 *
 * @example
 * ```typescript
 * type ValidationResult<A> = $<ValidatedF<string[]>, A>; // Validated<string[], A>
 * ```
 */
export interface ValidatedF<E> {
  _: Validated<E, this["_"]>;
}

/**
 * Type-level function for `State<S, A>` with S fixed.
 *
 * @example
 * ```typescript
 * type CounterState<A> = $<StateF<number>, A>; // State<number, A>
 * ```
 */
export interface StateF<S> {
  _: State<S, this["_"]>;
}

/**
 * Type-level function for `Reader<R, A>` with R fixed.
 *
 * @example
 * ```typescript
 * type ConfigReader<A> = $<ReaderF<Config>, A>; // Reader<Config, A>
 * ```
 */
export interface ReaderF<R> {
  _: Reader<R, this["_"]>;
}

/**
 * Type-level function for `Writer<W, A>` with W fixed.
 *
 * @example
 * ```typescript
 * type LogWriter<A> = $<WriterF<string[]>, A>; // Writer<string[], A>
 * ```
 */
export interface WriterF<W> {
  _: Writer<W, this["_"]>;
}

/**
 * Type-level function for `IO<A>`.
 *
 * @example
 * ```typescript
 * type IOAction = $<IOF, string>; // IO<string>
 * ```
 */
export interface IOF {
  _: IO<this["_"]>;
}

/**
 * Type-level function for `Id<A>` (Identity).
 *
 * @example
 * ```typescript
 * type Identity = $<IdF, number>; // number (Id is transparent)
 * ```
 */
export interface IdF {
  _: Id<this["_"]>;
}

/**
 * Type-level function for `Resource<A>`.
 *
 * @example
 * ```typescript
 * type ResourceHandle = $<ResourceF, FileHandle>; // Resource<FileHandle>
 * ```
 */
export interface ResourceF {
  _: Resource<this["_"]>;
}

// ============================================================================
// Simple Type Aliases
// ============================================================================

/**
 * Id is the identity functor — it does nothing, just wraps a value.
 * At the type level, `Id<A> = A`.
 */
export type Id<A> = A;

// ============================================================================
// Legacy Compatibility (deprecated)
// ============================================================================

/**
 * @deprecated Use `OptionF` instead.
 */
export interface OptionHKT {
  readonly _brand: "OptionHKT";
}

/**
 * @deprecated Use `EitherF<E>` instead.
 */
export interface EitherHKT {
  readonly _brand: "EitherHKT";
}

/**
 * @deprecated Use `ListF` instead.
 */
export interface ListHKT {
  readonly _brand: "ListHKT";
}
