/**
 * @typesugar/effect Showcase
 *
 * Self-documenting examples of deep Effect-TS integration with typesugar's
 * typeclass system: @service, @layer, resolveLayer, derives, HKT types,
 * typeclass instances, extension methods, and FlatMap do-notation.
 *
 * Type assertions used:
 *   typeAssert<Equal<A, B>>()        - A and B are the same type
 *   typeAssert<Extends<A, B>>()      - A is assignable to B
 *   typeAssert<Not<Equal<A, B>>>()   - A and B are DIFFERENT
 *   typeAssert<Not<Extends<A, B>>>() - A is NOT assignable to B
 *
 * Run:   typesugar run examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import { assert, typeAssert, type Equal, type Extends, type Not } from "@typesugar/testing";

import {
  // @service macro
  serviceRegistry,
  registerService,
  getService,
  type ServiceInfo,
  type ServiceMethodInfo,

  // @layer macro
  layerRegistry,
  registerLayer,
  getLayer,
  getLayersForService,
  type LayerInfo,

  // resolveLayer macro
  resolveLayer,

  // @derive macros
  EffectSchema,
  EffectEqual,
  EffectHash,

  // Extension namespaces
  EffectExt,
  OptionExt,
  EitherExt,

  // HKT types
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

  // Typeclass instances
  effectFunctor,
  effectApply,
  effectApplicative,
  effectMonad,
  effectMonadError,
  chunkFunctor,
  chunkFoldable,
  chunkTraverse,
  effectOptionFunctor,
  effectOptionMonad,
  effectOptionMonadError,
  effectEitherFunctor,
  effectEitherMonad,
  effectEitherMonadError,
  effectInstances,

  // FlatMap registration
  flatMapEffect,
  register,
} from "../src/index.js";

import type { Effect, Chunk, Option, Either, Stream } from "effect";
import type { $ } from "@typesugar/type-system";

// ============================================================================
// 1. SERVICE REGISTRY — Define and Register Effect Services
// ============================================================================

// The @service macro generates Context.Tag + accessor functions.
// At the registry level, services are tracked with their method signatures.

const httpClientInfo: ServiceInfo = {
  name: "HttpClient",
  methods: [
    { name: "get", paramTypes: ["string"], returnType: "Effect<Response, HttpError>" },
    { name: "post", paramTypes: ["string", "unknown"], returnType: "Effect<Response, HttpError>" },
  ],
};

registerService(httpClientInfo);
const retrieved = getService("HttpClient");
assert(retrieved !== undefined, "Service should be registered");
assert(retrieved!.name === "HttpClient");
assert(retrieved!.methods.length === 2);
assert(retrieved!.methods[0].name === "get");

// Type-level: ServiceInfo shape
typeAssert<Extends<ServiceInfo, { name: string; methods: ServiceMethodInfo[] }>>();

// ============================================================================
// 2. LAYER REGISTRY — Define and Compose Effect Layers
// ============================================================================

// The @layer macro generates Layer.succeed or Layer.effect for services.
// Layers can declare dependencies on other services.

const dbLayerInfo: LayerInfo = {
  name: "databaseLive",
  serviceName: "Database",
  requires: [],
};

const userRepoLayerInfo: LayerInfo = {
  name: "userRepoLive",
  serviceName: "UserRepo",
  requires: ["Database"],
};

registerLayer(dbLayerInfo);
registerLayer(userRepoLayerInfo);

assert(getLayer("databaseLive") !== undefined, "DB layer should be registered");
assert(getLayer("userRepoLive") !== undefined, "UserRepo layer should be registered");

const userRepoLayers = getLayersForService("UserRepo");
assert(userRepoLayers.length === 1);
assert(userRepoLayers[0].requires.includes("Database"));

// ============================================================================
// 3. HKT TYPES — Type-Level Functions for Effect Types
// ============================================================================

// EffectF<E, R> fixes the error and requirements, varying only the success type.
// $<EffectF<never, never>, number> = Effect<number, never, never>

type PureNum = $<EffectF<never, never>, number>;
typeAssert<Equal<PureNum, Effect.Effect<number, never, never>>>();

type HttpResult = $<EffectF<Error, never>, string>;
typeAssert<Equal<HttpResult, Effect.Effect<string, Error, never>>>();

// ChunkF is a single-parameter type-level function
type NumberChunk = $<ChunkF, number>;
typeAssert<Equal<NumberChunk, Chunk.Chunk<number>>>();

// EffectOptionF wraps Effect's Option
type MaybeString = $<EffectOptionF, string>;
typeAssert<Equal<MaybeString, Option.Option<string>>>();

// EffectEitherF<E> fixes the error type
type StringResult = $<EffectEitherF<string>, number>;
typeAssert<Equal<StringResult, Either.Either<number, string>>>();

// StreamF<E, R> for streaming
type EventStream = $<StreamF<Error, never>, string>;
typeAssert<Equal<EventStream, Stream.Stream<string, Error, never>>>();

// ============================================================================
// 4. TYPE ALIASES — Common Effect Patterns
// ============================================================================

// PureEffect<A> = Effect<A, never, never> — no errors, no requirements
typeAssert<Equal<PureEffect<number>, Effect.Effect<number, never, never>>>();

// FailableEffect<A, E> = Effect<A, E, never> — can fail, no requirements
typeAssert<Equal<FailableEffect<string, Error>, Effect.Effect<string, Error, never>>>();

// Extract success, error, and requirements types from an Effect
type TestEffect = Effect.Effect<string, Error, never>;
typeAssert<Equal<EffectSuccess<TestEffect>, string>>();
typeAssert<Equal<EffectError<TestEffect>, Error>>();
typeAssert<Equal<EffectRequirements<TestEffect>, never>>();

// ============================================================================
// 5. TYPECLASS INSTANCES — Functor, Applicative, Monad for Effect
// ============================================================================

// Effect.Effect instances are parameterized by E and R.
// effectFunctor<E, R>() returns a Functor for Effect<_, E, R>.

const functor = effectFunctor<never, never>();
assert(typeof functor.map === "function", "Functor should have map");

const apply = effectApply<never, never>();
assert(typeof apply.map === "function", "Apply should have map");
assert(typeof apply.ap === "function", "Apply should have ap");

const applicative = effectApplicative<never, never>();
assert(typeof applicative.pure === "function", "Applicative should have pure");

const monad = effectMonad<never, never>();
assert(typeof monad.flatMap === "function", "Monad should have flatMap");

const monadError = effectMonadError<never, never>();
assert(typeof monadError.handleError === "function", "MonadError should have handleError");

// Chunk instances
assert(typeof chunkFunctor.map === "function", "Chunk Functor should have map");
assert(typeof chunkFoldable.foldLeft === "function", "Chunk Foldable should have foldLeft");
assert(typeof chunkTraverse.traverse === "function", "Chunk Traverse should have traverse");

// Option instances
const optFunctor = effectOptionFunctor;
assert(typeof optFunctor.map === "function");
const optMonad = effectOptionMonad;
assert(typeof optMonad.flatMap === "function");

// Either instances
const eitherFunctor = effectEitherFunctor<string>();
assert(typeof eitherFunctor.map === "function");
const eitherMonad = effectEitherMonad<string>();
assert(typeof eitherMonad.flatMap === "function");

// effectInstances bundles all instances for specialize()
assert(typeof effectInstances === "object", "effectInstances should be an object");

// ============================================================================
// 6. EXTENSION METHODS — Fluent Chaining on Effect Types
// ============================================================================

// EffectExt provides standalone functions that the transformer rewrites
// from method calls: effect.map(f) → EffectExt.map(effect, f)

assert(typeof EffectExt.map === "function", "EffectExt should have map");
assert(typeof EffectExt.flatMap === "function", "EffectExt should have flatMap");
assert(typeof EffectExt.tap === "function", "EffectExt should have tap");

// OptionExt for Effect's Option type
assert(typeof OptionExt.map === "function", "OptionExt should have map");
assert(typeof OptionExt.flatMap === "function", "OptionExt should have flatMap");

// EitherExt for Effect's Either type
assert(typeof EitherExt.map === "function", "EitherExt should have map");
assert(typeof EitherExt.flatMap === "function", "EitherExt should have flatMap");

// ============================================================================
// 7. FLATMAP INSTANCE — Do-Notation via @typesugar/std
// ============================================================================

// flatMapEffect registers with @typesugar/std's FlatMap system,
// enabling let:/yield: syntax for Effect types.

assert(typeof flatMapEffect.map === "function", "flatMapEffect should have map");
assert(typeof flatMapEffect.flatMap === "function", "flatMapEffect should have flatMap");

// ============================================================================
// 8. DERIVE MACROS — Auto-Generate Effect Schema, Equal, Hash
// ============================================================================

// @derive(EffectSchema) generates Schema.Struct for a type
// @derive(EffectEqual) generates Equal.equals for a type
// @derive(EffectHash) generates Hash.hash for a type

// These are macro markers — they exist as values for the @derive decorator
assert(EffectSchema !== undefined, "EffectSchema derive marker should exist");
assert(EffectEqual !== undefined, "EffectEqual derive marker should exist");
assert(EffectHash !== undefined, "EffectHash derive marker should exist");

// In real usage:
// @derive(EffectSchema)
// interface User { id: string; name: string; age: number; }
// → Generates: export const UserSchema = Schema.Struct({
//     id: Schema.String, name: Schema.String, age: Schema.Number
//   })

// ============================================================================
// 9. REGISTRATION — Auto-Registration on Import
// ============================================================================

// The register() function is called automatically when you import @typesugar/effect.
// It registers: FlatMap instance, @service, @layer, resolveLayer, and @derive macros.

assert(typeof register === "function", "register function should be exported");

// Calling register() again is idempotent
register();

// ============================================================================
// 10. REAL-WORLD PATTERN — Service + Layer + Resolve
// ============================================================================

// In a real Effect-TS application, you'd use these macros together:
//
// @service
// interface Logger {
//   info(msg: string): Effect<void>
//   error(msg: string, cause: Error): Effect<void>
// }
//
// @service
// interface UserRepo {
//   findById(id: string): Effect<User | null, DbError>
//   save(user: User): Effect<void, DbError>
// }
//
// @layer(Logger)
// const loggerLive = {
//   info: (msg) => Effect.log(msg),
//   error: (msg, cause) => Effect.logError(msg, cause),
// };
//
// @layer(UserRepo, { requires: [Logger, Database] })
// const userRepoLive = ...
//
// // Automatic layer composition:
// const program: Effect<void, DbError, UserRepo> = ...
// const runnable = program.pipe(Effect.provide(resolveLayer<UserRepo>()))
// // → Automatically provides userRepoLive + loggerLive + databaseLive

console.log("@typesugar/effect showcase: all assertions passed!");
