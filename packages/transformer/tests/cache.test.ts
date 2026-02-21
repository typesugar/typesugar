/**
 * Tests for TransformCache and DependencyGraph
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TransformCache, DependencyGraph, hashContent } from "../src/cache.js";
import { IdentityPositionMapper } from "../src/position-mapper.js";
import type { TransformResult } from "../src/pipeline.js";

function makeResult(code: string = "test"): TransformResult {
  return {
    original: code,
    code,
    sourceMap: null,
    mapper: new IdentityPositionMapper(),
    changed: false,
    diagnostics: [],
  };
}

describe("hashContent", () => {
  it("produces consistent hashes", () => {
    const hash1 = hashContent("test content");
    const hash2 = hashContent("test content");

    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different content", () => {
    const hash1 = hashContent("content A");
    const hash2 = hashContent("content B");

    expect(hash1).not.toBe(hash2);
  });

  it("produces reasonably short hashes", () => {
    const hash = hashContent("some test content");

    // Hash should be a reasonable length
    expect(hash.length).toBeLessThan(20);
    expect(hash.length).toBeGreaterThan(4);
  });
});

describe("DependencyGraph", () => {
  let graph: DependencyGraph;

  beforeEach(() => {
    graph = new DependencyGraph();
  });

  it("tracks dependencies", () => {
    graph.setDependencies("a.ts", new Set(["b.ts", "c.ts"]));

    expect(graph.getDependencies("a.ts")).toEqual(new Set(["b.ts", "c.ts"]));
  });

  it("tracks dependents (reverse dependencies)", () => {
    graph.setDependencies("a.ts", new Set(["b.ts"]));
    graph.setDependencies("c.ts", new Set(["b.ts"]));

    expect(graph.getDependents("b.ts")).toEqual(new Set(["a.ts", "c.ts"]));
  });

  it("computes transitive dependents", () => {
    // a.ts → b.ts → c.ts
    graph.setDependencies("a.ts", new Set(["b.ts"]));
    graph.setDependencies("b.ts", new Set(["c.ts"]));

    // c.ts is depended on transitively by both a.ts and b.ts
    const dependents = graph.getTransitiveDependents("c.ts");

    expect(dependents).toContain("b.ts");
    expect(dependents).toContain("a.ts");
  });

  it("handles circular dependencies", () => {
    // a.ts ↔ b.ts
    graph.setDependencies("a.ts", new Set(["b.ts"]));
    graph.setDependencies("b.ts", new Set(["a.ts"]));

    // Should not infinite loop
    const dependentsOfA = graph.getTransitiveDependents("a.ts");
    const dependentsOfB = graph.getTransitiveDependents("b.ts");

    expect(dependentsOfA).toContain("b.ts");
    expect(dependentsOfB).toContain("a.ts");
  });

  it("updates dependencies correctly", () => {
    graph.setDependencies("a.ts", new Set(["b.ts", "c.ts"]));
    graph.setDependencies("a.ts", new Set(["d.ts"])); // Update

    // Old dependencies should be removed
    expect(graph.getDependents("b.ts")).not.toContain("a.ts");
    expect(graph.getDependents("c.ts")).not.toContain("a.ts");

    // New dependency should be tracked
    expect(graph.getDependents("d.ts")).toContain("a.ts");
  });

  it("removes file from graph", () => {
    graph.setDependencies("a.ts", new Set(["b.ts"]));
    graph.remove("a.ts");

    expect(graph.getDependencies("a.ts")).toEqual(new Set());
    expect(graph.getDependents("b.ts")).not.toContain("a.ts");
  });

  it("clears all dependencies", () => {
    graph.setDependencies("a.ts", new Set(["b.ts"]));
    graph.setDependencies("c.ts", new Set(["d.ts"]));

    graph.clear();

    expect(graph.getDependencies("a.ts")).toEqual(new Set());
    expect(graph.getDependents("b.ts")).toEqual(new Set());
  });
});

describe("TransformCache", () => {
  let cache: TransformCache;

  beforeEach(() => {
    cache = new TransformCache({ maxSize: 5 });
  });

  describe("preprocessed cache", () => {
    it("stores and retrieves preprocessed entries", () => {
      cache.setPreprocessed("test.ts", {
        code: "const x = 1;",
        map: null,
        contentHash: "hash123",
      });

      const entry = cache.getPreprocessed("test.ts");
      expect(entry).toBeDefined();
      expect(entry?.code).toBe("const x = 1;");
    });

    it("validates by content hash", () => {
      cache.setPreprocessed("test.ts", {
        code: "const x = 1;",
        map: null,
        contentHash: "hash123",
      });

      expect(cache.isPreprocessedValid("test.ts", "hash123")).toBe(true);
      expect(cache.isPreprocessedValid("test.ts", "different")).toBe(false);
    });
  });

  describe("transformed cache", () => {
    it("stores and retrieves transformed entries", () => {
      const result = makeResult("transformed code");

      cache.setTransformed("test.ts", {
        result,
        contentHash: "hash123",
        dependencies: new Set(),
        dependencyHashes: new Map(),
      });

      const entry = cache.getTransformed("test.ts");
      expect(entry).toBeDefined();
      expect(entry?.result.code).toBe("transformed code");
    });

    it("validates by content hash and dependencies", () => {
      cache.setTransformed("test.ts", {
        result: makeResult(),
        contentHash: "hash123",
        dependencies: new Set(["dep.ts"]),
        dependencyHashes: new Map([["dep.ts", "dephash"]]),
      });

      // Valid when all hashes match
      expect(
        cache.isTransformedValid("test.ts", "hash123", (dep) =>
          dep === "dep.ts" ? "dephash" : undefined
        )
      ).toBe(true);

      // Invalid when content hash differs
      expect(
        cache.isTransformedValid("test.ts", "different", () => "dephash")
      ).toBe(false);

      // Invalid when dependency hash differs
      expect(
        cache.isTransformedValid("test.ts", "hash123", () => "different")
      ).toBe(false);
    });
  });

  describe("invalidation", () => {
    it("invalidates single file", () => {
      cache.setTransformed("test.ts", {
        result: makeResult(),
        contentHash: "hash",
        dependencies: new Set(),
        dependencyHashes: new Map(),
      });

      cache.invalidate("test.ts");

      expect(cache.getTransformed("test.ts")).toBeUndefined();
    });

    it("invalidates dependent files", () => {
      // a.ts depends on b.ts
      cache.setTransformed("a.ts", {
        result: makeResult(),
        contentHash: "hashA",
        dependencies: new Set(["b.ts"]),
        dependencyHashes: new Map([["b.ts", "hashB"]]),
      });

      cache.setTransformed("b.ts", {
        result: makeResult(),
        contentHash: "hashB",
        dependencies: new Set(),
        dependencyHashes: new Map(),
      });

      // Invalidate b.ts
      cache.invalidate("b.ts");

      // a.ts should also be invalidated
      expect(cache.getTransformed("a.ts")).toBeUndefined();
      expect(cache.getTransformed("b.ts")).toBeUndefined();
    });
  });

  describe("LRU eviction", () => {
    it("evicts oldest entries when max size exceeded", () => {
      // Fill cache to capacity
      for (let i = 0; i < 5; i++) {
        cache.setTransformed(`file${i}.ts`, {
          result: makeResult(`code ${i}`),
          contentHash: `hash${i}`,
          dependencies: new Set(),
          dependencyHashes: new Map(),
        });
      }

      // Add one more
      cache.setTransformed("file5.ts", {
        result: makeResult("code 5"),
        contentHash: "hash5",
        dependencies: new Set(),
        dependencyHashes: new Map(),
      });

      // Oldest entry should be evicted
      expect(cache.getTransformed("file0.ts")).toBeUndefined();

      // Newest should still exist
      expect(cache.getTransformed("file5.ts")).toBeDefined();
    });

    it("updates access order on get", () => {
      // Add entries
      cache.setTransformed("file0.ts", {
        result: makeResult(),
        contentHash: "hash0",
        dependencies: new Set(),
        dependencyHashes: new Map(),
      });
      cache.setTransformed("file1.ts", {
        result: makeResult(),
        contentHash: "hash1",
        dependencies: new Set(),
        dependencyHashes: new Map(),
      });
      cache.setTransformed("file2.ts", {
        result: makeResult(),
        contentHash: "hash2",
        dependencies: new Set(),
        dependencyHashes: new Map(),
      });

      // Access file0 to make it "recently used"
      cache.getTransformed("file0.ts");

      // Fill up to force eviction
      cache.setTransformed("file3.ts", {
        result: makeResult(),
        contentHash: "hash3",
        dependencies: new Set(),
        dependencyHashes: new Map(),
      });
      cache.setTransformed("file4.ts", {
        result: makeResult(),
        contentHash: "hash4",
        dependencies: new Set(),
        dependencyHashes: new Map(),
      });
      cache.setTransformed("file5.ts", {
        result: makeResult(),
        contentHash: "hash5",
        dependencies: new Set(),
        dependencyHashes: new Map(),
      });

      // file0 should still exist (was accessed recently)
      expect(cache.getTransformed("file0.ts")).toBeDefined();

      // file1 should be evicted (oldest unused)
      expect(cache.getTransformed("file1.ts")).toBeUndefined();
    });
  });

  describe("cache stats", () => {
    it("reports cache statistics", () => {
      cache.setPreprocessed("a.ts", {
        code: "code",
        map: null,
        contentHash: "hash",
      });
      cache.setTransformed("b.ts", {
        result: makeResult(),
        contentHash: "hash",
        dependencies: new Set(),
        dependencyHashes: new Map(),
      });

      const stats = cache.getStats();

      expect(stats.preprocessedCount).toBe(1);
      expect(stats.transformedCount).toBe(1);
      // accessOrderLength tracks preprocessed entries separately from transformed
      // so it should reflect transformed count
      expect(stats.accessOrderLength).toBeGreaterThanOrEqual(1);
    });
  });

  describe("clear", () => {
    it("clears all caches", () => {
      cache.setPreprocessed("a.ts", {
        code: "code",
        map: null,
        contentHash: "hash",
      });
      cache.setTransformed("b.ts", {
        result: makeResult(),
        contentHash: "hash",
        dependencies: new Set(),
        dependencyHashes: new Map(),
      });

      cache.clear();

      expect(cache.getPreprocessed("a.ts")).toBeUndefined();
      expect(cache.getTransformed("b.ts")).toBeUndefined();
    });
  });
});
