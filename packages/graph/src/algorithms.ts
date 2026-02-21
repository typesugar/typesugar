import type { Graph, GraphEdge } from "./types.js";
import { adjacencyList } from "./graph.js";

/**
 * Topological sort using Kahn's algorithm.
 * Returns the sorted node IDs, or the cycle that prevented sorting.
 */
export function topoSort(
  graph: Graph
): { ok: true; order: string[] } | { ok: false; cycle: string[] } {
  const adj = adjacencyList(graph);
  const inDeg = new Map<string, number>();
  for (const n of graph.nodes) inDeg.set(n.id, 0);
  for (const e of graph.edges) {
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, d] of inDeg) {
    if (d === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const neighbor of adj.get(node) ?? []) {
      const nd = (inDeg.get(neighbor) ?? 1) - 1;
      inDeg.set(neighbor, nd);
      if (nd === 0) queue.push(neighbor);
    }
  }

  if (order.length !== graph.nodes.length) {
    const cycle = findOneCycle(graph);
    return { ok: false, cycle: cycle ?? [] };
  }
  return { ok: true, order };
}

/** Find a single cycle in the graph using DFS, or null if acyclic. */
function findOneCycle(graph: Graph): string[] | null {
  const adj = adjacencyList(graph);
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();
  for (const n of graph.nodes) {
    color.set(n.id, WHITE);
    parent.set(n.id, null);
  }

  for (const n of graph.nodes) {
    if (color.get(n.id) !== WHITE) continue;
    const stack: Array<{ node: string; idx: number }> = [{ node: n.id, idx: 0 }];
    color.set(n.id, GRAY);

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const neighbors = adj.get(top.node) ?? [];
      if (top.idx >= neighbors.length) {
        color.set(top.node, BLACK);
        stack.pop();
        continue;
      }
      const next = neighbors[top.idx];
      top.idx++;
      if (color.get(next) === GRAY) {
        const cycle: string[] = [next];
        for (let i = stack.length - 1; i >= 0; i--) {
          cycle.push(stack[i].node);
          if (stack[i].node === next) break;
        }
        cycle.reverse();
        return cycle;
      }
      if (color.get(next) === WHITE) {
        color.set(next, GRAY);
        parent.set(next, top.node);
        stack.push({ node: next, idx: 0 });
      }
    }
  }
  return null;
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
  return !topoSort(graph).ok;
}

/** Breadth-first search from `start`, returning node IDs in visit order. */
export function bfs(graph: Graph, start: string): string[] {
  const adj = adjacencyList(graph);
  const visited = new Set<string>();
  const order: string[] = [];
  const queue: string[] = [start];
  visited.add(start);

  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const neighbor of adj.get(node) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return order;
}

/** Depth-first search from `start`, returning node IDs in visit order. */
export function dfs(graph: Graph, start: string): string[] {
  const adj = adjacencyList(graph);
  const visited = new Set<string>();
  const order: string[] = [];

  function visit(node: string): void {
    if (visited.has(node)) return;
    visited.add(node);
    order.push(node);
    for (const neighbor of adj.get(node) ?? []) {
      visit(neighbor);
    }
  }

  visit(start);
  return order;
}

/** All node IDs reachable from `start` (inclusive). */
export function reachable(graph: Graph, start: string): Set<string> {
  return new Set(bfs(graph, start));
}

/** Check if there is a directed path from `from` to `to`. */
export function hasPath(graph: Graph, from: string, to: string): boolean {
  if (from === to) return true;
  return reachable(graph, from).has(to);
}

/** Shortest path (unweighted) via BFS. Returns the path array or null. */
export function shortestPath(graph: Graph, from: string, to: string): string[] | null {
  if (from === to) return [from];
  const adj = adjacencyList(graph);
  const visited = new Set<string>([from]);
  const parent = new Map<string, string>();
  const queue: string[] = [from];

  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const neighbor of adj.get(node) ?? []) {
      if (visited.has(neighbor)) continue;
      parent.set(neighbor, node);
      if (neighbor === to) {
        return reconstructPath(parent, from, to);
      }
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }
  return null;
}

function reconstructPath(parent: Map<string, string>, from: string, to: string): string[] {
  const path: string[] = [];
  let cur: string | undefined = to;
  while (cur !== undefined) {
    path.push(cur);
    if (cur === from) break;
    cur = parent.get(cur);
  }
  path.reverse();
  return path;
}

/**
 * Dijkstra's algorithm for weighted shortest path.
 * Edges without explicit weight are treated as weight 1.
 */
export function dijkstra(
  graph: Graph,
  from: string,
  to: string
): { path: string[]; weight: number } | null {
  if (from === to) return { path: [from], weight: 0 };

  const weightedAdj = new Map<string, Array<{ to: string; weight: number }>>();
  for (const n of graph.nodes) weightedAdj.set(n.id, []);
  for (const e of graph.edges) {
    weightedAdj.get(e.from)?.push({ to: e.to, weight: e.weight ?? 1 });
    if (!graph.directed) {
      weightedAdj.get(e.to)?.push({ to: e.from, weight: e.weight ?? 1 });
    }
  }

  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();

  for (const n of graph.nodes) dist.set(n.id, Infinity);
  dist.set(from, 0);

  while (true) {
    let minNode: string | null = null;
    let minDist = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < minDist) {
        minDist = d;
        minNode = id;
      }
    }
    if (minNode === null || minNode === to) break;

    visited.add(minNode);
    for (const { to: neighbor, weight } of weightedAdj.get(minNode) ?? []) {
      const alt = minDist + weight;
      if (alt < (dist.get(neighbor) ?? Infinity)) {
        dist.set(neighbor, alt);
        prev.set(neighbor, minNode);
      }
    }
  }

  const totalWeight = dist.get(to);
  if (totalWeight === undefined || totalWeight === Infinity) return null;

  const path: string[] = [];
  let cur: string | undefined = to;
  while (cur !== undefined) {
    path.push(cur);
    if (cur === from) break;
    cur = prev.get(cur);
  }
  path.reverse();
  return { path, weight: totalWeight };
}

/** Tarjan's algorithm for strongly connected components. */
export function stronglyConnectedComponents(graph: Graph): string[][] {
  const adj = adjacencyList(graph);
  let index = 0;
  const nodeIndex = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  function strongconnect(v: string): void {
    nodeIndex.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) ?? []) {
      if (!nodeIndex.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, nodeIndex.get(w)!));
      }
    }

    if (lowlink.get(v) === nodeIndex.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  }

  for (const n of graph.nodes) {
    if (!nodeIndex.has(n.id)) {
      strongconnect(n.id);
    }
  }

  return sccs;
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
