/**
 * @typesugar/graph Showcase
 *
 * Self-documenting examples of graph construction, algorithms, DSLs,
 * and state machine definition/verification.
 *
 * Type assertions used:
 *   typeAssert<Equal<A, B>>()        - A and B are the same type
 *   typeAssert<Extends<A, B>>()      - A is assignable to B
 *   typeAssert<Not<Equal<A, B>>>()   - A and B are DIFFERENT
 *   typeAssert<Not<Extends<A, B>>>() - A is NOT assignable to B
 *
 * Run:   typesugar run examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import { assert, typeAssert, type Equal, type Extends, type Not } from "@typesugar/testing";

import {
  // Graph construction
  createDigraph,
  createGraph,
  addNode,
  addEdge,
  removeNode,
  removeEdge,
  neighbors,
  inEdges,
  outEdges,
  degree,
  inDegree,
  outDegree,
  adjacencyList,

  // Algorithms
  topoSort,
  detectCycles,
  hasCycles,
  bfs,
  dfs,
  reachable,
  hasPath,
  shortestPath,
  dijkstra,
  stronglyConnectedComponents,
  isDAG,
  transitiveClosure,
  reverseGraph,

  // State machines
  defineStateMachine,
  verify,
  createInstance,
  toGraph,
  reachableStates,
  deadEndStates,
  isNondeterministic,

  // DSL
  parseDigraph,
  parseStateMachine,
  digraph,
  stateMachine,

  // Types
  type Graph,
  type StateMachineDefinition,
  type StateMachineInstance,
  type VerificationResult,
} from "../src/index.js";

// ============================================================================
// 1. DIRECTED GRAPH CONSTRUCTION - Build graphs from nodes and edge tuples
// ============================================================================

const dag = createDigraph(
  ["a", "b", "c", "d"],
  [
    ["a", "b"],
    ["a", "c"],
    ["b", "d"],
    ["c", "d"],
  ]
);

assert(dag.directed === true);
assert(dag.nodes.length === 4);
assert(dag.edges.length === 4);
typeAssert<Equal<typeof dag, Graph>>();

// Neighbors of a node (outgoing edges only in digraphs)
assert(neighbors(dag, "a").length === 2);
assert(neighbors(dag, "a").includes("b"));
assert(neighbors(dag, "a").includes("c"));

// In/out degree
assert(inDegree(dag, "d") === 2);
assert(outDegree(dag, "a") === 2);
assert(degree(dag, "a") === 2); // out only for source nodes

// Edge queries
assert(outEdges(dag, "a").length === 2);
assert(inEdges(dag, "d").length === 2);

// ============================================================================
// 2. UNDIRECTED GRAPH - Edges work in both directions
// ============================================================================

const undirected = createGraph(
  ["x", "y", "z"],
  [
    ["x", "y"],
    ["y", "z"],
  ]
);

assert(undirected.directed === false);
assert(neighbors(undirected, "y").includes("x"));
assert(neighbors(undirected, "y").includes("z"));

// ============================================================================
// 3. IMMUTABLE GRAPH MUTATION - addNode, addEdge, removeNode, removeEdge
// ============================================================================

let g = createDigraph(["a", "b"], [["a", "b"]]);

// Add a node — returns a new graph, original unchanged
const g2 = addNode(g, "c");
assert(g2.nodes.length === 3);
assert(g.nodes.length === 2);

// Add an edge — auto-creates missing endpoint nodes
const g3 = addEdge(g, "b", "c");
assert(g3.nodes.length === 3);
assert(g3.edges.length === 2);

// Remove a node — removes incident edges too
const g4 = removeNode(g3, "b");
assert(g4.nodes.length === 2);
assert(g4.edges.length === 0);

// Remove an edge
const g5 = removeEdge(g3, "a", "b");
assert(g5.edges.length === 1);

// ============================================================================
// 4. ADJACENCY LIST - Efficient traversal representation
// ============================================================================

const adj = adjacencyList(dag);
typeAssert<Equal<typeof adj, Map<string, string[]>>>();
assert(adj.get("a")!.includes("b"));
assert(adj.get("a")!.includes("c"));
assert(adj.get("d")!.length === 0);

// ============================================================================
// 5. TOPOLOGICAL SORT - Order nodes respecting edge direction
// ============================================================================

const sorted = topoSort(dag);
assert(sorted.ok === true);
if (sorted.ok) {
  assert(sorted.order.indexOf("a") < sorted.order.indexOf("b"));
  assert(sorted.order.indexOf("a") < sorted.order.indexOf("c"));
  assert(sorted.order.indexOf("b") < sorted.order.indexOf("d"));
  assert(sorted.order.indexOf("c") < sorted.order.indexOf("d"));
}

// Cyclic graphs return the cycle
const cyclic = createDigraph(["a", "b", "c"], [["a", "b"], ["b", "c"], ["c", "a"]]);
const cyclicSort = topoSort(cyclic);
assert(cyclicSort.ok === false);
if (!cyclicSort.ok) {
  assert(cyclicSort.cycle.length > 0);
}

// ============================================================================
// 6. CYCLE DETECTION - Find cycles and check DAG property
// ============================================================================

assert(isDAG(dag) === true);
assert(hasCycles(dag) === false);

assert(isDAG(cyclic) === false);
assert(hasCycles(cyclic) === true);

const allCycles = detectCycles(cyclic);
assert(allCycles.length >= 1);

// ============================================================================
// 7. BFS & DFS - Graph traversal algorithms
// ============================================================================

const bfsOrder = bfs(dag, "a");
assert(bfsOrder[0] === "a");
assert(bfsOrder.includes("b"));
assert(bfsOrder.includes("c"));
assert(bfsOrder.includes("d"));
assert(bfsOrder.length === 4);

const dfsOrder = dfs(dag, "a");
assert(dfsOrder[0] === "a");
assert(dfsOrder.includes("d"));
assert(dfsOrder.length === 4);

// ============================================================================
// 8. REACHABILITY & PATH FINDING - Check connectivity
// ============================================================================

const reachableFromA = reachable(dag, "a");
typeAssert<Equal<typeof reachableFromA, Set<string>>>();
assert(reachableFromA.has("a"));
assert(reachableFromA.has("d"));
assert(reachableFromA.size === 4);

assert(hasPath(dag, "a", "d") === true);
assert(hasPath(dag, "d", "a") === false);

const path = shortestPath(dag, "a", "d");
assert(path !== null);
assert(path![0] === "a");
assert(path![path!.length - 1] === "d");

// ============================================================================
// 9. DIJKSTRA'S ALGORITHM - Weighted shortest path
// ============================================================================

// Real-world example: road network with distances
const roadNetwork = createDigraph(
  ["Home", "Office", "Store", "Gym", "Park"],
  [
    ["Home", "Office"],
    ["Home", "Store"],
    ["Office", "Gym"],
    ["Store", "Gym"],
    ["Gym", "Park"],
    ["Store", "Park"],
  ]
);

const weighted = addEdge(
  addEdge(
    addEdge(
      addEdge(
        addEdge(
          addEdge(createDigraph([], []), "Home", "Office", undefined, 5),
          "Home", "Store", undefined, 2),
        "Office", "Gym", undefined, 3),
      "Store", "Gym", undefined, 7),
    "Gym", "Park", undefined, 1),
  "Store", "Park", undefined, 10);

const result = dijkstra(weighted, "Home", "Park");
assert(result !== null);
assert(result!.path[0] === "Home");
assert(result!.path[result!.path.length - 1] === "Park");
// Home -> Office (5) -> Gym (3) -> Park (1) = 9
assert(result!.weight === 9);

// ============================================================================
// 10. STRONGLY CONNECTED COMPONENTS - Tarjan's algorithm
// ============================================================================

// Two SCCs: {a, b, c} form a cycle, {d} is a sink
const sccGraph = createDigraph(
  ["a", "b", "c", "d"],
  [["a", "b"], ["b", "c"], ["c", "a"], ["c", "d"]]
);

const sccs = stronglyConnectedComponents(sccGraph);
assert(sccs.length === 2);
const largeScc = sccs.find(s => s.length === 3)!;
assert(largeScc.includes("a"));
assert(largeScc.includes("b"));
assert(largeScc.includes("c"));

// ============================================================================
// 11. TRANSITIVE CLOSURE & REVERSE - Graph transformations
// ============================================================================

const closure = transitiveClosure(dag);
const closureHasDirectPath = closure.edges.some(e => e.from === "a" && e.to === "d");
assert(closureHasDirectPath);

const reversed = reverseGraph(dag);
assert(reversed.edges.some(e => e.from === "b" && e.to === "a"));
assert(reversed.edges.some(e => e.from === "d" && e.to === "b"));

// ============================================================================
// 12. DSL PARSING - Build graphs from text
// ============================================================================

const parsed = parseDigraph(`
  a -> b, c
  b -> d
  c -> d
`);

assert(parsed.nodes.length === 4);
assert(parsed.edges.length === 4);
assert(parsed.directed === true);

// Labeled edges
const labeled = parseDigraph(`
  start -> mid [step1]
  mid -> end [step2]
`);
assert(labeled.edges[0].label === "step1");

// ============================================================================
// 13. TAGGED TEMPLATE LITERALS - Concise graph construction
// ============================================================================

const tplGraph = digraph`
  compile -> link
  link -> run
`;

assert(tplGraph.directed === true);
assert(tplGraph.nodes.length === 3);
assert(hasPath(tplGraph, "compile", "run"));

// ============================================================================
// 14. STATE MACHINE DEFINITION - Model workflows as transitions
// ============================================================================

// Real-world example: order processing workflow
const orderSM = defineStateMachine(
  [
    { from: "Pending", event: "pay", to: "Paid" },
    { from: "Paid", event: "ship", to: "Shipped" },
    { from: "Shipped", event: "deliver", to: "Delivered" },
    { from: "Pending", event: "cancel", to: "Cancelled" },
    { from: "Paid", event: "cancel", to: "Cancelled" },
  ],
  { initial: "Pending", terminal: ["Delivered", "Cancelled"] }
);

typeAssert<Equal<typeof orderSM, StateMachineDefinition>>();
assert(orderSM.initial === "Pending");
assert(orderSM.states.includes("Delivered"));

// ============================================================================
// 15. STATE MACHINE VERIFICATION - Detect structural issues
// ============================================================================

const verification = verify(orderSM);
typeAssert<Equal<typeof verification, VerificationResult>>();
assert(verification.valid === true);
assert(verification.unreachableStates.length === 0);
assert(verification.deadEndStates.length === 0);
assert(verification.nondeterministic.length === 0);

// Detect problems: unreachable state, dead end, nondeterminism
const brokenSM = defineStateMachine(
  [
    { from: "A", event: "go", to: "B" },
    { from: "A", event: "go", to: "C" }, // nondeterministic: same state+event -> different targets
  ],
  { initial: "A", terminal: [] }
);

const brokenResult = verify(brokenSM);
assert(brokenResult.valid === false);
assert(brokenResult.nondeterministic.length > 0);
assert(brokenResult.deadEndStates.length > 0);

// ============================================================================
// 16. STATE MACHINE INSTANCES - Immutable state tracking
// ============================================================================

const order = createInstance<string, string>(orderSM);
typeAssert<Extends<typeof order, StateMachineInstance<string, string>>>();
assert(order.current === "Pending");

// Transition produces a new instance
const paid = order.transition("pay");
assert(paid.current === "Paid");
assert(order.current === "Pending"); // original unchanged

// Check available events
assert(paid.canTransition("ship") === true);
assert(paid.canTransition("deliver") === false);
assert(paid.availableEvents().includes("ship"));
assert(paid.availableEvents().includes("cancel"));

// Chain transitions
const delivered = order.transition("pay").transition("ship").transition("deliver");
assert(delivered.current === "Delivered");

// ============================================================================
// 17. STATE MACHINE ANALYSIS - Reachability and dead ends
// ============================================================================

const reachable_ = reachableStates(orderSM);
assert(reachable_.has("Pending"));
assert(reachable_.has("Delivered"));

const deadEnds = deadEndStates(orderSM);
assert(deadEnds.length === 0); // all non-terminal states have outgoing transitions

const nondet = isNondeterministic(orderSM);
assert(nondet.length === 0);

// Convert state machine to graph for further analysis
const smGraph = toGraph(orderSM);
typeAssert<Equal<typeof smGraph, Graph>>();
assert(smGraph.directed === true);

// ============================================================================
// 18. STATE MACHINE DSL - Parse from text
// ============================================================================

const parsedSM = parseStateMachine(`
  @initial Idle
  @terminal Done
  Idle --start--> Running
  Running --pause--> Paused
  Running --finish--> Done
  Paused --resume--> Running
`);

assert(parsedSM.initial === "Idle");
assert(parsedSM.terminal!.includes("Done"));
assert(parsedSM.transitions.length === 4);

// Tagged template version with .create() helper
const sm = stateMachine`
  @initial Idle
  @terminal Done
  Idle --start--> Running
  Running --stop--> Done
`;

const instance = sm.create<string, string>();
assert(instance.current === "Idle");
const running = instance.transition("start");
assert(running.current === "Running");

console.log("@typesugar/graph showcase: all assertions passed!");
