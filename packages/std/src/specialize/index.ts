/**
 * Std Specialization Support
 *
 * Re-exports std's FlatMap instances so generic FlatMap-polymorphic code
 * gets zero-cost abstraction automatically. Specialization is an always-on
 * compiler optimization (PEP-053) — there is no macro to call.
 *
 * ## Usage
 *
 * Write generic code using the FlatMap interface; passing one of these known
 * instances auto-specializes the call, eliminating dictionary passing:
 *
 * ```typescript
 * import { stdFlatMapArray, stdFlatMapPromise } from "@typesugar/std/specialize";
 *
 * // Generic function using FlatMap
 * function double<F>(F: FlatMap<F>, fa: Kind<F, number>): Kind<F, number> {
 *   return F.map(fa, x => x * 2);
 * }
 *
 * // Auto-specialized — zero dictionary overhead
 * double(stdFlatMapArray, [1, 2, 3]);
 * // Compiles to: [1, 2, 3].map(x => x * 2)
 *
 * double(stdFlatMapPromise, somePromise);
 * // Compiles to: somePromise.then(x => x * 2)
 * ```
 *
 * ## Known Instances
 *
 * - `stdFlatMapArray` / `flatMapArray` — FlatMap for Array<A>
 * - `stdFlatMapPromise` / `flatMapPromise` — FlatMap for Promise<A>
 * - `stdFlatMapIterable` / `flatMapIterable` — FlatMap for Iterable<A>
 * - `stdFlatMapAsyncIterable` / `flatMapAsyncIterable` — FlatMap for AsyncIterable<A>
 *
 * @module
 */

import {
  flatMapArray,
  flatMapPromise,
  flatMapIterable,
  flatMapAsyncIterable,
  type FlatMap,
} from "../typeclasses/flatmap.js";

// ============================================================================
// Std FlatMap instances — passing these to a generic function auto-specializes
// ============================================================================

/**
 * FlatMap instance for Array — passing it to a generic function auto-specializes.
 *
 * @example
 * ```typescript
 * double(stdFlatMapArray, [1, 2, 3]);
 * ```
 */
export const stdFlatMapArray: FlatMap<unknown> = flatMapArray;

/**
 * FlatMap instance for Promise — passing it to a generic function auto-specializes.
 *
 * @example
 * ```typescript
 * double(stdFlatMapPromise, somePromise);
 * ```
 */
export const stdFlatMapPromise: FlatMap<unknown> = flatMapPromise;

/**
 * FlatMap instance for Iterable — passing it to a generic function auto-specializes.
 *
 * @example
 * ```typescript
 * double(stdFlatMapIterable, someIterable);
 * ```
 */
export const stdFlatMapIterable: FlatMap<unknown> = flatMapIterable;

/**
 * FlatMap instance for AsyncIterable — passing it to a generic function auto-specializes.
 *
 * @example
 * ```typescript
 * double(stdFlatMapAsyncIterable, someAsyncIterable);
 * ```
 */
export const stdFlatMapAsyncIterable: FlatMap<unknown> = flatMapAsyncIterable;

// ============================================================================
// Pre-specialized helpers for common patterns
// ============================================================================

/**
 * Direct Array map — what `(F, fa, f) => F.map(fa, f)` auto-specializes to
 * when called with `stdFlatMapArray`.
 */
export function arrayMap<A, B>(fa: A[], f: (a: A) => B): B[] {
  return fa.map(f);
}

/**
 * Direct Array flatMap — what `(F, fa, f) => F.flatMap(fa, f)` auto-specializes
 * to when called with `stdFlatMapArray`.
 */
export function arrayFlatMap<A, B>(fa: A[], f: (a: A) => B[]): B[] {
  return fa.flatMap(f);
}

/**
 * Direct Promise map — what `(F, fa, f) => F.map(fa, f)` auto-specializes to
 * when called with `stdFlatMapPromise`.
 */
export function promiseMap<A, B>(fa: Promise<A>, f: (a: A) => B): Promise<B> {
  return fa.then(f);
}

/**
 * Direct Promise flatMap — what `(F, fa, f) => F.flatMap(fa, f)` auto-specializes
 * to when called with `stdFlatMapPromise`.
 */
export function promiseFlatMap<A, B>(fa: Promise<A>, f: (a: A) => Promise<B>): Promise<B> {
  return fa.then(f);
}

/**
 * Pre-specialized iterable map — lazy evaluation.
 */
export function* iterableMap<A, B>(fa: Iterable<A>, f: (a: A) => B): Iterable<B> {
  for (const a of fa) {
    yield f(a);
  }
}

/**
 * Pre-specialized iterable flatMap — lazy evaluation.
 */
export function* iterableFlatMap<A, B>(fa: Iterable<A>, f: (a: A) => Iterable<B>): Iterable<B> {
  for (const a of fa) {
    yield* f(a);
  }
}

/**
 * Pre-specialized async iterable map — lazy async evaluation.
 */
export async function* asyncIterableMap<A, B>(
  fa: AsyncIterable<A>,
  f: (a: A) => B
): AsyncIterable<B> {
  for await (const a of fa) {
    yield f(a);
  }
}

/**
 * Pre-specialized async iterable flatMap — lazy async evaluation.
 */
export async function* asyncIterableFlatMap<A, B>(
  fa: AsyncIterable<A>,
  f: (a: A) => AsyncIterable<B>
): AsyncIterable<B> {
  for await (const a of fa) {
    yield* f(a);
  }
}

// ============================================================================
// Type re-exports for convenience
// ============================================================================

export type { FlatMap };
