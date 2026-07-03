/**
 * FlatMap Typeclass — runtime instances (PEP-050 Case-1).
 *
 * This entry is **runtime-only** and does NOT import `typescript`. It holds
 * the `FlatMap` interface and the built-in runtime instances (Array, Promise,
 * Iterable, AsyncIterable), split out of `flatmap.ts` so the
 * `@typesugar/std/syntax/do` activation marker can re-export them without
 * dragging the compile-time registry (which imports `typescript`) into user
 * runtime bundles.
 *
 * The `FlatMap<_ArrayTag>`-style type annotations double as the PEP-052
 * scope-resolution declarations: the instance scanner detects
 * `flatMapArray: FlatMap<_ArrayTag>` and serves the inferred brand `Array`
 * via the `_BTag` phantom-tag convention. Deliberately NOT `@impl` JSDoc —
 * std builds with the typesugar plugin, and the `@impl` attribute macro's
 * expansion is not neutral for global builtins (HKT annotation rewrite +
 * `namespace Array { ... }` companion merge shadowing the global).
 *
 * @internal
 */

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
// Phantom Tags
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

// ============================================================================
// Built-in Instances
// ============================================================================

/**
 * FlatMap instance for Array.
 *
 * Uses the native Array.prototype.map and Array.prototype.flatMap.
 * This compiles to direct method calls — zero overhead.
 */
export const flatMapArray: FlatMap<_ArrayTag> = {
  map: <A, B>(fa: unknown, f: (a: A) => B): unknown => (fa as A[]).map(f),
  flatMap: <A, B>(fa: unknown, f: (a: A) => unknown): unknown =>
    (fa as A[]).flatMap(f as (a: A) => B[]),
};

/**
 * FlatMap instance for Promise.
 *
 * Uses Promise.prototype.then for both map and flatMap.
 * Promise automatically flattens nested promises, so
 * map and flatMap have the same implementation.
 *
 * @do-methods bind=then map=then orElse=catch
 */
export const flatMapPromise: FlatMap<_PromiseTag> = {
  map: <A, B>(fa: unknown, f: (a: A) => B): unknown => (fa as Promise<A>).then(f),
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
  map: <A, B>(fa: unknown, f: (a: A) => B): unknown => iterableMap(fa as Iterable<A>, f),
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
  map: <A, B>(fa: unknown, f: (a: A) => B): unknown => asyncIterableMap(fa as AsyncIterable<A>, f),
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
function* iterableFlatMap<A, B>(fa: Iterable<A>, f: (a: A) => Iterable<B>): Iterable<B> {
  for (const a of fa) {
    yield* f(a);
  }
}

/**
 * Lazy map for AsyncIterable.
 */
async function* asyncIterableMap<A, B>(fa: AsyncIterable<A>, f: (a: A) => B): AsyncIterable<B> {
  for await (const a of fa) {
    yield f(a);
  }
}

/**
 * Lazy flatMap for AsyncIterable.
 */
async function* asyncIterableFlatMap<A, B>(
  fa: AsyncIterable<A>,
  f: (a: A) => AsyncIterable<B>
): AsyncIterable<B> {
  for await (const a of fa) {
    yield* f(a);
  }
}
