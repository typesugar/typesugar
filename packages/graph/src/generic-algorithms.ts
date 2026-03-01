/**
 * Generic graph algorithms parameterized over GraphLike<G, N, E>.
 *
 * All algorithms take Eq<N> + Hash<N> for node identity tracking,
 * using HashSet/HashMap from @typesugar/collections.
 */

import type { Eq, Hash, Monoid, Ord } from "@typesugar/std";
import { HashSet, HashMap } from "@typesugar/collections";
import type { GraphLike, WeightedGraphLike } from "./typeclass.js";

// ============================================================================
// Topological Sort (Kahn's algorithm)
// ============================================================================

/** Generic topological sort over any GraphLike. */
export function topoSortG<G, N, E>(
  g: G,
  GL: GraphLike<G, N, E>,
  eq: Eq<N>,
  hash: Hash<N>
): { ok: true; order: N[] } | { ok: false; cycle: N[] } {
  const inDeg = new HashMap<N, number>(eq, hash);
  const allNodes: N[] = [];
  for (const n of GL.nodes(g)) {
    allNodes.push(n);
    inDeg.set(n, 0);
  }
  for (const e of GL.edges(g)) {
    const target = GL.edgeTarget(e);
    inDeg.set(target, inDeg.getOrElse(target, 0) + 1);
  }

  const queue: N[] = [];
  for (const n of allNodes) {
    if (inDeg.getOrElse(n, 0) === 0) queue.push(n);
  }

  const order: N[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const neighbor of GL.successors(g, node)) {
      const nd = inDeg.getOrElse(neighbor, 1) - 1;
      inDeg.set(neighbor, nd);
      if (nd === 0) queue.push(neighbor);
    }
  }

  if (order.length !== allNodes.length) {
    const cycle = findOneCycleG(g, GL, eq, hash);
    return { ok: false, cycle: cycle ?? [] };
  }
  return { ok: true, order };
}

function findOneCycleG<G, N, E>(
  g: G,
  GL: GraphLike<G, N, E>,
  eq: Eq<N>,
  hash: Hash<N>
): N[] | null {
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new HashMap<N, number>(eq, hash);
  const allNodes: N[] = [];

  for (const n of GL.nodes(g)) {
    allNodes.push(n);
    color.set(n, WHITE);
  }

  for (const startNode of allNodes) {
    if (color.getOrElse(startNode, WHITE) !== WHITE) continue;
    const stack: Array<{ node: N; neighbors: N[]; idx: number }> = [];
    const succs = [...GL.successors(g, startNode)];
    stack.push({ node: startNode, neighbors: succs, idx: 0 });
    color.set(startNode, GRAY);

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.idx >= top.neighbors.length) {
        color.set(top.node, BLACK);
        stack.pop();
        continue;
      }
      const next = top.neighbors[top.idx];
      top.idx++;
      const nextColor = color.getOrElse(next, WHITE);
      if (nextColor === GRAY) {
        const cycle: N[] = [next];
        for (let i = stack.length - 1; i >= 0; i--) {
          cycle.push(stack[i].node);
          if (eq.equals(stack[i].node, next)) break;
        }
        cycle.reverse();
        return cycle;
      }
      if (nextColor === WHITE) {
        color.set(next, GRAY);
        const nextSuccs = [...GL.successors(g, next)];
        stack.push({ node: next, neighbors: nextSuccs, idx: 0 });
      }
    }
  }
  return null;
}

// ============================================================================
// Cycle Detection
// ============================================================================

/** Generic: returns true if the graph contains at least one cycle. */
export function hasCyclesG<G, N, E>(
  g: G,
  GL: GraphLike<G, N, E>,
  eq: Eq<N>,
  hash: Hash<N>
): boolean {
  return !topoSortG(g, GL, eq, hash).ok;
}

// ============================================================================
// BFS
// ============================================================================

/** Generic breadth-first search. */
export function bfsG<G, N, E>(
  g: G,
  start: N,
  GL: GraphLike<G, N, E>,
  eq: Eq<N>,
  hash: Hash<N>
): N[] {
  const visited = new HashSet<N>(eq, hash);
  const order: N[] = [];
  const queue: N[] = [start];
  visited.add(start);

  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const neighbor of GL.successors(g, node)) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return order;
}

// ============================================================================
// DFS
// ============================================================================

/** Generic depth-first search. */
export function dfsG<G, N, E>(
  g: G,
  start: N,
  GL: GraphLike<G, N, E>,
  eq: Eq<N>,
  hash: Hash<N>
): N[] {
  const visited = new HashSet<N>(eq, hash);
  const order: N[] = [];

  function visit(node: N): void {
    if (visited.has(node)) return;
    visited.add(node);
    order.push(node);
    for (const neighbor of GL.successors(g, node)) {
      visit(neighbor);
    }
  }

  visit(start);
  return order;
}

// ============================================================================
// Reachability
// ============================================================================

/** All nodes reachable from `start` (inclusive). */
export function reachableG<G, N, E>(
  g: G,
  start: N,
  GL: GraphLike<G, N, E>,
  eq: Eq<N>,
  hash: Hash<N>
): HashSet<N> {
  const result = new HashSet<N>(eq, hash);
  for (const n of bfsG(g, start, GL, eq, hash)) result.add(n);
  return result;
}

/** Check if there is a path from `from` to `to`. */
export function hasPathG<G, N, E>(
  g: G,
  from: N,
  to: N,
  GL: GraphLike<G, N, E>,
  eq: Eq<N>,
  hash: Hash<N>
): boolean {
  if (eq.equals(from, to)) return true;
  return reachableG(g, from, GL, eq, hash).has(to);
}

// ============================================================================
// Shortest Path (unweighted, BFS-based)
// ============================================================================

/** Generic shortest path via BFS. */
export function shortestPathG<G, N, E>(
  g: G,
  from: N,
  to: N,
  GL: GraphLike<G, N, E>,
  eq: Eq<N>,
  hash: Hash<N>
): N[] | null {
  if (eq.equals(from, to)) return [from];
  const visited = new HashSet<N>(eq, hash);
  visited.add(from);
  const parent = new HashMap<N, N>(eq, hash);
  const queue: N[] = [from];

  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const neighbor of GL.successors(g, node)) {
      if (visited.has(neighbor)) continue;
      parent.set(neighbor, node);
      if (eq.equals(neighbor, to)) {
        return reconstructPathG(parent, from, to, eq);
      }
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }
  return null;
}

function reconstructPathG<N>(parent: HashMap<N, N>, from: N, to: N, eq: Eq<N>): N[] {
  const path: N[] = [];
  let cur: N | undefined = to;
  while (cur !== undefined) {
    path.push(cur);
    if (eq.equals(cur, from)) break;
    cur = parent.get(cur);
  }
  path.reverse();
  return path;
}

// ============================================================================
// Dijkstra (generic weights + generic graph)
// ============================================================================

/** Generic Dijkstra with custom weight type over any WeightedGraphLike. */
export function dijkstraWithG<G, N, E, W>(
  g: G,
  from: N,
  to: N,
  WGL: WeightedGraphLike<G, N, E, W>,
  eq: Eq<N>,
  hash: Hash<N>,
  monoid: Monoid<W>,
  ord: Ord<W>
): { path: N[]; weight: W } | null {
  const identity = monoid.empty();
  if (eq.equals(from, to)) return { path: [from], weight: identity };

  const dist = new HashMap<N, W | null>(eq, hash);
  const prev = new HashMap<N, N>(eq, hash);
  const visited = new HashSet<N>(eq, hash);

  for (const n of WGL.nodes(g)) dist.set(n, null);
  dist.set(from, identity);

  while (true) {
    let minNode: N | null = null;
    let minDist: W | null = null;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d !== null) {
        if (minDist === null || ord.lessThan(d, minDist)) {
          minDist = d;
          minNode = id;
        }
      }
    }
    if (minNode === null || eq.equals(minNode, to)) break;

    visited.add(minNode);
    const currentDist = dist.get(minNode);
    if (currentDist === null || currentDist === undefined) continue;

    for (const e of edgesFrom(g, minNode, WGL, eq)) {
      const neighbor = WGL.edgeTarget(e);
      const weight = WGL.edgeWeight(e);
      const alt = monoid.combine(currentDist, weight);
      const neighborDist = dist.get(neighbor);
      if (neighborDist === undefined || neighborDist === null || ord.lessThan(alt, neighborDist)) {
        dist.set(neighbor, alt);
        prev.set(neighbor, minNode);
      }
    }
  }

  const totalWeight = dist.get(to);
  if (totalWeight === null || totalWeight === undefined) return null;

  const path = reconstructPathG(prev, from, to, eq);
  return { path, weight: totalWeight };
}

function edgesFrom<G, N, E>(g: G, node: N, GL: GraphLike<G, N, E>, eq: Eq<N>): E[] {
  const result: E[] = [];
  for (const e of GL.edges(g)) {
    if (eq.equals(GL.edgeSource(e), node)) result.push(e);
    if (!GL.isDirected(g) && eq.equals(GL.edgeTarget(e), node)) result.push(e);
  }
  return result;
}

// ============================================================================
// Strongly Connected Components (Tarjan's)
// ============================================================================

/** Generic Tarjan's algorithm. */
export function sccG<G, N, E>(g: G, GL: GraphLike<G, N, E>, eq: Eq<N>, hash: Hash<N>): N[][] {
  let index = 0;
  const nodeIndex = new HashMap<N, number>(eq, hash);
  const lowlink = new HashMap<N, number>(eq, hash);
  const onStack = new HashSet<N>(eq, hash);
  const stack: N[] = [];
  const sccs: N[][] = [];

  function strongconnect(v: N): void {
    nodeIndex.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of GL.successors(g, v)) {
      if (!nodeIndex.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, nodeIndex.get(w)!));
      }
    }

    if (lowlink.get(v) === nodeIndex.get(v)) {
      const scc: N[] = [];
      let w: N;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (!eq.equals(w, v));
      sccs.push(scc);
    }
  }

  for (const n of GL.nodes(g)) {
    if (!nodeIndex.has(n)) {
      strongconnect(n);
    }
  }

  return sccs;
}
