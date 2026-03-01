/**
 * @typesugar/effect
 *
 * Deep Effect-TS integration with typesugar's typeclass system.
 *
 * ## Core Features
 *
 * ### @service - Define Effect Services
 *
 * ```ts
 * @service
 * interface HttpClient {
 *   get(url: string): Effect.Effect<Response, HttpError>
 *   post(url: string, body: unknown): Effect.Effect<Response, HttpError>
 * }
 * // Generates: Context.Tag class + accessor functions namespace
 * ```
 *
 * ### @layer - Define Effect Layers
 *
 * ```ts
 * @layer(HttpClient)
 * const httpClientLive = {
 *   get: (url) => Effect.tryPromise(() => fetch(url)),
 *   post: (url, body) => Effect.tryPromise(() => fetch(url, { method: "POST", body: JSON.stringify(body) })),
 * }
 * // Generates: Layer.succeed(HttpClientTag, { ... })
 *
 * @layer(UserRepo, { requires: [Database] })
 * const userRepoLive =
 * let: {
 *   db << Database;
 * }
 * yield: ({ findById: (id) => db.query(...) })
 * // Generates: Layer.effect(UserRepoTag, ...)
 * // + registers dependency for automatic layer resolution
 * ```
 *
 * ### resolveLayer<R>() - Automatic Layer Composition
 *
 * Automatically resolve and compose layers to satisfy Effect requirements:
 *
 * ```ts
 * // Given registered layers:
 * @layer(Database) const databaseLive = { ... }
 * @layer(UserRepo, { requires: [Database] }) const userRepoLive = ...
 *
 * // Resolve all layers:
 * const program: Effect<void, Error, UserRepo> = ...
 * const runnable = program.pipe(Effect.provide(resolveLayer<UserRepo>()))
 * // Generates: Layer.merge(userRepoLive.pipe(Layer.provide(databaseLive)))
 * ```
 *
 * ### Extension Methods
 *
 * Import `EffectExt` to enable fluent method chaining on Effect types:
 *
 * ```ts
 * import { EffectExt } from "@typesugar/effect";
 *
 * // The transformer rewrites .method() calls to direct function calls
 * effect.map(x => x + 1)  // → EffectExt.map(effect, x => x + 1)
 *
 * // Chain operations fluently:
 * effect
 *   .map(x => x + 1)
 *   .flatMap(x => Effect.succeed(x * 2))
 *   .tap(x => Effect.log(`Got: ${x}`))
 * ```
 *
 * Also available: `OptionExt`, `EitherExt` for Effect's Option and Either types.
 *
 * ### @derive Macros
 *
 * Automatically generate Effect Schema, Equal, and Hash implementations:
 *
 * ```ts
 * @derive(EffectSchema)
 * interface User { id: string; name: string; age: number; }
 * // Generates: export const UserSchema = Schema.Struct({ ... })
 *
 * @derive(EffectEqual)
 * interface Point { x: number; y: number; }
 * // Generates: export const PointEqual: Equal.Equal<Point> = { ... }
 *
 * @derive(EffectHash)
 * interface Point { x: number; y: number; }
 * // Generates: export const PointHash: Hash.Hash<Point> = { ... }
 * ```
 *
 * ## Do-Notation (via @typesugar/std)
 *
 * The `let:/yield:` syntax is provided by @typesugar/std's generic do-notation macro.
 * This package registers a `FlatMap` instance for Effect that enables this syntax:
 *
 * ```ts
 * import "@typesugar/effect"; // Registers FlatMap instance for Effect
 *
 * // Labeled block syntax (compiles to Effect.flatMap chain)
 * let: {
 *   user << getUserById(id)
 *   posts << getPostsForUser(user.id)
 * }
 * yield: { user, posts }
 *
 * // Compiles to:
 * Effect.flatMap(getUserById(id), (user) =>
 *   Effect.flatMap(getPostsForUser(user.id), (posts) =>
 *     Effect.succeed({ user, posts })
 *   )
 * );
 * ```
 *
 * @module
 */

import { globalRegistry } from "@typesugar/core";
import { registerFlatMap } from "@typesugar/std/typeclasses/flatmap";

// Import @service and @layer macros
import {
  serviceAttribute,
  service,
  serviceRegistry,
  registerService,
  getService,
  type ServiceInfo,
  type ServiceMethodInfo,
} from "./macros/service.js";

import {
  layerAttribute,
  layer,
  layerRegistry,
  registerLayer,
  getLayer,
  getLayersForService,
  type LayerInfo,
} from "./macros/layer.js";

import { resolveLayerMacro, resolveLayer } from "./macros/resolve-layer.js";

// Import @compiled and compileGen macros
import {
  compiledAttribute,
  compileGenExpression,
  compileGen,
  compiled,
} from "./macros/compiled.js";

// Import @fused and fusePipeline macros
import {
  fusedAttribute,
  fusePipelineExpression,
  fusePipeline,
  fused,
} from "./macros/fused.js";

// Import schema specialization macros
import {
  specializeSchemaExpression,
  specializeSchemaUnsafeExpression,
  specializeSchema,
  specializeSchemaUnsafe,
} from "./macros/schema-specialize.js";

// Import derive macros
import {
  EffectSchemaDerive,
  EffectSchema,
  EffectEqualDerive,
  EffectEqual,
  EffectHashDerive,
  EffectHash,
} from "./derive/index.js";

// Import diagnostics
import {
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

// Import testing utilities
import {
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

// Import extension namespaces
import { EffectExt, OptionExt, EitherExt } from "./extensions.js";

// Re-export macros and registries
export {
  // @service macro
  serviceAttribute,
  service,
  serviceRegistry,
  registerService,
  getService,
  type ServiceInfo,
  type ServiceMethodInfo,
  // @layer macro
  layerAttribute,
  layer,
  layerRegistry,
  registerLayer,
  getLayer,
  getLayersForService,
  type LayerInfo,
  // resolveLayer<R>() macro
  resolveLayerMacro,
  resolveLayer,
  // @compiled and compileGen() macros
  compiledAttribute,
  compileGenExpression,
  compileGen,
  compiled,
  // @fused and fusePipeline() macros
  fusedAttribute,
  fusePipelineExpression,
  fusePipeline,
  fused,
  // Schema specialization macros
  specializeSchemaExpression,
  specializeSchemaUnsafeExpression,
  specializeSchema,
  specializeSchemaUnsafe,
  // @derive macros
  EffectSchemaDerive,
  EffectSchema,
  EffectEqualDerive,
  EffectEqual,
  EffectHashDerive,
  EffectHash,
  // Extension namespaces (import these to enable .method() syntax on Effect types)
  EffectExt,
  OptionExt,
  EitherExt,
  // Diagnostics
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
  // Testing utilities
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
};

// HKT types for Effect
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

// Typeclass instances for Effect
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
  // All instances for specialize()
  effectInstances,
} from "./instances.js";

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
      throw new Error(
        "Effect module not found. Install 'effect' as a dependency."
      );
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

// ============================================================================
// Registration
// ============================================================================

/**
 * Register all Effect adapter macros with the global registry.
 */
export function register(): void {
  // Register FlatMap instance for Effect (enables let:/yield: from @typesugar/std)
  registerFlatMap("Effect", flatMapEffect);

  // Register @service and @layer attribute macros
  globalRegistry.register(serviceAttribute);
  globalRegistry.register(layerAttribute);

  // Register resolveLayer<R>() expression macro
  globalRegistry.register(resolveLayerMacro);

  // Register @compiled attribute and compileGen() expression macros
  globalRegistry.register(compiledAttribute);
  globalRegistry.register(compileGenExpression);

  // Register @fused attribute and fusePipeline() expression macros
  globalRegistry.register(fusedAttribute);
  globalRegistry.register(fusePipelineExpression);

  // Register schema specialization expression macros
  globalRegistry.register(specializeSchemaExpression);
  globalRegistry.register(specializeSchemaUnsafeExpression);

  // Register @derive macros for Effect Schema, Equal, Hash
  globalRegistry.register(EffectSchemaDerive);
  globalRegistry.register(EffectEqualDerive);
  globalRegistry.register(EffectHashDerive);
}

// Auto-register on import
register();
