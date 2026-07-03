/**
 * FlatMap Typeclass
 *
 * Provides sequencing/chaining operations for type constructors.
 * This is the minimal typeclass required for do-notation (`let:/yield:`).
 *
 * Unlike Monad, FlatMap doesn't require `pure`/`of` — it only needs
 * `map` and `flatMap`. This makes it usable with types that support
 * chaining but don't have a natural way to lift pure values.
 *
 * ## Instances
 *
 * Built-in instances are provided for:
 * - Array<A> — flatMap is Array.prototype.flatMap
 * - Promise<A> — flatMap is Promise.prototype.then
 * - Iterable<A> — lazy flatMap via generator functions
 * - AsyncIterable<A> — async lazy flatMap via async generators
 *
 * ## Usage with let:/yield:
 *
 * ```typescript
 * // With Array
 * let: {
 *   x << [1, 2, 3]
 *   y << [x * 10, x * 20]
 * }
 * yield: ({ x, y })
 * // → [{ x: 1, y: 10 }, { x: 1, y: 20 }, { x: 2, y: 20 }, ...]
 *
 * // With Promise
 * let: {
 *   user << fetchUser(id)
 *   posts << fetchPosts(user.id)
 * }
 * yield: ({ user, posts })
 * // → Promise<{ user, posts }>
 * ```
 */

import { createGenericRegistry, type GenericRegistry } from "@typesugar/core";
import { registerInstanceWithMeta, hasFlatMapInstance, type InstanceMeta } from "@typesugar/macros";

// ============================================================================
// FlatMap Typeclass + Built-in Instances
// ============================================================================
// Moved to the runtime-only twin `flatmap-instances.ts` (PEP-050 Case-1 /
// PEP-052 Wave 3) so the `@typesugar/std/syntax/do` activation marker can
// re-export the instances without pulling this module's compile-time registry
// (and its `typescript` dependency) into user runtime bundles. Re-exported
// here for back-compat.

export type { FlatMap } from "./flatmap-instances.js";
export {
  flatMapArray,
  flatMapPromise,
  flatMapIterable,
  flatMapAsyncIterable,
} from "./flatmap-instances.js";

import {
  flatMapArray,
  flatMapPromise,
  flatMapIterable,
  flatMapAsyncIterable,
  type FlatMap,
} from "./flatmap-instances.js";

// ============================================================================
// Instance Registry (for runtime lookup)
// ============================================================================

/**
 * Registry of FlatMap instances by type constructor name.
 * Used by the let:/yield: macro to resolve instances at compile time.
 *
 * Uses the generic Registry<K,V> abstraction from @typesugar/core with "replace"
 * duplicate strategy for backward compatibility (previously used warn + override).
 *
 * Module-private — use {@link registerFlatMap} and {@link getFlatMap} to access.
 */
const flatMapInstances: GenericRegistry<string, FlatMap<unknown>> = createGenericRegistry({
  name: "FlatMapRegistry",
  duplicateStrategy: "replace",
});

// Initialize built-in instances in local registry (for backward compat)
flatMapInstances.set("Array", flatMapArray as FlatMap<unknown>);
flatMapInstances.set("Promise", flatMapPromise as FlatMap<unknown>);
flatMapInstances.set("Iterable", flatMapIterable as FlatMap<unknown>);
flatMapInstances.set("AsyncIterable", flatMapAsyncIterable as FlatMap<unknown>);

// Also register in the unified typeclass registry
function registerInUnifiedRegistry(name: string, meta?: InstanceMeta): void {
  registerInstanceWithMeta({
    typeclassName: "FlatMap",
    forType: name,
    instanceName: `flatMap${name}`,
    derived: false,
    meta,
  });
}

// Register built-in instances in unified registry with method name overrides
registerInUnifiedRegistry("Array");
registerInUnifiedRegistry("Promise", {
  methodNames: { bind: "then", map: "then", orElse: "catch" },
});
registerInUnifiedRegistry("Iterable");
registerInUnifiedRegistry("AsyncIterable");

/**
 * Register a FlatMap instance for a type constructor.
 *
 * @param name The name of the type constructor (e.g., "Option", "Effect")
 * @param instance The FlatMap instance
 * @param meta Optional metadata (e.g., method name overrides)
 *
 * @deprecated Use @instance decorator or registerInstanceWithMeta() from @typesugar/macros
 * for new code. This function is maintained for backward compatibility.
 */
export function registerFlatMap<F>(name: string, instance: FlatMap<F>, meta?: InstanceMeta): void {
  if (flatMapInstances.has(name)) {
    console.warn(`[typesugar] FlatMap instance for '${name}' is already registered. Overriding.`);
  }
  flatMapInstances.set(name, instance as FlatMap<unknown>);
  // Also register in unified registry
  registerInUnifiedRegistry(name, meta);
}

/**
 * Get a FlatMap instance by type constructor name.
 *
 * @param name The name of the type constructor
 * @returns The FlatMap instance, or undefined if not found
 *
 * @deprecated Use hasFlatMapInstance("FlatMap", name) from @typesugar/macros for new code.
 * This function is maintained for backward compatibility.
 */
export function getFlatMap(name: string): FlatMap<unknown> | undefined {
  return flatMapInstances.get(name);
}

/**
 * Check if a FlatMap instance exists for a type constructor.
 * Uses the unified registry.
 */
export function hasFlatMap(name: string, sourceFileName?: string): boolean {
  return hasFlatMapInstance(name, sourceFileName);
}
