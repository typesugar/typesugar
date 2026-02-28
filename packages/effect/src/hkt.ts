/**
 * Higher-Kinded Types for Effect-TS
 *
 * This module defines type-level functions for Effect-TS types using the
 * phantom kind marker encoding from `@typesugar/type-system`.
 *
 * ## Zero-Cost Philosophy
 *
 * The HKT encoding exists only at the type level. At runtime:
 * - Type-level functions (`EffectF`, `ChunkF`) are erased completely
 * - `Kind<EffectF<never, never>, number>` resolves to `Effect<number, never, never>`
 * - The `specialize` macro inlines dictionary methods at call sites
 *
 * ## Multi-arity type constructors
 *
 * Effect has three type parameters (A, E, R). We fix E and R and vary A:
 *
 * ```typescript
 * interface EffectF<E, R> extends TypeFunction { _: Effect<this["__kind__"], E, R> }
 * // Kind<EffectF<HttpError, HttpClient>, User> → Effect<User, HttpError, HttpClient>
 * ```
 *
 * @module
 */

import type { Effect, Chunk, Option, Either, Stream } from "effect";
import type { TypeFunction } from "@typesugar/type-system";

// Re-export core HKT infrastructure
export type { $, Kind, TypeFunction } from "@typesugar/type-system";

// ============================================================================
// Type-Level Functions for Effect Types
// ============================================================================

/**
 * Type-level function for `Effect<A, E, R>` with E and R fixed.
 *
 * Effect-TS uses `Effect<A, E, R>` where:
 * - A = success value type (varies with map/flatMap)
 * - E = error type (fixed for typeclass instances)
 * - R = requirements/context type (fixed for typeclass instances)
 *
 * @example
 * ```typescript
 * type HttpResult<A> = Kind<EffectF<HttpError, HttpClient>, A>;
 * // Resolves to: Effect<A, HttpError, HttpClient>
 * ```
 */
export interface EffectF<E = never, R = never> extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: Effect.Effect<this["__kind__"], E, R>;
}

/**
 * Type-level function for `Chunk<A>`.
 *
 * Chunk is Effect's immutable array type with O(1) prepend/append.
 *
 * @example
 * ```typescript
 * type NumberChunk = Kind<ChunkF, number>; // → Chunk<number>
 * ```
 */
export interface ChunkF extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: Chunk.Chunk<this["__kind__"]>;
}

/**
 * Type-level function for Effect's `Option<A>`.
 *
 * @example
 * ```typescript
 * type MaybeNumber = Kind<EffectOptionF, number>; // → Option<number>
 * ```
 */
export interface EffectOptionF extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: Option.Option<this["__kind__"]>;
}

/**
 * Type-level function for Effect's `Either<E, A>` with E fixed.
 *
 * @example
 * ```typescript
 * type StringResult<A> = Kind<EffectEitherF<string>, A>; // → Either<string, A>
 * ```
 */
export interface EffectEitherF<E> extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: Either.Either<this["__kind__"], E>;
}

/**
 * Type-level function for `Stream<A, E, R>` with E and R fixed.
 *
 * Stream is Effect's pull-based streaming type.
 * Note: Stream is Functor but not Monad (flatMap has different semantics).
 *
 * @example
 * ```typescript
 * type UserStream<A> = Kind<StreamF<Error, HttpClient>, A>; // → Stream<A, Error, HttpClient>
 * ```
 */
export interface StreamF<E = never, R = never> extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: Stream.Stream<this["__kind__"], E, R>;
}

// ============================================================================
// Type Aliases for Common Effect Patterns
// ============================================================================

/**
 * Effect with no error and no requirements.
 * Equivalent to Effect<A, never, never>.
 */
export type PureEffect<A> = Effect.Effect<A, never, never>;

/**
 * Effect with error but no requirements.
 * Equivalent to Effect<A, E, never>.
 */
export type FailableEffect<A, E> = Effect.Effect<A, E, never>;

/**
 * Type helper to extract the success type from an Effect.
 */
export type EffectSuccess<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never;

/**
 * Type helper to extract the error type from an Effect.
 */
export type EffectError<T> = T extends Effect.Effect<infer _A, infer E, infer _R> ? E : never;

/**
 * Type helper to extract the requirements type from an Effect.
 */
export type EffectRequirements<T> =
  T extends Effect.Effect<infer _A, infer _E, infer R> ? R : never;
