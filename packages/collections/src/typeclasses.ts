/**
 * Collection Typeclasses
 *
 * Non-HKT, multi-parameter typeclasses for concrete collection types.
 * Complements the HKT Foldable/Traverse in @typesugar/fp.
 *
 * Hierarchy:
 *   IterableOnce<I, A>
 *     └── Iterable<I, A>
 *           ├── Seq<S, A>
 *           ├── SetLike<S, K> → PersistentSetLike / MutableSetLike
 *           └── MapLike<M, K, V> → PersistentMapLike / MutableMapLike
 */

// ============================================================================
// IterableOnce — one-shot fold (non-HKT analog of Foldable)
// ============================================================================

/**
 * A structure that can be consumed by folding. May only be traversed once
 * (like an iterator) or many times (like a collection).
 */
export interface IterableOnce<I, A> {
  fold<B>(i: I, z: B, f: (acc: B, a: A) => B): B;
}

// ============================================================================
// Iterable — re-traversable, produces fresh iterators
// ============================================================================

/**
 * A structure that can be iterated repeatedly, producing a fresh JS iterator
 * each time.
 */
export interface Iterable<I, A> extends IterableOnce<I, A> {
  iterator(i: I): globalThis.IterableIterator<A>;
}

// ============================================================================
// Seq — ordered, indexed access
// ============================================================================

/**
 * An ordered, indexable sequence.
 */
export interface Seq<S, A> extends Iterable<S, A> {
  length(s: S): number;
  nth(s: S, index: number): A | undefined;
}

// ============================================================================
// SetLike — read-only set interface
// ============================================================================

/**
 * Read-only set operations. Shared base for both persistent and mutable sets.
 */
export interface SetLike<S, K> extends Iterable<S, K> {
  has(s: S, k: K): boolean;
  size(s: S): number;
}

// ============================================================================
// MapLike — read-only map interface
// ============================================================================

/**
 * Read-only map operations. Shared base for both persistent and mutable maps.
 */
export interface MapLike<M, K, V> extends Iterable<M, [K, V]> {
  get(m: M, k: K): V | undefined;
  has(m: M, k: K): boolean;
  size(m: M): number;
  keys(m: M): globalThis.IterableIterator<K>;
  values(m: M): globalThis.IterableIterator<V>;
}

// ============================================================================
// Persistent (immutable) variants — FP-style
// ============================================================================

/**
 * Persistent set: add/remove return new sets, originals unchanged.
 */
export interface PersistentSetLike<S, K> extends SetLike<S, K> {
  empty: S;
  add(s: S, k: K): S;
  remove(s: S, k: K): S;
}

/**
 * Persistent map: set/remove return new maps, originals unchanged.
 */
export interface PersistentMapLike<M, K, V> extends MapLike<M, K, V> {
  empty: M;
  set(m: M, k: K, v: V): M;
  remove(m: M, k: K): M;
}

// ============================================================================
// Mutable variants — imperative-style
// ============================================================================

/**
 * Mutable set: add/delete mutate in place.
 * `create()` is the factory method (like Scala companion `.empty`).
 */
export interface MutableSetLike<S, K> extends SetLike<S, K> {
  create(): S;
  add(s: S, k: K): void;
  delete(s: S, k: K): boolean;
  clear(s: S): void;
}

/**
 * Mutable map: set/delete mutate in place.
 * `create()` is the factory method.
 */
export interface MutableMapLike<M, K, V> extends MapLike<M, K, V> {
  create(): M;
  set(m: M, k: K, v: V): void;
  delete(m: M, k: K): boolean;
  clear(m: M): void;
}
