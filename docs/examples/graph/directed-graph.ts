//! Directed Graphs
//! Tagged template DSL with shortest-path algorithms

import { digraph, shortestPath, topoSort, hasCycles, dijkstra } from "@typesugar/graph";
import { comptime } from "typesugar";

// digraph`...` parses the adjacency DSL into a typed Graph at runtime
// 👀 Check JS Output: comptime() becomes an inlined literal
const buildTime = comptime(() => new Date().toISOString().slice(0, 10));

const deps = digraph`
  app -> ui, api
  ui -> core
  api -> core
  core -> utils, types
  utils -> types
`;

// Topological sort — safe build order for a monorepo
const buildOrder = topoSort(deps);
console.log("Build order:", buildOrder);
console.log("Has cycles?", hasCycles(deps));

// Shortest path (unweighted BFS)
const path = shortestPath(deps, "app", "types");
console.log("app → types:", path);

// Dijkstra with weighted edges (default weight = 1)
const network = digraph`
  A -> B, C
  B -> D
  C -> D
  D -> E
`;
const result = dijkstra(network, "A", "E");
console.log("\nDijkstra A→E:", result);
console.log("Built:", buildTime);

// Try: add a cycle (types -> app) and watch hasCycles() change
