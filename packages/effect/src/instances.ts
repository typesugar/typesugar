/**
 * Typeclass Instances for Effect-TS Types
 *
 * This module bridges Effect-TS types into typesugar's typeclass hierarchy,
 * enabling generic FP code to work seamlessly with Effect.
 *
 * ## Available Instances
 *
 * - `effectFunctor<E, R>` — Functor for Effect.Effect
 * - `effectApply<E, R>` — Apply for Effect.Effect
 * - `effectApplicative<E, R>` — Applicative for Effect.Effect
 * - `effectMonad<E, R>` — Monad for Effect.Effect
 * - `effectMonadError<E, R>` — MonadError for Effect.Effect
 * - `chunkFunctor` — Functor for Chunk
 * - `chunkFoldable` — Foldable for Chunk
 * - `effectOptionFunctor` — Functor for Effect's Option
 * - `effectOptionMonad` — Monad for Effect's Option
 * - `effectEitherFunctor<E>` — Functor for Effect's Either
 * - `effectEitherMonad<E>` — Monad for Effect's Either
 *
 * ## Type Safety Note
 *
 * Due to TypeScript's HKT limitations, these instances use `any` casts internally.
 * The runtime behavior is correct — Effect.map, Effect.flatMap, etc. are called
 * with the appropriate arguments. The types work correctly at the call site.
 *
 * ## Zero-Cost Usage
 *
 * All instances follow the dictionary-passing style for zero-cost specialization:
 *
 * ```typescript
 * import { effectMonad, EffectF } from "@typesugar/effect";
 * import { flatten } from "@typesugar/fp/typeclasses/monad";
 *
 * // Generic code works with Effect
 * const flattenEffect = flatten(effectMonad<never, never>());
 *
 * // With specialize(), the dictionary is eliminated:
 * const optimized = specialize(flattenEffect);
 * ```
 *
 * @module
 */

import { Effect, Chunk, Option, Either } from "effect";
import type { EffectF, ChunkF, EffectOptionF, EffectEitherF } from "./hkt.js";

// ============================================================================
// Typeclass Interfaces
// ============================================================================

/**
 * Functor typeclass interface.
 */
export interface Functor<F> {
  readonly map: <A, B>(fa: any, f: (a: A) => B) => any;
}

/**
 * Apply typeclass interface (Functor + ap).
 */
export interface Apply<F> extends Functor<F> {
  readonly ap: <A, B>(fab: any, fa: any) => any;
}

/**
 * Applicative typeclass interface (Apply + pure).
 */
export interface Applicative<F> extends Apply<F> {
  readonly pure: <A>(a: A) => any;
}

/**
 * FlatMap typeclass interface (Apply + flatMap).
 */
export interface FlatMap<F> extends Apply<F> {
  readonly flatMap: <A, B>(fa: any, f: (a: A) => any) => any;
}

/**
 * Monad typeclass interface (FlatMap + Applicative).
 */
export interface Monad<F> extends FlatMap<F>, Applicative<F> {}

/**
 * MonadError typeclass interface (Monad + error handling).
 */
export interface MonadError<F, E> extends Monad<F> {
  readonly raiseError: <A>(e: E) => any;
  readonly handleErrorWith: <A>(fa: any, f: (e: E) => any) => any;
}

/**
 * Foldable typeclass interface.
 */
export interface Foldable<F> {
  readonly foldLeft: <A, B>(fa: any, b: B, f: (b: B, a: A) => B) => B;
  readonly foldRight: <A, B>(fa: any, b: B, f: (a: A, b: B) => B) => B;
}

/**
 * Traverse typeclass interface (Functor + Foldable + sequence).
 */
export interface Traverse<F> extends Functor<F>, Foldable<F> {
  readonly traverse: <G>(G: Applicative<G>) => <A, B>(fa: any, f: (a: A) => any) => any;
}

// ============================================================================
// Effect.Effect Instances
// ============================================================================

/**
 * Functor instance for Effect.Effect.
 *
 * @example
 * ```typescript
 * const F = effectFunctor<never, never>();
 * const mapped = F.map(Effect.succeed(1), n => n * 2);
 * ```
 */
export function effectFunctor<E = never, R = never>(): Functor<EffectF<E, R>> {
  return {
    map: (fa, f) => Effect.map(fa, f),
  };
}

/**
 * Apply instance for Effect.Effect.
 */
export function effectApply<E = never, R = never>(): Apply<EffectF<E, R>> {
  return {
    map: (fa, f) => Effect.map(fa, f),
    ap: (fab, fa) => Effect.flatMap(fab, (f: any) => Effect.map(fa, f)),
  };
}

/**
 * Applicative instance for Effect.Effect.
 */
export function effectApplicative<E = never, R = never>(): Applicative<EffectF<E, R>> {
  return {
    map: (fa, f) => Effect.map(fa, f),
    ap: (fab, fa) => Effect.flatMap(fab, (f: any) => Effect.map(fa, f)),
    pure: (a) => Effect.succeed(a),
  };
}

/**
 * Monad instance for Effect.Effect.
 *
 * @example
 * ```typescript
 * const M = effectMonad<never, never>();
 * const chained = M.flatMap(
 *   Effect.succeed(1),
 *   n => Effect.succeed(n * 2)
 * );
 * ```
 */
export function effectMonad<E = never, R = never>(): Monad<EffectF<E, R>> {
  return {
    map: (fa, f) => Effect.map(fa, f),
    ap: (fab, fa) => Effect.flatMap(fab, (f: any) => Effect.map(fa, f)),
    pure: (a) => Effect.succeed(a),
    flatMap: (fa, f) => Effect.flatMap(fa, f),
  };
}

/**
 * MonadError instance for Effect.Effect.
 *
 * @example
 * ```typescript
 * const ME = effectMonadError<Error, never>();
 * const handled = ME.handleErrorWith(
 *   Effect.fail(new Error("oops")),
 *   e => Effect.succeed("fallback")
 * );
 * ```
 */
export function effectMonadError<E, R = never>(): MonadError<EffectF<E, R>, E> {
  return {
    map: (fa, f) => Effect.map(fa, f),
    ap: (fab, fa) => Effect.flatMap(fab, (f: any) => Effect.map(fa, f)),
    pure: (a) => Effect.succeed(a),
    flatMap: (fa, f) => Effect.flatMap(fa, f),
    raiseError: (e) => Effect.fail(e),
    handleErrorWith: (fa, f) => Effect.catchAll(fa, f),
  };
}

// ============================================================================
// Chunk Instances
// ============================================================================

/**
 * Functor instance for Chunk.
 */
export const chunkFunctor: Functor<ChunkF> = {
  map: (fa, f) => Chunk.map(fa, f),
};

/**
 * Foldable instance for Chunk.
 */
export const chunkFoldable: Foldable<ChunkF> = {
  foldLeft: (fa, b, f) => Chunk.reduce(fa, b, f),
  foldRight: (fa, b, f) => Chunk.reduceRight(fa, b, (acc: any, a: any) => f(a, acc)),
};

/**
 * Traverse instance for Chunk.
 */
export function chunkTraverse(): Traverse<ChunkF> {
  return {
    map: (fa, f) => Chunk.map(fa, f),
    foldLeft: (fa, b, f) => Chunk.reduce(fa, b, f),
    foldRight: (fa, b, f) => Chunk.reduceRight(fa, b, (acc: any, a: any) => f(a, acc)),
    traverse:
      <G>(G: Applicative<G>) =>
      <A, B>(fa: Chunk.Chunk<A>, f: (a: A) => any): any => {
        return Chunk.reduce(fa, G.pure(Chunk.empty<B>()), (gb: any, a: A) =>
          G.ap(
            G.map(gb, (chunk: Chunk.Chunk<B>) => (b: B) => Chunk.append(chunk, b)),
            f(a)
          )
        );
      },
  };
}

// ============================================================================
// Effect's Option Instances
// ============================================================================

/**
 * Functor instance for Effect's Option.
 */
export const effectOptionFunctor: Functor<EffectOptionF> = {
  map: (fa, f) => Option.map(fa, f),
};

/**
 * Monad instance for Effect's Option.
 */
export const effectOptionMonad: Monad<EffectOptionF> = {
  map: (fa, f) => Option.map(fa, f),
  ap: (fab, fa) => Option.flatMap(fab, (f: any) => Option.map(fa, f)),
  pure: (a) => Option.some(a),
  flatMap: (fa, f) => Option.flatMap(fa, f),
};

/**
 * MonadError instance for Effect's Option (using undefined as the error type).
 */
export const effectOptionMonadError: MonadError<EffectOptionF, undefined> = {
  map: (fa, f) => Option.map(fa, f),
  ap: (fab, fa) => Option.flatMap(fab, (f: any) => Option.map(fa, f)),
  pure: (a) => Option.some(a),
  flatMap: (fa, f) => Option.flatMap(fa, f),
  raiseError: () => Option.none(),
  handleErrorWith: (fa, f) => Option.orElse(fa, () => f(undefined)),
};

// ============================================================================
// Effect's Either Instances
// ============================================================================

/**
 * Functor instance for Effect's Either with fixed E.
 */
export function effectEitherFunctor<E>(): Functor<EffectEitherF<E>> {
  return {
    map: (fa, f) => Either.map(fa, f),
  };
}

/**
 * Monad instance for Effect's Either with fixed E.
 */
export function effectEitherMonad<E>(): Monad<EffectEitherF<E>> {
  return {
    map: (fa, f) => Either.map(fa, f),
    ap: (fab, fa) => Either.flatMap(fab, (f: any) => Either.map(fa, f)),
    pure: (a) => Either.right(a),
    flatMap: (fa, f) => Either.flatMap(fa, f),
  };
}

/**
 * MonadError instance for Effect's Either.
 */
export function effectEitherMonadError<E>(): MonadError<EffectEitherF<E>, E> {
  return {
    map: (fa, f) => Either.map(fa, f),
    ap: (fab, fa) => Either.flatMap(fab, (f: any) => Either.map(fa, f)),
    pure: (a) => Either.right(a),
    flatMap: (fa, f) => Either.flatMap(fa, f),
    raiseError: (e) => Either.left(e),
    handleErrorWith: (fa, f) => {
      if (Either.isLeft(fa)) {
        return f(Either.getLeft(fa) as E);
      }
      return fa;
    },
  };
}

// ============================================================================
// Instance Registration for specialize()
// ============================================================================

/**
 * All Effect typeclass instances for use with specialize().
 * These are the concrete instance objects that can be inlined.
 */
export const effectInstances = {
  /** Functor<EffectF<E, R>> */
  effectFunctor,
  /** Apply<EffectF<E, R>> */
  effectApply,
  /** Applicative<EffectF<E, R>> */
  effectApplicative,
  /** Monad<EffectF<E, R>> */
  effectMonad,
  /** MonadError<EffectF<E, R>, E> */
  effectMonadError,
  /** Functor<ChunkF> */
  chunkFunctor,
  /** Foldable<ChunkF> */
  chunkFoldable,
  /** Traverse<ChunkF> */
  chunkTraverse,
  /** Functor<EffectOptionF> */
  effectOptionFunctor,
  /** Monad<EffectOptionF> */
  effectOptionMonad,
  /** MonadError<EffectOptionF, undefined> */
  effectOptionMonadError,
  /** Functor<EffectEitherF<E>> */
  effectEitherFunctor,
  /** Monad<EffectEitherF<E>> */
  effectEitherMonad,
  /** MonadError<EffectEitherF<E>, E> */
  effectEitherMonadError,
};
