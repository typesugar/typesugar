import { describe, it, expect } from "vitest";
import {
  createDigraph,
  createGraph,
  topoSort,
  detectCycles,
  hasCycles,
  bfs,
  dfs,
  reachable,
  hasPath,
  shortestPath,
  dijkstra,
  stronglyConnectedComponents,
  isDAG,
  transitiveClosure,
  reverseGraph,
  neighbors,
  inEdges,
  outEdges,
  degree,
  inDegree,
  outDegree,
  adjacencyList,
  addNode,
  addEdge,
  removeNode,
  removeEdge,
} from "../index.js";

// ---------------------------------------------------------------------------
// Graph construction & query
// ---------------------------------------------------------------------------

describe("graph construction", () => {
  it("creates a directed graph", () => {
    const g = createDigraph(
      ["a", "b", "c"],
      [
        ["a", "b"],
        ["b", "c"],
      ]
    );
    expect(g.directed).toBe(true);
    expect(g.nodes).toHaveLength(3);
    expect(g.edges).toHaveLength(2);
  });

  it("creates an undirected graph", () => {
    const g = createGraph(["a", "b"], [["a", "b"]]);
    expect(g.directed).toBe(false);
  });

  it("auto-adds nodes mentioned in edges", () => {
    const g = createDigraph([], [["a", "b"]]);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });
});

describe("graph query", () => {
  const g = createDigraph(
    ["a", "b", "c", "d"],
    [
      ["a", "b"],
      ["a", "c"],
      ["b", "d"],
      ["c", "d"],
    ]
  );

  it("neighbors returns outgoing targets", () => {
    expect(neighbors(g, "a").sort()).toEqual(["b", "c"]);
    expect(neighbors(g, "d")).toEqual([]);
  });

  it("inEdges / outEdges", () => {
    expect(outEdges(g, "a")).toHaveLength(2);
    expect(inEdges(g, "d")).toHaveLength(2);
    expect(inEdges(g, "a")).toHaveLength(0);
  });

  it("degree / inDegree / outDegree", () => {
    expect(outDegree(g, "a")).toBe(2);
    expect(inDegree(g, "d")).toBe(2);
    expect(degree(g, "a")).toBe(2);
    expect(degree(g, "d")).toBe(2);
  });

  it("adjacencyList builds a map", () => {
    const adj = adjacencyList(g);
    expect(adj.get("a")!.sort()).toEqual(["b", "c"]);
    expect(adj.get("d")).toEqual([]);
  });

  it("undirected neighbors go both ways", () => {
    const ug = createGraph(["a", "b"], [["a", "b"]]);
    expect(neighbors(ug, "a")).toEqual(["b"]);
    expect(neighbors(ug, "b")).toEqual(["a"]);
  });
});

describe("graph mutation (immutable)", () => {
  const g = createDigraph(["a", "b"], [["a", "b"]]);

  it("addNode returns a new graph", () => {
    const g2 = addNode(g, "c");
    expect(g2.nodes).toHaveLength(3);
    expect(g.nodes).toHaveLength(2);
  });

  it("addNode is idempotent for existing nodes", () => {
    const g2 = addNode(g, "a");
    expect(g2.nodes).toHaveLength(2);
  });

  it("addEdge auto-creates missing nodes", () => {
    const g2 = addEdge(g, "b", "c");
    expect(g2.nodes).toHaveLength(3);
    expect(g2.edges).toHaveLength(2);
  });

  it("removeNode removes incident edges", () => {
    const g2 = removeNode(g, "b");
    expect(g2.nodes).toHaveLength(1);
    expect(g2.edges).toHaveLength(0);
  });

  it("removeEdge", () => {
    const g2 = removeEdge(g, "a", "b");
    expect(g2.edges).toHaveLength(0);
    expect(g2.nodes).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Topological sort
// ---------------------------------------------------------------------------

describe("topoSort", () => {
  it("sorts a DAG", () => {
    const g = createDigraph(
      ["a", "b", "c", "d"],
      [
        ["a", "b"],
        ["a", "c"],
        ["b", "d"],
        ["c", "d"],
      ]
    );
    const result = topoSort(g);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order.indexOf("a")).toBeLessThan(result.order.indexOf("b"));
      expect(result.order.indexOf("a")).toBeLessThan(result.order.indexOf("c"));
      expect(result.order.indexOf("b")).toBeLessThan(result.order.indexOf("d"));
    }
  });

  it("sorts a linear chain", () => {
    const g = createDigraph(
      ["a", "b", "c"],
      [
        ["a", "b"],
        ["b", "c"],
      ]
    );
    const result = topoSort(g);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order).toEqual(["a", "b", "c"]);
    }
  });

  it("detects a cycle", () => {
    const g = createDigraph(
      ["a", "b", "c"],
      [
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
      ]
    );
    const result = topoSort(g);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.cycle.length).toBeGreaterThan(0);
    }
  });

  it("handles a diamond DAG", () => {
    const g = createDigraph(
      ["a", "b", "c", "d"],
      [
        ["a", "b"],
        ["a", "c"],
        ["b", "d"],
        ["c", "d"],
      ]
    );
    const result = topoSort(g);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order).toHaveLength(4);
    }
  });
});

// ---------------------------------------------------------------------------
// BFS & DFS
// ---------------------------------------------------------------------------

describe("bfs", () => {
  it("visits nodes in breadth-first order", () => {
    const g = createDigraph(
      ["a", "b", "c", "d"],
      [
        ["a", "b"],
        ["a", "c"],
        ["b", "d"],
      ]
    );
    const order = bfs(g, "a");
    expect(order[0]).toBe("a");
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("d"));
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("d"));
  });

  it("handles disconnected nodes", () => {
    const g = createDigraph(["a", "b", "c"], [["a", "b"]]);
    const order = bfs(g, "a");
    expect(order).toEqual(["a", "b"]);
  });
});

describe("dfs", () => {
  it("visits nodes in depth-first order", () => {
    const g = createDigraph(
      ["a", "b", "c", "d"],
      [
        ["a", "b"],
        ["b", "d"],
        ["a", "c"],
      ]
    );
    const order = dfs(g, "a");
    expect(order[0]).toBe("a");
    expect(order).toContain("d");
  });

  it("handles disconnected nodes", () => {
    const g = createDigraph(["a", "b", "c"], [["a", "b"]]);
    const order = dfs(g, "a");
    expect(order).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// Reachability
// ---------------------------------------------------------------------------

describe("reachability", () => {
  const g = createDigraph(
    ["a", "b", "c", "d", "e"],
    [
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
    ]
  );

  it("reachable from start", () => {
    const r = reachable(g, "a");
    expect(r).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("disconnected nodes are unreachable", () => {
    const r = reachable(g, "a");
    expect(r.has("e")).toBe(false);
  });

  it("hasPath positive", () => {
    expect(hasPath(g, "a", "d")).toBe(true);
  });

  it("hasPath negative", () => {
    expect(hasPath(g, "d", "a")).toBe(false);
  });

  it("hasPath self", () => {
    expect(hasPath(g, "a", "a")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Shortest path
// ---------------------------------------------------------------------------

describe("shortestPath (unweighted)", () => {
  it("finds shortest path in a DAG", () => {
    const g = createDigraph(
      ["a", "b", "c", "d"],
      [
        ["a", "b"],
        ["b", "d"],
        ["a", "c"],
        ["c", "d"],
      ]
    );
    const path = shortestPath(g, "a", "d");
    expect(path).not.toBeNull();
    expect(path![0]).toBe("a");
    expect(path![path!.length - 1]).toBe("d");
    expect(path!.length).toBe(3);
  });

  it("returns null when no path exists", () => {
    const g = createDigraph(["a", "b"], []);
    expect(shortestPath(g, "a", "b")).toBeNull();
  });

  it("returns single node for same start and end", () => {
    const g = createDigraph(["a"], []);
    expect(shortestPath(g, "a", "a")).toEqual(["a"]);
  });
});

describe("dijkstra (weighted)", () => {
  it("finds shortest weighted path", () => {
    const g: ReturnType<typeof createDigraph> = {
      nodes: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
      edges: [
        { from: "a", to: "b", weight: 1 },
        { from: "b", to: "d", weight: 1 },
        { from: "a", to: "c", weight: 1 },
        { from: "c", to: "d", weight: 10 },
      ],
      directed: true,
    };
    const result = dijkstra(g, "a", "d");
    expect(result).not.toBeNull();
    expect(result!.path).toEqual(["a", "b", "d"]);
    expect(result!.weight).toBe(2);
  });

  it("returns null when no path exists", () => {
    const g = createDigraph(["a", "b"], []);
    expect(dijkstra(g, "a", "b")).toBeNull();
  });

  it("handles same start and end", () => {
    const g = createDigraph(["a"], []);
    const result = dijkstra(g, "a", "a");
    expect(result).toEqual({ path: ["a"], weight: 0 });
  });
});

// ---------------------------------------------------------------------------
// Strongly connected components
// ---------------------------------------------------------------------------

describe("stronglyConnectedComponents", () => {
  it("each node is its own SCC in a DAG", () => {
    const g = createDigraph(
      ["a", "b", "c"],
      [
        ["a", "b"],
        ["b", "c"],
      ]
    );
    const sccs = stronglyConnectedComponents(g);
    expect(sccs).toHaveLength(3);
    for (const scc of sccs) {
      expect(scc).toHaveLength(1);
    }
  });

  it("detects a single SCC (full cycle)", () => {
    const g = createDigraph(
      ["a", "b", "c"],
      [
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
      ]
    );
    const sccs = stronglyConnectedComponents(g);
    expect(sccs).toHaveLength(1);
    expect(sccs[0].sort()).toEqual(["a", "b", "c"]);
  });

  it("detects multiple SCCs", () => {
    const g = createDigraph(
      ["a", "b", "c", "d"],
      [
        ["a", "b"],
        ["b", "a"],
        ["c", "d"],
        ["d", "c"],
        ["b", "c"],
      ]
    );
    const sccs = stronglyConnectedComponents(g);
    expect(sccs).toHaveLength(2);
    const sorted = sccs.map((s) => s.sort()).sort((a, b) => a[0].localeCompare(b[0]));
    expect(sorted).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Cycle detection
// ---------------------------------------------------------------------------

describe("cycle detection", () => {
  it("no cycles in a DAG", () => {
    const g = createDigraph(
      ["a", "b", "c"],
      [
        ["a", "b"],
        ["b", "c"],
      ]
    );
    expect(hasCycles(g)).toBe(false);
    expect(detectCycles(g)).toEqual([]);
  });

  it("detects self-loop", () => {
    const g = createDigraph(["a"], [["a", "a"]]);
    expect(hasCycles(g)).toBe(true);
    const cycles = detectCycles(g);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it("detects complex cycles", () => {
    const g = createDigraph(
      ["a", "b", "c"],
      [
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
      ]
    );
    expect(hasCycles(g)).toBe(true);
    const cycles = detectCycles(g);
    expect(cycles.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// isDAG, transitiveClosure, reverseGraph
// ---------------------------------------------------------------------------

describe("isDAG", () => {
  it("returns true for a DAG", () => {
    const g = createDigraph(["a", "b"], [["a", "b"]]);
    expect(isDAG(g)).toBe(true);
  });

  it("returns false for a cyclic graph", () => {
    const g = createDigraph(
      ["a", "b"],
      [
        ["a", "b"],
        ["b", "a"],
      ]
    );
    expect(isDAG(g)).toBe(false);
  });
});

describe("transitiveClosure", () => {
  it("adds transitive edges", () => {
    const g = createDigraph(
      ["a", "b", "c"],
      [
        ["a", "b"],
        ["b", "c"],
      ]
    );
    const tc = transitiveClosure(g);
    const edgeSet = new Set(tc.edges.map((e) => `${e.from}->${e.to}`));
    expect(edgeSet.has("a->b")).toBe(true);
    expect(edgeSet.has("a->c")).toBe(true);
    expect(edgeSet.has("b->c")).toBe(true);
  });
});

describe("reverseGraph", () => {
  it("flips all edges", () => {
    const g = createDigraph(
      ["a", "b", "c"],
      [
        ["a", "b"],
        ["b", "c"],
      ]
    );
    const rg = reverseGraph(g);
    expect(rg.edges[0].from).toBe("b");
    expect(rg.edges[0].to).toBe("a");
    expect(rg.edges[1].from).toBe("c");
    expect(rg.edges[1].to).toBe("b");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("empty graph", () => {
    const g = createDigraph([], []);
    expect(topoSort(g)).toEqual({ ok: true, order: [] });
    expect(hasCycles(g)).toBe(false);
    expect(stronglyConnectedComponents(g)).toEqual([]);
  });

  it("single node, no edges", () => {
    const g = createDigraph(["a"], []);
    expect(topoSort(g)).toEqual({ ok: true, order: ["a"] });
    expect(bfs(g, "a")).toEqual(["a"]);
    expect(dfs(g, "a")).toEqual(["a"]);
    expect(reachable(g, "a")).toEqual(new Set(["a"]));
  });

  it("disconnected graph", () => {
    const g = createDigraph(
      ["a", "b", "c", "d"],
      [
        ["a", "b"],
        ["c", "d"],
      ]
    );
    expect(hasPath(g, "a", "d")).toBe(false);
    expect(hasPath(g, "a", "b")).toBe(true);
    expect(reachable(g, "a")).toEqual(new Set(["a", "b"]));
  });
});
