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

/**
 * Simple hash function for content-based cache invalidation
 */
export function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
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
