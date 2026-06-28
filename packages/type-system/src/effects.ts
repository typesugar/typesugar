/**
 * Effect System Annotations Macro
 *
 * Compile-time tracking of side effects. Functions are annotated with their
 * effects, and the macro enforces that pure functions don't call effectful
 * ones — catching side-effect violations at compile time.
 *
 * This is NOT a full algebraic effect system (like Koka or Effect-TS).
 * It's a lightweight annotation system that catches common mistakes:
 * - Pure functions accidentally calling I/O
 * - Sync functions accidentally calling async code
 * - Functions with undeclared side effects
 *
 * Inspired by:
 * - Java's checked exceptions
 * - Koka's effect system
 * - Rust's unsafe blocks
 * - Effect-TS's Effect<A, E, R> type
 *
 * ## How it works
 *
 * 1. Annotate functions with `@pure`, `@effect("io")`, `@effect("async")`, etc.
 * 2. The macro walks the call graph at compile time
 * 3. Reports errors when a @pure function calls an @effect function
 * 4. Tracks effect propagation (if A calls B which has effect "io", A also has "io")
 *
 * @example
 * ```typescript
 * @pure
 * function add(a: number, b: number): number {
 *   return a + b;  // OK: no effects
 * }
 *
 * @effect("io")
 * function readFile(path: string): string {
 *   return fs.readFileSync(path, "utf-8");
 * }
 *
 * @effect("async")
 * async function fetchData(url: string): Promise<string> {
 *   const res = await fetch(url);
 *   return res.text();
 * }
 *
 * @pure
 * function process(data: string): number {
 *   readFile("config.json");  // Compile error! Pure function calling @effect("io")
 *   return data.length;
 * }
 *
 * @effect("io", "async")
 * async function loadAndProcess(path: string): Promise<number> {
 *   const data = readFile(path);   // OK: we declared "io"
 *   const extra = await fetchData("http://example.com"); // OK: we declared "async"
 *   return add(data.length, extra.length);  // OK: pure functions are always callable
 * }
 * ```
 *
 * The `@pure` / `@effect` macro definitions live in the package's `./macros`
 * entry (loaded by the transformer at build time). This module is runtime-only
 * and does NOT import `typescript`; it exposes the effect registry + helpers
 * (`registerPure`, `registerEffect`, `checkEffectCall`) that those macros call.
 */

import { createGenericRegistry, type GenericRegistry } from "@typesugar/core";

// ============================================================================
// Effect Types
// ============================================================================

/**
 * Known effect kinds.
 */
export type EffectKind =
  | "io" // File system, network, database
  | "async" // Asynchronous operations
  | "random" // Non-deterministic (Math.random, crypto)
  | "time" // Time-dependent (Date.now, setTimeout)
  | "console" // Console output
  | "dom" // DOM manipulation
  | "state" // Mutable state
  | "throw" // May throw exceptions
  | "unsafe" // Unsafe operations (type assertions, etc.)
  | string; // Custom effects

/**
 * Effect annotation for a function.
 *
 * This is a plain data interface. Consumers who want Show/Eq instances
 * can use `@deriving(Show, Eq)` from `@typesugar/typeclass` on their own types.
 *
 * @example
 * ```typescript
 * import { deriving } from "@typesugar/typeclass";
 * import type { EffectAnnotation } from "@typesugar/type-system";
 *
 * // Create a type alias and derive instances
 * @deriving(Show, Eq)
 * interface MyEffectAnnotation extends EffectAnnotation {}
 * ```
 */
export interface EffectAnnotation {
  /** The function name */
  readonly name: string;

  /** Whether the function is pure (no effects) */
  readonly pure: boolean;

  /** The effects this function may perform */
  readonly effects: ReadonlySet<EffectKind>;

  /** Source location for error messages */
  readonly location?: string;
}

// ============================================================================
// Effect Registry (compile-time state)
// ============================================================================

/**
 * Global registry of effect annotations.
 * Populated by @pure and @effect decorators during compilation.
 *
 * Uses the generic Registry<K,V> abstraction from @typesugar/core with "replace"
 * duplicate strategy for idempotent registration.
 */
export const effectRegistry: GenericRegistry<string, EffectAnnotation> = createGenericRegistry({
  name: "EffectRegistry",
  duplicateStrategy: "replace",
});

/**
 * Register a pure function.
 */
export function registerPure(name: string, location?: string): void {
  effectRegistry.set(name, {
    name,
    pure: true,
    effects: new Set(),
    location,
  });
}

/**
 * Register an effectful function.
 */
export function registerEffect(name: string, effects: EffectKind[], location?: string): void {
  effectRegistry.set(name, {
    name,
    pure: false,
    effects: new Set(effects),
    location,
  });
}

/**
 * Check if calling `callee` from `caller` is valid.
 * Returns an error message if invalid, undefined if OK.
 */
export function checkEffectCall(caller: string, callee: string): string | undefined {
  const callerAnnotation = effectRegistry.get(caller);
  const calleeAnnotation = effectRegistry.get(callee);

  if (!callerAnnotation || !calleeAnnotation) {
    return undefined; // Unknown functions are allowed (open world assumption)
  }

  // Pure functions can't call effectful functions
  if (callerAnnotation.pure && !calleeAnnotation.pure) {
    const effects = Array.from(calleeAnnotation.effects).join(", ");
    return (
      `@pure function '${caller}' cannot call @effect("${effects}") function '${callee}'. ` +
      `Either remove @pure from '${caller}' or add @effect("${effects}") to it.`
    );
  }

  // Effectful functions must declare all effects of their callees
  if (!callerAnnotation.pure && !calleeAnnotation.pure) {
    const missingEffects: EffectKind[] = [];
    for (const effect of calleeAnnotation.effects) {
      if (!callerAnnotation.effects.has(effect)) {
        missingEffects.push(effect);
      }
    }

    if (missingEffects.length > 0) {
      return (
        `Function '${caller}' calls '${callee}' which has effects [${missingEffects.join(", ")}] ` +
        `not declared in '${caller}'. Add @effect("${missingEffects.join('", "')}") to '${caller}'.`
      );
    }
  }

  return undefined;
}

// ============================================================================
// Effect-Typed Function Wrappers
// ============================================================================

/**
 * Type-level effect tracking — encode effects in the return type.
 *
 * This provides an alternative to decorators: encode effects in the type
 * signature itself, similar to Effect-TS.
 */
export type Effectful<Effects extends string, T> = T & {
  readonly __effects__: Effects;
};

/**
 * A pure value — no effects.
 */
export type Pure<T> = Effectful<never, T>;

/**
 * IO effect — file system, network, database.
 */
export type IO<T> = Effectful<"io", T>;

/**
 * Async effect.
 */
export type Async<T> = Effectful<"async", T>;

/**
 * Extract effects from an effectful type.
 */
export type EffectsOf<T> = T extends Effectful<infer E, unknown> ? E : never;

/**
 * Check if a type has a specific effect.
 */
export type HasEffect<T, E extends string> = E extends EffectsOf<T> ? true : false;

/**
 * Combine effects from multiple types.
 */
export type CombineEffects<A, B> = Effectful<EffectsOf<A> | EffectsOf<B>, unknown>;

// ============================================================================
// Runtime Helpers
// ============================================================================

/**
 * Mark a value as pure (identity at runtime).
 */
export function pure<T>(value: T): Pure<T> {
  return value as Pure<T>;
}

/**
 * Mark a value as having IO effects (identity at runtime).
 */
export function io<T>(value: T): IO<T> {
  return value as IO<T>;
}

/**
 * Mark a value as async (identity at runtime).
 */
export function async_<T>(value: T): Async<T> {
  return value as Async<T>;
}

/**
 * Assert that a function is pure at runtime (no-op, for documentation).
 */
export function assertPure<T extends (...args: any[]) => any>(fn: T): T {
  return fn;
}
