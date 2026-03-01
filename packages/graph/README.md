# @typesugar/graph

Compile-time graph algorithms and state machine verification for TypeScript, inspired by Boost.Graph.

Define graphs and state machines via a concise DSL or programmatic API, then run classic algorithms (topological sort, shortest path, SCC, cycle detection) and verify state machine properties (reachability, dead ends, nondeterminism) — all with immutable data structures.

## Quick Start

```typescript
import { digraph, topoSort, shortestPath } from "@typesugar/graph";

const g = digraph`
  task-a -> task-b, task-c
  task-b -> task-d
  task-c -> task-d
`;

const sorted = topoSort(g);
// { ok: true, order: ["task-a", "task-b", "task-c", "task-d"] }

const path = shortestPath(g, "task-a", "task-d");
// ["task-a", "task-b", "task-d"]
```

## State Machines

Define, verify, and run state machines with **compile-time verification**:

```typescript
import { stateMachine, verify, createInstance } from "@typesugar/graph";

const order = stateMachine`
  @initial Created
  @terminal Delivered, Cancelled
  Created --submit--> Pending
  Pending --approve--> Approved
  Pending --reject--> Rejected
  Pending --cancel--> Cancelled
  Approved --ship--> Shipped
  Shipped --deliver--> Delivered
`;

// ⚠️ With typesugar transformer, this emits a compile-time error:
// "Dead-end states detected: Rejected. These states have no outgoing
//  transitions and are not marked as terminal."

const inst = order.create();
const shipped = inst.transition("submit").transition("approve").transition("ship");
shipped.current; // "Shipped"
shipped.availableEvents(); // ["deliver"]
```

### Compile-Time Verification

When used with the typesugar transformer, `stateMachine` validates your state machine at compile time:

```typescript
// ❌ Compile error: Unreachable states detected: Orphan
const bad = stateMachine`
  @initial A
  A --go--> B
  Orphan --never--> Used
`;

// ❌ Compile error: Dead-end states detected: C
const deadEnd = stateMachine`
  @initial A
  @terminal B
  A --go--> B, C
`;

// ❌ Compile error: Nondeterministic transitions detected:
//    State "A" on event "go" → [B, C]
const nondet = stateMachine`
  @initial A
  A --go--> B
  A --go--> C
`;
```

Runtime verification is still available via `verify()` for dynamic state machines.

## Graph Construction

### DSL

```typescript
import { digraph, graph } from "@typesugar/graph";

// Directed graph
const dg = digraph`
  a -> b, c
  b -> d [weight]
`;

// Undirected graph
const ug = graph`
  a -> b
  b -> c
`;
```

### Programmatic API

```typescript
import { createDigraph, createGraph, addNode, addEdge } from "@typesugar/graph";

const g = createDigraph(
  ["a", "b", "c"],
  [
    ["a", "b"],
    ["b", "c"],
  ]
);

// Immutable — returns new graphs
const g2 = addNode(g, "d");
const g3 = addEdge(g2, "c", "d", "next", 5);
```

## Algorithms

| Algorithm                     | Function                                  | Complexity      |
| ----------------------------- | ----------------------------------------- | --------------- |
| Topological sort              | `topoSort(g)`                             | O(V + E)        |
| Cycle detection               | `detectCycles(g)`, `hasCycles(g)`         | O(V + E)        |
| BFS / DFS                     | `bfs(g, start)`, `dfs(g, start)`          | O(V + E)        |
| Reachability                  | `reachable(g, start)`, `hasPath(g, a, b)` | O(V + E)        |
| Shortest path (unweighted)    | `shortestPath(g, a, b)`                   | O(V + E)        |
| Shortest path (weighted)      | `dijkstra(g, a, b)`                       | O(V^2)          |
| Shortest path (custom weight) | `dijkstraWith(g, a, b, config)`           | O(V^2)          |
| Strongly connected components | `stronglyConnectedComponents(g)`          | O(V + E)        |
| DAG check                     | `isDAG(g)`                                | O(V + E)        |
| Transitive closure            | `transitiveClosure(g)`                    | O(V \* (V + E)) |
| Reverse graph                 | `reverseGraph(g)`                         | O(V + E)        |

All of these delegate to generic `*G` variants internally. For custom graph types, use the `*G` functions with a `GraphLike` instance — see [GraphLike Typeclass](#graphlike-typeclass) below.

### Custom Weight Types with Monoid

`dijkstraWith` accepts any weight type with a `Monoid<W>` (for combining costs) and `Ord<W>` (for comparing them):

```typescript
import { dijkstraWith } from "@typesugar/graph";
import type { Monoid, Ord } from "@typesugar/std";

// Duration-based routing
interface Duration {
  totalMs: number;
}

const durationMonoid: Monoid<Duration> = {
  combine: (a, b) => ({ totalMs: a.totalMs + b.totalMs }),
  empty: () => ({ totalMs: 0 }),
};

const durationOrd: Ord<Duration> = {
  equals: (a, b) => a.totalMs === b.totalMs,
  compare: (a, b) => a.totalMs - b.totalMs,
  lessThan: (a, b) => a.totalMs < b.totalMs,
  lessThanOrEqual: (a, b) => a.totalMs <= b.totalMs,
  greaterThan: (a, b) => a.totalMs > b.totalMs,
  greaterThanOrEqual: (a, b) => a.totalMs >= b.totalMs,
};

const result = dijkstraWith(networkGraph, "server-a", "server-b", {
  monoid: durationMonoid,
  ord: durationOrd,
  getWeight: (e) => ({ totalMs: parseInt(e.label ?? "0") }),
});
// result.weight is Duration, not number
```

This enables:

- **Multi-criteria optimization** — costs as tuples with lexicographic comparison
- **Probability paths** — combine via multiplication, find max via reversed Ord
- **Symbolic weights** — exact arithmetic without floating-point errors

## State Machine Verification

`verify(sm)` checks for common structural issues:

- **Unreachable states** — states not reachable from the initial state
- **Dead-end states** — states with no outgoing transitions that aren't declared terminal
- **Nondeterminism** — same state + same event leading to different targets
- **Cycles** — cyclic paths through the state graph

## State Machine DSL

```text
@initial StateName
@terminal State1, State2
FromState --event--> ToState
```

Lines starting with `#` are comments. Blank lines are ignored.

## GraphLike Typeclass

Graph algorithms are parameterized over `GraphLike<G, N, E>` — an abstraction that lets you run the same algorithms on any graph-like structure, not just the built-in `Graph` type.

```typescript
interface GraphLike<G, N, E> {
  nodes(g: G): Iterable<N>;
  edges(g: G): Iterable<E>;
  successors(g: G, node: N): Iterable<N>;
  edgeSource(e: E): N;
  edgeTarget(e: E): N;
  isDirected(g: G): boolean;
}

interface WeightedGraphLike<G, N, E, W> extends GraphLike<G, N, E> {
  edgeWeight(e: E): W;
}
```

`G` is your graph type, `N` is the node type, `E` is the edge type. Implement these six methods and you get all the algorithms.

### Node Identity via Eq + Hash

Node identity is **not** baked into the typeclass. Instead, algorithms take `Eq<N>` and `Hash<N>` as parameters — Haskell/Scala-style. That means `N` can be `number`, `string`, or any custom struct, as long as you provide equality and hashing. The algorithms use `HashSet`/`HashMap` from `@typesugar/collections` for visited tracking and path reconstruction.

### Generic Algorithms

| Algorithm       | Generic Function                                         | Returns                               |
| --------------- | -------------------------------------------------------- | ------------------------------------- |
| Topo sort       | `topoSortG(g, GL, eq, hash)`                             | `{ok, order}` \| `{ok: false, cycle}` |
| Cycle detection | `hasCyclesG(g, GL, eq, hash)`                            | `boolean`                             |
| BFS             | `bfsG(g, start, GL, eq, hash)`                           | `N[]`                                 |
| DFS             | `dfsG(g, start, GL, eq, hash)`                           | `N[]`                                 |
| Reachability    | `reachableG(g, start, GL, eq, hash)`                     | `HashSet<N>`                          |
| Has path        | `hasPathG(g, from, to, GL, eq, hash)`                    | `boolean`                             |
| Shortest path   | `shortestPathG(g, from, to, GL, eq, hash)`               | `N[] \| null`                         |
| Dijkstra        | `dijkstraWithG(g, from, to, WGL, eq, hash, monoid, ord)` | `{path, weight} \| null`              |
| SCC             | `sccG(g, GL, eq, hash)`                                  | `N[][]`                               |

### Custom Graph Example

Here's an adjacency-list graph with numeric nodes — completely different from the built-in `Graph`:

```typescript
import { topoSortG, bfsG, shortestPathG, type GraphLike } from "@typesugar/graph";
import { eqNumber, hashNumber } from "@typesugar/std";

interface AdjGraph {
  adj: Map<number, number[]>;
}

const adjGraphLike: GraphLike<AdjGraph, number, { src: number; dst: number }> = {
  nodes(g) {
    return g.adj.keys();
  },
  edges(g) {
    const result: { src: number; dst: number }[] = [];
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

const g: AdjGraph = {
  adj: new Map([
    [1, [2, 3]],
    [2, [4]],
    [3, [4]],
    [4, []],
  ]),
};

const sorted = topoSortG(g, adjGraphLike, eqNumber, hashNumber);
// { ok: true, order: [1, 2, 3, 4] or similar valid topo order }

const path = shortestPathG(g, 1, 4, adjGraphLike, eqNumber, hashNumber);
// [1, 2, 4] or [1, 3, 4]
```

### Concrete Instances

For the built-in `Graph` type:

- `graphLike: GraphLike<Graph, string, GraphEdge>` — nodes are string IDs
- `weightedGraphLike: WeightedGraphLike<Graph, string, GraphEdge, number>` — adds `edgeWeight(e)` (defaults to 1 when missing)

### Backward Compatibility

`topoSort`, `bfs`, `dijkstra`, `shortestPath`, and the rest are unchanged. They delegate to the `*G` variants internally and keep the same API. Use the `*G` functions when you have a custom graph type.

## Zero-Cost Guarantee

When using the typesugar transformer:

- **Compile-time parsing** — the DSL is parsed at compile time, not runtime
- **Compile-time verification** — structural issues are caught before your code runs
- **Inlined definitions** — the generated code contains literal state/transition arrays
- **Type-safe instances** — state and event types are inferred from the definition

## API Quick Reference

**GraphLike typeclass:**

- `GraphLike`, `WeightedGraphLike` — type interfaces
- `graphLike` — `GraphLike<Graph, string, GraphEdge>`
- `weightedGraphLike` — `WeightedGraphLike<Graph, string, GraphEdge, number>`

**Generic algorithms:** `topoSortG`, `hasCyclesG`, `bfsG`, `dfsG`, `reachableG`, `hasPathG`, `shortestPathG`, `dijkstraWithG`, `sccG`

## Future

- **Effect layer integration** — state machine as an Effect service layer
- **Visualization** — DOT/Mermaid output for graph rendering
