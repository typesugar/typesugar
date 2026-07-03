/**
 * ParCombine Typeclass — runtime instances (PEP-050 Case-1).
 *
 * This entry is **runtime-only** and does NOT import `typescript`. It holds the
 * `ParCombine` interface and the built-in runtime instances (Promise,
 * AsyncIterable, Array, Iterable).
 *
 * The compile-time builders + registry (which import `typescript`) live in the
 * sibling `par-combine.ts`, loaded by the transformer via the `./macros` entry.
 *
 * @internal
 */

// ============================================================================
// ParCombine Typeclass
// ============================================================================

/**
 * ParCombine typeclass — parallel combination for type constructors.
 *
 * Defines how to combine multiple independent effects into a single effect
 * containing all results. Used by par:/yield: macro.
 *
 * @macro-only — Uses `unknown` because the macro handles type safety at
 * the call site through compile-time code generation.
 */
export interface ParCombine<F> {
  /**
   * Combine multiple independent effects into a single effect of an array.
   */
  all(effects: readonly unknown[]): unknown;

  /**
   * Map/transform the combined result.
   */
  map(combined: unknown, f: (results: unknown[]) => unknown): unknown;
}

// ============================================================================
// Phantom Tags
// ============================================================================

interface _PromiseTag {
  readonly _tag: "Promise";
}

interface _AsyncIterableTag {
  readonly _tag: "AsyncIterable";
}

interface _ArrayTag {
  readonly _tag: "Array";
}

interface _IterableTag {
  readonly _tag: "Iterable";
}

// ============================================================================
// Built-in Instances
// ============================================================================

/**
 * @do-methods map=then all=all receiver=Promise
 */
export const parCombinePromise: ParCombine<_PromiseTag> = {
  all: (effects) => Promise.all(effects as Promise<unknown>[]),
  map: (combined, f) => (combined as Promise<unknown[]>).then(f as (r: unknown[]) => unknown),
};

async function collectAsync<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iter) result.push(item);
  return result;
}

export const parCombineAsyncIterable: ParCombine<_AsyncIterableTag> = {
  all: (effects) =>
    Promise.all(
      (effects as AsyncIterable<unknown>[]).map((e) => collectAsync(e as AsyncIterable<unknown>))
    ),
  map: (combined, f) => (combined as Promise<unknown[]>).then(f as (r: unknown[]) => unknown),
};

function cartesianProduct(arrays: unknown[][]): unknown[][] {
  return arrays.reduce<unknown[][]>(
    (acc, arr) => acc.flatMap((combo) => arr.map((item) => [...combo, item])),
    [[]]
  );
}

export const parCombineArray: ParCombine<_ArrayTag> = {
  all: (effects) => cartesianProduct(effects as unknown[][]),
  map: (combined, f) => (combined as unknown[][]).map(f),
};

export const parCombineIterable: ParCombine<_IterableTag> = {
  all: (effects) => {
    const arrays = (effects as Iterable<unknown>[]).map((it) => Array.from(it));
    return cartesianProduct(arrays);
  },
  map: (combined, f) => (combined as unknown[][]).map(f),
};
