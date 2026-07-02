/**
 * @typesugar/effect — runtime entry (PEP-050 Case-1 split).
 *
 * Deep Effect-TS integration with typesugar's typeclass system.
 *
 * This `.` entry is **runtime-only** and does NOT import `typescript`. It exposes:
 * - the runtime placeholders that the `@service`, `@layer`, `resolveLayer<R>()`,
 *   `@compiled`/`compileGen()`, `@fused`/`fusePipeline()` and
 *   `specializeSchema()` macros replace at compile time (they throw / no-op if the
 *   transformer didn't run),
 * - the `@derive` tokens (`EffectSchema`, `EffectEqual`, `EffectHash`),
 * - the Effect typeclass instances, extension namespaces, testing utilities and
 *   diagnostics, and
 * - the `FlatMap` instance for Effect (registered as a runtime side effect) that
 *   powers @typesugar/std's generic `let:/yield:` do-notation.
 *
 * The macro *definitions* (which import `typescript`) live in the `./macros`
 * entry, loaded by the transformer at build time. See PEP-050.
 *
 * @module
 */

import { registerFlatMap } from "@typesugar/std/typeclasses/flatmap";

// ============================================================================
// Runtime Placeholders (replaced by the macros at compile time)
// ============================================================================

/**
 * Runtime placeholder for the `@service` decorator.
 * No-op that signals to the macro system; transformed away at compile time.
 */
export function service<T>(_target: T): T {
  return _target;
}

/**
 * Runtime placeholder for the `@layer` decorator factory.
 * Returns a no-op decorator; transformed away at compile time.
 */
export function layer<S>(_service: S, _options?: { requires?: unknown[] }): <T>(target: T) => T {
  return (target) => target;
}

/**
 * Runtime placeholder for `resolveLayer<R>()`. Should be transformed at compile time.
 */
export function resolveLayer<R>(_options?: { debug?: boolean }): never {
  void _options;
  throw new Error(
    "resolveLayer<R>() was not transformed at compile time. " +
      "Make sure @typesugar/effect is registered with the transformer."
  );
}

/**
 * Runtime placeholder for `layerMake<R>(...)`. Should be transformed at compile time.
 */
export function layerMake<R>(...args: unknown[]): never {
  void args;
  throw new Error(
    "layerMake<R>() was not transformed at compile time. " +
      "Make sure @typesugar/effect is registered with the transformer."
  );
}

/**
 * Runtime placeholder for `compileGen()`.
 * Replaced at compile time with the transformed expression.
 */
export function compileGen<A, E, R>(
  _effect: import("effect").Effect.Effect<A, E, R>
): import("effect").Effect.Effect<A, E, R> {
  throw new Error(
    "compileGen() requires the typesugar transformer. Configure it in your build tool."
  );
}

/**
 * Decorator placeholder for `@compiled`.
 * Replaced at compile time with the transformed declaration.
 */
export function compiled<T>(
  target: T,
  _context?: ClassDecoratorContext | ClassMethodDecoratorContext | ClassFieldDecoratorContext
): T {
  console.warn("@compiled decorator requires the typesugar transformer.");
  return target;
}

/**
 * Runtime placeholder for `fusePipeline()`.
 */
export function fusePipeline<A, E, R>(
  _effect: import("effect").Effect.Effect<A, E, R>
): import("effect").Effect.Effect<A, E, R> {
  throw new Error(
    "fusePipeline() requires the typesugar transformer. Configure it in your build tool."
  );
}

/**
 * Decorator placeholder for `@fused`.
 */
export function fused<T>(
  target: T,
  _context?: ClassDecoratorContext | ClassMethodDecoratorContext | ClassFieldDecoratorContext
): T {
  console.warn("@fused decorator requires the typesugar transformer.");
  return target;
}

/**
 * Runtime placeholder for `specializeSchema()`.
 * Throws at runtime — this call should be compiled away by the transformer.
 */
export function specializeSchema<A, I, R>(
  _schema: import("effect").Schema.Schema<A, I, R>
): (input: unknown) => A {
  throw new Error(
    "specializeSchema() is a compile-time macro and requires the typesugar transformer. " +
      "See: https://github.com/dpovey/typesugar#setup"
  );
}

/**
 * Runtime placeholder for `specializeSchemaUnsafe()`.
 * Throws at runtime — this call should be compiled away by the transformer.
 */
export function specializeSchemaUnsafe<A, I, R>(
  _schema: import("effect").Schema.Schema<A, I, R>,
  _input: unknown
): A {
  throw new Error(
    "specializeSchemaUnsafe() is a compile-time macro and requires the typesugar transformer. " +
      "See: https://github.com/dpovey/typesugar#setup"
  );
}

/** Runtime placeholder token for `@derive(EffectSchema)`. */
export const EffectSchema = "EffectSchema";

/** Runtime placeholder token for `@derive(EffectEqual)`. */
export const EffectEqual = "EffectEqual";

/** Runtime placeholder token for `@derive(EffectHash)`. */
export const EffectHash = "EffectHash";

// ============================================================================
// Public types (erased at runtime)
// ============================================================================

export type { ServiceInfo, ServiceMethodInfo } from "./macros/service.js";
export type { LayerInfo } from "./macros/layer.js";
export type { ResolvedLayer, GraphResolution } from "./macros/layer-graph.js";

// ============================================================================
// HKT types for Effect
// ============================================================================

export {
  type EffectF,
  type ChunkF,
  type EffectOptionF,
  type EffectEitherF,
  type StreamF,
  type PureEffect,
  type FailableEffect,
  type EffectSuccess,
  type EffectError,
  type EffectRequirements,
} from "./hkt.js";

// ============================================================================
// Typeclass instances for Effect
// ============================================================================

export {
  // Effect.Effect instances
  effectFunctor,
  effectApply,
  effectApplicative,
  effectMonad,
  effectMonadError,
  // Chunk instances
  chunkFunctor,
  chunkFoldable,
  chunkTraverse,
  // Effect's Option instances
  effectOptionFunctor,
  effectOptionMonad,
  effectOptionMonadError,
  // Effect's Either instances
  effectEitherFunctor,
  effectEitherMonad,
  effectEitherMonadError,
  // All typeclass instances (auto-specialization candidates)
  effectInstances,
} from "./instances.js";

// ============================================================================
// Extension namespaces (import these to enable .method() syntax on Effect types)
// ============================================================================

export { EffectExt, OptionExt, EitherExt } from "./extensions.js";

// ============================================================================
// Diagnostics
// ============================================================================

export {
  EFFECT001,
  EFFECT002,
  EFFECT003,
  EFFECT010,
  EFFECT011,
  EFFECT020,
  EFFECT021,
  EFFECT030,
  EFFECT040,
  effectDiagnostics,
  getEffectDiagnostic,
  EffectDiagnosticBuilder,
  EffectDiagnosticCategory,
  formatEffectDiagnosticCLI,
  toTsDiagnostic,
  type EffectDiagnosticDescriptor,
  type EffectLabeledSpan,
  type EffectCodeSuggestion,
  type EffectRichDiagnostic,
} from "./diagnostics.js";

// ============================================================================
// Testing utilities
// ============================================================================

export {
  mockService,
  testLayer,
  combineLayers,
  succeedMock,
  failMock,
  dieMock,
  assertCalled,
  assertNotCalled,
  assertCalledTimes,
  type MockService,
  type MockMethodConfig,
  type TestLayerOptions,
} from "./testing.js";

// ============================================================================
// Effect FlatMap Instance (for @typesugar/std do-notation)
// ============================================================================

/**
 * FlatMap instance for Effect-TS.
 *
 * Delegates to Effect.map and Effect.flatMap from the Effect module.
 * This enables the generic `let:/yield:` syntax from @typesugar/std.
 *
 * Note: Effect is loaded lazily from the 'effect' peer dependency.
 * Ensure 'effect' is installed in your project.
 *
 * The instance is typed as `any` to work around HKT type complexity.
 * Runtime behavior is correct - Effect.map and Effect.flatMap are called
 * with the appropriate arguments.
 */
let _Effect: any;
function getEffectModule(): any {
  if (!_Effect) {
    try {
      _Effect = require("effect").Effect;
    } catch {
      throw new Error("Effect module not found. Install 'effect' as a dependency.");
    }
  }
  return _Effect;
}

export const flatMapEffect = {
  map: <A, B>(fa: unknown, f: (a: A) => B): unknown => {
    return getEffectModule().map(fa, f);
  },
  flatMap: <A, B>(fa: unknown, f: (a: A) => unknown): unknown => {
    return getEffectModule().flatMap(fa, f);
  },
};

// Register the FlatMap instance for Effect as a runtime side effect so the
// generic let:/yield: do-notation macro (@typesugar/std) can expand for Effect.
registerFlatMap("Effect", flatMapEffect);
