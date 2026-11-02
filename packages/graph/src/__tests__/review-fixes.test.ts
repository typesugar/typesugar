/**
 * Regression tests for the 1.0 deep-review graph findings (FMG-9, FMG-10,
 * FMG-13, FMG-16).
 */
import { describe, it, expect } from "vitest";
import { eqString, hashString } from "@typesugar/std";
import {
  createDigraph,
  createGraph,
  dijkstra,
  shortestPath,
  hasCycles,
  isDAG,
  topoSort,
  detectCycles,
  transitiveClosure,
  parseDigraph,
  dfsG,
  sccG,
  hasCyclesG,
  graphLike,
  type GraphLike,
} from "../index.js";

describe("FMG-9: dijkstra on undirected graphs", () => {
  it("traverses an edge stored in the reverse direction", () => {
    const g = createGraph(["A", "B"], [["B", "A"]]);
    expect(shortestPath(g, "A", "B")).toEqual(["A", "B"]);
    expect(dijkstra(g, "A", "B")).toEqual({ path: ["A", "B"], weight: 1 });
  });

  it("finds a multi-hop path through reversed edges", () => {
    const g = {
      nodes: [{ id: "A" }, { id: "B" }, { id: "C" }],
      edges: [
        { from: "B", to: "A", weight: 2 },
        { from: "C", to: "B", weight: 3 },
      ],
      directed: false,
    };
    expect(dijkstra(g, "A", "C")).toEqual({ path: ["A", "B", "C"], weight: 5 });
  });
});

describe("FMG-10: cycle algorithms on undirected graphs", () => {
  const square = createGraph(
    ["n2", "n3", "n4", "n5"],
    [
      ["n2", "n5"],
      ["n4", "n5"],
      ["n3", "n4"],
      ["n2", "n3"],
    ]
  );
  const tree = createGraph(
    ["A", "B", "C"],
    [
      ["A", "B"],
      ["A", "C"],
    ]
  );

  it("hasCycles detects an undirected 4-cycle", () => {
    expect(hasCycles(square)).toBe(true);
  });

  it("hasCycles is false for an undirected tree (a single edge is not a cycle)", () => {
    expect(hasCycles(tree)).toBe(false);
    expect(hasCycles(createGraph(["A", "B"], [["A", "B"]]))).toBe(false);
  });

  it("hasCycles treats a self-loop and parallel undirected edges as cycles", () => {
    expect(hasCycles(createGraph(["A"], [["A", "A"]]))).toBe(true);
    expect(
      hasCycles(
        createGraph(
          ["A", "B"],
          [
            ["A", "B"],
            ["B", "A"],
          ]
        )
      )
    ).toBe(true);
  });

  it("topoSort / isDAG / detectCycles reject undirected input", () => {
    expect(() => topoSort(tree)).toThrow(/directed/);
    expect(() => isDAG(tree)).toThrow(/directed/);
    expect(() => detectCycles(createGraph(["A", "B"], [["A", "B"]]))).toThrow(/directed/);
  });

  it("directed behaviour is unchanged", () => {
    const dag = createDigraph(["A", "B"], [["A", "B"]]);
    expect(hasCycles(dag)).toBe(false);
    expect(isDAG(dag)).toBe(true);
    expect(
      detectCycles(
        createDigraph(
          ["A", "B"],
          [
            ["A", "B"],
            ["B", "A"],
          ]
        )
      )
    ).toEqual([["A", "B"]]);
  });
});

/** A fast adjacency-map GraphLike so a long chain is cheap to build. */
function chainGraph(n: number, closeLoop = false) {
  const adj = new Map<string, string[]>();
  for (let i = 0; i < n; i++)
    adj.set("v" + i, i + 1 < n ? ["v" + (i + 1)] : closeLoop ? ["v0"] : []);
  const GL: GraphLike<Map<string, string[]>, string, [string, string]> = {
    nodes: (g) => [...g.keys()],
    edges: (g) => [...g].flatMap(([f, ts]) => ts.map((t) => [f, t] as [string, string])),
    successors: (g, v) => g.get(v) ?? [],
    edgeSource: (e) => e[0],
    edgeTarget: (e) => e[1],
    isDirected: () => true,
  };
  return { g: adj, GL };
}

describe("FMG-13: deep graphs do not overflow the stack", () => {
  const N = 50_000;

  it("dfsG on a long chain", () => {
    const { g, GL } = chainGraph(N);
    const order = dfsG(g, "v0", GL, eqString, hashString);
    expect(order.length).toBe(N);
    expect(order[0]).toBe("v0");
    expect(order[N - 1]).toBe("v" + (N - 1));
  });

  it("sccG on a long chain and on a long cycle", () => {
    const chain = chainGraph(N);
    expect(sccG(chain.g, chain.GL, eqString, hashString).length).toBe(N);
    const loop = chainGraph(N, true);
    const sccs = sccG(loop.g, loop.GL, eqString, hashString);
    expect(sccs.length).toBe(1);
    expect(sccs[0].length).toBe(N);
    expect(hasCyclesG(loop.g, loop.GL, eqString, hashString)).toBe(true);
  });

  it("detectCycles on a long cycle", () => {
    const n = 20_000;
    const ids = Array.from({ length: n }, (_, i) => "v" + i);
    const g = createDigraph(
      ids,
      ids.map((id, i) => [id, ids[(i + 1) % n]] as [string, string])
    );
    const cycles = detectCycles(g);
    expect(cycles.length).toBe(1);
    expect(cycles[0].length).toBe(n);
  });

  it("dfsG preserves recursive preorder on a branching graph", () => {
    const g = createDigraph(
      ["a", "b", "c", "d", "e"],
      [
        ["a", "b"],
        ["a", "c"],
        ["b", "d"],
        ["c", "e"],
        ["d", "c"],
      ]
    );
    // a -> b -> d -> c -> e (c already visited when a's second child comes up)
    expect(dfsG(g, "a", graphLike, eqString, hashString)).toEqual(["a", "b", "d", "c", "e"]);
  });
});

describe("FMG-16: transitiveClosure and DSL edge cases", () => {
  it("transitiveClosure includes u->u when u lies on a cycle", () => {
    const g = createDigraph(
      ["A", "B", "C"],
      [
        ["A", "B"],
        ["B", "A"],
        ["B", "C"],
      ]
    );
    const edges = transitiveClosure(g)
      .edges.map((e) => `${e.from}->${e.to}`)
      .sort();
    expect(edges).toEqual(["A->A", "A->B", "A->C", "B->A", "B->B", "B->C"]);
  });

  it("transitiveClosure omits u->u for nodes not on a cycle", () => {
    const g = createDigraph(["A", "B"], [["A", "B"]]);
    expect(transitiveClosure(g).edges.map((e) => `${e.from}->${e.to}`)).toEqual(["A->B"]);
  });

  it("parseDigraph rejects a comma inside a label", () => {
    expect(() => parseDigraph("a -> b [x, y]")).toThrow(SyntaxError);
  });

  it("parseDigraph rejects chained arrows", () => {
    expect(() => parseDigraph("a -> b -> c")).toThrow(SyntaxError);
  });

  it("parseDigraph still accepts labelled and multiple targets", () => {
    const g = parseDigraph("a -> b [go], c");
    expect(g.edges).toEqual([
      { from: "a", to: "b", label: "go" },
      { from: "a", to: "c" },
    ]);
  });
});
