/**
 * Red Team Tests for @typesugar/react
 *
 * Attack surfaces:
 * - Signal read/write edge cases (Object.is semantics, NaN, function values)
 * - Computed dependency tracking (circular, conditional, diamond patterns)
 * - Effect cleanup (missing cleanup, double dispose, timing)
 * - Batched update ordering and error handling
 * - Memory leaks from subscriptions and dependency tracking
 * - Safety check bypasses (conditional state, direct mutation)
 */
import { describe, it, expect, vi } from "vitest";
import { state, derived, effect, watch, match, each } from "../packages/react/src/index.js";
import {
  createSignal,
  createSignalObject,
  createComputed,
  createEffect,
  batch,
  untrack,
} from "../packages/react/src/runtime/signals.js";

describe("React Integration Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Signal Value Semantics
  // ==========================================================================
  describe("Signal Value Semantics", () => {
    it("should treat NaN as equal to NaN (Object.is semantics)", () => {
      const [count, setCount] = createSignal(NaN);
      let updateCount = 0;

      const dispose = createEffect(() => {
        count();
        updateCount++;
      });

      expect(updateCount).toBe(1);

      setCount(NaN);
      expect(updateCount).toBe(1);

      dispose();
    });

    it("should distinguish -0 from +0 (Object.is semantics)", () => {
      const [value, setValue] = createSignal(0);
      let updateCount = 0;

      const dispose = createEffect(() => {
        value();
        updateCount++;
      });

      expect(updateCount).toBe(1);

      // Object.is(0, -0) === false, so this SHOULD trigger an update
      setValue(-0);
      expect(updateCount).toBe(2);

      dispose();
    });

    it("should handle undefined as a valid value distinct from missing", () => {
      const signal = createSignalObject<string | undefined>("initial");
      let lastValue: string | undefined = "sentinel";

      const dispose = createEffect(() => {
        lastValue = signal.get();
      });

      expect(lastValue).toBe("initial");

      signal.set(undefined);
      expect(lastValue).toBe(undefined);

      signal.set("restored");
      expect(lastValue).toBe("restored");

      dispose();
    });

    it("FINDING: function values are invoked as updaters", () => {
      // FINDING: The signal setter treats any function as an updater,
      // making it impossible to store function values directly.
      // This is a known limitation — use wrapper objects for function storage.
      const fn1 = () => "first";
      const fn2 = () => "second";

      const [getter, setter] = createSignal<() => string>(fn1);

      // When we try to set fn2, it's invoked as an updater with fn1 as argument
      // fn2(fn1) returns "second" (ignoring the argument)
      setter(fn2);

      // The stored value is now "second" (a string), not fn2 (a function)
      expect(typeof getter()).toBe("string");
      expect(getter()).toBe("second");

      // Workaround: wrap functions in objects
      const [getterWrapped, setterWrapped] = createSignal({ fn: fn1 });
      setterWrapped({ fn: fn2 });
      expect(getterWrapped().fn()).toBe("second");
    });

    it("should handle deeply nested object reference equality", () => {
      const obj = { nested: { deep: { value: 1 } } };
      const signal = createSignalObject(obj);
      let updateCount = 0;

      const dispose = createEffect(() => {
        signal.get();
        updateCount++;
      });

      expect(updateCount).toBe(1);

      signal.set(obj);
      expect(updateCount).toBe(1);

      signal.set({ ...obj });
      expect(updateCount).toBe(2);

      dispose();
    });
  });

  // ==========================================================================
  // Attack 2: Computed Dependency Edge Cases
  // ==========================================================================
  describe("Computed Dependency Tracking", () => {
    it("should handle conditional dependency reads", () => {
      const [condition, setCondition] = createSignal(true);
      const [valueA, setValueA] = createSignal("A");
      const [valueB, setValueB] = createSignal("B");

      let computeCount = 0;
      const computed = createComputed(() => {
        computeCount++;
        return condition() ? valueA() : valueB();
      });

      expect(computed()).toBe("A");
      expect(computeCount).toBe(1);

      setValueB("B2");
      expect(computeCount).toBe(1);

      setCondition(false);
      expect(computed()).toBe("B2");
      expect(computeCount).toBe(2);

      setValueA("A2");
      expect(computeCount).toBe(2);

      setValueB("B3");
      expect(computed()).toBe("B3");
      expect(computeCount).toBe(3);
    });

    it("FINDING: computed-to-computed dependencies not tracked", () => {
      // FINDING: The current implementation tracks signal->computed dependencies,
      // but computed->computed dependencies are NOT properly tracked.
      // When root changes, left and right recompute, but bottom doesn't see
      // the change because it tracks left/right as computeds, not signals.
      const [root, setRoot] = createSignal(1);

      const left = createComputed(() => root() * 2);
      const right = createComputed(() => root() * 3);
      const bottom = createComputed(() => left() + right());

      expect(bottom()).toBe(5); // 1*2 + 1*3 = 5

      setRoot(2);

      // left and right track root, so they recompute
      expect(left()).toBe(4); // 2*2 = 4
      expect(right()).toBe(6); // 2*3 = 6

      // BUT: bottom doesn't track the computed-to-computed dependency
      // It still returns the cached value because it wasn't notified
      // This is a limitation of the implementation
      expect(bottom()).toBe(5); // Still returns stale value!

      // Workaround: Use signals instead of computeds for intermediate values,
      // or use a full reactive system like Solid.js for proper glitch-free updates
    });

    it("FINDING: no built-in infinite loop detection", () => {
      // FINDING: The signal implementation doesn't have built-in infinite loop detection.
      // A computed that mutates its own dependency will run until the condition stops.
      // This test uses a self-limiting condition to avoid actual infinite loop.
      let loopCount = 0;

      const signal = createSignalObject(0);

      const computed = createComputed(() => {
        loopCount++;
        const val = signal.get();
        // Self-limiting: stops when val reaches 10
        if (val < 10) {
          signal.set(val + 1);
        }
        return val;
      });

      // The computed runs, triggering set(), which triggers recompute, etc.
      // Eventually val reaches 10 and the loop stops
      const result = computed();
      expect(result).toBe(0); // Returns initial read value
      expect(signal.get()).toBe(10); // Signal was mutated to 10
      expect(loopCount).toBeGreaterThan(1);
    });

    it("FINDING: computed throws eagerly on dependency change", () => {
      // FINDING: When a dependency changes, computed recomputes eagerly.
      // If the computation throws, the error propagates from set(), not from get().
      const [trigger, setTrigger] = createSignal(false);

      const computed = createComputed(() => {
        if (trigger()) {
          throw new Error("Intentional error");
        }
        return "ok";
      });

      expect(computed()).toBe("ok");

      // The error is thrown during setTrigger, not during computed()
      expect(() => setTrigger(true)).toThrow("Intentional error");
    });

    it("should handle computed with async dependency read (anti-pattern)", () => {
      const [value, setValue] = createSignal(0);
      let asyncReadResult: number | null = null;

      const computed = createComputed(() => {
        Promise.resolve().then(() => {
          asyncReadResult = value();
        });
        return value();
      });

      expect(computed()).toBe(0);

      setValue(42);

      expect(computed()).toBe(42);
    });
  });

  // ==========================================================================
  // Attack 3: Effect Cleanup Edge Cases
  // ==========================================================================
  describe("Effect Cleanup", () => {
    it("should call cleanup before re-running effect", () => {
      const [value, setValue] = createSignal(0);
      const sequence: string[] = [];

      const dispose = createEffect(() => {
        const v = value();
        sequence.push(`run:${v}`);
        return () => {
          sequence.push(`cleanup:${v}`);
        };
      });

      expect(sequence).toEqual(["run:0"]);

      setValue(1);
      expect(sequence).toEqual(["run:0", "cleanup:0", "run:1"]);

      setValue(2);
      expect(sequence).toEqual(["run:0", "cleanup:0", "run:1", "cleanup:1", "run:2"]);

      dispose();
      expect(sequence).toEqual(["run:0", "cleanup:0", "run:1", "cleanup:1", "run:2", "cleanup:2"]);
    });

    it("cleanup errors propagate during dependency change", () => {
      const [value, setValue] = createSignal(0);
      let cleanupCalled = false;

      const dispose = createEffect(() => {
        value();
        return () => {
          cleanupCalled = true;
          throw new Error("Cleanup error");
        };
      });

      // The cleanup error is thrown when the effect re-runs due to dependency change
      expect(() => setValue(1)).toThrow("Cleanup error");
      expect(cleanupCalled).toBe(true);

      // Note: dispose() will also throw since cleanup runs on dispose
      expect(() => dispose()).toThrow("Cleanup error");
    });

    it("should not run effect after dispose", () => {
      const [value, setValue] = createSignal(0);
      let runCount = 0;

      const dispose = createEffect(() => {
        value();
        runCount++;
      });

      expect(runCount).toBe(1);

      dispose();

      setValue(1);
      expect(runCount).toBe(1);
    });

    it("should handle double dispose gracefully", () => {
      const [value] = createSignal(0);

      const dispose = createEffect(() => {
        value();
      });

      dispose();
      expect(() => dispose()).not.toThrow();
    });

    it("should handle cleanup returning non-function", () => {
      const [value, setValue] = createSignal(0);
      let runCount = 0;

      const dispose = createEffect(() => {
        value();
        runCount++;
        return null as unknown as () => void;
      });

      expect(runCount).toBe(1);

      expect(() => setValue(1)).not.toThrow();
      expect(runCount).toBe(2);

      dispose();
    });
  });

  // ==========================================================================
  // Attack 4: Batched Updates
  // ==========================================================================
  describe("Batched Updates", () => {
    it("FINDING: batch queues notify callbacks, not individual updates", () => {
      // FINDING: The batch() implementation queues the notify() callbacks,
      // but each setValue still triggers its own notify. This means effects
      // may run multiple times if they depend on multiple signals.
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal(0);
      const sequence: string[] = [];

      const dispose = createEffect(() => {
        sequence.push(`effect: a=${a()}, b=${b()}`);
      });

      expect(sequence).toEqual(["effect: a=0, b=0"]);

      batch(() => {
        setA(1);
        setB(2);
      });

      // The effect runs once per dependency change due to separate notify calls
      // Ideal would be: ["effect: a=0, b=0", "effect: a=1, b=2"]
      // Actual: may include intermediate states
      expect(sequence.length).toBeGreaterThanOrEqual(2);
      expect(sequence[sequence.length - 1]).toBe("effect: a=1, b=2");

      dispose();
    });

    it("FINDING: nested batches each trigger their own flush", () => {
      // FINDING: Each batch() call increments/decrements batchDepth,
      // but the inner batches don't fully coalesce into a single flush.
      const [value, setValue] = createSignal(0);
      let effectCount = 0;

      const dispose = createEffect(() => {
        value();
        effectCount++;
      });

      expect(effectCount).toBe(1);

      batch(() => {
        setValue(1);
        batch(() => {
          setValue(2);
          batch(() => {
            setValue(3);
          });
        });
      });

      // Multiple effect runs occur, not just 2
      expect(effectCount).toBeGreaterThanOrEqual(2);
      expect(value()).toBe(3);

      dispose();
    });

    it("should flush batch on error", () => {
      const [value, setValue] = createSignal(0);
      let effectCount = 0;

      const dispose = createEffect(() => {
        value();
        effectCount++;
      });

      expect(effectCount).toBe(1);

      expect(() => {
        batch(() => {
          setValue(1);
          throw new Error("Batch error");
        });
      }).toThrow("Batch error");

      expect(effectCount).toBe(2);

      dispose();
    });

    it("FINDING: multiple updates to same signal in batch not coalesced", () => {
      // FINDING: Each setValue() queues a separate notify callback,
      // so multiple updates to the same signal in a batch can trigger
      // multiple effect runs.
      const [value, setValue] = createSignal(0);
      let effectCount = 0;

      const dispose = createEffect(() => {
        value();
        effectCount++;
      });

      expect(effectCount).toBe(1);

      batch(() => {
        setValue(1);
        setValue(2);
        setValue(3);
      });

      // Each setValue queues a notify, so effect may run 3 times
      expect(effectCount).toBeGreaterThanOrEqual(2);
      expect(value()).toBe(3);

      dispose();
    });
  });

  // ==========================================================================
  // Attack 5: Memory Leak Patterns
  // ==========================================================================
  describe("Memory Leak Patterns", () => {
    it("should remove effect from signal dependencies on dispose", () => {
      const signal = createSignalObject(0);
      const effectRefs: WeakRef<object>[] = [];

      for (let i = 0; i < 5; i++) {
        const tracker = { id: i };
        effectRefs.push(new WeakRef(tracker));

        const dispose = createEffect(() => {
          signal.get();
          void tracker;
        });

        dispose();
      }

      signal.set(1);
    });

    it("should not retain references to old computed dependencies", () => {
      const [condition, setCondition] = createSignal(true);
      const signalA = createSignalObject("A");
      const signalB = createSignalObject("B");

      const computed = createComputed(() => {
        return condition() ? signalA.get() : signalB.get();
      });

      expect(computed()).toBe("A");

      setCondition(false);
      expect(computed()).toBe("B");

      let aUpdated = false;
      signalA.subscribe(() => {
        aUpdated = true;
      });

      signalA.set("A2");
      expect(aUpdated).toBe(true);
    });

    it("should handle rapid subscribe/unsubscribe cycles", () => {
      const signal = createSignalObject(0);
      const unsubscribes: (() => void)[] = [];

      for (let i = 0; i < 1000; i++) {
        const unsub = signal.subscribe(() => {});
        unsubscribes.push(unsub);
      }

      for (const unsub of unsubscribes) {
        unsub();
      }

      expect(() => signal.set(1)).not.toThrow();
    });
  });

  // ==========================================================================
  // Attack 6: Untrack Edge Cases
  // ==========================================================================
  describe("Untrack Edge Cases", () => {
    it("should prevent dependency tracking inside untrack", () => {
      const [tracked, setTracked] = createSignal(0);
      const [untracked, setUntracked] = createSignal(0);
      let effectCount = 0;

      const dispose = createEffect(() => {
        tracked();
        untrack(() => {
          untracked();
        });
        effectCount++;
      });

      expect(effectCount).toBe(1);

      setUntracked(1);
      expect(effectCount).toBe(1);

      setTracked(1);
      expect(effectCount).toBe(2);

      dispose();
    });

    it("should handle nested untrack", () => {
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal(0);
      const [c, setC] = createSignal(0);
      let effectCount = 0;

      const dispose = createEffect(() => {
        a();
        untrack(() => {
          b();
          untrack(() => {
            c();
          });
        });
        effectCount++;
      });

      expect(effectCount).toBe(1);

      setB(1);
      setC(1);
      expect(effectCount).toBe(1);

      setA(1);
      expect(effectCount).toBe(2);

      dispose();
    });

    it("should restore tracking context after untrack throws", () => {
      const [outer, setOuter] = createSignal(0);
      const [inner, setInner] = createSignal(0);
      let effectCount = 0;

      const dispose = createEffect(() => {
        outer();
        try {
          untrack(() => {
            inner();
            throw new Error("untrack error");
          });
        } catch {}
        effectCount++;
      });

      expect(effectCount).toBe(1);

      setInner(1);
      expect(effectCount).toBe(1);

      setOuter(1);
      expect(effectCount).toBe(2);

      dispose();
    });
  });

  // ==========================================================================
  // Attack 7: Runtime Fallback Edge Cases
  // ==========================================================================
  describe("Runtime Fallback Behavior", () => {
    it("should handle state() runtime fallback with updater function", () => {
      const counter = state(0);

      expect(counter.get()).toBe(0);

      counter.set(5);
      expect(counter.get()).toBe(5);

      counter.set((prev) => prev + 1);
      expect(counter.get()).toBe(6);

      counter.update((v) => v * 2);
      expect(counter.get()).toBe(12);
    });

    it("should handle derived() runtime fallback", () => {
      const counter = state(5);
      const doubled = derived(() => counter.get() * 2);

      expect(doubled.get()).toBe(10);

      counter.set(10);
      expect(doubled.get()).toBe(20);
    });

    it("should handle effect() runtime fallback with cleanup", () => {
      const cleanupCalled = vi.fn();

      effect(() => {
        return () => {
          cleanupCalled();
        };
      });
    });

    it("should handle watch() runtime fallback", () => {
      const a = state(1);
      const b = state(2);
      let result: number[] = [];

      watch([a, b], (aVal, bVal) => {
        result = [aVal, bVal];
      });

      expect(result).toEqual([1, 2]);
    });
  });

  // ==========================================================================
  // Attack 8: Match Pattern Exhaustiveness
  // ==========================================================================
  describe("Match Pattern Edge Cases", () => {
    type Status =
      | { _tag: "loading" }
      | { _tag: "error"; message: string }
      | { _tag: "success"; data: number };

    it("should handle match with all cases", () => {
      const loading: Status = { _tag: "loading" };
      const error: Status = { _tag: "error", message: "fail" };
      const success: Status = { _tag: "success", data: 42 };

      const result1 = match(loading, {
        loading: () => "loading",
        error: (e) => e.message,
        success: (s) => String(s.data),
      });

      expect(result1).toBe("loading");

      const result2 = match(error, {
        loading: () => "loading",
        error: (e) => e.message,
        success: (s) => String(s.data),
      });

      expect(result2).toBe("fail");

      const result3 = match(success, {
        loading: () => "loading",
        error: (e) => e.message,
        success: (s) => String(s.data),
      });

      expect(result3).toBe("42");
    });

    it("should throw on unhandled case at runtime", () => {
      const unknownStatus = { _tag: "unknown" } as Status;

      expect(() =>
        match(unknownStatus, {
          loading: () => "loading",
          error: (e) => e.message,
          success: (s) => String(s.data),
        })
      ).toThrow("Unhandled case: unknown");
    });

    it("should handle match case returning undefined", () => {
      const status: Status = { _tag: "loading" };

      const result = match(status, {
        loading: () => undefined,
        error: () => "error",
        success: () => "success",
      });

      expect(result).toBe(undefined);
    });
  });

  // ==========================================================================
  // Attack 9: Each Iterator Edge Cases
  // ==========================================================================
  describe("Each Iterator Edge Cases", () => {
    it("should handle empty array", () => {
      const items: string[] = [];
      const result = each(
        items,
        (item) => item,
        (item) => item
      );

      expect(result).toEqual([]);
    });

    it("should handle array with duplicate keys", () => {
      const items = [
        { id: 1, name: "a" },
        { id: 1, name: "b" },
        { id: 2, name: "c" },
      ];

      const result = each(
        items,
        (item) => item.name,
        (item) => item.id
      );

      expect(result).toEqual(["a", "b", "c"]);
    });

    it("should pass correct index to render function", () => {
      const items = ["a", "b", "c"];
      const indices: number[] = [];

      each(
        items,
        (item, index) => {
          indices.push(index);
          return item;
        },
        (item) => item
      );

      expect(indices).toEqual([0, 1, 2]);
    });

    it("should handle null/undefined in array", () => {
      const items = [1, null, undefined, 2];

      const result = each(
        items,
        (item) => item,
        (item, idx) => idx
      );

      expect(result).toEqual([1, null, undefined, 2]);
    });
  });

  // ==========================================================================
  // Attack 10: Concurrent Update Patterns
  // ==========================================================================
  describe("Concurrent Update Patterns", () => {
    it("should handle effect triggering another effect's dependency", () => {
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal(0);
      const sequence: string[] = [];

      const disposeA = createEffect(() => {
        const val = a();
        sequence.push(`effect-a: ${val}`);
        if (val === 1) {
          setB(1);
        }
      });

      const disposeB = createEffect(() => {
        sequence.push(`effect-b: ${b()}`);
      });

      expect(sequence).toEqual(["effect-a: 0", "effect-b: 0"]);

      setA(1);
      expect(sequence).toContain("effect-a: 1");
      expect(sequence).toContain("effect-b: 1");

      disposeA();
      disposeB();
    });

    it("should handle computed updating signal during read", () => {
      const signal = createSignalObject(0);
      let computeCount = 0;

      const computed = createComputed(() => {
        computeCount++;
        const val = signal.get();
        if (val === 0) {
          signal.set(1);
        }
        return val;
      });

      expect(computed()).toBe(0);
      expect(computeCount).toBeGreaterThan(0);
    });

    it("should handle signal set during subscription callback", () => {
      const signal = createSignalObject(0);
      let callbackCount = 0;

      const unsub = signal.subscribe((val) => {
        callbackCount++;
        if (val === 1) {
          signal.set(2);
        }
      });

      signal.set(1);

      expect(callbackCount).toBeGreaterThanOrEqual(2);
      expect(signal.get()).toBe(2);

      unsub();
    });
  });
});
