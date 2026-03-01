/**
 * HashMap<K, V> — A map backed by hash bucketing using Eq<K> + Hash<K>.
 *
 * API mirrors native Map<K, V> for drop-in usage.
 * With specialize(), HashMap<string, V> compiles to equivalent of native Map<string, V>.
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

  private _findEntry(bucket: Entry<K, V>[], k: K): Entry<K, V> | undefined {
    for (let i = 0; i < bucket.length; i++) {
      if (this._eq.equals(k, bucket[i].key)) return bucket[i];
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
      if (this._eq.equals(k, bucket[i].key)) {
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

  *entries(): IterableIterator<[K, V]> {
    for (const bucket of this._buckets.values()) {
      for (const { key, value } of bucket) yield [key, value];
    }
  }

  *keys(): IterableIterator<K> {
    for (const bucket of this._buckets.values()) {
      for (const { key } of bucket) yield key;
    }
  }

  *values(): IterableIterator<V> {
    for (const bucket of this._buckets.values()) {
      for (const { value } of bucket) yield value;
    }
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
