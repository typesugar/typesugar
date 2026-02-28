/**
 * Incremental Macro Expansion Cache
 *
 * Caches the results of macro expansions keyed by a hash of the input
 * (source text + macro name + arguments). On subsequent compilations,
 * if the input hasn't changed, the cached expansion is reused.
 *
 * Inspired by: Rust incremental compilation, Gradle build cache, Bazel
 *
 * @example
 * ```typescript
 * // In transformer setup:
 * const cache = new MacroExpansionCache(".typesugar-cache");
 *
 * // Before expanding:
 * const cacheKey = cache.computeKey(macroName, sourceText, argTexts);
 * const cached = cache.get(cacheKey);
 * if (cached) return cached;
 *
 * // After expanding:
 * cache.set(cacheKey, expandedText);
 * ```
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// =============================================================================
// Cache Entry
// =============================================================================

interface CacheEntry {
  /** Hash of the input that produced this expansion */
  inputHash: string;

  /** The expanded source text */
  expandedText: string;

  /** Timestamp when the entry was created */
  timestamp: number;

  /** Version of the macro system (invalidates on upgrade) */
  version: string;
}

// =============================================================================
// Cache Store
// =============================================================================

/** Current cache format version — bump to invalidate all caches */
const CACHE_VERSION = "2";

/**
 * Separator used to join multiple node code strings in a single cache entry.
 * Chosen to be unlikely to appear in generated TypeScript code.
 */
const MULTI_NODE_SEPARATOR = "\n/* __TYPESUGAR_CACHE_SEP__ */\n";

/**
 * On-disk cache for macro expansion results.
 *
 * The cache is stored as a single JSON file. For large projects,
 * this could be split into per-file caches.
 */
export class MacroExpansionCache {
  private entries = new Map<string, CacheEntry>();
  private dirty = false;
  private cacheFilePath: string;

  /** Statistics for cache performance monitoring */
  public stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  constructor(cacheDir: string = ".typesugar-cache") {
    this.cacheFilePath = path.resolve(cacheDir, "expansions.json");
    this.load();
  }

  /**
   * Compute a cache key from the macro name, source text, and arguments.
   */
  computeKey(macroName: string, sourceText: string, argTexts: string[]): string {
    const input = [macroName, sourceText, ...argTexts].join("\0");
    return crypto.createHash("sha256").update(input).digest("hex").slice(0, 32);
  }

  /**
   * Look up a cached expansion.
   * Returns the expanded text if found and valid, undefined otherwise.
   */
  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (entry && entry.version === CACHE_VERSION) {
      this.stats.hits++;
      return entry.expandedText;
    }

    if (entry) {
      // Version mismatch — evict
      this.entries.delete(key);
      this.stats.evictions++;
      this.dirty = true;
    }

    this.stats.misses++;
    return undefined;
  }

  /**
   * Store a macro expansion result in the cache.
   */
  set(key: string, expandedText: string): void {
    this.entries.set(key, {
      inputHash: key,
      expandedText,
      timestamp: Date.now(),
      version: CACHE_VERSION,
    });
    this.dirty = true;
  }

  /**
   * Invalidate a specific cache entry.
   */
  invalidate(key: string): void {
    if (this.entries.delete(key)) {
      this.dirty = true;
      this.stats.evictions++;
    }
  }

  /**
   * Invalidate all entries for a specific macro.
   */
  invalidateMacro(macroName: string): void {
    // Since the macro name is part of the hash, we can't efficiently
    // find entries by macro name. For now, just clear everything.
    // A more sophisticated implementation would maintain a secondary index.
    this.clear();
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    const count = this.entries.size;
    this.entries.clear();
    this.dirty = true;
    this.stats.evictions += count;
  }

  /**
   * Persist the cache to disk.
   * Call this at the end of compilation.
   */
  save(): void {
    if (!this.dirty) return;

    try {
      const dir = path.dirname(this.cacheFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data: Record<string, CacheEntry> = {};
      for (const [key, entry] of this.entries) {
        data[key] = entry;
      }

      fs.writeFileSync(this.cacheFilePath, JSON.stringify(data, null, 2), "utf-8");
      this.dirty = false;
    } catch {
      // Cache write failure is non-fatal
    }
  }

  /**
   * Load the cache from disk.
   */
  private load(): void {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const raw = fs.readFileSync(this.cacheFilePath, "utf-8");
        const data = JSON.parse(raw) as Record<string, CacheEntry>;

        for (const [key, entry] of Object.entries(data)) {
          if (entry.version === CACHE_VERSION) {
            this.entries.set(key, entry);
          }
        }
      }
    } catch {
      // Cache read failure is non-fatal — start with empty cache
      this.entries.clear();
    }
  }

  /**
   * Get cache statistics as a formatted string.
   */
  getStatsString(): string {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) : "0.0";
    return (
      `Cache: ${this.stats.hits} hits, ${this.stats.misses} misses ` +
      `(${hitRate}% hit rate), ${this.stats.evictions} evictions, ` +
      `${this.entries.size} entries`
    );
  }

  /**
   * Store multiple code strings (e.g., from attribute/derive macros that
   * return `Node[]`) as a single cache entry.
   */
  setMulti(key: string, codeStrings: string[]): void {
    this.set(key, codeStrings.join(MULTI_NODE_SEPARATOR));
  }

  /**
   * Retrieve a multi-node cache entry, splitting it back into individual
   * code strings. Returns undefined on cache miss.
   */
  getMulti(key: string): string[] | undefined {
    const raw = this.get(key);
    if (raw === undefined) return undefined;
    return raw.split(MULTI_NODE_SEPARATOR);
  }

  /**
   * Compute a structural cache key for auto-derivation.
   *
   * Unlike call-site caching (which hashes the source text of the call),
   * derivation depends on the type's structure. This hashes the typeclass
   * name together with a JSON representation of the type metadata so that
   * any field change invalidates the entry.
   */
  computeStructuralKey(typeclassName: string, structuralJson: string): string {
    const input = `derive\0${typeclassName}\0${structuralJson}`;
    return crypto.createHash("sha256").update(input).digest("hex").slice(0, 32);
  }

  /** Number of entries currently held in memory */
  get size(): number {
    return this.entries.size;
  }
}

// =============================================================================
// In-Memory Cache (for single compilation runs)
// =============================================================================

/**
 * Lightweight in-memory cache for a single compilation run.
 * No disk I/O, no serialization overhead.
 */
export class InMemoryExpansionCache {
  private entries = new Map<string, string>();

  computeKey(macroName: string, sourceText: string, argTexts: string[]): string {
    const input = [macroName, sourceText, ...argTexts].join("\0");
    return crypto.createHash("sha256").update(input).digest("hex").slice(0, 32);
  }

  get(key: string): string | undefined {
    return this.entries.get(key);
  }

  set(key: string, expandedText: string): void {
    this.entries.set(key, expandedText);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
