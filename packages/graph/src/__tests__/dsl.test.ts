import { describe, it, expect } from "vitest";
import { parseDigraph, parseStateMachine, digraph, graph, stateMachine } from "../index.js";

// ---------------------------------------------------------------------------
// Digraph DSL
// ---------------------------------------------------------------------------

describe("parseDigraph", () => {
  it("parses simple edges", () => {
    const g = parseDigraph(`
      a -> b
      b -> c
    `);
    expect(g.directed).toBe(true);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c"]);
    expect(g.edges).toHaveLength(2);
  });

  it("parses multiple targets", () => {
    const g = parseDigraph("a -> b, c, d");
    expect(g.edges).toHaveLength(3);
    expect(g.edges.map((e) => e.to).sort()).toEqual(["b", "c", "d"]);
  });

  it("parses edges with labels", () => {
    const g = parseDigraph("a -> b [weight], c");
    expect(g.edges).toHaveLength(2);
    const labeled = g.edges.find((e) => e.label);
    expect(labeled).toBeDefined();
    expect(labeled!.label).toBe("weight");
    expect(labeled!.to).toBe("b");
  });

  it("ignores blank lines and comments", () => {
    const g = parseDigraph(`
      # This is a comment
      a -> b

      b -> c
      # Another comment
    `);
    expect(g.edges).toHaveLength(2);
  });

  it("handles standalone node declaration", () => {
    const g = parseDigraph(`
      isolated
      a -> b
    `);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "isolated"]);
  });

  it("throws on missing source", () => {
    expect(() => parseDigraph("-> b")).toThrow(SyntaxError);
  });

  it("throws on missing targets", () => {
    expect(() => parseDigraph("a ->")).toThrow(SyntaxError);
  });
});

// ---------------------------------------------------------------------------
// StateMachine DSL
// ---------------------------------------------------------------------------

describe("parseStateMachine", () => {
  it("parses transitions", () => {
    const sm = parseStateMachine(`
      Idle --start--> Running
      Running --stop--> Idle
    `);
    expect([...sm.states].sort()).toEqual(["Idle", "Running"]);
    expect(sm.transitions).toHaveLength(2);
    expect(sm.initial).toBe("Idle");
  });

  it("parses @initial directive", () => {
    const sm = parseStateMachine(`
      @initial Running
      Idle --start--> Running
      Running --stop--> Idle
    `);
    expect(sm.initial).toBe("Running");
  });

  it("parses @terminal directive", () => {
    const sm = parseStateMachine(`
      @terminal Done, Cancelled
      Active --finish--> Done
      Active --cancel--> Cancelled
    `);
    expect(sm.terminal).toEqual(["Done", "Cancelled"]);
  });

  it("ignores comments and blank lines", () => {
    const sm = parseStateMachine(`
      # Traffic light
      Green --timer--> Yellow

      Yellow --timer--> Red
      # cycle back
      Red --timer--> Green
    `);
    expect(sm.transitions).toHaveLength(3);
  });

  it("throws on malformed syntax", () => {
    expect(() => parseStateMachine("not a transition")).toThrow(SyntaxError);
  });

  it("throws on empty definition", () => {
    expect(() => parseStateMachine("")).toThrow(SyntaxError);
    expect(() => parseStateMachine("# just comments")).toThrow(SyntaxError);
  });
});

// ---------------------------------------------------------------------------
// Tagged template literals
// ---------------------------------------------------------------------------

describe("digraph tagged template", () => {
  it("creates a directed graph", () => {
    const g = digraph`
      a -> b, c
      b -> d
    `;
    expect(g.directed).toBe(true);
    expect(g.edges).toHaveLength(3);
  });

  it("supports interpolation", () => {
    const target = "c";
    const g = digraph`a -> b, ${target}`;
    expect(g.edges).toHaveLength(2);
    expect(g.edges[1].to).toBe("c");
  });
});

describe("graph tagged template", () => {
  it("creates an undirected graph", () => {
    const g = graph`
      a -> b
      b -> c
    `;
    expect(g.directed).toBe(false);
    expect(g.edges).toHaveLength(2);
  });
});

describe("stateMachine tagged template", () => {
  it("creates a state machine definition", () => {
    const sm = stateMachine`
      Idle --start--> Running
      Running --stop--> Idle
    `;
    expect([...sm.states].sort()).toEqual(["Idle", "Running"]);
    expect(sm.transitions).toHaveLength(2);
  });

  it("has a create() helper", () => {
    const sm = stateMachine`
      @initial Idle
      Idle --start--> Running
      Running --stop--> Idle
    `;
    const inst = sm.create();
    expect(inst.current).toBe("Idle");
  });
});
