/**
 * GraphLike Typeclass
 *
 * Abstracts graph structure so generic algorithms work on any graph-like type.
 * Node identity comes from Eq<N> + Hash<N> constraints on algorithms,
 * NOT from the typeclass itself (Haskell-style separation of concerns).
 *
 * Hierarchy:
 *   GraphLike<G, N, E>
 *     └── WeightedGraphLike<G, N, E, W>
 */

import type { Graph, GraphEdge } from "./types.js";

// ============================================================================
// Core typeclass — 6 required methods
// ============================================================================

/**
 * GraphLike typeclass — structural queries on a graph.
 *
 * @typeParam G - The graph type
 * @typeParam N - The node type (identity via Eq/Hash, NOT baked in here)
 * @typeParam E - The edge type
 */
export interface GraphLike<G, N, E> {
  /** All nodes in the graph. */
  nodes(g: G): Iterable<N>;

  /** All edges in the graph. */
  edges(g: G): Iterable<E>;

  /** Successor nodes (outgoing for digraphs, all neighbors for undirected). */
  successors(g: G, node: N): Iterable<N>;

  /** Source node of an edge. */
  edgeSource(e: E): N;

  /** Target node of an edge. */
  edgeTarget(e: E): N;

  /** Whether the graph is directed. */
  isDirected(g: G): boolean;
}

// ============================================================================
// Weighted extension
// ============================================================================

/**
 * WeightedGraphLike extends GraphLike with edge weights.
 */
export interface WeightedGraphLike<G, N, E, W> extends GraphLike<G, N, E> {
  edgeWeight(e: E): W;
}

// ============================================================================
// Concrete instance for Graph
// ============================================================================

/**
 * GraphLike instance for the concrete Graph type.
 * N = string (node IDs), E = GraphEdge.
 */
export const graphLike: GraphLike<Graph, string, GraphEdge> = {
  nodes(g) {
    return g.nodes.map((n) => n.id);
  },

  edges(g) {
    return g.edges;
  },

  successors(g, nodeId) {
    const result: string[] = [];
    for (const e of g.edges) {
      if (e.from === nodeId) result.push(e.to);
      if (!g.directed && e.to === nodeId) result.push(e.from);
    }
    return result;
  },

  edgeSource(e) {
    return e.from;
  },

  edgeTarget(e) {
    return e.to;
  },

  isDirected(g) {
    return g.directed;
  },
};

/**
 * WeightedGraphLike instance for Graph with numeric edge weights.
 */
export const weightedGraphLike: WeightedGraphLike<Graph, string, GraphEdge, number> = {
  ...graphLike,
  edgeWeight(e) {
    return e.weight ?? 1;
  },
};
