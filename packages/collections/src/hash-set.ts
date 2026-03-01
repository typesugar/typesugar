/**
 * HashSet<K> — A set backed by hash bucketing using Eq<K> + Hash<K>.
 *
 * API mirrors native Set<K> for drop-in usage.
 * With specialize(), HashSet<string> compiles to equivalent of native Set<string>.
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

  has(k: K): boolean {
    const h = this._hash.hash(k);
    const bucket = this._buckets.get(h);
    if (!bucket) return false;
    for (let i = 0; i < bucket.length; i++) {
      if (this._eq.equals(k, bucket[i])) return true;
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
      if (this._eq.equals(k, bucket[i])) return this;
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
      if (this._eq.equals(k, bucket[i])) {
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
    for (const bucket of this._buckets.values()) {
      for (const k of bucket) yield k;
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
