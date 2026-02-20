/**
 * FlatMap Typeclass
 *
 * Provides sequencing/chaining operations for type constructors.
 * This is the minimal typeclass required for do-notation (`let:/yield:`).
 *
 * Unlike Monad, FlatMap doesn't require `pure`/`of` — it only needs
 * `map` and `flatMap`. This makes it usable with types that support
 * chaining but don't have a natural way to lift pure values.
 *
 * ## Instances
 *
 * Built-in instances are provided for:
 * - Array<A> — flatMap is Array.prototype.flatMap
 * - Promise<A> — flatMap is Promise.prototype.then
 * - Iterable<A> — lazy flatMap via generator functions
 * - AsyncIterable<A> — async lazy flatMap via async generators
 *
 * ## Usage with let:/yield:
 *
 * ```typescript
 * // With Array
 * let: {
 *   x << [1, 2, 3]
 *   y << [x * 10, x * 20]
 * }
 * yield: { x, y }
 * // → [{ x: 1, y: 10 }, { x: 1, y: 20 }, { x: 2, y: 20 }, ...]
 *
 * // With Promise
 * let: {
 *   user << fetchUser(id)
 *   posts << fetchPosts(user.id)
 * }
 * yield: { user, posts }
 * // → Promise<{ user, posts }>
 * ```
 */

import { createGenericRegistry, type GenericRegistry } from "@typesugar/core";

// ============================================================================
// FlatMap Typeclass
// ============================================================================

/**
 * FlatMap typeclass — sequencing for type constructors.
 *
 * **@macro-only** — This interface is designed for macro-only use and is not
 * intended for direct consumption by end users. The `F` type parameter is
 * phantom (unused in the interface body) and all values are typed as `unknown`
 * because the let:/yield: macro handles type safety at the call site through
 * compile-time code generation.
 *
 * This is the minimal typeclass required for do-notation (`let:/yield:`).
 * It uses a simplified interface without HKT to avoid TypeScript's
 * type instantiation depth limits.
 *
 * Laws:
 * - Associativity: flatMap(flatMap(fa, f), g) = flatMap(fa, a => flatMap(f(a), g))
 * - Consistency: map(fa, f) = flatMap(fa, a => pure(f(a))) [when pure exists]
 *
 * Use `registerStdInstances()` macro to enable summon<FlatMap<F>>() resolution.
 * @internal
 */
export interface FlatMap<F> {
  /**
   * Transform the wrapped value.
   * @param fa The wrapped value
   * @param f The transformation function
   */
  map<A, B>(fa: unknown, f: (a: A) => B): unknown;

  /**
   * Sequence operations, flattening the result.
   * @param fa The wrapped value
   * @param f A function returning a new wrapped value
   */
  flatMap<A, B>(fa: unknown, f: (a: A) => unknown): unknown;
}

// ============================================================================
// Built-in Instances
// ============================================================================

/**
 * @internal Phantom tag for Array FlatMap instance.
 * Not intended for external use — exists only to parameterize FlatMap<F>.
 */
interface _ArrayTag {
  readonly _tag: "Array";
}

/**
 * @internal Phantom tag for Promise FlatMap instance.
 * Not intended for external use — exists only to parameterize FlatMap<F>.
 */
interface _PromiseTag {
  readonly _tag: "Promise";
}

/**
 * @internal Phantom tag for Iterable FlatMap instance.
 * Not intended for external use — exists only to parameterize FlatMap<F>.
 */
interface _IterableTag {
  readonly _tag: "Iterable";
}

/**
 * @internal Phantom tag for AsyncIterable FlatMap instance.
 * Not intended for external use — exists only to parameterize FlatMap<F>.
 */
interface _AsyncIterableTag {
  readonly _tag: "AsyncIterable";
}

/**
 * FlatMap instance for Array.
 *
 * Uses the native Array.prototype.map and Array.prototype.flatMap.
 * This compiles to direct method calls — zero overhead.
 */
export const flatMapArray: FlatMap<_ArrayTag> = {
  map: <A, B>(fa: unknown, f: (a: A) => B): unknown =>
    (fa as A[]).map(f),
  flatMap: <A, B>(fa: unknown, f: (a: A) => unknown): unknown =>
    (fa as A[]).flatMap(f as (a: A) => B[]),
};

/**
 * FlatMap instance for Promise.
 *
 * Uses Promise.prototype.then for both map and flatMap.
 * Promise automatically flattens nested promises, so
 * map and flatMap have the same implementation.
 */
export const flatMapPromise: FlatMap<_PromiseTag> = {
  map: <A, B>(fa: unknown, f: (a: A) => B): unknown =>
    (fa as Promise<A>).then(f),
  flatMap: <A, B>(fa: unknown, f: (a: A) => unknown): unknown =>
    (fa as Promise<A>).then(f as (a: A) => Promise<B>),
};

/**
 * FlatMap instance for Iterable.
 *
 * Uses generator functions for lazy evaluation.
 * Elements are produced on demand, not eagerly.
 */
export const flatMapIterable: FlatMap<_IterableTag> = {
  map: <A, B>(fa: unknown, f: (a: A) => B): unknown =>
    iterableMap(fa as Iterable<A>, f),
  flatMap: <A, B>(fa: unknown, f: (a: A) => unknown): unknown =>
    iterableFlatMap(fa as Iterable<A>, f as (a: A) => Iterable<B>),
};

/**
 * FlatMap instance for AsyncIterable.
 *
 * Uses async generator functions for lazy async evaluation.
 * Useful for streaming data processing.
 */
export const flatMapAsyncIterable: FlatMap<_AsyncIterableTag> = {
  map: <A, B>(fa: unknown, f: (a: A) => B): unknown =>
    asyncIterableMap(fa as AsyncIterable<A>, f),
  flatMap: <A, B>(fa: unknown, f: (a: A) => unknown): unknown =>
    asyncIterableFlatMap(fa as AsyncIterable<A>, f as (a: A) => AsyncIterable<B>),
};

// ============================================================================
// Helper Functions for Iterable/AsyncIterable
// ============================================================================

/**
 * Lazy map for Iterable.
 */
function* iterableMap<A, B>(fa: Iterable<A>, f: (a: A) => B): Iterable<B> {
  for (const a of fa) {
    yield f(a);
  }
}

/**
 * Lazy flatMap for Iterable.
 */
function* iterableFlatMap<A, B>(
  fa: Iterable<A>,
  f: (a: A) => Iterable<B>,
): Iterable<B> {
  for (const a of fa) {
    yield* f(a);
  }
}

/**
 * Lazy map for AsyncIterable.
 */
async function* asyncIterableMap<A, B>(
  fa: AsyncIterable<A>,
  f: (a: A) => B,
): AsyncIterable<B> {
  for await (const a of fa) {
    yield f(a);
  }
}

/**
 * Lazy flatMap for AsyncIterable.
 */
async function* asyncIterableFlatMap<A, B>(
  fa: AsyncIterable<A>,
  f: (a: A) => AsyncIterable<B>,
): AsyncIterable<B> {
  for await (const a of fa) {
    yield* f(a);
  }
}

// ============================================================================
// Instance Registry (for runtime lookup)
// ============================================================================

/**
 * Registry of FlatMap instances by type constructor name.
 * Used by the let:/yield: macro to resolve instances at compile time.
 *
 * Uses the generic Registry<K,V> abstraction from @typesugar/core with "replace"
 * duplicate strategy for backward compatibility (previously used warn + override).
 *
 * Module-private — use {@link registerFlatMap} and {@link getFlatMap} to access.
 */
const flatMapInstances: GenericRegistry<string, FlatMap<unknown>> = createGenericRegistry({
  name: "FlatMapRegistry",
  duplicateStrategy: "replace",
});

// Initialize built-in instances
flatMapInstances.set("Array", flatMapArray as FlatMap<unknown>);
flatMapInstances.set("Promise", flatMapPromise as FlatMap<unknown>);
flatMapInstances.set("Iterable", flatMapIterable as FlatMap<unknown>);
flatMapInstances.set("AsyncIterable", flatMapAsyncIterable as FlatMap<unknown>);

/**
 * Register a FlatMap instance for a type constructor.
 *
 * @param name The name of the type constructor (e.g., "Option", "Effect")
 * @param instance The FlatMap instance
 */
export function registerFlatMap<F>(
  name: string,
  instance: FlatMap<F>,
): void {
  if (flatMapInstances.has(name)) {
    console.warn(
      `[typesugar] FlatMap instance for '${name}' is already registered. Overriding.`,
    );
  }
  flatMapInstances.set(name, instance as FlatMap<unknown>);
}

/**
 * Get a FlatMap instance by type constructor name.
 *
 * @param name The name of the type constructor
 * @returns The FlatMap instance, or undefined if not found
 */
export function getFlatMap(name: string): FlatMap<unknown> | undefined {
  return flatMapInstances.get(name);
}
