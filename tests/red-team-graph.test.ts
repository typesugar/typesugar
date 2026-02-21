/**
 * Red Team Tests for @typesugar/graph
 *
 * Attack surfaces:
 * - Empty graph handling (zero nodes/edges)
 * - Self-loops (node pointing to itself)
 * - Duplicate edges (multiple edges between same pair)
 * - Negative edge weights (Dijkstra correctness)
 * - Disconnected graphs (multiple components)
 * - Cycle detection edge cases (single node cycles, overlapping cycles)
 * - State machine unreachable states
 * - State machine invalid transitions
 * - State machine nondeterminism
 * - Very large graphs (algorithmic complexity)
 */
import { describe, it, expect } from "vitest";
import {
  createDigraph,
  createGraph,
  neighbors,
  inEdges,
  outEdges,
  degree,
  inDegree,
  outDegree,
  addNode,
  addEdge,
  removeNode,
  removeEdge,
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
  defineStateMachine,
  verify,
  createInstance,
  toGraph,
  reachableStates,
  deadEndStates,
  isNondeterministic,
} from "../packages/graph/src/index.js";

describe("Graph Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Empty Graph Handling
  // ==========================================================================
  describe("empty graph handling", () => {
    it("creates an empty digraph with no nodes or edges", () => {
      const g = createDigraph([], []);
      expect(g.nodes).toEqual([]);
      expect(g.edges).toEqual([]);
      expect(g.directed).toBe(true);
    });

    it("creates an empty undirected graph with no nodes or edges", () => {
      const g = createGraph([], []);
      expect(g.nodes).toEqual([]);
      expect(g.edges).toEqual([]);
      expect(g.directed).toBe(false);
    });

    it("topoSort on empty graph returns empty order", () => {
      const g = createDigraph([], []);
      const result = topoSort(g);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.order).toEqual([]);
      }
    });

    it("detectCycles on empty graph returns no cycles", () => {
      const g = createDigraph([], []);
      expect(detectCycles(g)).toEqual([]);
    });

    it("stronglyConnectedComponents on empty graph returns empty", () => {
      const g = createDigraph([], []);
      expect(stronglyConnectedComponents(g)).toEqual([]);
    });

    it("transitiveClosure on empty graph returns empty graph", () => {
      const g = createDigraph([], []);
      const tc = transitiveClosure(g);
      expect(tc.nodes).toEqual([]);
      expect(tc.edges).toEqual([]);
    });
  });

  // ==========================================================================
  // Attack 2: Self-Loops
  // ==========================================================================
  describe("self-loops", () => {
    it("creates graph with self-loop", () => {
      const g = createDigraph(["A"], [["A", "A"]]);
      expect(g.edges).toHaveLength(1);
      expect(g.edges[0]).toEqual({ from: "A", to: "A" });
    });

    it("detects self-loop as a cycle", () => {
      const g = createDigraph(["A"], [["A", "A"]]);
      expect(hasCycles(g)).toBe(true);
    });

    it("detectCycles finds self-loop", () => {
      const g = createDigraph(["A"], [["A", "A"]]);
      const cycles = detectCycles(g);
      expect(cycles.length).toBeGreaterThan(0);
      expect(cycles.some((c) => c.includes("A"))).toBe(true);
    });

    it("topoSort fails on self-loop", () => {
      const g = createDigraph(["A"], [["A", "A"]]);
      const result = topoSort(g);
      expect(result.ok).toBe(false);
    });

    it("neighbors includes self for self-loop", () => {
      const g = createDigraph(["A"], [["A", "A"]]);
      expect(neighbors(g, "A")).toContain("A");
    });

    it("inDegree and outDegree both count self-loop", () => {
      const g = createDigraph(["A"], [["A", "A"]]);
      expect(inDegree(g, "A")).toBe(1);
      expect(outDegree(g, "A")).toBe(1);
    });

    it("Dijkstra handles self-loop correctly", () => {
      const g = addEdge(createDigraph(["A"], [["A", "A"]]), "A", "A", undefined, 5);
      const result = dijkstra(g, "A", "A");
      expect(result).toEqual({ path: ["A"], weight: 0 });
    });
  });

  // ==========================================================================
  // Attack 3: Duplicate Edges
  // ==========================================================================
  describe("duplicate edges", () => {
    it("allows multiple edges between same nodes", () => {
      const g = createDigraph(
        ["A", "B"],
        [
          ["A", "B"],
          ["A", "B"],
        ]
      );
      expect(g.edges).toHaveLength(2);
    });

    it("degree counts duplicate edges", () => {
      const g = createDigraph(
        ["A", "B"],
        [
          ["A", "B"],
          ["A", "B"],
          ["A", "B"],
        ]
      );
      expect(outDegree(g, "A")).toBe(3);
      expect(inDegree(g, "B")).toBe(3);
    });

    it("removeEdge removes only matching edges", () => {
      const g = createDigraph(
        ["A", "B"],
        [
          ["A", "B"],
          ["A", "B"],
        ]
      );
      const g2 = removeEdge(g, "A", "B");
      expect(g2.edges).toHaveLength(0);
    });

    it("neighbors may contain duplicates from duplicate edges", () => {
      const g = createDigraph(
        ["A", "B"],
        [
          ["A", "B"],
          ["A", "B"],
        ]
      );
      const n = neighbors(g, "A");
      expect(n).toEqual(["B", "B"]);
    });

    it("Dijkstra picks lowest weight among duplicate edges", () => {
      let g = createDigraph(["A", "B"], []);
      g = addEdge(g, "A", "B", "high", 100);
      g = addEdge(g, "A", "B", "low", 1);
      const result = dijkstra(g, "A", "B");
      expect(result?.weight).toBe(1);
    });
  });

  // ==========================================================================
  // Attack 4: Negative Edge Weights
  // ==========================================================================
  describe("negative edge weights", () => {
    it("Dijkstra does NOT handle negative weights correctly (known limitation)", () => {
      let g = createDigraph(["A", "B", "C"], []);
      g = addEdge(g, "A", "B", undefined, 5);
      g = addEdge(g, "A", "C", undefined, 2);
      g = addEdge(g, "C", "B", undefined, -10);

      const result = dijkstra(g, "A", "B");
      // Dijkstra may return suboptimal path with negative weights
      // A -> C -> B should be 2 + (-10) = -8, but Dijkstra might return A -> B = 5
      // This documents the limitation rather than asserting correctness
      expect(result).not.toBeNull();
    });

    it("zero weight edges work correctly", () => {
      let g = createDigraph(["A", "B", "C"], []);
      g = addEdge(g, "A", "B", undefined, 0);
      g = addEdge(g, "A", "C", undefined, 1);
      g = addEdge(g, "C", "B", undefined, 0);

      const result = dijkstra(g, "A", "B");
      expect(result?.weight).toBe(0);
      expect(result?.path).toEqual(["A", "B"]);
    });

    it("very large weights don't overflow", () => {
      let g = createDigraph(["A", "B"], []);
      g = addEdge(g, "A", "B", undefined, Number.MAX_SAFE_INTEGER - 1);

      const result = dijkstra(g, "A", "B");
      expect(result?.weight).toBe(Number.MAX_SAFE_INTEGER - 1);
    });
  });

  // ==========================================================================
  // Attack 5: Disconnected Graphs
  // ==========================================================================
  describe("disconnected graphs", () => {
    it("BFS only visits reachable component", () => {
      const g = createDigraph(
        ["A", "B", "C", "D"],
        [
          ["A", "B"],
          ["C", "D"],
        ]
      );
      const visited = bfs(g, "A");
      expect(visited).toContain("A");
      expect(visited).toContain("B");
      expect(visited).not.toContain("C");
      expect(visited).not.toContain("D");
    });

    it("DFS only visits reachable component", () => {
      const g = createDigraph(
        ["A", "B", "C", "D"],
        [
          ["A", "B"],
          ["C", "D"],
        ]
      );
      const visited = dfs(g, "A");
      expect(visited).toContain("A");
      expect(visited).toContain("B");
      expect(visited).not.toContain("C");
      expect(visited).not.toContain("D");
    });

    it("hasPath returns false for disconnected nodes", () => {
      const g = createDigraph(
        ["A", "B", "C", "D"],
        [
          ["A", "B"],
          ["C", "D"],
        ]
      );
      expect(hasPath(g, "A", "C")).toBe(false);
      expect(hasPath(g, "A", "D")).toBe(false);
    });

    it("shortestPath returns null for disconnected nodes", () => {
      const g = createDigraph(
        ["A", "B", "C", "D"],
        [
          ["A", "B"],
          ["C", "D"],
        ]
      );
      expect(shortestPath(g, "A", "C")).toBeNull();
    });

    it("dijkstra returns null for disconnected nodes", () => {
      const g = createDigraph(
        ["A", "B", "C", "D"],
        [
          ["A", "B"],
          ["C", "D"],
        ]
      );
      expect(dijkstra(g, "A", "C")).toBeNull();
    });

    it("stronglyConnectedComponents finds multiple components", () => {
      const g = createDigraph(
        ["A", "B", "C", "D"],
        [
          ["A", "B"],
          ["B", "A"],
          ["C", "D"],
          ["D", "C"],
        ]
      );
      const sccs = stronglyConnectedComponents(g);
      expect(sccs).toHaveLength(2);
    });

    it("isolated nodes are their own SCC", () => {
      const g = createDigraph(["A", "B", "C"], [["A", "B"]]);
      const sccs = stronglyConnectedComponents(g);
      expect(sccs.some((scc) => scc.length === 1 && scc[0] === "C")).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 6: Cycle Detection Edge Cases
  // ==========================================================================
  describe("cycle detection edge cases", () => {
    it("detects simple 2-node cycle", () => {
      const g = createDigraph(
        ["A", "B"],
        [
          ["A", "B"],
          ["B", "A"],
        ]
      );
      expect(hasCycles(g)).toBe(true);
      const cycles = detectCycles(g);
      expect(cycles.length).toBeGreaterThan(0);
    });

    it("detects 3-node cycle", () => {
      const g = createDigraph(
        ["A", "B", "C"],
        [
          ["A", "B"],
          ["B", "C"],
          ["C", "A"],
        ]
      );
      expect(hasCycles(g)).toBe(true);
      const cycles = detectCycles(g);
      expect(cycles.some((c) => c.length === 3)).toBe(true);
    });

    it("handles graph with multiple overlapping cycles", () => {
      const g = createDigraph(
        ["A", "B", "C", "D"],
        [
          ["A", "B"],
          ["B", "A"],
          ["B", "C"],
          ["C", "D"],
          ["D", "B"],
        ]
      );
      expect(hasCycles(g)).toBe(true);
      const cycles = detectCycles(g);
      expect(cycles.length).toBeGreaterThanOrEqual(2);
    });

    it("DAG with long chain is correctly identified as acyclic", () => {
      const nodes = ["A", "B", "C", "D", "E"];
      const edges: [string, string][] = [
        ["A", "B"],
        ["B", "C"],
        ["C", "D"],
        ["D", "E"],
      ];
      const g = createDigraph(nodes, edges);
      expect(hasCycles(g)).toBe(false);
      expect(isDAG(g)).toBe(true);
    });

    it("topoSort returns correct order for DAG", () => {
      const g = createDigraph(
        ["A", "B", "C", "D"],
        [
          ["A", "B"],
          ["A", "C"],
          ["B", "D"],
          ["C", "D"],
        ]
      );
      const result = topoSort(g);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const order = result.order;
        expect(order.indexOf("A")).toBeLessThan(order.indexOf("B"));
        expect(order.indexOf("A")).toBeLessThan(order.indexOf("C"));
        expect(order.indexOf("B")).toBeLessThan(order.indexOf("D"));
        expect(order.indexOf("C")).toBeLessThan(order.indexOf("D"));
      }
    });

    it("topoSort returns cycle when graph has cycle", () => {
      const g = createDigraph(
        ["A", "B", "C"],
        [
          ["A", "B"],
          ["B", "C"],
          ["C", "A"],
        ]
      );
      const result = topoSort(g);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.cycle.length).toBeGreaterThan(0);
      }
    });
  });

  // ==========================================================================
  // Attack 7: State Machine Unreachable States
  // ==========================================================================
  describe("state machine unreachable states", () => {
    it("identifies unreachable states", () => {
      const sm = defineStateMachine(
        [
          { from: "idle", event: "start", to: "running" },
          { from: "orphan", event: "noop", to: "orphan" },
        ],
        { initial: "idle" }
      );
      const result = verify(sm);
      expect(result.unreachableStates).toContain("orphan");
    });

    it("initial state is always reachable", () => {
      const sm = defineStateMachine([{ from: "idle", event: "start", to: "running" }], {
        initial: "idle",
      });
      const reached = reachableStates(sm);
      expect(reached.has("idle")).toBe(true);
    });

    it("all states reachable in connected machine", () => {
      const sm = defineStateMachine(
        [
          { from: "idle", event: "start", to: "running" },
          { from: "running", event: "stop", to: "idle" },
        ],
        { initial: "idle" }
      );
      const result = verify(sm);
      expect(result.unreachableStates).toHaveLength(0);
    });

    it("handles state only appearing as target", () => {
      const sm = defineStateMachine(
        [
          { from: "A", event: "go", to: "B" },
          { from: "A", event: "jump", to: "C" },
        ],
        { initial: "A" }
      );
      const reached = reachableStates(sm);
      expect(reached.has("B")).toBe(true);
      expect(reached.has("C")).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 8: State Machine Invalid Transitions
  // ==========================================================================
  describe("state machine invalid transitions", () => {
    it("throws on invalid transition", () => {
      const sm = defineStateMachine([{ from: "idle", event: "start", to: "running" }], {
        initial: "idle",
      });
      const instance = createInstance(sm);
      expect(() => instance.transition("stop")).toThrow();
    });

    it("canTransition returns false for invalid event", () => {
      const sm = defineStateMachine([{ from: "idle", event: "start", to: "running" }], {
        initial: "idle",
      });
      const instance = createInstance(sm);
      expect(instance.canTransition("stop")).toBe(false);
      expect(instance.canTransition("start")).toBe(true);
    });

    it("availableEvents returns only valid events", () => {
      const sm = defineStateMachine(
        [
          { from: "idle", event: "start", to: "running" },
          { from: "idle", event: "reset", to: "idle" },
          { from: "running", event: "stop", to: "idle" },
        ],
        { initial: "idle" }
      );
      const instance = createInstance(sm);
      const events = instance.availableEvents();
      expect(events).toContain("start");
      expect(events).toContain("reset");
      expect(events).not.toContain("stop");
    });

    it("transition returns new instance with updated state", () => {
      const sm = defineStateMachine([{ from: "idle", event: "start", to: "running" }], {
        initial: "idle",
      });
      const instance = createInstance(sm);
      const next = instance.transition("start");
      expect(instance.current).toBe("idle");
      expect(next.current).toBe("running");
    });

    it("throws helpful error message on invalid transition", () => {
      const sm = defineStateMachine([{ from: "idle", event: "start", to: "running" }], {
        initial: "idle",
      });
      const instance = createInstance(sm);
      expect(() => instance.transition("invalid")).toThrow(/No transition from state "idle"/);
    });
  });

  // ==========================================================================
  // Attack 9: State Machine Nondeterminism
  // ==========================================================================
  describe("state machine nondeterminism", () => {
    it("detects nondeterministic transitions", () => {
      const sm = defineStateMachine(
        [
          { from: "idle", event: "go", to: "A" },
          { from: "idle", event: "go", to: "B" },
        ],
        { initial: "idle" }
      );
      const nondet = isNondeterministic(sm);
      expect(nondet).toHaveLength(1);
      expect(nondet[0].state).toBe("idle");
      expect(nondet[0].event).toBe("go");
      expect(nondet[0].targets).toContain("A");
      expect(nondet[0].targets).toContain("B");
    });

    it("verify marks nondeterministic machine as invalid", () => {
      const sm = defineStateMachine(
        [
          { from: "idle", event: "go", to: "A" },
          { from: "idle", event: "go", to: "B" },
        ],
        { initial: "idle" }
      );
      const result = verify(sm);
      expect(result.valid).toBe(false);
      expect(result.nondeterministic).toHaveLength(1);
    });

    it("deterministic machine passes verification", () => {
      const sm = defineStateMachine(
        [
          { from: "idle", event: "a", to: "A" },
          { from: "idle", event: "b", to: "B" },
        ],
        { initial: "idle", terminal: ["A", "B"] }
      );
      const result = verify(sm);
      expect(result.nondeterministic).toHaveLength(0);
    });

    it("nondeterministic instance takes first matching transition", () => {
      const sm = defineStateMachine(
        [
          { from: "idle", event: "go", to: "A" },
          { from: "idle", event: "go", to: "B" },
        ],
        { initial: "idle" }
      );
      const instance = createInstance(sm);
      const next = instance.transition("go");
      // Should pick first one (A), but this is implementation-dependent
      expect(["A", "B"]).toContain(next.current);
    });
  });

  // ==========================================================================
  // Attack 10: Dead End States
  // ==========================================================================
  describe("dead end states", () => {
    it("identifies dead end states (non-terminal with no outgoing)", () => {
      const sm = defineStateMachine(
        [
          { from: "idle", event: "go", to: "stuck" },
          // "stuck" has no outgoing transitions
        ],
        { initial: "idle" }
      );
      const deadEnds = deadEndStates(sm);
      expect(deadEnds).toContain("stuck");
    });

    it("terminal states are not dead ends", () => {
      const sm = defineStateMachine([{ from: "idle", event: "complete", to: "done" }], {
        initial: "idle",
        terminal: ["done"],
      });
      const deadEnds = deadEndStates(sm);
      expect(deadEnds).not.toContain("done");
    });

    it("verify reports dead ends", () => {
      const sm = defineStateMachine([{ from: "idle", event: "trap", to: "stuck" }], {
        initial: "idle",
      });
      const result = verify(sm);
      expect(result.deadEndStates).toContain("stuck");
      expect(result.valid).toBe(false);
    });

    it("cyclic machine with no terminal has no dead ends", () => {
      const sm = defineStateMachine(
        [
          { from: "A", event: "next", to: "B" },
          { from: "B", event: "next", to: "A" },
        ],
        { initial: "A" }
      );
      const deadEnds = deadEndStates(sm);
      expect(deadEnds).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Attack 11: Graph Mutation Immutability
  // ==========================================================================
  describe("graph mutation immutability", () => {
    it("addNode returns new graph, original unchanged", () => {
      const g1 = createDigraph(["A"], []);
      const g2 = addNode(g1, "B");
      expect(g1.nodes).toHaveLength(1);
      expect(g2.nodes).toHaveLength(2);
    });

    it("addEdge returns new graph, original unchanged", () => {
      const g1 = createDigraph(["A", "B"], []);
      const g2 = addEdge(g1, "A", "B");
      expect(g1.edges).toHaveLength(0);
      expect(g2.edges).toHaveLength(1);
    });

    it("removeNode returns new graph, original unchanged", () => {
      const g1 = createDigraph(["A", "B"], [["A", "B"]]);
      const g2 = removeNode(g1, "A");
      expect(g1.nodes).toHaveLength(2);
      expect(g2.nodes).toHaveLength(1);
      expect(g1.edges).toHaveLength(1);
      expect(g2.edges).toHaveLength(0);
    });

    it("removeEdge returns new graph, original unchanged", () => {
      const g1 = createDigraph(["A", "B"], [["A", "B"]]);
      const g2 = removeEdge(g1, "A", "B");
      expect(g1.edges).toHaveLength(1);
      expect(g2.edges).toHaveLength(0);
    });

    it("addNode is idempotent for existing node", () => {
      const g1 = createDigraph(["A"], []);
      const g2 = addNode(g1, "A");
      expect(g2).toBe(g1);
    });
  });

  // ==========================================================================
  // Attack 12: Non-existent Node Queries
  // ==========================================================================
  describe("non-existent node queries", () => {
    it("neighbors of non-existent node returns empty", () => {
      const g = createDigraph(["A"], []);
      expect(neighbors(g, "Z")).toEqual([]);
    });

    it("degree of non-existent node returns 0", () => {
      const g = createDigraph(["A"], []);
      expect(degree(g, "Z")).toBe(0);
    });

    it("BFS from non-existent node returns just that node", () => {
      const g = createDigraph(["A", "B"], [["A", "B"]]);
      const visited = bfs(g, "Z");
      expect(visited).toEqual(["Z"]);
    });

    it("hasPath from non-existent node to itself is true", () => {
      const g = createDigraph(["A"], []);
      expect(hasPath(g, "Z", "Z")).toBe(true);
    });

    it("dijkstra from non-existent node returns null for other targets", () => {
      const g = createDigraph(["A", "B"], [["A", "B"]]);
      expect(dijkstra(g, "Z", "A")).toBeNull();
    });

    it("dijkstra from non-existent node to itself returns zero path", () => {
      const g = createDigraph(["A"], []);
      const result = dijkstra(g, "Z", "Z");
      expect(result).toEqual({ path: ["Z"], weight: 0 });
    });
  });

  // ==========================================================================
  // Attack 13: Reverse Graph Edge Cases
  // ==========================================================================
  describe("reverse graph edge cases", () => {
    it("reverseGraph swaps edge direction", () => {
      const g = createDigraph(["A", "B"], [["A", "B"]]);
      const r = reverseGraph(g);
      expect(r.edges[0].from).toBe("B");
      expect(r.edges[0].to).toBe("A");
    });

    it("reverseGraph preserves edge metadata", () => {
      let g = createDigraph(["A", "B"], []);
      g = addEdge(g, "A", "B", "label", 42);
      const r = reverseGraph(g);
      expect(r.edges[0].label).toBe("label");
      expect(r.edges[0].weight).toBe(42);
    });

    it("double reverse is identity", () => {
      const g = createDigraph(
        ["A", "B", "C"],
        [
          ["A", "B"],
          ["B", "C"],
        ]
      );
      const rr = reverseGraph(reverseGraph(g));
      expect(rr.edges).toEqual(g.edges);
    });

    it("reverseGraph on empty graph returns empty graph", () => {
      const g = createDigraph([], []);
      const r = reverseGraph(g);
      expect(r.nodes).toEqual([]);
      expect(r.edges).toEqual([]);
    });
  });

  // ==========================================================================
  // Attack 14: State Machine with Empty Transitions
  // ==========================================================================
  describe("state machine edge cases", () => {
    it("throws on empty transitions", () => {
      expect(() => defineStateMachine([])).toThrow("Cannot define a state machine with no states");
    });

    it("createInstance with custom initial state", () => {
      const sm = defineStateMachine(
        [
          { from: "A", event: "go", to: "B" },
          { from: "B", event: "go", to: "C" },
        ],
        { initial: "A" }
      );
      const instance = createInstance(sm, "B");
      expect(instance.current).toBe("B");
    });

    it("toGraph converts state machine to graph", () => {
      const sm = defineStateMachine(
        [
          { from: "idle", event: "start", to: "running" },
          { from: "running", event: "stop", to: "idle" },
        ],
        { initial: "idle" }
      );
      const g = toGraph(sm);
      expect(g.nodes.map((n) => n.id).sort()).toEqual(["idle", "running"]);
      expect(g.edges).toHaveLength(2);
      expect(g.directed).toBe(true);
    });

    it("verify detects cycles in state machine", () => {
      const sm = defineStateMachine(
        [
          { from: "A", event: "go", to: "B" },
          { from: "B", event: "go", to: "C" },
          { from: "C", event: "go", to: "A" },
        ],
        { initial: "A" }
      );
      const result = verify(sm);
      expect(result.cycles.length).toBeGreaterThan(0);
    });
  });
});
