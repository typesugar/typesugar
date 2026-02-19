/**
 * Effect-TS Integration
 *
 * This module provides type-level functions and typeclass instances for
 * integrating Effect-TS with the zero-cost typeclass system.
 *
 * ## Installation
 *
 * To use this module, first install Effect-TS:
 * ```bash
 * pnpm add effect
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * import { effectMonad, effectApplicativeError } from "@ttfx/fp/effect";
 * import { specialize } from "@ttfx/macros";
 *
 * // Generic function using Monad
 * function double<F>(F: Monad<F>, fa: $<F, number>): $<F, number> {
 *   return F.map(fa, x => x * 2);
 * }
 *
 * // Zero-cost specialized version for Effect
 * const doubleEffect = specialize(double, effectMonad<never, never>());
 * // Compiles to: (fa) => Effect.map(fa, x => x * 2)
 * ```
 *
 * ## Architecture
 *
 * Effect-TS uses `Effect<A, E, R>` where:
 * - A: Success type (covariant)
 * - E: Error type (covariant)
 * - R: Requirements/Context type (contravariant)
 *
 * Our type-level functions fix R and E, allowing variance over A:
 * - `EffectF<R, E>` - Type constructor for Effect with fixed R, E
 * - `StreamF<R, E>` - Type constructor for Stream with fixed R, E
 * - `LayerF<RIn, E>` - Type constructor for Layer with fixed input/error
 */

import type { $ } from "../hkt.js";
import type { Functor } from "../typeclasses/functor.js";
import type { Applicative } from "../typeclasses/applicative.js";
import type { Monad } from "../typeclasses/monad.js";
import { makeMonad } from "../typeclasses/monad.js";
import type { MonadError } from "../typeclasses/monad-error.js";
import type { SemigroupK, MonoidK } from "../typeclasses/alternative.js";

// ============================================================================
// Effect Type Declarations
// ============================================================================

/**
 * Forward declaration for Effect<A, E, R>
 *
 * When Effect-TS is installed, this is compatible with the actual Effect type.
 */
export interface Effect<out A, out E = never, out R = never> {
  readonly [EffectTypeId]: EffectTypeId;
  readonly _A: () => A;
  readonly _E: () => E;
  readonly _R: (_: R) => void;
}

declare const EffectTypeId: unique symbol;
type EffectTypeId = typeof EffectTypeId;

/**
 * Forward declaration for Stream<A, E, R>
 */
export interface Stream<out A, out E = never, out R = never> {
  readonly [StreamTypeId]: StreamTypeId;
  readonly _A: () => A;
  readonly _E: () => E;
  readonly _R: (_: R) => void;
}

declare const StreamTypeId: unique symbol;
type StreamTypeId = typeof StreamTypeId;

/**
 * Forward declaration for Layer<ROut, E, RIn>
 */
export interface Layer<out ROut, out E = never, in RIn = never> {
  readonly [LayerTypeId]: LayerTypeId;
  readonly _ROut: () => ROut;
  readonly _E: () => E;
  readonly _RIn: (_: RIn) => void;
}

declare const LayerTypeId: unique symbol;
type LayerTypeId = typeof LayerTypeId;

// ============================================================================
// Type-Level Functions
// ============================================================================

/**
 * Type-level function for Effect with fixed R and E.
 *
 * Usage:
 * ```typescript
 * type MyEffect = $<EffectF<never, Error>, number>;
 * // Resolves to: Effect<number, Error, never>
 * ```
 */
export interface EffectF<R = never, E = never> {
  _: Effect<this["_"], E, R>;
}

/**
 * Type-level function for Stream with fixed R and E.
 */
export interface StreamF<R = never, E = never> {
  _: Stream<this["_"], E, R>;
}

/**
 * Type-level function for Layer with fixed RIn and E.
 * The output type R varies.
 */
export interface LayerF<RIn = never, E = never> {
  _: Layer<this["_"], E, RIn>;
}

// ============================================================================
// Typeclass Instances (Stubs - require Effect-TS)
// ============================================================================

/**
 * Create a Functor for Effect with fixed requirements and error type.
 *
 * Requires Effect-TS to be installed:
 * ```typescript
 * import * as Effect from "effect/Effect";
 * const functor = effectFunctor<never, never>(Effect);
 * ```
 */
export function effectFunctor<R, E>(
  E: typeof import("effect/Effect"),
): Functor<EffectF<R, E>> {
  return {
    map: <A, B>(
      fa: $<EffectF<R, E>, A>,
      f: (a: A) => B,
    ): $<EffectF<R, E>, B> => {
      return E.map(fa as any, f) as any;
    },
  };
}

/**
 * Create an Applicative for Effect with fixed requirements and error type.
 */
export function effectApplicative<R, E>(
  E: typeof import("effect/Effect"),
): Applicative<EffectF<R, E>> {
  const functor = effectFunctor<R, E>(E);
  return {
    ...functor,
    pure: <A>(a: A): $<EffectF<R, E>, A> => {
      return E.succeed(a) as any;
    },
    ap: <A, B>(
      fab: $<EffectF<R, E>, (a: A) => B>,
      fa: $<EffectF<R, E>, A>,
    ): $<EffectF<R, E>, B> => {
      return E.flatMap(fab as any, (f: any) => E.map(fa as any, f)) as any;
    },
  };
}

/**
 * Create a Monad for Effect with fixed requirements and error type.
 */
export function effectMonad<R, E>(
  E: typeof import("effect/Effect"),
): Monad<EffectF<R, E>> {
  const applicative = effectApplicative<R, E>(E);
  return {
    ...applicative,
    flatMap: <A, B>(
      fa: $<EffectF<R, E>, A>,
      f: (a: A) => $<EffectF<R, E>, B>,
    ): $<EffectF<R, E>, B> => {
      return E.flatMap(fa as any, f as any) as any;
    },
  };
}

/**
 * Create a MonadError for Effect with fixed requirements and error type.
 */
export function effectMonadError<R, E>(
  E: typeof import("effect/Effect"),
): MonadError<EffectF<R, E>, E> {
  const monad = effectMonad<R, E>(E);
  return {
    ...monad,
    raiseError: <A>(e: E): $<EffectF<R, E>, A> => {
      return E.fail(e) as any;
    },
    handleErrorWith: <A>(
      fa: $<EffectF<R, E>, A>,
      handler: (e: E) => $<EffectF<R, E>, A>,
    ): $<EffectF<R, E>, A> => {
      return E.catchAll(fa as any, handler as any) as any;
    },
  };
}

/**
 * Create a SemigroupK for Effect (using orElse semantics).
 */
export function effectSemigroupK<R, E>(
  E: typeof import("effect/Effect"),
): SemigroupK<EffectF<R, E>> {
  return {
    combineK: <A>(
      x: $<EffectF<R, E>, A>,
      y: $<EffectF<R, E>, A>,
    ): $<EffectF<R, E>, A> => {
      return E.orElse(x as any, () => y as any) as any;
    },
  };
}

// ============================================================================
// Stream Instances
// ============================================================================

/**
 * Create a Functor for Stream.
 */
export function streamFunctor<R, E>(
  S: typeof import("effect/Stream"),
): Functor<StreamF<R, E>> {
  return {
    map: <A, B>(
      fa: $<StreamF<R, E>, A>,
      f: (a: A) => B,
    ): $<StreamF<R, E>, B> => {
      return S.map(fa as any, f) as any;
    },
  };
}

/**
 * Create a Monad for Stream.
 */
export function streamMonad<R, E>(
  S: typeof import("effect/Stream"),
): Monad<StreamF<R, E>> {
  const functor = streamFunctor<R, E>(S);
  return {
    ...functor,
    pure: <A>(a: A): $<StreamF<R, E>, A> => {
      return S.succeed(a) as any;
    },
    ap: <A, B>(
      fab: $<StreamF<R, E>, (a: A) => B>,
      fa: $<StreamF<R, E>, A>,
    ): $<StreamF<R, E>, B> => {
      return S.flatMap(fab as any, (f: any) => S.map(fa as any, f)) as any;
    },
    flatMap: <A, B>(
      fa: $<StreamF<R, E>, A>,
      f: (a: A) => $<StreamF<R, E>, B>,
    ): $<StreamF<R, E>, B> => {
      return S.flatMap(fa as any, f as any) as any;
    },
  };
}

/**
 * Create a SemigroupK for Stream (concatenation).
 */
export function streamSemigroupK<R, E>(
  S: typeof import("effect/Stream"),
): SemigroupK<StreamF<R, E>> {
  return {
    combineK: <A>(
      x: $<StreamF<R, E>, A>,
      y: $<StreamF<R, E>, A>,
    ): $<StreamF<R, E>, A> => {
      return S.concat(x as any, y as any) as any;
    },
  };
}

/**
 * Create a MonoidK for Stream.
 */
export function streamMonoidK<R, E>(
  S: typeof import("effect/Stream"),
): MonoidK<StreamF<R, E>> {
  return {
    ...streamSemigroupK<R, E>(S),
    emptyK: <A>(): $<StreamF<R, E>, A> => {
      return S.empty as any;
    },
  };
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Extract the success type from an Effect
 */
export type EffectSuccess<T> = T extends Effect<infer A, any, any> ? A : never;

/**
 * Extract the error type from an Effect
 */
export type EffectError<T> = T extends Effect<any, infer E, any> ? E : never;

/**
 * Extract the requirements type from an Effect
 */
export type EffectContext<T> = T extends Effect<any, any, infer R> ? R : never;
