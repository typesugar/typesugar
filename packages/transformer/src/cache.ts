/**
 * TransformCache - Layered caching with dependency tracking
 *
 * Three-level cache for optimal performance:
 * - L1: Preprocessor results (fast, invalidate on file content change)
 * - L2: Full transform results (slower, invalidate on dependency change)
 * - L3: ts.Program instance (expensive, invalidate on tsconfig or file add/remove)
 */

import type { RawSourceMap } from "@typesugar/preprocessor";
import type { TransformResult } from "./pipeline.js";
import xxhashInit, { type XXHashAPI } from "xxhash-wasm";

/** xxhash API - initialized lazily */
let xxhashApi: XXHashAPI | null = null;
let xxhashInitPromise: Promise<XXHashAPI> | null = null;

/**
 * Initialize xxhash for fast content hashing.
 * Call this early in build startup for best performance.
 * hashContent() will use fallback if not initialized.
 */
export async function initHasher(): Promise<void> {
  if (xxhashApi) return;
  if (!xxhashInitPromise) {
    xxhashInitPromise = xxhashInit();
  }
  xxhashApi = await xxhashInitPromise;
}

/**
 * Fast 64-bit content hash for cache invalidation.
 * Uses xxhash64 if initialized, falls back to DJB2 otherwise.
 *
 * @param content - String content to hash
 * @returns Hex string hash (16 chars for xxhash64, shorter for fallback)
 */
export function hashContent(content: string): string {
  if (xxhashApi) {
    // xxhash64 returns bigint, convert to hex string
    return xxhashApi.h64ToString(content);
  }

  // Fallback: DJB2 hash (32-bit, higher collision risk)
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

/**
 * Check if the fast hasher is initialized.
 */
export function isHasherInitialized(): boolean {
  return xxhashApi !== null;
}

/**
 * Preprocessor cache entry
 */
export interface PreprocessedCacheEntry {
  code: string;
  map: RawSourceMap | null;
  original: string;
  contentHash: string;
}

/**
 * Transform cache entry with dependency tracking
 */
export interface TransformCacheEntry {
  result: TransformResult;
  contentHash: string;
  dependencies: Set<string>;
  dependencyHashes: Map<string, string>;
}

/**
 * Dependency graph for tracking file relationships
 */
export class DependencyGraph {
  /** Map from file to its dependencies (files it imports) */
  private dependencies = new Map<string, Set<string>>();
  /** Map from file to its dependents (files that import it) */
  private dependents = new Map<string, Set<string>>();

  /**
   * Add dependencies for a file
   */
  setDependencies(fileName: string, deps: Set<string>): void {
    // Remove old dependency relationships
    const oldDeps = this.dependencies.get(fileName);
    if (oldDeps) {
      for (const dep of oldDeps) {
        this.dependents.get(dep)?.delete(fileName);
      }
    }

    // Add new dependency relationships
    this.dependencies.set(fileName, deps);
    for (const dep of deps) {
      let depSet = this.dependents.get(dep);
      if (!depSet) {
        depSet = new Set();
        this.dependents.set(dep, depSet);
      }
      depSet.add(fileName);
    }
  }

  /**
   * Get all files that depend on the given file
   */
  getDependents(fileName: string): Set<string> {
    return this.dependents.get(fileName) ?? new Set();
  }

  /**
   * Get all dependencies of the given file
   */
  getDependencies(fileName: string): Set<string> {
    return this.dependencies.get(fileName) ?? new Set();
  }

  /**
   * Get all transitive dependents (files that directly or indirectly depend on this file)
   */
  getTransitiveDependents(fileName: string): Set<string> {
    const visited = new Set<string>();
    const stack = [fileName];

    while (stack.length > 0) {
      const current = stack.pop()!;
      const deps = this.dependents.get(current);
      if (deps) {
        for (const dep of deps) {
          if (!visited.has(dep)) {
            visited.add(dep);
            stack.push(dep);
          }
        }
      }
    }

    return visited;
  }

  /**
   * Remove a file from the dependency graph
   */
  remove(fileName: string): void {
    // Remove from dependencies
    const deps = this.dependencies.get(fileName);
    if (deps) {
      for (const dep of deps) {
        this.dependents.get(dep)?.delete(fileName);
      }
    }
    this.dependencies.delete(fileName);

    // Remove from dependents
    const depSet = this.dependents.get(fileName);
    if (depSet) {
      for (const dep of depSet) {
        this.dependencies.get(dep)?.delete(fileName);
      }
    }
    this.dependents.delete(fileName);
  }

  /**
   * Clear the entire dependency graph
   */
  clear(): void {
    this.dependencies.clear();
    this.dependents.clear();
  }
}

/**
 * TransformCache - Three-level cache for transformation results
 */
export class TransformCache {
  /** L1: Preprocessor results (keyed by file name) */
  private preprocessed = new Map<string, PreprocessedCacheEntry>();

  /** L2: Full transform results (keyed by file name) */
  private transformed = new Map<string, TransformCacheEntry>();

  /** Dependency graph for invalidation tracking */
  private depGraph = new DependencyGraph();

  /** Maximum cache size (LRU eviction) */
  private maxSize: number;

  /** Access order for LRU eviction */
  private accessOrder: string[] = [];

  constructor(options: { maxSize?: number } = {}) {
    this.maxSize = options.maxSize ?? 1000;
  }

  // ---------------------------------------------------------------------------
  // L1: Preprocessor cache
  // ---------------------------------------------------------------------------

  /**
   * Get preprocessed content from L1 cache
   */
  getPreprocessed(fileName: string): PreprocessedCacheEntry | undefined {
    const entry = this.preprocessed.get(fileName);
    if (entry) {
      this.recordAccess(fileName);
    }
    return entry;
  }

  /**
   * Set preprocessed content in L1 cache
   */
  setPreprocessed(fileName: string, entry: PreprocessedCacheEntry): void {
    this.preprocessed.set(fileName, entry);
    this.recordAccess(fileName);
    this.evictIfNeeded();
  }

  /**
   * Check if L1 cache is valid for a file
   */
  isPreprocessedValid(fileName: string, currentContentHash: string): boolean {
    const entry = this.preprocessed.get(fileName);
    return entry !== undefined && entry.contentHash === currentContentHash;
  }

  // ---------------------------------------------------------------------------
  // L2: Transform cache
  // ---------------------------------------------------------------------------

  /**
   * Get transform result from L2 cache
   */
  getTransformed(fileName: string): TransformCacheEntry | undefined {
    const entry = this.transformed.get(fileName);
    if (entry) {
      this.recordAccess(fileName);
    }
    return entry;
  }

  /**
   * Set transform result in L2 cache
   */
  setTransformed(fileName: string, entry: TransformCacheEntry): void {
    this.transformed.set(fileName, entry);
    this.depGraph.setDependencies(fileName, entry.dependencies);
    this.recordAccess(fileName);
    this.evictIfNeeded();
  }

  /**
   * Check if L2 cache is valid for a file
   *
   * Validates:
   * 1. Content hash hasn't changed
   * 2. All dependency hashes are still valid
   */
  isTransformedValid(
    fileName: string,
    currentContentHash: string,
    getContentHash: (dep: string) => string | undefined
  ): boolean {
    const entry = this.transformed.get(fileName);
    if (!entry) return false;
    if (entry.contentHash !== currentContentHash) return false;

    // Check all dependency hashes
    for (const [dep, hash] of entry.dependencyHashes) {
      const currentDepHash = getContentHash(dep);
      if (currentDepHash !== hash) return false;
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Invalidation
  // ---------------------------------------------------------------------------

  /**
   * Invalidate cache for a single file
   */
  invalidate(fileName: string): void {
    this.preprocessed.delete(fileName);
    this.transformed.delete(fileName);

    // Also invalidate dependents
    const dependents = this.depGraph.getTransitiveDependents(fileName);
    for (const dep of dependents) {
      this.transformed.delete(dep);
    }
  }

  /**
   * Invalidate cache for multiple files
   */
  invalidateMany(fileNames: Iterable<string>): void {
    for (const fileName of fileNames) {
      this.invalidate(fileName);
    }
  }

  /**
   * Clear all caches
   */
  clear(): void {
    this.preprocessed.clear();
    this.transformed.clear();
    this.depGraph.clear();
    this.accessOrder = [];
  }

  // ---------------------------------------------------------------------------
  // Dependency tracking
  // ---------------------------------------------------------------------------

  /**
   * Update dependencies for a file
   */
  updateDependencies(fileName: string, dependencies: Set<string>): void {
    this.depGraph.setDependencies(fileName, dependencies);
  }

  /**
   * Get all files that depend on the given file
   */
  getDependents(fileName: string): Set<string> {
    return this.depGraph.getDependents(fileName);
  }

  /**
   * Get transitive dependents
   */
  getTransitiveDependents(fileName: string): Set<string> {
    return this.depGraph.getTransitiveDependents(fileName);
  }

  // ---------------------------------------------------------------------------
  // Stats & Debugging
  // ---------------------------------------------------------------------------

  /**
   * Get cache statistics
   */
  getStats(): {
    preprocessedCount: number;
    transformedCount: number;
    accessOrderLength: number;
  } {
    return {
      preprocessedCount: this.preprocessed.size,
      transformedCount: this.transformed.size,
      accessOrderLength: this.accessOrder.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private recordAccess(fileName: string): void {
    const index = this.accessOrder.indexOf(fileName);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(fileName);
  }

  private evictIfNeeded(): void {
    while (this.accessOrder.length > this.maxSize) {
      const oldest = this.accessOrder.shift();
      if (oldest) {
        this.preprocessed.delete(oldest);
        this.transformed.delete(oldest);
        this.depGraph.remove(oldest);
      }
    }
  }
}

/**
 * Create a new transform cache with default options
 */
export function createTransformCache(options?: { maxSize?: number }): TransformCache {
  return new TransformCache(options);
}

// =============================================================================
// Disk Transform Cache
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

/**
 * Entry stored on disk for transformed files
 */
export interface DiskCacheEntry {
  /** Transformed code */
  code: string;
  /** Source map (JSON string) */
  sourceMap: string | null;
  /** Original content hash for validation */
  contentHash: string;
  /** Dependency file paths */
  dependencies: string[];
  /** Hash of each dependency's content */
  dependencyHashes: Record<string, string>;
  /** Transformer version for cache invalidation */
  transformerVersion: string;
  /** Timestamp when entry was created */
  timestamp: number;
}

/**
 * Manifest entry for quick cache lookups
 */
interface ManifestEntry {
  /** Content hash of the source file */
  contentHash: string;
  /** Cache key (hash used for the cache file name) */
  cacheKey: string;
  /** Last access timestamp */
  lastAccess: number;
}

/** Current disk cache format version */
const DISK_CACHE_VERSION = "1";

/**
 * DiskTransformCache - Content-addressable disk cache for transform results
 *
 * Stores transformed files in `.typesugar-cache/transforms/<hash>.json`.
 * A manifest file maps file names to cache keys for fast startup.
 *
 * @example
 * ```typescript
 * const diskCache = new DiskTransformCache('.typesugar-cache/transforms');
 *
 * // Check cache
 * const entry = diskCache.get(fileName, contentHash, depHashes);
 * if (entry) {
 *   return { code: entry.code, sourceMap: JSON.parse(entry.sourceMap) };
 * }
 *
 * // Transform and cache
 * const result = transform(fileName);
 * diskCache.set(fileName, contentHash, dependencies, depHashes, result);
 * ```
 */
export class DiskTransformCache {
  private cacheDir: string;
  private manifestPath: string;
  private manifest = new Map<string, ManifestEntry>();
  private dirty = false;

  /** Statistics for monitoring */
  public stats = {
    hits: 0,
    misses: 0,
    staleHits: 0,
    writes: 0,
  };

  constructor(cacheDir: string = ".typesugar-cache/transforms") {
    this.cacheDir = path.resolve(cacheDir);
    this.manifestPath = path.join(this.cacheDir, "manifest.json");
    this.loadManifest();
  }

  /**
   * Get a cached transform result.
   *
   * @param fileName - The source file path
   * @param contentHash - Hash of the source file content
   * @param getDepHash - Function to get the current hash of a dependency
   * @returns The cached entry if valid, undefined otherwise
   */
  get(
    fileName: string,
    contentHash: string,
    getDepHash: (dep: string) => string | undefined
  ): DiskCacheEntry | undefined {
    const manifestEntry = this.manifest.get(fileName);
    if (!manifestEntry) {
      this.stats.misses++;
      return undefined;
    }

    // Content hash changed — stale
    if (manifestEntry.contentHash !== contentHash) {
      this.stats.staleHits++;
      return undefined;
    }

    // Load from disk
    const cacheFile = path.join(this.cacheDir, `${manifestEntry.cacheKey}.json`);
    try {
      if (!fs.existsSync(cacheFile)) {
        this.stats.misses++;
        return undefined;
      }

      const entry = JSON.parse(fs.readFileSync(cacheFile, "utf-8")) as DiskCacheEntry;

      // Version check
      if (entry.transformerVersion !== DISK_CACHE_VERSION) {
        this.stats.staleHits++;
        return undefined;
      }

      // Validate dependencies
      for (const dep of entry.dependencies) {
        const expectedHash = entry.dependencyHashes[dep];
        const currentHash = getDepHash(dep);
        if (currentHash !== expectedHash) {
          this.stats.staleHits++;
          return undefined;
        }
      }

      // Update last access
      manifestEntry.lastAccess = Date.now();
      this.dirty = true;

      this.stats.hits++;
      return entry;
    } catch {
      this.stats.misses++;
      return undefined;
    }
  }

  /**
   * Store a transform result in the cache.
   */
  set(
    fileName: string,
    contentHash: string,
    dependencies: string[],
    dependencyHashes: Record<string, string>,
    code: string,
    sourceMap: RawSourceMap | null
  ): void {
    // Compute cache key from content + dependencies
    const cacheKey = this.computeCacheKey(fileName, contentHash, dependencyHashes);

    const entry: DiskCacheEntry = {
      code,
      sourceMap: sourceMap ? JSON.stringify(sourceMap) : null,
      contentHash,
      dependencies,
      dependencyHashes,
      transformerVersion: DISK_CACHE_VERSION,
      timestamp: Date.now(),
    };

    // Write to disk
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }

      const cacheFile = path.join(this.cacheDir, `${cacheKey}.json`);
      fs.writeFileSync(cacheFile, JSON.stringify(entry), "utf-8");

      // Update manifest
      this.manifest.set(fileName, {
        contentHash,
        cacheKey,
        lastAccess: Date.now(),
      });
      this.dirty = true;
      this.stats.writes++;
    } catch {
      // Cache write failure is non-fatal
    }
  }

  /**
   * Invalidate cache for a file.
   */
  invalidate(fileName: string): void {
    const manifestEntry = this.manifest.get(fileName);
    if (manifestEntry) {
      // Optionally delete the cache file
      const cacheFile = path.join(this.cacheDir, `${manifestEntry.cacheKey}.json`);
      try {
        fs.unlinkSync(cacheFile);
      } catch {
        // Ignore errors
      }
      this.manifest.delete(fileName);
      this.dirty = true;
    }
  }

  /**
   * Save the manifest to disk.
   * Call this at build end.
   */
  save(): void {
    if (!this.dirty) return;

    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }

      const data: Record<string, ManifestEntry> = {};
      for (const [key, entry] of this.manifest) {
        data[key] = entry;
      }

      fs.writeFileSync(this.manifestPath, JSON.stringify(data, null, 2), "utf-8");
      this.dirty = false;
    } catch {
      // Manifest write failure is non-fatal
    }
  }

  /**
   * Get statistics as a formatted string.
   */
  getStatsString(): string {
    const total = this.stats.hits + this.stats.misses + this.stats.staleHits;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) : "0.0";
    return (
      `DiskCache: ${this.stats.hits} hits, ${this.stats.misses} misses, ` +
      `${this.stats.staleHits} stale (${hitRate}% hit rate), ` +
      `${this.stats.writes} writes, ${this.manifest.size} entries`
    );
  }

  /**
   * Get the number of entries in the manifest.
   */
  get size(): number {
    return this.manifest.size;
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    try {
      // Delete all cache files
      if (fs.existsSync(this.cacheDir)) {
        for (const file of fs.readdirSync(this.cacheDir)) {
          if (file.endsWith(".json")) {
            fs.unlinkSync(path.join(this.cacheDir, file));
          }
        }
      }
    } catch {
      // Ignore errors
    }
    this.manifest.clear();
    this.dirty = true;
  }

  private loadManifest(): void {
    try {
      if (fs.existsSync(this.manifestPath)) {
        const data = JSON.parse(fs.readFileSync(this.manifestPath, "utf-8")) as Record<
          string,
          ManifestEntry
        >;
        for (const [key, entry] of Object.entries(data)) {
          this.manifest.set(key, entry);
        }
      }
    } catch {
      // Manifest load failure — start fresh
      this.manifest.clear();
    }
  }

  private computeCacheKey(
    fileName: string,
    contentHash: string,
    dependencyHashes: Record<string, string>
  ): string {
    const depPart = Object.entries(dependencyHashes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join("|");
    const input = `${fileName}\0${contentHash}\0${depPart}\0${DISK_CACHE_VERSION}`;
    return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
  }
}
