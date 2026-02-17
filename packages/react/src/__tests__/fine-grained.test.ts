/**
 * Tests for fine-grained mode expansion
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { createMacroTestContext } from "../../../test-utils/macro-context.js";
import { stateMacro } from "../macros/state.js";
import { derivedMacro } from "../macros/derived.js";
import { effectMacro } from "../macros/effect.js";
import { DEFAULT_CONFIG, type ReactMacroConfig } from "../types.js";

// Mock configuration for fine-grained mode
const fineGrainedConfig: ReactMacroConfig = {
  ...DEFAULT_CONFIG,
  mode: "fine-grained",
};

describe("Fine-grained mode expansion", () => {
  describe("state() in fine-grained mode", () => {
    it("should understand fine-grained config option exists", () => {
      // This is a placeholder test that verifies the config type exists
      // Actual fine-grained expansion would need more infrastructure
      expect(fineGrainedConfig.mode).toBe("fine-grained");
      expect(fineGrainedConfig.optimizeRendering).toBe(true);
    });
  });

  describe("signal runtime", () => {
    it("should export signal runtime primitives", async () => {
      // Dynamic import to verify the module exports work
      const runtime = await import("../runtime/signals.js");
      
      expect(typeof runtime.createSignal).toBe("function");
      expect(typeof runtime.createComputed).toBe("function");
      expect(typeof runtime.createEffect).toBe("function");
      expect(typeof runtime.batch).toBe("function");
      expect(typeof runtime.untrack).toBe("function");
    });

    it("should create a working signal", async () => {
      const { createSignal } = await import("../runtime/signals.js");
      
      const [count, setCount] = createSignal(0);
      
      expect(count()).toBe(0);
      setCount(1);
      expect(count()).toBe(1);
      setCount(v => v + 1);
      expect(count()).toBe(2);
    });

    it("should create reactive computed values", async () => {
      const { createSignal, createComputed } = await import("../runtime/signals.js");
      
      const [count, setCount] = createSignal(1);
      const doubled = createComputed(() => count() * 2);
      
      expect(doubled()).toBe(2);
      setCount(5);
      expect(doubled()).toBe(10);
    });

    it("should run effects when dependencies change", async () => {
      const { createSignal, createEffect } = await import("../runtime/signals.js");
      
      const [count, setCount] = createSignal(0);
      const effects: number[] = [];
      
      createEffect(() => {
        effects.push(count());
      });
      
      expect(effects).toEqual([0]); // Initial run
      
      setCount(1);
      expect(effects).toEqual([0, 1]);
      
      setCount(2);
      expect(effects).toEqual([0, 1, 2]);
    });

    it("should batch updates", async () => {
      const { createSignal, createEffect, batch } = await import("../runtime/signals.js");
      
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal(0);
      const effects: string[] = [];
      
      createEffect(() => {
        effects.push(`a=${a()}, b=${b()}`);
      });
      
      effects.length = 0; // Clear initial run
      
      batch(() => {
        setA(1);
        setB(2);
      });
      
      // Should only run once with both values updated
      expect(effects).toEqual(["a=1, b=2"]);
    });

    it("should support untrack to prevent dependency tracking", async () => {
      const { createSignal, createEffect, untrack } = await import("../runtime/signals.js");
      
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal(0);
      const effects: string[] = [];
      
      createEffect(() => {
        const aVal = a();
        const bVal = untrack(() => b());
        effects.push(`a=${aVal}, b=${bVal}`);
      });
      
      effects.length = 0; // Clear initial run
      
      setA(1);
      expect(effects).toEqual(["a=1, b=0"]); // a is tracked
      
      effects.length = 0;
      setB(2);
      expect(effects).toEqual([]); // b is untracked
    });
  });

  describe("reconciler", () => {
    it("should export keyed list component", async () => {
      const reconciler = await import("../runtime/reconciler.js");
      
      expect(typeof reconciler.KeyedList).toBe("function");
      expect(typeof reconciler.createKeyedList).toBe("function");
    });
  });
});
