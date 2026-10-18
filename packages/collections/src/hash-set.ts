/**
 * HashSet<K> — A set backed by hash bucketing using Eq<K> + Hash<K>.
 *
 * API mirrors native Set<K> for drop-in usage.
 * Auto-specialization compiles HashSet<string> to the equivalent of native Set<string>.
 *
 * Semantics shared with native Set:
 * - NaN is one key: it is treated as equal to itself even though `Eq<number>`
 *   (`===` semantics) says `NaN !== NaN`, so `add(NaN)` twice gives size 1 and
 *   `has(NaN)` is true. The supplied `Hash` must give NaN a single hash (std's
 *   `hashNumber` does).
 * - Deleting entries while iterating is safe: entries not yet visited are still
 *   visited unless they were deleted first.
 *
 * Differences: iteration follows hash-bucket order, not insertion order.
 */

import type { Eq, Hash } from "@typesugar/std";

export class HashSet<K> {
  private readonly _eq: Eq<K>;
  private readonly _hash: Hash<K>;
  private readonly _buckets = new Map<number, K[]>();
  private _size = 0;

  constructor(eq: Eq<K>, hash: Hash<K>) {
    this._eq = eq;
    this._hash = hash;
  }

  get size(): number {
    return this._size;
  }

  /** `Eq.equals`, plus NaN equal to itself (SameValueZero, like native Set). */
  private _same(a: K, b: K): boolean {
    // `x !== x` holds only for NaN.
    return this._eq.equals(a, b) || (a !== a && b !== b);
  }

  has(k: K): boolean {
    const h = this._hash.hash(k);
    const bucket = this._buckets.get(h);
    if (!bucket) return false;
    for (let i = 0; i < bucket.length; i++) {
      if (this._same(k, bucket[i])) return true;
    }
    return false;
  }

  add(k: K): this {
    const h = this._hash.hash(k);
    let bucket = this._buckets.get(h);
    if (!bucket) {
      this._buckets.set(h, [k]);
      this._size++;
      return this;
    }
    for (let i = 0; i < bucket.length; i++) {
      if (this._same(k, bucket[i])) return this;
    }
    bucket.push(k);
    this._size++;
    return this;
  }

  delete(k: K): boolean {
    const h = this._hash.hash(k);
    const bucket = this._buckets.get(h);
    if (!bucket) return false;
    for (let i = 0; i < bucket.length; i++) {
      if (this._same(k, bucket[i])) {
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

  *[Symbol.iterator](): IterableIterator<K> {
    // `delete` splices the live bucket array, so walking it by index would skip
    // the entry after a deleted one. Walk a snapshot instead, and skip entries
    // deleted since the snapshot (the bucket left the map, or no longer holds it).
    for (const [h, bucket] of this._buckets) {
      const snapshot = bucket.slice();
      for (const k of snapshot) {
        if (this._buckets.get(h) === bucket && bucket.includes(k)) yield k;
      }
    }
  }

  values(): IterableIterator<K> {
    return this[Symbol.iterator]();
  }

  forEach(fn: (value: K) => void): void {
    for (const k of this) fn(k);
  }

  toArray(): K[] {
    const result: K[] = [];
    for (const k of this) result.push(k);
    return result;
  }
}
