/**
 * Higher-Kinded Types for @typesugar/fp
 *
 * This module defines type-level functions for @typesugar/fp data types using the
 * phantom kind marker encoding from `@typesugar/type-system`.
 *
 * ## Zero-Cost Philosophy
 *
 * The HKT encoding exists only at the type level. At runtime:
 * - Type-level functions (`OptionF`, `EitherF`) are erased completely
 * - `Kind<OptionF, number>` resolves to `Option<number>` via preprocessor
 * - The `specialize` macro inlines dictionary methods at call sites
 * - No closures, no indirect dispatch, no dictionary objects in hot paths
 *
 * ## Three-Layer Architecture
 *
 * 1. **Lexical** (`F<A>` with `F<_>` declaration):
 *    ```typescript
 *    interface Functor<F<_>> {
 *      map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
 *    }
 *    ```
 *
 * 2. **Intermediate** (`Kind<F, A>`):
 *    ```typescript
 *    interface Functor<F> {
 *      map<A, B>(fa: Kind<F, A>, f: (a: A) => B): Kind<F, B>;
 *    }
 *    ```
 *
 * 3. **Final** (resolved for known type functions):
 *    ```typescript
 *    // Kind<OptionF, A> → Option<A>
 *    map<A, B>(fa: Option<A>, f: (a: A) => B): Option<B>;
 *    ```
 *
 * ## Multi-arity type constructors
 *
 * For types with multiple parameters (Either<E, A>, State<S, A>), we fix all
 * but one parameter and vary the rightmost:
 *
 * ```typescript
 * interface EitherF<E> { _: Either<E, this["__kind__"]> }
 * // Kind<EitherF<string>, number> → Either<string, number>
 * ```
 */

// Re-export core HKT infrastructure from type-system
export type { $, Kind, Apply, TypeFunction } from "@typesugar/type-system";
export { unsafeCoerce } from "@typesugar/type-system";

// Import TypeFunction for use in interface definitions
import type { TypeFunction } from "@typesugar/type-system";

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
 * type NumberArray = Kind<ArrayF, number>; // → Array<number>
 * ```
 */
export interface ArrayF extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: Array<this["__kind__"]>;
}

/**
 * Type-level function for `Promise<A>`.
 *
 * @example
 * ```typescript
 * type AsyncNumber = Kind<PromiseF, number>; // → Promise<number>
 * ```
 */
export interface PromiseF extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: Promise<this["__kind__"]>;
}

// ============================================================================
// Type-Level Functions for @typesugar/fp Data Types
// ============================================================================

/**
 * Type-level function for `Option<A>`.
 *
 * @example
 * ```typescript
 * type MaybeNumber = Kind<OptionF, number>; // → Option<number>
 * ```
 */
export interface OptionF extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: Option<this["__kind__"]>;
}

/**
 * Type-level function for `Either<E, A>` with E fixed.
 *
 * @example
 * ```typescript
 * type StringResult<A> = Kind<EitherF<string>, A>; // → Either<string, A>
 * ```
 */
export interface EitherF<E> extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: Either<E, this["__kind__"]>;
}

/**
 * Type-level function for `List<A>`.
 *
 * @example
 * ```typescript
 * type NumberList = Kind<ListF, number>; // → List<number>
 * ```
 */
export interface ListF extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: List<this["__kind__"]>;
}

/**
 * Type-level function for `NonEmptyList<A>`.
 *
 * @example
 * ```typescript
 * type NonEmptyNumbers = Kind<NonEmptyListF, number>; // → NonEmptyList<number>
 * ```
 */
export interface NonEmptyListF extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: NonEmptyList<this["__kind__"]>;
}

/**
 * Type-level function for `Validated<E, A>` with E fixed.
 *
 * @example
 * ```typescript
 * type ValidationResult<A> = Kind<ValidatedF<string[]>, A>; // → Validated<string[], A>
 * ```
 */
export interface ValidatedF<E> extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: Validated<E, this["__kind__"]>;
}

/**
 * Type-level function for `State<S, A>` with S fixed.
 *
 * @example
 * ```typescript
 * type CounterState<A> = Kind<StateF<number>, A>; // → State<number, A>
 * ```
 */
export interface StateF<S> extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: State<S, this["__kind__"]>;
}

/**
 * Type-level function for `Reader<R, A>` with R fixed.
 *
 * @example
 * ```typescript
 * type ConfigReader<A> = Kind<ReaderF<Config>, A>; // → Reader<Config, A>
 * ```
 */
export interface ReaderF<R> extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: Reader<R, this["__kind__"]>;
}

/**
 * Type-level function for `Writer<W, A>` with W fixed.
 *
 * @example
 * ```typescript
 * type LogWriter<A> = Kind<WriterF<string[]>, A>; // → Writer<string[], A>
 * ```
 */
export interface WriterF<W> extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: Writer<W, this["__kind__"]>;
}

/**
 * Type-level function for `IO<A>`.
 *
 * @example
 * ```typescript
 * type IOAction = Kind<IOF, string>; // → IO<string>
 * ```
 */
export interface IOF extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: IO<this["__kind__"]>;
}

/**
 * Type-level function for `Id<A>` (Identity).
 *
 * @example
 * ```typescript
 * type Identity = Kind<IdF, number>; // → number (Id is transparent)
 * ```
 */
export interface IdF extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: Id<this["__kind__"]>;
}

/**
 * Type-level function for `Resource<A>`.
 *
 * @example
 * ```typescript
 * type ResourceHandle = Kind<ResourceF, FileHandle>; // → Resource<FileHandle>
 * ```
 */
export interface ResourceF extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: Resource<this["__kind__"]>;
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
