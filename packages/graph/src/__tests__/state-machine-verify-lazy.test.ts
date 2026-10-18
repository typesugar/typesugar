/**
 * FMG-15: `verify()` runs at compile time inside the `stateMachine` macro, so it
 * must not enumerate every elementary cycle (exponential in dense machines)
 * unless the caller actually reads `result.cycles`.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../algorithms.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../algorithms.js")>();
  return { ...orig, detectCycles: vi.fn(orig.detectCycles) };
});

import { detectCycles } from "../algorithms.js";
import { defineStateMachine, verify } from "../state-machine.js";

describe("FMG-15: verify() computes cycles lazily", () => {
  it("does not enumerate cycles unless .cycles is read", () => {
    const states = ["A", "B", "C"];
    const tr = states.flatMap((a) =>
      states.filter((b) => b !== a).map((b) => ({ from: a, event: "to" + b, to: b }))
    );
    const r = verify(defineStateMachine(tr, { initial: "A" }));
    expect(r.valid).toBe(true);
    expect(r.unreachableStates).toEqual([]);
    expect(detectCycles).not.toHaveBeenCalled();
    expect(r.cycles.length).toBe(5);
    expect(r.cycles.length).toBe(5);
    expect(detectCycles).toHaveBeenCalledTimes(1);
  });
});
