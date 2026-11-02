/**
 * HashMap<K, V> — A map backed by hash bucketing using Eq<K> + Hash<K>.
 *
 * API mirrors native Map<K, V> for drop-in usage.
 * Auto-specialization compiles HashMap<string, V> to the equivalent of native Map<string, V>.
 *
 * Semantics shared with native Map:
 * - NaN is one key: it is treated as equal to itself even though `Eq<number>`
 *   (`===` semantics) says `NaN !== NaN`. The supplied `Hash` must give NaN a
 *   single hash (std's `hashNumber` does).
 * - Deleting entries while iterating is safe: entries not yet visited are still
 *   visited unless they were deleted first.
 *
 * Differences: iteration follows hash-bucket order, not insertion order.
 */

import type { Eq, Hash } from "@typesugar/std";

interface Entry<K, V> {
  key: K;
  value: V;
}

export class HashMap<K, V> {
  private readonly _eq: Eq<K>;
  private readonly _hash: Hash<K>;
  private readonly _buckets = new Map<number, Entry<K, V>[]>();
  private _size = 0;

  constructor(eq: Eq<K>, hash: Hash<K>) {
    this._eq = eq;
    this._hash = hash;
  }

  get size(): number {
    return this._size;
  }

  /** `Eq.equals`, plus NaN equal to itself (SameValueZero, like native Map). */
  private _same(a: K, b: K): boolean {
    // `x !== x` holds only for NaN.
    return this._eq.equals(a, b) || (a !== a && b !== b);
  }

  private _findEntry(bucket: Entry<K, V>[], k: K): Entry<K, V> | undefined {
    for (let i = 0; i < bucket.length; i++) {
      if (this._same(k, bucket[i].key)) return bucket[i];
    }
    return undefined;
  }

  get(k: K): V | undefined {
    const h = this._hash.hash(k);
    const bucket = this._buckets.get(h);
    if (!bucket) return undefined;
    const entry = this._findEntry(bucket, k);
    return entry?.value;
  }

  has(k: K): boolean {
    const h = this._hash.hash(k);
    const bucket = this._buckets.get(h);
    if (!bucket) return false;
    return this._findEntry(bucket, k) !== undefined;
  }

  set(k: K, v: V): this {
    const h = this._hash.hash(k);
    let bucket = this._buckets.get(h);
    if (!bucket) {
      this._buckets.set(h, [{ key: k, value: v }]);
      this._size++;
      return this;
    }
    const entry = this._findEntry(bucket, k);
    if (entry) {
      entry.value = v;
    } else {
      bucket.push({ key: k, value: v });
      this._size++;
    }
    return this;
  }

  delete(k: K): boolean {
    const h = this._hash.hash(k);
    const bucket = this._buckets.get(h);
    if (!bucket) return false;
    for (let i = 0; i < bucket.length; i++) {
      if (this._same(k, bucket[i].key)) {
        bucket.splice(i, 1);
        if (bucket.length === 0) this._buckets.delete(h);
        this._size--;
        return true;
      }
    }
    return false;
  }

  clear(): void {
    this._buckets.clear();
    this._size = 0;
  }

  /**
   * Live entries, safe against deletion during iteration. `delete` splices the
   * live bucket array, so walking it by index would skip the entry after a
   * deleted one. Walk a snapshot instead, and skip entries deleted since the
   * snapshot (the bucket left the map, or no longer holds that entry object).
   */
  private *_liveEntries(): IterableIterator<Entry<K, V>> {
    for (const [h, bucket] of this._buckets) {
      const snapshot = bucket.slice();
      for (const entry of snapshot) {
        if (this._buckets.get(h) === bucket && bucket.includes(entry)) yield entry;
      }
    }
  }

  *entries(): IterableIterator<[K, V]> {
    for (const { key, value } of this._liveEntries()) yield [key, value];
  }

  *keys(): IterableIterator<K> {
    for (const { key } of this._liveEntries()) yield key;
  }

  *values(): IterableIterator<V> {
    for (const { value } of this._liveEntries()) yield value;
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  forEach(fn: (value: V, key: K) => void): void {
    for (const [k, v] of this) fn(v, k);
  }

  getOrElse(k: K, fallback: V): V {
    const h = this._hash.hash(k);
    const bucket = this._buckets.get(h);
    if (!bucket) return fallback;
    const entry = this._findEntry(bucket, k);
    return entry ? entry.value : fallback;
  }
}
