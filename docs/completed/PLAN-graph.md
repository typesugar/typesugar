# Plan: Compile-Time Graph Algorithms & State Machine Verification

## Status: PHASE 1 IMPLEMENTED

Phase 1 (graph construction, algorithms, state machine verification, DSL, tagged templates) is implemented in `packages/graph/`. Phase 2 (compile-time algorithm execution via `comptime()`) is future work.

## Inspiration

Boost.Graph provides a generic graph library where algorithms (BFS, DFS, Dijkstra, topological sort) work over any graph representation via concepts. The key insight: most interesting graph problems in application code are **statically known** — state machines, dependency graphs, module graphs, workflow DAGs.

typesugar already has phantom state machines (`packages/type-system/src/phantom.ts`). This plan adds **compile-time verification** on top: reachability analysis, deadlock detection, and graph algorithms that run during compilation.

## Design

### Graph Definition DSL

```typescript
import { graph, digraph, stateMachine } from "@typesugar/graph";

// Directed graph from a tagged template
const deps = digraph`
  app -> auth, database, cache
  auth -> database, crypto
  database -> pool
  cache -> pool
`;

// Compile-time: topological sort, cycle detection
const buildOrder = deps.topoSort(); // ["pool", "crypto", "database", "cache", "auth", "app"]

// Compile error if cyclic:
const bad = digraph`
  a -> b
  b -> c
  c -> a
`;
// Error: Cycle detected: a → b → c → a
```

### State Machine Verification

Builds on existing `createStateMachine()` from `phantom.ts`:

```typescript
const orderFSM = stateMachine`
  Created   --submit-->   Pending
  Pending   --approve-->  Approved
  Pending   --reject-->   Rejected
  Approved  --ship-->     Shipped
  Shipped   --deliver-->  Delivered
  Rejected  --resubmit--> Pending
`;

// Compile-time verifications (all zero-cost, removed from output):
// ✓ All states reachable from initial state (Created)
// ✓ No dead-end states (Delivered/Rejected are marked terminal)
// ✓ No orphan transitions
// ✓ Deterministic (no state has two transitions with same event)

// Runtime: type-safe transition function
const order = orderFSM.create("Created");
const pending = orderFSM.transition(order, "submit"); // Pending
const bad = orderFSM.transition(order, "ship"); // Compile error: no "ship" from Created
```

### Verification Attributes

```typescript
@stateMachine({
  initial: "Created",
  terminal: ["Delivered", "Rejected"],
  verify: ["reachable", "no-deadlocks", "deterministic"],
})
type OrderState = "Created" | "Pending" | "Approved" | "Rejected" | "Shipped" | "Delivered";
```

### Graph Algorithms (Compile-Time)

All algorithms run at compile time via `comptime()` integration and produce literal results:

| Algorithm                     | Use Case                           | Output                        |
| ----------------------------- | ---------------------------------- | ----------------------------- |
| Topological sort              | Build order, dependency resolution | Ordered array literal         |
| Cycle detection               | Circular dependency errors         | Compile error with cycle path |
| Reachability                  | State machine verification         | Boolean / unreachable set     |
| Shortest path                 | Optimal transition sequences       | Path literal                  |
| Strongly connected components | Module clustering                  | Array of component arrays     |
| Dominator tree                | Control flow analysis              | Tree structure                |

### Layer Composition Verification (Effect Integration)

For `@typesugar/effect`, verify that service layers form a valid DAG:

```typescript
import { verifyLayers } from "@typesugar/graph";

@service class Database { ... }
@service class Auth { constructor(private db: Database) {} }
@service class Cache { constructor(private db: Database) {} }
@service class App { constructor(private auth: Auth, private cache: Cache) {} }

// Compile-time: extracts dependency graph from constructor parameters
// Verifies: no cycles, all dependencies satisfied, optimal initialization order
const layer = verifyLayers(App);
// Compiles to: sequential initialization in topological order
```

## Implementation

### Phase 1: Graph IR + Tagged Template Macro

**Package:** `@typesugar/graph`

**Core types:**

```typescript
interface GraphNode {
  id: string;
  metadata?: Record<string, unknown>;
}
interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  weight?: number;
}
interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  directed: boolean;
}
```

**Macro:** `digraph` / `graph` / `stateMachine` tagged template macros that parse at compile time and produce a `Graph` IR.

### Phase 2: Compile-Time Algorithms

Implement algorithms as pure functions that operate on the Graph IR:

```typescript
function topoSort(g: Graph): string[] | { cycle: string[] };
function reachable(g: Graph, from: string): Set<string>;
function shortestPath(g: Graph, from: string, to: string): string[];
function stronglyConnected(g: Graph): string[][];
function isDeterministic(g: Graph): boolean | { state: string; event: string };
```

These run inside `comptime()` — results are inlined as literals.

### Phase 3: Phantom State Machine Integration

Extend `createStateMachine()` in `phantom.ts` to accept verification options:

- Reuse Graph IR for the transition table
- Run verification algorithms at compile time
- Generate type-safe transition function with the existing phantom type encoding
- Strip verification code from output

### Phase 4: Effect Layer Verification

- Extract dependency graph from `@service` constructor parameters
- Build Graph IR at compile time
- Run cycle detection + topological sort
- Generate optimal initialization sequence

## Zero-Cost Verification

The graph and all algorithms exist only at compile time. Output contains:

- **State machines:** A plain object mapping `[state, event] → nextState` (or inlined switch)
- **Topological sorts:** A literal array
- **Verification:** Nothing — just compile errors if violated

## Inspirations

- **Boost.Graph** — generic graph algorithms over concepts
- **Petri nets** — formal verification of concurrent systems
- **TLA+** — state machine model checking (we're doing a lightweight version)
- **Scala Akka FSM** — typed state machines (but runtime; ours is compile-time)

## Dependencies

- `@typesugar/core` — tagged template macro, `comptime()`
- `@typesugar/type-system` — `phantom.ts` state machines
- `@typesugar/effect` — layer composition (Phase 4)

## Open Questions

1. Should weighted graph algorithms (Dijkstra, A\*) be included? They're less useful at compile time but could power routing/optimization DSLs.
2. How much of the Graph IR should survive to runtime for dynamic graphs? Or should dynamic graphs use a separate runtime library?
3. Should the `stateMachine` DSL support guards/conditions on transitions (like XState)?
