/**
 * Fine-Grained Signal Runtime
 *
 * A minimal reactive signal implementation for fine-grained mode.
 * This provides Solid.js-style reactivity without a virtual DOM.
 *
 * ~200 LOC, zero dependencies beyond React.
 */

// ============================================================================
// Types
// ============================================================================

/** A reactive signal */
export interface Signal<T> {
  /** Get the current value */
  get(): T;
  /** Set a new value */
  set(value: T | ((prev: T) => T)): void;
  /** Update with a function */
  update(fn: (prev: T) => T): void;
  /** Subscribe to changes */
  subscribe(callback: (value: T) => void): () => void;
}

/** A computed signal (read-only) */
export interface Computed<T> {
  /** Get the computed value */
  get(): T;
  /** Subscribe to changes */
  subscribe(callback: (value: T) => void): () => void;
}

/** An effect cleanup function */
export type Cleanup = () => void;

// ============================================================================
// Internal State
// ============================================================================

/** Currently executing computed (for automatic dependency tracking) */
let currentComputed: ComputedImpl<unknown> | null = null;

/** Currently executing effect (for automatic dependency tracking) */
let currentEffect: EffectImpl | null = null;

/** Batch update queue */
let batchQueue: Set<() => void> | null = null;
let batchDepth = 0;

// ============================================================================
// Signal Implementation
// ============================================================================

class SignalImpl<T> implements Signal<T> {
  private value: T;
  private subscribers = new Set<(value: T) => void>();
  private computedDependents = new Set<ComputedImpl<unknown>>();
  private effectDependents = new Set<EffectImpl>();

  constructor(initialValue: T) {
    this.value = initialValue;
  }

  get(): T {
    // Track dependency if inside a computed or effect
    if (currentComputed) {
      this.computedDependents.add(currentComputed);
      currentComputed.addDependency(this);
    }
    if (currentEffect) {
      this.effectDependents.add(currentEffect);
      currentEffect.addDependency(this);
    }
    return this.value;
  }

  set(valueOrFn: T | ((prev: T) => T)): void {
    const newValue =
      typeof valueOrFn === "function"
        ? (valueOrFn as (prev: T) => T)(this.value)
        : valueOrFn;

    if (Object.is(this.value, newValue)) {
      return; // No change
    }

    this.value = newValue;
    this.notify();
  }

  update(fn: (prev: T) => T): void {
    this.set(fn(this.value));
  }

  subscribe(callback: (value: T) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  private notify(): void {
    // Notify all dependents
    const notify = () => {
      // Snapshot sets to avoid modification during iteration
      // (recompute() removes/re-adds computed to the set, which would cause infinite loop)
      const computeds = [...this.computedDependents];
      const effects = [...this.effectDependents];

      // Subscribers
      for (const callback of this.subscribers) {
        callback(this.value);
      }

      // Computed dependents (recompute)
      for (const computed of computeds) {
        computed.recompute();
      }

      // Effect dependents (re-run)
      for (const effect of effects) {
        effect.run();
      }
    };

    if (batchQueue) {
      batchQueue.add(notify);
    } else {
      notify();
    }
  }

  /** @internal */
  removeDependentComputed(computed: ComputedImpl<unknown>): void {
    this.computedDependents.delete(computed);
  }

  /** @internal */
  removeDependentEffect(effect: EffectImpl): void {
    this.effectDependents.delete(effect);
  }
}

// ============================================================================
// Computed Implementation
// ============================================================================

class ComputedImpl<T> implements Computed<T> {
  private value!: T;
  private computation: () => T;
  private subscribers = new Set<(value: T) => void>();
  private dependencies = new Set<SignalImpl<unknown>>();
  private dirty = true;

  constructor(computation: () => T) {
    this.computation = computation;
    // Compute initial value
    this.recompute();
  }

  get(): T {
    if (this.dirty) {
      this.recompute();
    }

    // Track as dependency if inside another computed
    if (currentComputed && currentComputed !== this) {
      // Computed-to-computed dependencies are handled through signals
    }

    return this.value;
  }

  subscribe(callback: (value: T) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  /** @internal */
  recompute(): void {
    // Clear old dependencies
    for (const dep of this.dependencies) {
      dep.removeDependentComputed(this);
    }
    this.dependencies.clear();

    // Track new dependencies
    const previousComputed = currentComputed;
    currentComputed = this;

    try {
      const newValue = this.computation();
      this.dirty = false;

      if (!Object.is(this.value, newValue)) {
        this.value = newValue;
        // Notify subscribers
        for (const callback of this.subscribers) {
          callback(this.value);
        }
      }
    } finally {
      currentComputed = previousComputed;
    }
  }

  /** @internal */
  addDependency(signal: SignalImpl<unknown>): void {
    this.dependencies.add(signal);
  }
}

// ============================================================================
// Effect Implementation
// ============================================================================

class EffectImpl {
  private effectFn: () => void | Cleanup;
  private cleanup: Cleanup | void;
  private dependencies = new Set<SignalImpl<unknown>>();
  private disposed = false;

  constructor(effectFn: () => void | Cleanup) {
    this.effectFn = effectFn;
    this.run();
  }

  /** @internal */
  run(): void {
    if (this.disposed) return;

    // Run cleanup from previous execution
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = undefined;
    }

    // Clear old dependencies
    for (const dep of this.dependencies) {
      dep.removeDependentEffect(this);
    }
    this.dependencies.clear();

    // Track new dependencies
    const previousEffect = currentEffect;
    currentEffect = this;

    try {
      this.cleanup = this.effectFn();
    } finally {
      currentEffect = previousEffect;
    }
  }

  /** @internal */
  addDependency(signal: SignalImpl<unknown>): void {
    this.dependencies.add(signal);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Run cleanup
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = undefined;
    }

    // Remove from all dependencies
    for (const dep of this.dependencies) {
      dep.removeDependentEffect(this);
    }
    this.dependencies.clear();
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a reactive signal (Solid.js-style tuple API)
 *
 * @example
 * ```typescript
 * const [count, setCount] = createSignal(0);
 * console.log(count()); // 0
 * setCount(1);
 * setCount(v => v + 1);
 * ```
 */
export function createSignal<T>(
  initialValue: T,
): [read: () => T, write: (value: T | ((prev: T) => T)) => void] {
  const signal = new SignalImpl(initialValue);
  return [() => signal.get(), (value: T | ((prev: T) => T)) => signal.set(value)];
}

/**
 * Create a reactive signal (object API for internal use)
 */
export function createSignalObject<T>(initialValue: T): Signal<T> {
  return new SignalImpl(initialValue);
}

/**
 * Create a computed (derived) signal (Solid.js-style)
 *
 * @example
 * ```typescript
 * const doubled = createComputed(() => count() * 2);
 * console.log(doubled()); // Computed value
 * ```
 */
export function createComputed<T>(computation: () => T): () => T {
  const computed = new ComputedImpl(computation);
  return () => computed.get();
}

/**
 * Create a computed signal (object API for internal use)
 */
export function createComputedObject<T>(computation: () => T): Computed<T> {
  return new ComputedImpl(computation);
}

/**
 * Create a reactive effect
 * @returns Dispose function
 */
export function createEffect(effectFn: () => void | Cleanup): () => void {
  const effect = new EffectImpl(effectFn);
  return () => effect.dispose();
}

/**
 * Batch multiple updates to prevent intermediate notifications
 */
export function batch(fn: () => void): void {
  batchDepth++;
  if (batchDepth === 1) {
    batchQueue = new Set();
  }

  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0 && batchQueue) {
      const queue = batchQueue;
      batchQueue = null;
      for (const notify of queue) {
        notify();
      }
    }
  }
}

/**
 * Run a function without tracking dependencies
 */
export function untrack<T>(fn: () => T): T {
  const previousComputed = currentComputed;
  const previousEffect = currentEffect;
  currentComputed = null;
  currentEffect = null;

  try {
    return fn();
  } finally {
    currentComputed = previousComputed;
    currentEffect = previousEffect;
  }
}

// ============================================================================
// React Integration Hooks
// ============================================================================

import { useState, useEffect, useRef, useMemo } from "react";

/**
 * React hook to use a signal in a component
 */
export function useSignal<T>(initialValue: T): Signal<T> {
  const [, forceUpdate] = useState({});
  const signalRef = useRef<Signal<T>>();

  if (!signalRef.current) {
    signalRef.current = createSignal(initialValue);
  }

  useEffect(() => {
    // Subscribe to signal changes and trigger re-render
    return signalRef.current!.subscribe(() => {
      forceUpdate({});
    });
  }, []);

  return signalRef.current;
}

/**
 * React hook to use a computed value
 */
export function useComputed<T>(computation: () => T): T {
  const [, forceUpdate] = useState({});
  const computedRef = useRef<Computed<T>>();

  if (!computedRef.current) {
    computedRef.current = createComputed(computation);
  }

  useEffect(() => {
    return computedRef.current!.subscribe(() => {
      forceUpdate({});
    });
  }, []);

  return computedRef.current.get();
}

/**
 * React hook for reactive effects
 */
export function useReactiveEffect(effectFn: () => void | Cleanup): void {
  const effectRef = useRef<() => void>();

  useEffect(() => {
    effectRef.current = createEffect(effectFn);
    return () => effectRef.current?.();
  }, [effectFn]);
}
