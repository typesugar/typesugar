/**
 * Layer Graph Utilities Tests
 *
 * Tests for the shared dependency graph resolution used by both
 * layerMake<R>() (explicit wiring) and resolveLayer<R>() (implicit wiring).
 *
 * Uses @typesugar/graph under the hood for topoSort/cycle detection.
 */
import { describe, it, expect } from "vitest";
import {
  resolveGraph,
  formatDebugTree,
  CircularDependencyError,
  type GraphResolution,
} from "../src/macros/layer-graph.js";
import type { LayerInfo } from "../src/macros/layer.js";

// Also verify we can import the @typesugar/graph algorithms directly
import { topoSort, createDigraph, detectCycles } from "@typesugar/graph";

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

function makeLookup(
  layers: LayerInfo[]
): (service: string) => LayerInfo[] {
  const byService = new Map<string, LayerInfo[]>();
  for (const l of layers) {
    const existing = byService.get(l.provides) ?? [];
    existing.push(l);
    byService.set(l.provides, existing);
  }
  return (s) => byService.get(s) ?? [];
}

// ============================================================================
// @typesugar/graph integration (sanity checks)
// ============================================================================

describe("@typesugar/graph integration", () => {
  it("should create a digraph from layer dependencies", () => {
    const g = createDigraph(
      ["Database", "UserRepo"],
      [["UserRepo", "Database"]]
    );
    expect(g.nodes.length).toBe(2);
    expect(g.edges.length).toBe(1);
    expect(g.directed).toBe(true);
  });

  it("should topologically sort a DAG", () => {
    // Edges point from dependent → dependency (Cake needs Chocolate, etc.)
    const g = createDigraph(
      ["Spoon", "Chocolate", "Flour", "Cake"],
      [
        ["Cake", "Chocolate"],
        ["Cake", "Flour"],
        ["Chocolate", "Spoon"],
        ["Flour", "Spoon"],
      ]
    );
    const result = topoSort(g);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Kahn's processes in-degree-0 first, so Cake (no incoming) comes first
      // and Spoon (most depended-on) comes last.
      // resolveGraph reverses this to get dependencies-first order.
      expect(result.order.indexOf("Cake")).toBeLessThan(
        result.order.indexOf("Chocolate")
      );
      expect(result.order.indexOf("Cake")).toBeLessThan(
        result.order.indexOf("Flour")
      );
      expect(result.order.indexOf("Chocolate")).toBeLessThan(
        result.order.indexOf("Spoon")
      );
    }
  });

  it("should detect cycles", () => {
    const g = createDigraph(
      ["A", "B", "C"],
      [
        ["A", "B"],
        ["B", "C"],
        ["C", "A"],
      ]
    );
    const result = topoSort(g);
    expect(result.ok).toBe(false);

    const cycles = detectCycles(g);
    expect(cycles.length).toBeGreaterThan(0);
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

    const resolution = resolveGraph(["UserRepo"], makeLookup(layers));

    expect(resolution.missing).toEqual([]);
    expect(resolution.sorted).toContain("Database");
    expect(resolution.sorted).toContain("UserRepo");
    expect(resolution.graph.size).toBe(2);
  });

  it("should produce correct topological order", () => {
    const layers = [
      makeLayer("dbLive", "Database"),
      makeLayer("userRepoLive", "UserRepo", ["Database"]),
    ];

    const resolution = resolveGraph(["UserRepo"], makeLookup(layers));

    expect(resolution.sorted.indexOf("Database")).toBeLessThan(
      resolution.sorted.indexOf("UserRepo")
    );
  });

  it("should resolve transitive dependencies automatically", () => {
    const layers = [
      makeLayer("spoonLive", "Spoon"),
      makeLayer("chocolateLive", "Chocolate", ["Spoon"]),
      makeLayer("flourLive", "Flour", ["Spoon"]),
      makeLayer("cakeLive", "Cake", ["Chocolate", "Flour"]),
    ];

    // Only request Cake — should pull in Chocolate, Flour, Spoon transitively
    const resolution = resolveGraph(["Cake"], makeLookup(layers));

    expect(resolution.missing).toEqual([]);
    expect(resolution.graph.size).toBe(4);
    expect(resolution.sorted).toContain("Spoon");
    expect(resolution.sorted).toContain("Chocolate");
    expect(resolution.sorted).toContain("Flour");
    expect(resolution.sorted).toContain("Cake");
  });

  it("should maintain dependency ordering in diamond graph", () => {
    const layers = [
      makeLayer("spoonLive", "Spoon"),
      makeLayer("chocolateLive", "Chocolate", ["Spoon"]),
      makeLayer("flourLive", "Flour", ["Spoon"]),
      makeLayer("cakeLive", "Cake", ["Chocolate", "Flour"]),
    ];

    const resolution = resolveGraph(["Cake"], makeLookup(layers));
    const idx = (s: string) => resolution.sorted.indexOf(s);

    expect(idx("Spoon")).toBeLessThan(idx("Chocolate"));
    expect(idx("Spoon")).toBeLessThan(idx("Flour"));
    expect(idx("Chocolate")).toBeLessThan(idx("Cake"));
    expect(idx("Flour")).toBeLessThan(idx("Cake"));
  });

  it("should report missing dependencies", () => {
    const layers = [makeLayer("userRepoLive", "UserRepo", ["Database"])];

    const resolution = resolveGraph(["UserRepo"], makeLookup(layers));

    expect(resolution.missing).toContain("Database");
  });

  it("should detect unused layers", () => {
    const layers = [
      makeLayer("dbLive", "Database"),
      makeLayer("loggerLive", "Logger"),
      makeLayer("userRepoLive", "UserRepo", ["Database"]),
    ];

    const resolution = resolveGraph(
      ["UserRepo"],
      makeLookup(layers),
      layers
    );

    expect(resolution.unused.map((l) => l.name)).toContain("loggerLive");
  });

  it("should prefer layers from specified file", () => {
    const dbLive = makeLayer("dbLive", "Database");
    dbLive.sourceFile = "prod.ts";
    const dbTest = makeLayer("dbTest", "Database");
    dbTest.sourceFile = "test.ts";

    const resolution = resolveGraph(
      ["Database"],
      makeLookup([dbLive, dbTest]),
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

    expect(() =>
      resolveGraph(["A"], makeLookup(layers))
    ).toThrow(CircularDependencyError);
  });

  it("should throw CircularDependencyError with cycle path", () => {
    const layers = [
      makeLayer("aLive", "A", ["B"]),
      makeLayer("bLive", "B", ["C"]),
      makeLayer("cLive", "C", ["A"]),
    ];

    try {
      resolveGraph(["A"], makeLookup(layers));
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CircularDependencyError);
      const err = e as CircularDependencyError;
      expect(err.cycle.length).toBeGreaterThan(2);
    }
  });

  it("should expose the raw @typesugar/graph Graph", () => {
    const layers = [
      makeLayer("dbLive", "Database"),
      makeLayer("userRepoLive", "UserRepo", ["Database"]),
    ];

    const resolution = resolveGraph(["UserRepo"], makeLookup(layers));

    expect(resolution.rawGraph).toBeDefined();
    expect(resolution.rawGraph.directed).toBe(true);
    expect(resolution.rawGraph.nodes.length).toBe(2);
    expect(resolution.rawGraph.edges.length).toBe(1);
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

    const resolution = resolveGraph(["UserRepo"], makeLookup(layers));
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

    const resolution = resolveGraph(["Cake"], makeLookup(layers));
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
      rawGraph: createDigraph([], []),
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
