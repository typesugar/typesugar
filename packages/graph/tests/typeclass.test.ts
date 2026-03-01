import { describe, it, expect } from "vitest";
import { createDigraph, createGraph } from "../src/graph.js";
import { graphLike, weightedGraphLike } from "../src/typeclass.js";
import {
  topoSortG,
  hasCyclesG,
  bfsG,
  dfsG,
  reachableG,
  hasPathG,
  shortestPathG,
  dijkstraWithG,
  sccG,
} from "../src/generic-algorithms.js";
import type { GraphLike } from "../src/typeclass.js";
import {
  eqString,
  hashString,
  eqNumber,
  hashNumber,
  type Eq,
  type Hash,
  type Monoid,
  type Ord,
} from "@typesugar/std";

// ============================================================================
// Test: concrete Graph instance
// ============================================================================

describe("graphLike instance", () => {
  const g = createDigraph(
    ["A", "B", "C", "D"],
    [
      ["A", "B"],
      ["B", "C"],
      ["A", "D"],
    ]
  );

  it("nodes returns string IDs", () => {
    const nodes = [...graphLike.nodes(g)].sort();
    expect(nodes).toEqual(["A", "B", "C", "D"]);
  });

  it("edges", () => {
    const edges = [...graphLike.edges(g)];
    expect(edges.length).toBe(3);
  });

  it("successors", () => {
    expect([...graphLike.successors(g, "A")].sort()).toEqual(["B", "D"]);
    expect([...graphLike.successors(g, "B")]).toEqual(["C"]);
    expect([...graphLike.successors(g, "C")]).toEqual([]);
  });

  it("edgeSource/edgeTarget", () => {
    const edge = [...graphLike.edges(g)][0];
    expect(graphLike.edgeSource(edge)).toBe("A");
    expect(graphLike.edgeTarget(edge)).toBe("B");
  });

  it("isDirected", () => {
    expect(graphLike.isDirected(g)).toBe(true);
    const ug = createGraph(["A", "B"], [["A", "B"]]);
    expect(graphLike.isDirected(ug)).toBe(false);
  });
});

// ============================================================================
// Test: generic algorithms with concrete Graph
// ============================================================================

describe("Generic algorithms with Graph", () => {
  it("topoSortG", () => {
    const g = createDigraph(
      ["A", "B", "C"],
      [
        ["A", "B"],
        ["B", "C"],
      ]
    );
    const result = topoSortG(g, graphLike, eqString, hashString);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order.indexOf("A")).toBeLessThan(result.order.indexOf("B"));
      expect(result.order.indexOf("B")).toBeLessThan(result.order.indexOf("C"));
    }
  });

  it("topoSortG detects cycles", () => {
    const g = createDigraph(
      ["A", "B", "C"],
      [
        ["A", "B"],
        ["B", "C"],
        ["C", "A"],
      ]
    );
    const result = topoSortG(g, graphLike, eqString, hashString);
    expect(result.ok).toBe(false);
  });

  it("hasCyclesG", () => {
    const acyclic = createDigraph(["A", "B"], [["A", "B"]]);
    const cyclic = createDigraph(
      ["A", "B"],
      [
        ["A", "B"],
        ["B", "A"],
      ]
    );
    expect(hasCyclesG(acyclic, graphLike, eqString, hashString)).toBe(false);
    expect(hasCyclesG(cyclic, graphLike, eqString, hashString)).toBe(true);
  });

  it("bfsG", () => {
    const g = createDigraph(
      ["A", "B", "C", "D"],
      [
        ["A", "B"],
        ["A", "C"],
        ["B", "D"],
      ]
    );
    const order = bfsG(g, "A", graphLike, eqString, hashString);
    expect(order[0]).toBe("A");
    expect(order.indexOf("B")).toBeLessThan(order.indexOf("D"));
  });

  it("dfsG", () => {
    const g = createDigraph(
      ["A", "B", "C"],
      [
        ["A", "B"],
        ["B", "C"],
      ]
    );
    const order = dfsG(g, "A", graphLike, eqString, hashString);
    expect(order).toEqual(["A", "B", "C"]);
  });

  it("hasPathG", () => {
    const g = createDigraph(
      ["A", "B", "C"],
      [
        ["A", "B"],
        ["B", "C"],
      ]
    );
    expect(hasPathG(g, "A", "C", graphLike, eqString, hashString)).toBe(true);
    expect(hasPathG(g, "C", "A", graphLike, eqString, hashString)).toBe(false);
  });

  it("shortestPathG", () => {
    const g = createDigraph(
      ["A", "B", "C", "D"],
      [
        ["A", "B"],
        ["B", "D"],
        ["A", "C"],
        ["C", "D"],
      ]
    );
    const path = shortestPathG(g, "A", "D", graphLike, eqString, hashString);
    expect(path).not.toBeNull();
    expect(path![0]).toBe("A");
    expect(path![path!.length - 1]).toBe("D");
    expect(path!.length).toBe(3);
  });

  it("sccG", () => {
    const g = createDigraph(
      ["A", "B", "C"],
      [
        ["A", "B"],
        ["B", "C"],
        ["C", "A"],
      ]
    );
    const sccs = sccG(g, graphLike, eqString, hashString);
    expect(sccs.length).toBe(1);
    expect(sccs[0].sort()).toEqual(["A", "B", "C"]);
  });

  it("dijkstraWithG", () => {
    const g = createDigraph(
      ["A", "B", "C"],
      [
        ["A", "B", ""],
        ["B", "C", ""],
      ]
    );
    g.edges.forEach((e: any) => {
      e.weight = 1;
    });

    const monoid: Monoid<number> = { combine: (a, b) => a + b, empty: () => 0 };
    const ord: Ord<number> = {
      equals: (a, b) => a === b,
      notEquals: (a, b) => a !== b,
      compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
      lessThan: (a, b) => a < b,
      lessThanOrEqual: (a, b) => a <= b,
      greaterThan: (a, b) => a > b,
      greaterThanOrEqual: (a, b) => a >= b,
    } as Ord<number>;

    const result = dijkstraWithG(g, "A", "C", weightedGraphLike, eqString, hashString, monoid, ord);
    expect(result).not.toBeNull();
    expect(result!.path).toEqual(["A", "B", "C"]);
    expect(result!.weight).toBe(2);
  });
});

// ============================================================================
// Test: custom graph type (proves the typeclass abstraction works)
// ============================================================================

describe("Generic algorithms with CUSTOM graph type", () => {
  /**
   * A simple adjacency-list graph using numbers as nodes.
   * Completely different from the built-in Graph type.
   */
  interface AdjGraph {
    adj: Map<number, number[]>;
  }

  interface NumEdge {
    src: number;
    dst: number;
  }

  const adjGraphLike: GraphLike<AdjGraph, number, NumEdge> = {
    nodes(g) {
      return g.adj.keys();
    },
    edges(g) {
      const result: NumEdge[] = [];
      for (const [src, dsts] of g.adj) {
        for (const dst of dsts) result.push({ src, dst });
      }
      return result;
    },
    successors(g, node) {
      return g.adj.get(node) ?? [];
    },
    edgeSource(e) {
      return e.src;
    },
    edgeTarget(e) {
      return e.dst;
    },
    isDirected() {
      return true;
    },
  };

  function mkGraph(adj: Record<number, number[]>): AdjGraph {
    return { adj: new Map(Object.entries(adj).map(([k, v]) => [Number(k), v])) };
  }

  it("topoSortG on custom graph", () => {
    const g = mkGraph({ 1: [2], 2: [3], 3: [] });
    const result = topoSortG(g, adjGraphLike, eqNumber, hashNumber);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order.indexOf(1)).toBeLessThan(result.order.indexOf(2));
      expect(result.order.indexOf(2)).toBeLessThan(result.order.indexOf(3));
    }
  });

  it("bfsG on custom graph", () => {
    const g = mkGraph({ 1: [2, 3], 2: [4], 3: [4], 4: [] });
    const order = bfsG(g, 1, adjGraphLike, eqNumber, hashNumber);
    expect(order[0]).toBe(1);
    expect(order).toContain(2);
    expect(order).toContain(3);
    expect(order).toContain(4);
  });

  it("dfsG on custom graph", () => {
    const g = mkGraph({ 1: [2], 2: [3], 3: [] });
    const order = dfsG(g, 1, adjGraphLike, eqNumber, hashNumber);
    expect(order).toEqual([1, 2, 3]);
  });

  it("hasPathG on custom graph", () => {
    const g = mkGraph({ 1: [2], 2: [3], 3: [], 4: [] });
    expect(hasPathG(g, 1, 3, adjGraphLike, eqNumber, hashNumber)).toBe(true);
    expect(hasPathG(g, 1, 4, adjGraphLike, eqNumber, hashNumber)).toBe(false);
  });

  it("shortestPathG on custom graph", () => {
    const g = mkGraph({ 1: [2, 3], 2: [4], 3: [4], 4: [] });
    const path = shortestPathG(g, 1, 4, adjGraphLike, eqNumber, hashNumber);
    expect(path).not.toBeNull();
    expect(path![0]).toBe(1);
    expect(path![path!.length - 1]).toBe(4);
    expect(path!.length).toBe(3);
  });

  it("sccG on custom graph with cycle", () => {
    const g = mkGraph({ 1: [2], 2: [3], 3: [1], 4: [] });
    const sccs = sccG(g, adjGraphLike, eqNumber, hashNumber);
    const cycleScc = sccs.find((scc) => scc.length > 1);
    expect(cycleScc).toBeDefined();
    expect(cycleScc!.sort()).toEqual([1, 2, 3]);
  });

  it("hasCyclesG on custom graph", () => {
    const acyclic = mkGraph({ 1: [2], 2: [3], 3: [] });
    const cyclic = mkGraph({ 1: [2], 2: [1] });
    expect(hasCyclesG(acyclic, adjGraphLike, eqNumber, hashNumber)).toBe(false);
    expect(hasCyclesG(cyclic, adjGraphLike, eqNumber, hashNumber)).toBe(true);
  });
});
