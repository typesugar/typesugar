import type { Graph, GraphEdge, GraphNode } from "./types.js";

/** Create a directed graph from node IDs and edge tuples `[from, to, label?]`. */
export function createDigraph(
  nodes: string[],
  edges: [from: string, to: string, label?: string][]
): Graph {
  return buildGraph(nodes, edges, true);
}

/** Create an undirected graph from node IDs and edge tuples `[from, to, label?]`. */
export function createGraph(
  nodes: string[],
  edges: [from: string, to: string, label?: string][]
): Graph {
  return buildGraph(nodes, edges, false);
}

function buildGraph(
  nodeIds: string[],
  edgeTuples: [string, string, string?][],
  directed: boolean
): Graph {
  const nodeSet = new Set(nodeIds);
  for (const [from, to] of edgeTuples) {
    nodeSet.add(from);
    nodeSet.add(to);
  }
  const nodes: GraphNode[] = [...nodeSet].map((id) => ({ id }));
  const edges: GraphEdge[] = edgeTuples.map(([from, to, label]) => ({
    from,
    to,
    ...(label !== undefined ? { label } : {}),
  }));
  return { nodes, edges, directed };
}

/** Get IDs of all neighbor nodes (outgoing for digraphs, both directions for undirected). */
export function neighbors(graph: Graph, nodeId: string): string[] {
  const result: string[] = [];
  for (const e of graph.edges) {
    if (e.from === nodeId) result.push(e.to);
    if (!graph.directed && e.to === nodeId) result.push(e.from);
  }
  return result;
}

/** Get all edges pointing into `nodeId`. */
export function inEdges(graph: Graph, nodeId: string): GraphEdge[] {
  if (graph.directed) {
    return graph.edges.filter((e) => e.to === nodeId);
  }
  return graph.edges.filter((e) => e.from === nodeId || e.to === nodeId);
}

/** Get all edges going out of `nodeId`. */
export function outEdges(graph: Graph, nodeId: string): GraphEdge[] {
  if (graph.directed) {
    return graph.edges.filter((e) => e.from === nodeId);
  }
  return graph.edges.filter((e) => e.from === nodeId || e.to === nodeId);
}

/** Total degree (in + out for directed, edge count for undirected). */
export function degree(graph: Graph, nodeId: string): number {
  if (graph.directed) {
    return inDegree(graph, nodeId) + outDegree(graph, nodeId);
  }
  let count = 0;
  for (const e of graph.edges) {
    if (e.from === nodeId || e.to === nodeId) count++;
  }
  return count;
}

/** Number of edges pointing into `nodeId`. */
export function inDegree(graph: Graph, nodeId: string): number {
  if (graph.directed) {
    return graph.edges.filter((e) => e.to === nodeId).length;
  }
  return degree(graph, nodeId);
}

/** Number of edges going out of `nodeId`. */
export function outDegree(graph: Graph, nodeId: string): number {
  if (graph.directed) {
    return graph.edges.filter((e) => e.from === nodeId).length;
  }
  return degree(graph, nodeId);
}

/** Build an adjacency list `Map<nodeId, neighborIds[]>` for efficient traversal. */
export function adjacencyList(graph: Graph): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) {
    adj.set(n.id, []);
  }
  for (const e of graph.edges) {
    adj.get(e.from)?.push(e.to);
    if (!graph.directed) {
      adj.get(e.to)?.push(e.from);
    }
  }
  return adj;
}

/** Return a new graph with an additional node. */
export function addNode(graph: Graph, id: string, metadata?: Record<string, unknown>): Graph {
  if (graph.nodes.some((n) => n.id === id)) return graph;
  const node: GraphNode = metadata ? { id, metadata } : { id };
  return { ...graph, nodes: [...graph.nodes, node] };
}

/** Return a new graph with an additional edge. Missing endpoint nodes are created. */
export function addEdge(
  graph: Graph,
  from: string,
  to: string,
  label?: string,
  weight?: number
): Graph {
  let g = graph;
  if (!g.nodes.some((n) => n.id === from)) g = addNode(g, from);
  if (!g.nodes.some((n) => n.id === to)) g = addNode(g, to);
  const edge: GraphEdge = {
    from,
    to,
    ...(label !== undefined ? { label } : {}),
    ...(weight !== undefined ? { weight } : {}),
  };
  return { ...g, edges: [...g.edges, edge] };
}

/** Return a new graph without the given node (and all its incident edges). */
export function removeNode(graph: Graph, id: string): Graph {
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => n.id !== id),
    edges: graph.edges.filter((e) => e.from !== id && e.to !== id),
  };
}

/** Return a new graph without edges from `from` to `to`. */
export function removeEdge(graph: Graph, from: string, to: string): Graph {
  return {
    ...graph,
    edges: graph.edges.filter((e) => !(e.from === from && e.to === to)),
  };
}
