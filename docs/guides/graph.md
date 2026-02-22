# Graph Algorithms

Immutable graph data structures with classic algorithms and state machine verification — define graphs with a concise DSL or build them programmatically.

## Quick Start

```bash
npm install @typesugar/graph
```

```typescript
import { digraph, topoSort, shortestPath } from "@typesugar/graph";

const g = digraph`
  task-a -> task-b, task-c
  task-b -> task-d
  task-c -> task-d
`;

topoSort(g);
// { ok: true, order: ["task-a", "task-b", "task-c", "task-d"] }

shortestPath(g, "task-a", "task-d");
// ["task-a", "task-b", "task-d"]
```

## Graph Construction

### DSL

The `digraph` and `graph` tagged templates parse a simple edge-list syntax:

```typescript
import { digraph, graph } from "@typesugar/graph";

// Directed graph — edges have direction
const dg = digraph`
  a -> b, c
  b -> d
`;

// Undirected graph — edges go both ways
const ug = graph`
  a -> b
  b -> c
`;
```

Each line defines edges from a source node to one or more targets. The DSL auto-creates nodes on first reference.

### Programmatic API

For dynamic graph construction:

```typescript
import { createDigraph, addNode, addEdge } from "@typesugar/graph";

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

Query the structure with `neighbors()`, `inEdges()`, `outEdges()`, `degree()`, `adjacencyList()`.

## Algorithms

| Algorithm                     | Function                                  | Complexity      |
| ----------------------------- | ----------------------------------------- | --------------- |
| Topological sort              | `topoSort(g)`                             | O(V + E)        |
| Cycle detection               | `detectCycles(g)`, `hasCycles(g)`         | O(V + E)        |
| BFS / DFS                     | `bfs(g, start)`, `dfs(g, start)`          | O(V + E)        |
| Reachability                  | `reachable(g, start)`, `hasPath(g, a, b)` | O(V + E)        |
| Shortest path (unweighted)    | `shortestPath(g, a, b)`                   | O(V + E)        |
| Shortest path (weighted)      | `dijkstra(g, a, b)`                       | O(V^2)          |
| Strongly connected components | `stronglyConnectedComponents(g)`          | O(V + E)        |
| DAG check                     | `isDAG(g)`                                | O(V + E)        |
| Transitive closure            | `transitiveClosure(g)`                    | O(V \* (V + E)) |
| Reverse graph                 | `reverseGraph(g)`                         | O(V + E)        |

```typescript
import {
  digraph,
  bfs,
  dfs,
  reachable,
  hasPath,
  stronglyConnectedComponents,
} from "@typesugar/graph";

const g = digraph`
  a -> b, c
  b -> d
  c -> d
  d -> e
`;

bfs(g, "a"); // ["a", "b", "c", "d", "e"]
dfs(g, "a"); // ["a", "b", "d", "e", "c"]
reachable(g, "b"); // Set { "b", "d", "e" }
hasPath(g, "a", "e"); // true
```

## State Machines

Define state machines with a dedicated DSL, then verify properties and run instances:

```typescript
import { stateMachine, verify } from "@typesugar/graph";

const order = stateMachine`
  @initial Created
  @terminal Delivered, Cancelled

  Created  --submit-->  Pending
  Pending  --approve--> Approved
  Pending  --reject-->  Rejected
  Pending  --cancel-->  Cancelled
  Approved --ship-->    Shipped
  Shipped  --deliver--> Delivered
`;
```

### Verification

`verify()` catches structural problems at definition time:

```typescript
const result = verify(order);
// {
//   valid: false,
//   unreachableStates: [],
//   deadEndStates: ["Rejected"],   // not terminal, no way out
//   nondeterministic: [],
//   cycles: []
// }
```

It checks for:

- **Unreachable states** — can't be reached from the initial state
- **Dead-end states** — no outgoing transitions and not declared terminal
- **Nondeterminism** — same state + same event leading to different targets
- **Cycles** — cyclic paths through the state graph

### Running Instances

```typescript
const inst = order.create();

const shipped = inst.transition("submit").transition("approve").transition("ship");

shipped.current; // "Shipped"
shipped.availableEvents(); // ["deliver"]

// Invalid transitions throw
shipped.transition("cancel"); // Error: no "cancel" transition from "Shipped"
```

## Real-World Example: Dependency Resolution

```typescript
import { digraph, topoSort, detectCycles } from "@typesugar/graph";

const deps = digraph`
  app      -> api, ui
  api      -> db, auth
  ui       -> components, styles
  auth     -> db
`;

const cycles = detectCycles(deps);
if (cycles.length > 0) {
  throw new Error(`Circular dependencies: ${cycles}`);
}

const buildOrder = topoSort(deps);
// { ok: true, order: ["db", "auth", "styles", "components", "api", "ui", "app"] }

// Build packages in order
for (const pkg of buildOrder.order) {
  console.log(`Building ${pkg}...`);
}
```

This pattern works for build systems, task scheduling, course prerequisites — anything with dependency ordering.

## What's Next

- [API Reference](/reference/packages#graph)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/graph)
