# @typesugar/graph

> 📖 **Full documentation:** [Graph Algorithms guide](https://typesugar.org/guides/graph). The microsite is the canonical reference; this README is a quickstart.

Compile-time graph algorithms and state machine verification for TypeScript, inspired by Boost.Graph.

## Installation

```bash
npm install @typesugar/graph
```

## Quick Start

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

## Documentation

- [Graph Algorithms guide](https://typesugar.org/guides/graph) — full reference
- [State machine verification](https://typesugar.org/guides/graph#state-machines)
- [GraphLike typeclass & custom graphs](https://typesugar.org/guides/graph#graphlike-typeclass)
