export type {
  Graph,
  GraphNode,
  GraphEdge,
  Transition,
  StateMachineDefinition,
  StateMachineInstance,
  VerificationResult,
} from "./types.js";

export {
  createDigraph,
  createGraph,
  neighbors,
  inEdges,
  outEdges,
  degree,
  inDegree,
  outDegree,
  adjacencyList,
  addNode,
  addEdge,
  removeNode,
  removeEdge,
} from "./graph.js";

// Typeclass
export type { GraphLike, WeightedGraphLike } from "./typeclass.js";
export { graphLike, weightedGraphLike } from "./typeclass.js";

// Generic algorithms (parameterized over GraphLike + Eq + Hash)
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

// Backward-compatible concrete algorithms (for Graph type)
export type { PathCostConfig } from "./algorithms.js";

export {
  topoSort,
  detectCycles,
  hasCycles,
  bfs,
  dfs,
  reachable,
  hasPath,
  shortestPath,
  dijkstra,
  dijkstraWith,
  numberMonoid,
  numberOrd,
  stronglyConnectedComponents,
  isDAG,
  transitiveClosure,
  reverseGraph,
} from "./algorithms.js";

export {
  defineStateMachine,
  verify,
  createInstance,
  toGraph,
  reachableStates,
  deadEndStates,
  isNondeterministic,
} from "./state-machine.js";

export { parseDigraph, parseStateMachine } from "./dsl.js";

// Runtime tagged-template helpers + the helper the stateMachine macro emits.
// The macro *definitions* live in the `./macros` entry (build-time only) and are
// deliberately NOT re-exported here so the `.` runtime entry stays
// typescript-free. See PEP-050.
export {
  digraph,
  graph,
  stateMachine,
  __typesugar_createStateMachineInstance,
} from "./templates.js";
