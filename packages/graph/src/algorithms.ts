import type { Graph, GraphEdge } from "./types.js";
import { adjacencyList } from "./graph.js";
import type { Monoid, Ord } from "@typesugar/std";
import { eqString, hashString } from "@typesugar/std";
import { graphLike, weightedGraphLike } from "./typeclass.js";
import {
  topoSortG,
  hasCyclesG,
  bfsG,
  dfsG,
  hasPathG,
  shortestPathG,
  dijkstraWithG,
  sccG,
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
 */
export function topoSort(
  graph: Graph
): { ok: true; order: string[] } | { ok: false; cycle: string[] } {
  return topoSortG(graph, graphLike, eqString, hashString);
}

/** Detect all elementary cycles using Johnson's algorithm (simplified DFS variant). */
export function detectCycles(graph: Graph): string[][] {
  const adj = adjacencyList(graph);
  const nodeIds = graph.nodes.map((n) => n.id);
  const cycles: string[][] = [];
  const blocked = new Set<string>();
  const blockedMap = new Map<string, Set<string>>();
  const stack: string[] = [];

  function unblock(u: string): void {
    blocked.delete(u);
    const bSet = blockedMap.get(u);
    if (bSet) {
      for (const w of bSet) {
        if (blocked.has(w)) unblock(w);
      }
      bSet.clear();
    }
  }

  function circuit(v: string, start: string): boolean {
    let found = false;
    stack.push(v);
    blocked.add(v);

    for (const w of adj.get(v) ?? []) {
      if (w === start) {
        cycles.push([...stack]);
        found = true;
      } else if (!blocked.has(w) && nodeIds.indexOf(w) >= nodeIds.indexOf(start)) {
        if (circuit(w, start)) found = true;
      }
    }

    if (found) {
      unblock(v);
    } else {
      for (const w of adj.get(v) ?? []) {
        if (!blockedMap.has(w)) blockedMap.set(w, new Set());
        blockedMap.get(w)!.add(v);
      }
    }
    stack.pop();
    return found;
  }

  for (const startNode of nodeIds) {
    blocked.clear();
    blockedMap.clear();
    circuit(startNode, startNode);
  }

  return cycles;
}

/** Returns true if the graph contains at least one cycle. */
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

/** Returns true if the directed graph is a DAG (no cycles). */
export function isDAG(graph: Graph): boolean {
  return !hasCycles(graph);
}

/** Compute the transitive closure: an edge (u,v) exists iff v is reachable from u. */
export function transitiveClosure(graph: Graph): Graph {
  const nodeIds = graph.nodes.map((n) => n.id);
  const newEdges: GraphEdge[] = [];

  for (const nodeId of nodeIds) {
    const reached = reachable(graph, nodeId);
    reached.delete(nodeId);
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
