/**
 * In-Memory LRU Cache for Browser Playground
 *
 * Replaces the disk-backed cache from @typesugar/transformer with a
 * browser-compatible in-memory implementation.
 */

import type { TransformDiagnostic } from "@typesugar/transformer-core";

export interface CacheEntry<T> {
  value: T;
  hash: string;
}

export class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private accessOrder: string[] = [];
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  get(key: string, hash: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry || entry.hash !== hash) {
      return undefined;
    }
    this.recordAccess(key);
    return entry.value;
  }

  set(key: string, hash: string, value: T): void {
    this.cache.set(key, { value, hash });
    this.recordAccess(key);
    this.evictIfNeeded();
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): void {
    this.cache.delete(key);
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  get size(): number {
    return this.cache.size;
  }

  private recordAccess(key: string): void {
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }
    this.accessOrder.push(key);
  }

  private evictIfNeeded(): void {
    while (this.accessOrder.length > this.maxSize) {
      const oldest = this.accessOrder.shift();
      if (oldest) {
        this.cache.delete(oldest);
      }
    }
  }
}

export interface TransformCacheEntry {
  code: string;
  sourceMap: string | null;
  changed: boolean;
  diagnostics: TransformDiagnostic[];
}

export class BrowserTransformCache {
  private cache: LRUCache<TransformCacheEntry>;

  public stats = {
    hits: 0,
    misses: 0,
  };

  constructor(maxSize: number = 100) {
    this.cache = new LRUCache(maxSize);
  }

  get(key: string, hash: string): TransformCacheEntry | undefined {
    const entry = this.cache.get(key, hash);
    if (entry) {
      this.stats.hits++;
      return entry;
    }
    this.stats.misses++;
    return undefined;
  }

  set(key: string, hash: string, entry: TransformCacheEntry): void {
    this.cache.set(key, hash, entry);
  }

  clear(): void {
    this.cache.clear();
    this.stats.hits = 0;
    this.stats.misses = 0;
  }

  getStatsString(): string {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) : "0.0";
    return `Cache: ${this.stats.hits} hits, ${this.stats.misses} misses (${hitRate}% hit rate)`;
  }
}

export function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
