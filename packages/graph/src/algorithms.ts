"use extension";
/**
 * Graph Algorithms
 *
 * All exported functions take `Graph` as their first argument,
 * enabling method-call syntax: `g.topoSort()`, `g.bfs(start)`, etc.
 */
import type { Graph, GraphEdge } from "./types.js";
import { adjacencyList } from "./graph.js";
import type { Monoid, Ord } from "@typesugar/std";
import { eqString, hashString } from "@typesugar/std";
import { graphLike, weightedGraphLike, type GraphLike } from "./typeclass.js";
import {
  topoSortG,
  hasCyclesG,
  bfsG,
  dfsG,
  hasPathG,
  shortestPathG,
  dijkstraWithG,
  sccG,
  requireDirected,
} from "./generic-algorithms.js";

// Re-export generic algorithms
export {
  topoSortG,
  hasCyclesG,
  bfsG,
  dfsG,
  reachableG,
  hasPathG,
  shortestPathG,
  dijkstraWithG,
  sccG,
} from "./generic-algorithms.js";

/**
 * Configuration for generic shortest path algorithms.
 * Enables Dijkstra to work with custom weight types (e.g., durations, costs, probabilities).
 */
export interface PathCostConfig<W> {
  /** Monoid for combining weights along a path */
  readonly monoid: Monoid<W>;
  /** Ordering for comparing path costs */
  readonly ord: Ord<W>;
  /** Extract weight from an edge (defaults to edge.weight if present) */
  readonly getWeight: (edge: GraphEdge) => W;
}

// ============================================================================
// Backward-compatible wrappers that delegate to generic algorithms
// ============================================================================

/**
 * Topological sort using Kahn's algorithm.
 * Returns the sorted node IDs, or the cycle that prevented sorting.
 *
 * Directed graphs only: throws a `TypeError` for an undirected graph.
 */
export function topoSort(
  graph: Graph
): { ok: true; order: string[] } | { ok: false; cycle: string[] } {
  return topoSortG(graph, graphLike, eqString, hashString);
}

/**
 * Detect all elementary cycles using Johnson's algorithm (simplified DFS variant).
 *
 * Directed graphs only: throws a `TypeError` for an undirected graph (where
 * every edge would otherwise be reported as a 2-cycle). The number of
 * elementary cycles can be exponential in the number of nodes; use
 * {@link hasCycles} when you only need to know whether one exists.
 */
export function detectCycles(graph: Graph): string[][] {
  requireDirected(graph, graphLike, "detectCycles");
  const adj = adjacencyList(graph);
  const nodeIds = graph.nodes.map((n) => n.id);
  const order = new Map<string, number>();
  nodeIds.forEach((id, i) => order.set(id, i));
  const cycles: string[][] = [];
  const blocked = new Set<string>();
  const blockedMap = new Map<string, Set<string>>();
  const stack: string[] = [];

  function unblock(u0: string): void {
    // Iterative worklist (the recursive version overflows on long chains).
    const work = [u0];
    while (work.length > 0) {
      const u = work.pop()!;
      blocked.delete(u);
      const bSet = blockedMap.get(u);
      if (bSet) {
        for (const w of bSet) {
          if (blocked.has(w)) work.push(w);
        }
        bSet.clear();
      }
    }
  }

  // Iterative `circuit(v, start)` with an explicit frame stack, so cycle
  // detection on long paths doesn't overflow the JS call stack.
  function circuit(v0: string, start: string, allowed: Set<string>): void {
    type Frame = { v: string; succ: string[]; i: number; found: boolean };
    const enter = (v: string): Frame => {
      stack.push(v);
      blocked.add(v);
      return { v, succ: adj.get(v) ?? [], i: 0, found: false };
    };
    const frames: Frame[] = [enter(v0)];
    while (frames.length > 0) {
      const f = frames[frames.length - 1];
      if (f.i < f.succ.length) {
        const w = f.succ[f.i++];
        if (w === start) {
          cycles.push([...stack]);
          f.found = true;
        } else if (!blocked.has(w) && allowed.has(w)) {
          frames.push(enter(w));
        }
        continue;
      }
      // Return from circuit(f.v)
      frames.pop();
      if (f.found) {
        unblock(f.v);
      } else {
        for (const w of f.succ) {
          if (!blockedMap.has(w)) blockedMap.set(w, new Set());
          blockedMap.get(w)!.add(f.v);
        }
      }
      stack.pop();
      const parent = frames[frames.length - 1];
      if (parent && f.found) parent.found = true;
    }
  }

  // Johnson's outer loop: only search from the least node of a non-trivial
  // SCC of the subgraph induced by nodes at index >= s, restricted to that SCC.
  // Nodes that cannot be on a cycle are never walked, which keeps long acyclic
  // stretches linear instead of quadratic.
  let s = 0;
  while (s < nodeIds.length) {
    const lo = s;
    const sub: GraphLike<null, string, never> = {
      nodes: () => nodeIds.slice(lo),
      edges: () => [],
      successors: (_g, v) => (adj.get(v) ?? []).filter((w) => (order.get(w) ?? -1) >= lo),
      edgeSource: (e) => e,
      edgeTarget: (e) => e,
      isDirected: () => true,
    };
    let best: { least: number; members: string[] } | undefined;
    for (const scc of sccG(null, sub, eqString, hashString)) {
      const nontrivial = scc.length > 1 || (adj.get(scc[0]) ?? []).includes(scc[0]);
      if (!nontrivial) continue;
      let least = Infinity;
      for (const m of scc) least = Math.min(least, order.get(m)!);
      if (!best || least < best.least) best = { least, members: scc };
    }
    if (!best) break;
    const startNode = nodeIds[best.least];
    blocked.clear();
    blockedMap.clear();
    circuit(startNode, startNode, new Set(best.members));
    s = best.least + 1;
  }

  return cycles;
}

/**
 * Returns true if the graph contains at least one cycle — a directed cycle for
 * a directed graph, an undirected cycle (including self-loops and parallel
 * edges) for an undirected graph.
 */
export function hasCycles(graph: Graph): boolean {
  return hasCyclesG(graph, graphLike, eqString, hashString);
}

/** Breadth-first search from `start`, returning node IDs in visit order. */
export function bfs(graph: Graph, start: string): string[] {
  return bfsG(graph, start, graphLike, eqString, hashString);
}

/** Depth-first search from `start`, returning node IDs in visit order. */
export function dfs(graph: Graph, start: string): string[] {
  return dfsG(graph, start, graphLike, eqString, hashString);
}

/** All node IDs reachable from `start` (inclusive). */
export function reachable(graph: Graph, start: string): Set<string> {
  return new Set(bfs(graph, start));
}

/** Check if there is a directed path from `from` to `to`. */
export function hasPath(graph: Graph, from: string, to: string): boolean {
  return hasPathG(graph, from, to, graphLike, eqString, hashString);
}

/** Shortest path (unweighted) via BFS. Returns the path array or null. */
export function shortestPath(graph: Graph, from: string, to: string): string[] | null {
  return shortestPathG(graph, from, to, graphLike, eqString, hashString);
}

/**
 * Generic Dijkstra's algorithm with custom weight type.
 *
 * Uses Monoid<W> for combining path costs and Ord<W> for comparing them.
 *
 * @example
 * ```ts
 * const result = dijkstraWith(graph, "A", "B", {
 *   monoid: durationMonoid,
 *   ord: durationOrd,
 *   getWeight: (e) => Duration.parse(e.label ?? "0s"),
 * });
 * ```
 */
export function dijkstraWith<W>(
  graph: Graph,
  from: string,
  to: string,
  config: PathCostConfig<W>
): { path: string[]; weight: W } | null {
  const { monoid, ord, getWeight } = config;
  const wgl = {
    ...graphLike,
    edgeWeight: (e: GraphEdge) => getWeight(e),
  };
  return dijkstraWithG(graph, from, to, wgl, eqString, hashString, monoid, ord);
}

/**
 * Default number-based Monoid for path costs.
 * Combines via addition, identity is 0.
 */
export const numberMonoid: Monoid<number> = {
  combine: (a, b) => a + b,
  empty: () => 0,
};

/**
 * Default number-based Ord for path costs.
 * Standard numeric ordering.
 */
export const numberOrd: Ord<number> = {
  equals: (a, b) => a === b,
  compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  lessThan: (a, b) => a < b,
  lessThanOrEqual: (a, b) => a <= b,
  greaterThan: (a, b) => a > b,
  greaterThanOrEqual: (a, b) => a >= b,
} as Ord<number>;

/**
 * Dijkstra's algorithm for weighted shortest path (number weights).
 * Edges without explicit weight are treated as weight 1.
 *
 * For custom weight types, use `dijkstraWith` with appropriate Monoid and Ord.
 */
export function dijkstra(
  graph: Graph,
  from: string,
  to: string
): { path: string[]; weight: number } | null {
  return dijkstraWith(graph, from, to, {
    monoid: numberMonoid,
    ord: numberOrd,
    getWeight: (e) => e.weight ?? 1,
  });
}

/** Tarjan's algorithm for strongly connected components. */
export function stronglyConnectedComponents(graph: Graph): string[][] {
  return sccG(graph, graphLike, eqString, hashString);
}

/**
 * Returns true if the directed graph is a DAG (no cycles).
 *
 * Directed graphs only: throws a `TypeError` for an undirected graph.
 */
export function isDAG(graph: Graph): boolean {
  requireDirected(graph, graphLike, "isDAG");
  return !hasCycles(graph);
}

/**
 * Compute the transitive closure: an edge (u,v) exists iff v is reachable from
 * u by a path of one or more edges. In particular `u -> u` is included exactly
 * when u lies on a cycle (or has a self-loop).
 */
export function transitiveClosure(graph: Graph): Graph {
  const nodeIds = graph.nodes.map((n) => n.id);
  const newEdges: GraphEdge[] = [];

  for (const nodeId of nodeIds) {
    const reached = reachable(graph, nodeId);
    // `reachable` includes the start node itself (the empty path). Keep it only
    // if a non-empty path returns to it: a directed edge p -> u from some p
    // reachable from u (p === u is a self-loop). For an undirected graph only
    // an explicit self-loop counts — walking an edge back is not a cycle.
    const onCycle = graph.edges.some((e) =>
      graph.directed ? e.to === nodeId && reached.has(e.from) : e.from === nodeId && e.to === nodeId
    );
    if (!onCycle) reached.delete(nodeId);
    for (const target of reached) {
      newEdges.push({ from: nodeId, to: target });
    }
  }

  return { nodes: [...graph.nodes], edges: newEdges, directed: graph.directed };
}

/** Reverse all edges in a directed graph. */
export function reverseGraph(graph: Graph): Graph {
  return {
    nodes: [...graph.nodes],
    edges: graph.edges.map((e) => ({ ...e, from: e.to, to: e.from })),
    directed: graph.directed,
  };
}
