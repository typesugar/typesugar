//! Directed Graphs
//! Build graphs, find paths, detect cycles, topological sort

import { createDigraph, topoSort, hasCycles, shortestPath, reachable, bfs } from "@typesugar/graph";

// Monorepo dependency graph
const deps = createDigraph(
  ["app", "ui", "api", "core", "utils", "types"],
  [
    ["app",  "ui",    "uses"],
    ["app",  "api",   "uses"],
    ["ui",   "core",  "uses"],
    ["api",  "core",  "uses"],
    ["core", "utils", "uses"],
    ["core", "types", "uses"],
    ["utils", "types", "uses"],
  ]
);

// Topological sort → safe build order
const buildOrder = topoSort(deps);
console.log("Build order:", buildOrder);

// Cycle detection
console.log("Has cycles?", hasCycles(deps));

// What does 'app' depend on (transitively)?
const allDeps = reachable(deps, "app");
console.log("\n'app' depends on:", allDeps);

// Shortest path from app to types
const path = shortestPath(deps, "app", "types");
console.log("Shortest path app→types:", path);

// BFS traversal from core
const visited: string[] = [];
bfs(deps, "core", (node) => { visited.push(node); });
console.log("\nBFS from 'core':", visited);
