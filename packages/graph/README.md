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

Define, verify, and run state machines:

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

const result = verify(order);
// {
//   valid: false,
//   unreachableStates: [],
//   deadEndStates: ["Rejected"],  // not declared terminal
//   nondeterministic: [],
//   cycles: []
// }

const inst = order.create();
const shipped = inst.transition("submit").transition("approve").transition("ship");
shipped.current; // "Shipped"
shipped.availableEvents(); // ["deliver"]
```

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
| Strongly connected components | `stronglyConnectedComponents(g)`          | O(V + E)        |
| DAG check                     | `isDAG(g)`                                | O(V + E)        |
| Transitive closure            | `transitiveClosure(g)`                    | O(V \* (V + E)) |
| Reverse graph                 | `reverseGraph(g)`                         | O(V + E)        |

## State Machine Verification

`verify(sm)` checks for common structural issues:

- **Unreachable states** — states not reachable from the initial state
- **Dead-end states** — states with no outgoing transitions that aren't declared terminal
- **Nondeterminism** — same state + same event leading to different targets
- **Cycles** — cyclic paths through the state graph

## State Machine DSL

```
@initial StateName
@terminal State1, State2
FromState --event--> ToState
```

Lines starting with `#` are comments. Blank lines are ignored.

## Future

- **Compile-time verification** — run `verify()` via `comptime()` during compilation
- **Effect layer integration** — state machine as an Effect service layer
- **Visualization** — DOT/Mermaid output for graph rendering
