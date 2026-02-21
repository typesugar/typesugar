import { describe, it, expect } from "vitest";
import {
  defineStateMachine,
  verify,
  createInstance,
  toGraph,
  reachableStates,
  deadEndStates,
  isNondeterministic,
  parseStateMachine,
} from "../index.js";

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

describe("defineStateMachine", () => {
  it("creates a machine from transitions", () => {
    const sm = defineStateMachine([
      { from: "Idle", event: "start", to: "Running" },
      { from: "Running", event: "stop", to: "Idle" },
    ]);
    expect(sm.states.sort()).toEqual(["Idle", "Running"]);
    expect(sm.transitions).toHaveLength(2);
    expect(sm.initial).toBe("Idle");
  });

  it("uses explicit initial state", () => {
    const sm = defineStateMachine(
      [
        { from: "A", event: "go", to: "B" },
        { from: "B", event: "go", to: "C" },
      ],
      { initial: "B" }
    );
    expect(sm.initial).toBe("B");
  });

  it("accepts terminal states", () => {
    const sm = defineStateMachine([{ from: "A", event: "go", to: "B" }], { terminal: ["B"] });
    expect(sm.terminal).toEqual(["B"]);
  });

  it("throws for empty transitions", () => {
    expect(() => defineStateMachine([])).toThrow();
  });
});

describe("parseStateMachine (DSL)", () => {
  it("parses simple transitions", () => {
    const sm = parseStateMachine(`
      Idle --start--> Running
      Running --stop--> Idle
    `);
    expect(sm.states.sort()).toEqual(["Idle", "Running"]);
    expect(sm.transitions).toHaveLength(2);
  });

  it("parses @initial and @terminal directives", () => {
    const sm = parseStateMachine(`
      @initial Idle
      @terminal Done
      Idle --begin--> Working
      Working --finish--> Done
    `);
    expect(sm.initial).toBe("Idle");
    expect(sm.terminal).toEqual(["Done"]);
  });

  it("rejects malformed syntax", () => {
    expect(() => parseStateMachine("bad line")).toThrow(SyntaxError);
  });
});

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

describe("verify", () => {
  it("valid machine has no issues", () => {
    const sm = defineStateMachine(
      [
        { from: "Idle", event: "start", to: "Running" },
        { from: "Running", event: "stop", to: "Idle" },
      ],
      { initial: "Idle" }
    );
    const result = verify(sm);
    expect(result.valid).toBe(true);
    expect(result.unreachableStates).toEqual([]);
    expect(result.deadEndStates).toEqual([]);
    expect(result.nondeterministic).toEqual([]);
  });

  it("detects unreachable states", () => {
    const sm = defineStateMachine(
      [
        { from: "A", event: "go", to: "B" },
        { from: "C", event: "go", to: "D" },
      ],
      { initial: "A" }
    );
    const result = verify(sm);
    expect(result.unreachableStates).toContain("C");
    expect(result.unreachableStates).toContain("D");
  });

  it("detects dead-end states", () => {
    const sm = defineStateMachine(
      [
        { from: "A", event: "go", to: "B" },
        { from: "A", event: "alt", to: "C" },
      ],
      { initial: "A", terminal: ["C"] }
    );
    const result = verify(sm);
    expect(result.deadEndStates).toContain("B");
    expect(result.deadEndStates).not.toContain("C");
  });

  it("detects nondeterminism", () => {
    const sm = defineStateMachine([
      { from: "A", event: "go", to: "B" },
      { from: "A", event: "go", to: "C" },
    ]);
    const result = verify(sm);
    expect(result.nondeterministic).toHaveLength(1);
    expect(result.nondeterministic[0].state).toBe("A");
    expect(result.nondeterministic[0].event).toBe("go");
    expect(result.nondeterministic[0].targets.sort()).toEqual(["B", "C"]);
  });
});

// ---------------------------------------------------------------------------
// Instance
// ---------------------------------------------------------------------------

describe("createInstance", () => {
  const sm = defineStateMachine(
    [
      { from: "Idle", event: "start", to: "Running" },
      { from: "Running", event: "pause", to: "Paused" },
      { from: "Paused", event: "resume", to: "Running" },
      { from: "Running", event: "stop", to: "Idle" },
    ],
    { initial: "Idle" }
  );

  it("starts in initial state", () => {
    const inst = createInstance(sm);
    expect(inst.current).toBe("Idle");
  });

  it("transitions to next state", () => {
    const inst = createInstance(sm);
    const next = inst.transition("start");
    expect(next.current).toBe("Running");
  });

  it("chains transitions", () => {
    const inst = createInstance(sm);
    const result = inst
      .transition("start")
      .transition("pause")
      .transition("resume")
      .transition("stop");
    expect(result.current).toBe("Idle");
  });

  it("canTransition checks validity", () => {
    const inst = createInstance(sm);
    expect(inst.canTransition("start")).toBe(true);
    expect(inst.canTransition("stop")).toBe(false);
  });

  it("availableEvents lists valid events", () => {
    const inst = createInstance(sm);
    expect(inst.availableEvents()).toEqual(["start"]);

    const running = inst.transition("start");
    expect(running.availableEvents().sort()).toEqual(["pause", "stop"]);
  });

  it("throws on invalid transition", () => {
    const inst = createInstance(sm);
    expect(() => inst.transition("stop")).toThrow(
      /No transition from state "Idle" on event "stop"/
    );
  });

  it("accepts explicit initial state override", () => {
    const inst = createInstance(sm, "Running" as any);
    expect(inst.current).toBe("Running");
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe("toGraph", () => {
  it("converts state machine to directed graph", () => {
    const sm = defineStateMachine([
      { from: "A", event: "go", to: "B" },
      { from: "B", event: "back", to: "A" },
    ]);
    const g = toGraph(sm);
    expect(g.directed).toBe(true);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
    expect(g.edges).toHaveLength(2);
  });
});

describe("reachableStates", () => {
  it("finds all reachable states", () => {
    const sm = defineStateMachine(
      [
        { from: "A", event: "go", to: "B" },
        { from: "B", event: "go", to: "C" },
        { from: "D", event: "go", to: "E" },
      ],
      { initial: "A" }
    );
    const reached = reachableStates(sm);
    expect(reached).toEqual(new Set(["A", "B", "C"]));
  });
});

describe("deadEndStates", () => {
  it("finds states with no outgoing transitions", () => {
    const sm = defineStateMachine(
      [
        { from: "A", event: "go", to: "B" },
        { from: "A", event: "alt", to: "C" },
      ],
      { terminal: ["C"] }
    );
    const dead = deadEndStates(sm);
    expect(dead).toContain("B");
    expect(dead).not.toContain("C");
  });
});

describe("isNondeterministic", () => {
  it("detects nondeterministic transitions", () => {
    const sm = defineStateMachine([
      { from: "A", event: "go", to: "B" },
      { from: "A", event: "go", to: "C" },
    ]);
    const nd = isNondeterministic(sm);
    expect(nd).toHaveLength(1);
  });

  it("returns empty for deterministic machine", () => {
    const sm = defineStateMachine([
      { from: "A", event: "go", to: "B" },
      { from: "A", event: "stop", to: "C" },
    ]);
    expect(isNondeterministic(sm)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Complex state machines
// ---------------------------------------------------------------------------

describe("complex FSMs", () => {
  it("order lifecycle", () => {
    const sm = defineStateMachine(
      [
        { from: "Created", event: "submit", to: "Pending" },
        { from: "Pending", event: "approve", to: "Approved" },
        { from: "Pending", event: "reject", to: "Rejected" },
        { from: "Approved", event: "ship", to: "Shipped" },
        { from: "Shipped", event: "deliver", to: "Delivered" },
        { from: "Pending", event: "cancel", to: "Cancelled" },
      ],
      { initial: "Created", terminal: ["Delivered", "Rejected", "Cancelled"] }
    );

    const result = verify(sm);
    expect(result.unreachableStates).toEqual([]);
    expect(result.deadEndStates).toEqual([]);
    expect(result.nondeterministic).toEqual([]);

    const inst = createInstance(sm);
    const delivered = inst
      .transition("submit")
      .transition("approve")
      .transition("ship")
      .transition("deliver");
    expect(delivered.current).toBe("Delivered");
  });

  it("traffic light", () => {
    const sm = defineStateMachine(
      [
        { from: "Green", event: "timer", to: "Yellow" },
        { from: "Yellow", event: "timer", to: "Red" },
        { from: "Red", event: "timer", to: "Green" },
      ],
      { initial: "Green" }
    );
    const result = verify(sm);
    expect(result.valid).toBe(true);
    expect(result.cycles.length).toBeGreaterThan(0);
  });
});
