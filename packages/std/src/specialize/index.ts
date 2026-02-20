/**
 * Std Specialization Support
 *
 * Re-exports std's FlatMap instances for use with the `specialize()` macro.
 * The instances are registered with the core specialization registry at
 * compile time (in the transformer), enabling zero-cost abstraction for
 * generic FlatMap-polymorphic code.
 *
 * ## Usage
 *
 * Users can write generic code using the FlatMap interface and then
 * specialize it to eliminate dictionary passing:
 *
 * ```typescript
 * import { specialize } from "typemacro";
 * import { stdFlatMapArray, stdFlatMapPromise } from "@typesugar/std/specialize";
 *
 * // Generic function using FlatMap
 * function double<F>(F: FlatMap<F>, fa: Kind<F, number>): Kind<F, number> {
 *   return F.map(fa, x => x * 2);
 * }
 *
 * // Specialized versions — zero dictionary overhead
 * const doubleArray = specialize(double, stdFlatMapArray);
 * // Expands to: (fa: number[]) => fa.map(x => x * 2)
 *
 * const doublePromise = specialize(double, stdFlatMapPromise);
 * // Expands to: (fa: Promise<number>) => fa.then(x => x * 2)
 * ```
 *
 * ## Registered Instances
 *
 * The following instances are registered with the core specialization
 * registry and can be referenced by name with `specialize()`:
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
// Export std FlatMap instances for use with specialize()
// ============================================================================

/**
 * FlatMap instance for Array — use with specialize() for zero-cost abstraction.
 *
 * @example
 * ```typescript
 * const doubleArray = specialize(double, stdFlatMapArray);
 * ```
 */
export const stdFlatMapArray: FlatMap<unknown> = flatMapArray;

/**
 * FlatMap instance for Promise — use with specialize() for zero-cost abstraction.
 *
 * @example
 * ```typescript
 * const doublePromise = specialize(double, stdFlatMapPromise);
 * ```
 */
export const stdFlatMapPromise: FlatMap<unknown> = flatMapPromise;

/**
 * FlatMap instance for Iterable — use with specialize() for zero-cost abstraction.
 *
 * @example
 * ```typescript
 * const doubleIterable = specialize(double, stdFlatMapIterable);
 * ```
 */
export const stdFlatMapIterable: FlatMap<unknown> = flatMapIterable;

/**
 * FlatMap instance for AsyncIterable — use with specialize() for zero-cost abstraction.
 *
 * @example
 * ```typescript
 * const doubleAsyncIterable = specialize(double, stdFlatMapAsyncIterable);
 * ```
 */
export const stdFlatMapAsyncIterable: FlatMap<unknown> = flatMapAsyncIterable;

// ============================================================================
// Pre-specialized helpers for common patterns
// ============================================================================

/**
 * Pre-specialized array map. Equivalent to `specialize((F, fa, f) => F.map(fa, f), stdFlatMapArray)`.
 *
 * This is a compile-time optimization hint — the actual specialization
 * happens when code using these helpers is transformed.
 */
export function arrayMap<A, B>(fa: A[], f: (a: A) => B): B[] {
  return fa.map(f);
}

/**
 * Pre-specialized array flatMap. Equivalent to `specialize((F, fa, f) => F.flatMap(fa, f), stdFlatMapArray)`.
 */
export function arrayFlatMap<A, B>(fa: A[], f: (a: A) => B[]): B[] {
  return fa.flatMap(f);
}

/**
 * Pre-specialized promise map. Equivalent to `specialize((F, fa, f) => F.map(fa, f), stdFlatMapPromise)`.
 */
export function promiseMap<A, B>(fa: Promise<A>, f: (a: A) => B): Promise<B> {
  return fa.then(f);
}

/**
 * Pre-specialized promise flatMap. Equivalent to `specialize((F, fa, f) => F.flatMap(fa, f), stdFlatMapPromise)`.
 */
export function promiseFlatMap<A, B>(
  fa: Promise<A>,
  f: (a: A) => Promise<B>,
): Promise<B> {
  return fa.then(f);
}

/**
 * Pre-specialized iterable map — lazy evaluation.
 */
export function* iterableMap<A, B>(
  fa: Iterable<A>,
  f: (a: A) => B,
): Iterable<B> {
  for (const a of fa) {
    yield f(a);
  }
}

/**
 * Pre-specialized iterable flatMap — lazy evaluation.
 */
export function* iterableFlatMap<A, B>(
  fa: Iterable<A>,
  f: (a: A) => Iterable<B>,
): Iterable<B> {
  for (const a of fa) {
    yield* f(a);
  }
}

/**
 * Pre-specialized async iterable map — lazy async evaluation.
 */
export async function* asyncIterableMap<A, B>(
  fa: AsyncIterable<A>,
  f: (a: A) => B,
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
  f: (a: A) => AsyncIterable<B>,
): AsyncIterable<B> {
  for await (const a of fa) {
    yield* f(a);
  }
}

// ============================================================================
// Type re-exports for convenience
// ============================================================================

export type { FlatMap };
