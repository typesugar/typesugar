/**
 * Lazy iterator pipeline with single-pass fusion
 *
 * Collects chained operations (.map, .filter, .flatMap, etc.) and
 * executes them in a single pass over the source when a terminal
 * operation is called. No intermediate arrays are allocated.
 */

import type { PipelineStep } from "./types.js";

/**
 * A lazy, fused iterator pipeline.
 *
 * Chain operations build up an IR of steps. Terminal operations
 * (`toArray`, `reduce`, `find`, etc.) fuse the steps and iterate
 * the source exactly once.
 *
 * @example
 * ```typescript
 * const result = new LazyPipeline([1, 2, 3, 4, 5])
 *   .filter(x => x % 2 === 0)
 *   .map(x => x * 10)
 *   .toArray(); // [20, 40] — single pass, no intermediate arrays
 * ```
 */
export class LazyPipeline<T> {
  private readonly source: Iterable<unknown>;
  private readonly steps: PipelineStep[];

  constructor(source: Iterable<T>, steps?: PipelineStep[]) {
    this.source = source as Iterable<unknown>;
    this.steps = steps ?? [];
  }

  private chain(step: PipelineStep): LazyPipeline<any> {
    return new LazyPipeline<any>(this.source, [...this.steps, step]);
  }

  /** Transform each element */
  map<U>(f: (value: T) => U): LazyPipeline<U> {
    return this.chain({ type: "map", f });
  }

  /** Keep only elements that satisfy the predicate */
  filter(predicate: (value: T) => boolean): LazyPipeline<T> {
    return this.chain({ type: "filter", predicate });
  }

  /** Map each element to an iterable and flatten */
  flatMap<U>(f: (value: T) => Iterable<U>): LazyPipeline<U> {
    return this.chain({ type: "flatMap", f });
  }

  /** Take the first `count` elements */
  take(count: number): LazyPipeline<T> {
    return this.chain({ type: "take", count });
  }

  /** Skip the first `count` elements */
  drop(count: number): LazyPipeline<T> {
    return this.chain({ type: "drop", count });
  }

  /** Take elements while predicate holds, stop at first failure */
  takeWhile(predicate: (value: T) => boolean): LazyPipeline<T> {
    return this.chain({ type: "takeWhile", predicate });
  }

  /** Skip elements while predicate holds, emit once it fails */
  dropWhile(predicate: (value: T) => boolean): LazyPipeline<T> {
    return this.chain({ type: "dropWhile", predicate });
  }

  // ---------------------------------------------------------------------------
  // Terminal operations — these drive the single-pass execution
  // ---------------------------------------------------------------------------

  /** Collect all results into an array */
  toArray(): T[] {
    const result: T[] = [];
    for (const value of this.execute()) {
      result.push(value);
    }
    return result;
  }

  /** Fold elements left-to-right into a single value */
  reduce<Acc>(f: (acc: Acc, value: T) => Acc, init: Acc): Acc {
    let acc = init;
    for (const value of this.execute()) {
      acc = f(acc, value);
    }
    return acc;
  }

  /** Find the first element matching the predicate */
  find(predicate: (value: T) => boolean): T | null {
    for (const value of this.execute()) {
      if (predicate(value)) return value;
    }
    return null;
  }

  /** True if any element satisfies the predicate */
  some(predicate: (value: T) => boolean): boolean {
    for (const value of this.execute()) {
      if (predicate(value)) return true;
    }
    return false;
  }

  /** True if all elements satisfy the predicate */
  every(predicate: (value: T) => boolean): boolean {
    for (const value of this.execute()) {
      if (!predicate(value)) return false;
    }
    return true;
  }

  /** Count the number of elements */
  count(): number {
    let n = 0;
    for (const _value of this.execute()) {
      n++;
    }
    return n;
  }

  /** Execute a side effect for each element */
  forEach(f: (value: T) => void): void {
    for (const value of this.execute()) {
      f(value);
    }
  }

  /** First element, or null if empty */
  first(): T | null {
    for (const value of this.execute()) {
      return value;
    }
    return null;
  }

  /** Last element, or null if empty */
  last(): T | null {
    let result: T | null = null;
    for (const value of this.execute()) {
      result = value;
    }
    return result;
  }

  /** Collect into a Map using key/value extractors */
  toMap<K, V>(keyFn: (value: T) => K, valueFn: (value: T) => V): Map<K, V> {
    const map = new Map<K, V>();
    for (const value of this.execute()) {
      map.set(keyFn(value), valueFn(value));
    }
    return map;
  }

  /** Group elements by a key function */
  groupBy<K>(keyFn: (value: T) => K): Map<K, T[]> {
    const groups = new Map<K, T[]>();
    for (const value of this.execute()) {
      const key = keyFn(value);
      const group = groups.get(key);
      if (group) {
        group.push(value);
      } else {
        groups.set(key, [value]);
      }
    }
    return groups;
  }

  /** Minimum element (uses optional comparator, defaults to < ) */
  min(compare?: (a: T, b: T) => number): T | null {
    const cmp =
      compare ?? ((a: T, b: T) => ((a as any) < (b as any) ? -1 : (a as any) > (b as any) ? 1 : 0));
    let result: T | null = null;
    let first = true;
    for (const value of this.execute()) {
      if (first) {
        result = value;
        first = false;
      } else if (cmp(value, result!) < 0) {
        result = value;
      }
    }
    return result;
  }

  /** Maximum element (uses optional comparator, defaults to > ) */
  max(compare?: (a: T, b: T) => number): T | null {
    const cmp =
      compare ?? ((a: T, b: T) => ((a as any) < (b as any) ? -1 : (a as any) > (b as any) ? 1 : 0));
    let result: T | null = null;
    let first = true;
    for (const value of this.execute()) {
      if (first) {
        result = value;
        first = false;
      } else if (cmp(value, result!) > 0) {
        result = value;
      }
    }
    return result;
  }

  /** Sum of numeric elements */
  sum(this: LazyPipeline<number>): number {
    let total = 0;
    for (const value of this.execute()) {
      total += value;
    }
    return total;
  }

  /** Join string elements with a separator */
  join(this: LazyPipeline<string>, separator: string = ","): string {
    let result = "";
    let first = true;
    for (const value of this.execute()) {
      if (first) {
        result = value;
        first = false;
      } else {
        result += separator + value;
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Execution engine — single-pass, fused iteration
  // ---------------------------------------------------------------------------

  /**
   * Core execution generator. Iterates the source once, applying all
   * accumulated steps to each element inline. Steps that can short-circuit
   * (take, takeWhile) terminate the generator early.
   */
  private *execute(): Generator<T> {
    // Pre-compute per-step mutable state
    const steps = this.steps;
    const len = steps.length;
    const dropCounters = new Array<number>(len);
    const takeCounters = new Array<number>(len);
    const dropWhilePassed = new Array<boolean>(len);

    for (let i = 0; i < len; i++) {
      const step = steps[i];
      if (step.type === "drop") dropCounters[i] = step.count;
      if (step.type === "take") takeCounters[i] = step.count;
      if (step.type === "dropWhile") dropWhilePassed[i] = false;
    }

    for (const raw of this.source) {
      // Process a single value through the pipeline. FlatMap can produce
      // multiple values, so we use a stack of pending items.
      const pending: unknown[] = [raw];
      // Track which step each pending item starts at
      const pendingStepIdx: number[] = [0];

      while (pending.length > 0) {
        let value: unknown = pending.pop()!;
        let startStep = pendingStepIdx.pop()!;
        let skip = false;

        for (let i = startStep; i < len; i++) {
          const step = steps[i];
          switch (step.type) {
            case "map":
              value = step.f(value);
              break;

            case "filter":
              if (!step.predicate(value)) {
                skip = true;
              }
              break;

            case "flatMap": {
              // Push sub-items in reverse order so first comes out first
              const items: unknown[] = [];
              for (const item of step.f(value)) {
                items.push(item);
              }
              for (let j = items.length - 1; j >= 0; j--) {
                pending.push(items[j]);
                pendingStepIdx.push(i + 1);
              }
              skip = true;
              break;
            }

            case "take":
              if (takeCounters[i] <= 0) {
                // We've already taken enough — stop entirely
                return;
              }
              takeCounters[i]--;
              break;

            case "drop":
              if (dropCounters[i] > 0) {
                dropCounters[i]--;
                skip = true;
              }
              break;

            case "takeWhile":
              if (!step.predicate(value)) {
                return;
              }
              break;

            case "dropWhile":
              if (!dropWhilePassed[i]) {
                if (step.predicate(value)) {
                  skip = true;
                } else {
                  dropWhilePassed[i] = true;
                }
              }
              break;
          }

          if (skip) break;
        }

        if (!skip) {
          yield value as T;

          // Check if any take counter just hit zero — if so, we're done
          for (let i = 0; i < len; i++) {
            if (steps[i].type === "take" && takeCounters[i] <= 0) {
              return;
            }
          }
        }
      }
    }
  }
}
