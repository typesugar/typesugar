/**
 * Layer Graph Utilities Tests
 *
 * Tests for the shared dependency graph resolution used by both
 * layerMake<R>() (explicit wiring) and resolveLayer<R>() (implicit wiring).
 */
import { describe, it, expect } from "vitest";
import {
  buildDependencyGraph,
  topologicalSort,
  resolveGraph,
  formatDebugTree,
  CircularDependencyError,
  type GraphResolution,
} from "../src/macros/layer-graph.js";
import type { LayerInfo } from "../src/macros/layer.js";

// ============================================================================
// Helpers
// ============================================================================

function makeLayer(
  name: string,
  provides: string,
  requires: string[] = []
): LayerInfo {
  return {
    name,
    provides,
    requires,
    sourceFile: "test.ts",
    layerType: "effect",
  };
}

// ============================================================================
// buildDependencyGraph
// ============================================================================

describe("buildDependencyGraph", () => {
  it("should build graph from layers", () => {
    const layers = [
      makeLayer("dbLive", "Database"),
      makeLayer("userRepoLive", "UserRepo", ["Database"]),
    ];

    const graph = buildDependencyGraph(layers);
    expect(graph.size).toBe(2);
    expect(graph.get("Database")?.layer.name).toBe("dbLive");
    expect(graph.get("UserRepo")?.dependencies).toEqual(["Database"]);
  });

  it("should handle layers with no dependencies", () => {
    const layers = [makeLayer("loggerLive", "Logger")];
    const graph = buildDependencyGraph(layers);
    expect(graph.get("Logger")?.dependencies).toEqual([]);
  });
});

// ============================================================================
// topologicalSort
// ============================================================================

describe("topologicalSort", () => {
  it("should sort simple dependency chain", () => {
    const layers = [
      makeLayer("dbLive", "Database"),
      makeLayer("userRepoLive", "UserRepo", ["Database"]),
    ];
    const graph = buildDependencyGraph(layers);
    const { sorted, missing } = topologicalSort(
      ["UserRepo", "Database"],
      graph
    );

    expect(missing).toEqual([]);
    expect(sorted.indexOf("Database")).toBeLessThan(
      sorted.indexOf("UserRepo")
    );
  });

  it("should sort diamond dependency", () => {
    const layers = [
      makeLayer("spoonLive", "Spoon"),
      makeLayer("chocolateLive", "Chocolate", ["Spoon"]),
      makeLayer("flourLive", "Flour", ["Spoon"]),
      makeLayer("cakeLive", "Cake", ["Chocolate", "Flour"]),
    ];
    const graph = buildDependencyGraph(layers);
    const { sorted, missing } = topologicalSort(
      ["Cake", "Chocolate", "Flour", "Spoon"],
      graph
    );

    expect(missing).toEqual([]);
    expect(sorted.indexOf("Spoon")).toBeLessThan(
      sorted.indexOf("Chocolate")
    );
    expect(sorted.indexOf("Spoon")).toBeLessThan(
      sorted.indexOf("Flour")
    );
    expect(sorted.indexOf("Chocolate")).toBeLessThan(
      sorted.indexOf("Cake")
    );
    expect(sorted.indexOf("Flour")).toBeLessThan(
      sorted.indexOf("Cake")
    );
  });

  it("should report missing services", () => {
    const graph = buildDependencyGraph([]);
    const { sorted, missing } = topologicalSort(["Missing"], graph);
    expect(missing).toContain("Missing");
    expect(sorted).toContain("Missing");
  });

  it("should detect circular dependencies", () => {
    const layers = [
      makeLayer("aLive", "A", ["B"]),
      makeLayer("bLive", "B", ["A"]),
    ];
    const graph = buildDependencyGraph(layers);

    expect(() => topologicalSort(["A"], graph)).toThrow(
      CircularDependencyError
    );
  });

  it("should include cycle path in error", () => {
    const layers = [
      makeLayer("aLive", "A", ["B"]),
      makeLayer("bLive", "B", ["C"]),
      makeLayer("cLive", "C", ["A"]),
    ];
    const graph = buildDependencyGraph(layers);

    try {
      topologicalSort(["A"], graph);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CircularDependencyError);
      const err = e as CircularDependencyError;
      expect(err.cycle).toContain("A");
      expect(err.cycle).toContain("B");
      expect(err.cycle).toContain("C");
    }
  });
});

// ============================================================================
// resolveGraph
// ============================================================================

describe("resolveGraph", () => {
  it("should resolve simple graph", () => {
    const layers = [
      makeLayer("dbLive", "Database"),
      makeLayer("userRepoLive", "UserRepo", ["Database"]),
    ];

    const byService = new Map<string, LayerInfo[]>();
    for (const l of layers) {
      byService.set(l.provides, [l]);
    }

    const resolution = resolveGraph(
      ["UserRepo"],
      (s) => byService.get(s) ?? []
    );

    expect(resolution.missing).toEqual([]);
    expect(resolution.sorted).toContain("Database");
    expect(resolution.sorted).toContain("UserRepo");
    expect(resolution.graph.size).toBe(2);
  });

  it("should resolve transitive dependencies automatically", () => {
    const layers = [
      makeLayer("spoonLive", "Spoon"),
      makeLayer("chocolateLive", "Chocolate", ["Spoon"]),
      makeLayer("flourLive", "Flour", ["Spoon"]),
      makeLayer("cakeLive", "Cake", ["Chocolate", "Flour"]),
    ];

    const byService = new Map<string, LayerInfo[]>();
    for (const l of layers) {
      byService.set(l.provides, [l]);
    }

    // Only request Cake — should pull in Chocolate, Flour, Spoon transitively
    const resolution = resolveGraph(
      ["Cake"],
      (s) => byService.get(s) ?? []
    );

    expect(resolution.missing).toEqual([]);
    expect(resolution.graph.size).toBe(4);
    expect(resolution.sorted).toContain("Spoon");
    expect(resolution.sorted).toContain("Chocolate");
    expect(resolution.sorted).toContain("Flour");
    expect(resolution.sorted).toContain("Cake");
  });

  it("should report missing dependencies", () => {
    const layers = [
      makeLayer("userRepoLive", "UserRepo", ["Database"]),
    ];
    const byService = new Map<string, LayerInfo[]>();
    for (const l of layers) {
      byService.set(l.provides, [l]);
    }

    const resolution = resolveGraph(
      ["UserRepo"],
      (s) => byService.get(s) ?? []
    );

    expect(resolution.missing).toContain("Database");
  });

  it("should detect unused layers", () => {
    const layers = [
      makeLayer("dbLive", "Database"),
      makeLayer("loggerLive", "Logger"),
      makeLayer("userRepoLive", "UserRepo", ["Database"]),
    ];

    const byService = new Map<string, LayerInfo[]>();
    for (const l of layers) {
      byService.set(l.provides, [l]);
    }

    const resolution = resolveGraph(
      ["UserRepo"],
      (s) => byService.get(s) ?? [],
      layers
    );

    expect(resolution.unused.map((l) => l.name)).toContain("loggerLive");
  });

  it("should prefer layers from specified file", () => {
    const dbLive = makeLayer("dbLive", "Database");
    dbLive.sourceFile = "prod.ts";
    const dbTest = makeLayer("dbTest", "Database");
    dbTest.sourceFile = "test.ts";

    const byService = new Map<string, LayerInfo[]>();
    byService.set("Database", [dbLive, dbTest]);

    const resolution = resolveGraph(
      ["Database"],
      (s) => byService.get(s) ?? [],
      undefined,
      "test.ts"
    );

    expect(resolution.graph.get("Database")?.layer.name).toBe("dbTest");
  });

  it("should throw on circular dependencies", () => {
    const layers = [
      makeLayer("aLive", "A", ["B"]),
      makeLayer("bLive", "B", ["A"]),
    ];
    const byService = new Map<string, LayerInfo[]>();
    for (const l of layers) {
      byService.set(l.provides, [l]);
    }

    expect(() =>
      resolveGraph(["A"], (s) => byService.get(s) ?? [])
    ).toThrow(CircularDependencyError);
  });
});

// ============================================================================
// formatDebugTree
// ============================================================================

describe("formatDebugTree", () => {
  it("should format a simple tree", () => {
    const layers = [
      makeLayer("dbLive", "Database"),
      makeLayer("userRepoLive", "UserRepo", ["Database"]),
    ];
    const byService = new Map<string, LayerInfo[]>();
    for (const l of layers) {
      byService.set(l.provides, [l]);
    }

    const resolution = resolveGraph(
      ["UserRepo"],
      (s) => byService.get(s) ?? []
    );
    const tree = formatDebugTree(resolution);

    expect(tree).toContain("Layer Wiring Graph");
    expect(tree).toContain("userRepoLive");
    expect(tree).toContain("dbLive");
  });

  it("should format a diamond dependency tree", () => {
    const layers = [
      makeLayer("spoonLive", "Spoon"),
      makeLayer("chocolateLive", "Chocolate", ["Spoon"]),
      makeLayer("flourLive", "Flour", ["Spoon"]),
      makeLayer("cakeLive", "Cake", ["Chocolate", "Flour"]),
    ];
    const byService = new Map<string, LayerInfo[]>();
    for (const l of layers) {
      byService.set(l.provides, [l]);
    }

    const resolution = resolveGraph(
      ["Cake"],
      (s) => byService.get(s) ?? []
    );
    const tree = formatDebugTree(resolution);

    expect(tree).toContain("cakeLive");
    expect(tree).toContain("chocolateLive");
    expect(tree).toContain("flourLive");
    expect(tree).toContain("spoonLive");
  });

  it("should handle empty graph", () => {
    const resolution: GraphResolution = {
      sorted: [],
      missing: [],
      graph: new Map(),
      unused: [],
    };
    const tree = formatDebugTree(resolution);
    expect(tree).toContain("(empty)");
  });
});

// ============================================================================
// CircularDependencyError
// ============================================================================

describe("CircularDependencyError", () => {
  it("should store the cycle path", () => {
    const err = new CircularDependencyError(["A", "B", "C", "A"]);
    expect(err.cycle).toEqual(["A", "B", "C", "A"]);
    expect(err.message).toContain("A → B → C → A");
    expect(err.name).toBe("CircularDependencyError");
  });
});
