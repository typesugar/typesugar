/**
 * Standalone Extension Methods for Effect Types
 *
 * These extension methods enable fluent method chaining on Effect types:
 *
 * ```ts
 * import { EffectExt } from "@typesugar/effect";
 *
 * // Instead of Effect.map(effect, f), you can write:
 * effect.map(f)  // → EffectExt.map(effect, f)
 *
 * // Chain operations fluently:
 * effect
 *   .map(x => x + 1)
 *   .flatMap(x => Effect.succeed(x * 2))
 *   .tap(x => Effect.log(`Got: ${x}`))
 *   .catchTag("NotFound", () => Effect.succeed(0))
 * ```
 *
 * The transformer rewrites these method calls to direct function calls,
 * making them zero-cost at runtime.
 *
 * @module
 */

import type { Effect, Option, Either, Cause, Schedule, Scope } from "effect";
import { Effect as E, Option as O, Either as Ei, pipe } from "effect";

/**
 * Extension methods for Effect.Effect<A, E, R>.
 *
 * Each method takes the effect as the first argument (the receiver)
 * and returns a new effect.
 */
export namespace EffectExt {
  // ==========================================================================
  // Mapping
  // ==========================================================================

  /**
   * Transform the success value of an effect.
   *
   * @example
   * effect.map(x => x + 1)  // → EffectExt.map(effect, x => x + 1)
   */
  export function map<A, E, R, B>(
    self: Effect.Effect<A, E, R>,
    f: (a: A) => B
  ): Effect.Effect<B, E, R> {
    return E.map(self, f);
  }

  /**
   * Transform the success value to a constant.
   *
   * @example
   * effect.as(42)  // → EffectExt.as(effect, 42)
   */
  export function as<A, E, R, B>(self: Effect.Effect<A, E, R>, value: B): Effect.Effect<B, E, R> {
    return E.as(self, value);
  }

  /**
   * Discard the success value, returning void.
   *
   * @example
   * effect.asVoid()  // → EffectExt.asVoid(effect)
   */
  export function asVoid<A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<void, E, R> {
    return E.asVoid(self);
  }

  // ==========================================================================
  // Sequencing (FlatMap)
  // ==========================================================================

  /**
   * Chain effects sequentially, passing the success value to the next effect.
   *
   * @example
   * effect.flatMap(x => Effect.succeed(x * 2))
   */
  export function flatMap<A, E, R, B, E2, R2>(
    self: Effect.Effect<A, E, R>,
    f: (a: A) => Effect.Effect<B, E2, R2>
  ): Effect.Effect<B, E | E2, R | R2> {
    return E.flatMap(self, f);
  }

  /**
   * Flatten a nested effect.
   *
   * @example
   * Effect.succeed(Effect.succeed(1)).flatten()  // → Effect<1>
   */
  export function flatten<A, E, R, E2, R2>(
    self: Effect.Effect<Effect.Effect<A, E2, R2>, E, R>
  ): Effect.Effect<A, E | E2, R | R2> {
    return E.flatten(self);
  }

  /**
   * Execute a side effect without changing the value.
   *
   * @example
   * effect.tap(x => Effect.log(`Got: ${x}`))
   */
  export function tap<A, E, R, E2, R2>(
    self: Effect.Effect<A, E, R>,
    f: (a: A) => Effect.Effect<unknown, E2, R2>
  ): Effect.Effect<A, E | E2, R | R2> {
    return E.tap(self, f);
  }

  /**
   * Execute a side effect on error without changing the error.
   *
   * @example
   * effect.tapError(e => Effect.log(`Error: ${e}`))
   */
  export function tapError<A, E, R, E2, R2>(
    self: Effect.Effect<A, E, R>,
    f: (e: E) => Effect.Effect<unknown, E2, R2>
  ): Effect.Effect<A, E | E2, R | R2> {
    return E.tapError(self, f);
  }

  /**
   * Execute side effects on both success and error.
   *
   * @example
   * effect.tapBoth({
   *   onSuccess: x => Effect.log(`Success: ${x}`),
   *   onFailure: e => Effect.log(`Error: ${e}`)
   * })
   */
  export function tapBoth<A, E, R, E2, R2, E3, R3>(
    self: Effect.Effect<A, E, R>,
    options: {
      readonly onSuccess: (a: A) => Effect.Effect<unknown, E2, R2>;
      readonly onFailure: (e: E) => Effect.Effect<unknown, E3, R3>;
    }
  ): Effect.Effect<A, E | E2 | E3, R | R2 | R3> {
    return E.tapBoth(self, options);
  }

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  /**
   * Catch all errors and recover with a new effect.
   *
   * @example
   * effect.catchAll(e => Effect.succeed(defaultValue))
   */
  export function catchAll<A, E, R, B, E2, R2>(
    self: Effect.Effect<A, E, R>,
    f: (e: E) => Effect.Effect<B, E2, R2>
  ): Effect.Effect<A | B, E2, R | R2> {
    return E.catchAll(self, f);
  }

  /**
   * Provide a fallback effect if this one fails.
   *
   * @example
   * effect.orElse(() => fallbackEffect)
   */
  export function orElse<A, E, R, B, E2, R2>(
    self: Effect.Effect<A, E, R>,
    that: () => Effect.Effect<B, E2, R2>
  ): Effect.Effect<A | B, E2, R | R2> {
    return E.orElse(self, that);
  }

  /**
   * Return a fallback value if this effect fails.
   *
   * @example
   * effect.orElseSucceed(() => defaultValue)
   */
  export function orElseSucceed<A, E, R, B>(
    self: Effect.Effect<A, E, R>,
    that: () => B
  ): Effect.Effect<A | B, never, R> {
    return E.orElseSucceed(self, that);
  }

  /**
   * Map the error channel.
   *
   * @example
   * effect.mapError(e => new WrappedError(e))
   */
  export function mapError<A, E, R, E2>(
    self: Effect.Effect<A, E, R>,
    f: (e: E) => E2
  ): Effect.Effect<A, E2, R> {
    return E.mapError(self, f);
  }

  /**
   * Map both success and error channels.
   *
   * @example
   * effect.mapBoth({
   *   onSuccess: x => x + 1,
   *   onFailure: e => new WrappedError(e)
   * })
   */
  export function mapBoth<A, E, R, A2, E2>(
    self: Effect.Effect<A, E, R>,
    options: {
      readonly onSuccess: (a: A) => A2;
      readonly onFailure: (e: E) => E2;
    }
  ): Effect.Effect<A2, E2, R> {
    return E.mapBoth(self, options);
  }

  // ==========================================================================
  // Option/Either Integration
  // ==========================================================================

  /**
   * Convert None to a specified error.
   *
   * @example
   * effect.someOrFail(() => new NotFoundError())
   */
  export function someOrFail<A, E, R, E2>(
    self: Effect.Effect<Option.Option<A>, E, R>,
    error: () => E2
  ): Effect.Effect<A, E | E2, R> {
    return E.flatMap(self, (opt) => (O.isSome(opt) ? E.succeed(opt.value) : E.fail(error())));
  }

  /**
   * Return Option.none() if this effect fails.
   *
   * @example
   * effect.option()  // Effect<Option<A>, never, R>
   */
  export function option<A, E, R>(
    self: Effect.Effect<A, E, R>
  ): Effect.Effect<Option.Option<A>, never, R> {
    return E.option(self);
  }

  /**
   * Return Left(error) or Right(success) as an Either.
   *
   * @example
   * effect.either()  // Effect<Either<E, A>, never, R>
   */
  export function either<A, E, R>(
    self: Effect.Effect<A, E, R>
  ): Effect.Effect<Either.Either<A, E>, never, R> {
    return E.either(self);
  }

  // ==========================================================================
  // Combinators
  // ==========================================================================

  /**
   * Run this effect and another in parallel, returning both results.
   *
   * @example
   * effect1.zip(effect2)  // Effect<[A1, A2], E1 | E2, R1 | R2>
   */
  export function zip<A, E, R, B, E2, R2>(
    self: Effect.Effect<A, E, R>,
    that: Effect.Effect<B, E2, R2>
  ): Effect.Effect<[A, B], E | E2, R | R2> {
    return E.zip(self, that);
  }

  /**
   * Run this effect and another, returning only the left result.
   *
   * @example
   * effect1.zipLeft(effect2)  // runs both, returns effect1's result
   */
  export function zipLeft<A, E, R, E2, R2>(
    self: Effect.Effect<A, E, R>,
    that: Effect.Effect<unknown, E2, R2>
  ): Effect.Effect<A, E | E2, R | R2> {
    return E.zipLeft(self, that);
  }

  /**
   * Run this effect and another, returning only the right result.
   *
   * @example
   * effect1.zipRight(effect2)  // runs both, returns effect2's result
   */
  export function zipRight<A, E, R, B, E2, R2>(
    self: Effect.Effect<A, E, R>,
    that: Effect.Effect<B, E2, R2>
  ): Effect.Effect<B, E | E2, R | R2> {
    return E.zipRight(self, that);
  }

  /**
   * Run this effect and another in parallel, using a function to combine results.
   *
   * @example
   * effect1.zipWith(effect2, (a, b) => a + b)
   */
  export function zipWith<A, E, R, B, E2, R2, C>(
    self: Effect.Effect<A, E, R>,
    that: Effect.Effect<B, E2, R2>,
    f: (a: A, b: B) => C
  ): Effect.Effect<C, E | E2, R | R2> {
    return E.zipWith(self, that, f);
  }

  // ==========================================================================
  // Filtering
  // ==========================================================================

  /**
   * Filter success values, failing with the given error if predicate is false.
   *
   * @example
   * effect.filterOrFail(x => x > 0, () => new InvalidValueError())
   */
  export function filterOrFail<A, E, R, E2>(
    self: Effect.Effect<A, E, R>,
    predicate: (a: A) => boolean,
    error: (a: A) => E2
  ): Effect.Effect<A, E | E2, R> {
    return E.filterOrFail(self, predicate, error);
  }

  /**
   * Filter success values, dying with defect if predicate is false.
   *
   * @example
   * effect.filterOrDie(x => x > 0, () => new Error("invariant violated"))
   */
  export function filterOrDie<A, E, R>(
    self: Effect.Effect<A, E, R>,
    predicate: (a: A) => boolean,
    error: (a: A) => unknown
  ): Effect.Effect<A, E, R> {
    return E.filterOrDie(self, predicate, error);
  }

  // ==========================================================================
  // Timing
  // ==========================================================================

  /**
   * Delay the execution of this effect.
   *
   * @example
   * import { Duration } from "effect"
   * effect.delay(Duration.seconds(1))
   */
  export function delay<A, E, R>(
    self: Effect.Effect<A, E, R>,
    duration: import("effect").Duration.DurationInput
  ): Effect.Effect<A, E, R> {
    return E.delay(self, duration);
  }

  /**
   * Set a timeout on this effect. Returns the result or fails with TimeoutException.
   *
   * @example
   * import { Duration } from "effect"
   * effect.timeout(Duration.seconds(5))
   */
  export function timeout<A, E, R>(
    self: Effect.Effect<A, E, R>,
    duration: import("effect").Duration.DurationInput
  ): Effect.Effect<A, E | import("effect").Cause.TimeoutException, R> {
    return E.timeout(self, duration);
  }

  /**
   * Fail with a specific error if this effect times out.
   *
   * @example
   * effect.timeoutFail({
   *   duration: Duration.seconds(5),
   *   onTimeout: () => new TimeoutError()
   * })
   */
  export function timeoutFail<A, E, R, E2>(
    self: Effect.Effect<A, E, R>,
    options: {
      readonly duration: import("effect").Duration.DurationInput;
      readonly onTimeout: () => E2;
    }
  ): Effect.Effect<A, E | E2, R> {
    return E.timeoutFail(self, options);
  }

  /**
   * Measure and log the duration of this effect.
   *
   * @example
   * effect.timed()  // Effect<[Duration, A], E, R>
   */
  export function timed<A, E, R>(
    self: Effect.Effect<A, E, R>
  ): Effect.Effect<[import("effect").Duration.Duration, A], E, R> {
    return E.timed(self);
  }

  // ==========================================================================
  // Retry
  // ==========================================================================

  /**
   * Retry this effect according to a schedule.
   *
   * @example
   * import { Schedule } from "effect"
   * effect.retry(Schedule.exponential(Duration.millis(100)))
   */
  export function retry<A, E, R, Out, R2>(
    self: Effect.Effect<A, E, R>,
    policy: Schedule.Schedule<Out, E, R2>
  ): Effect.Effect<A, E, R | R2> {
    return E.retry(self, policy);
  }

  // ==========================================================================
  // Resource Management
  // ==========================================================================

  /**
   * Ensure a finalizer runs after this effect completes.
   *
   * @example
   * effect.ensuring(Effect.log("done"))
   */
  export function ensuring<A, E, R, R2>(
    self: Effect.Effect<A, E, R>,
    finalizer: Effect.Effect<unknown, never, R2>
  ): Effect.Effect<A, E, R | R2> {
    return E.ensuring(self, finalizer);
  }

  /**
   * Run a finalizer on success only.
   *
   * @example
   * effect.onSuccess(a => Effect.log(`Got: ${a}`))
   */
  export function onSuccess<A, E, R, R2>(
    self: Effect.Effect<A, E, R>,
    f: (a: A) => Effect.Effect<unknown, never, R2>
  ): Effect.Effect<A, E, R | R2> {
    return E.tap(self, f);
  }

  /**
   * Run a finalizer on error only.
   *
   * @example
   * effect.onError(cause => Effect.log(`Failed: ${cause}`))
   */
  export function onError<A, E, R, R2>(
    self: Effect.Effect<A, E, R>,
    f: (cause: Cause.Cause<E>) => Effect.Effect<unknown, never, R2>
  ): Effect.Effect<A, E, R | R2> {
    return E.onError(self, f);
  }

  // ==========================================================================
  // Providing Context
  // ==========================================================================

  /**
   * Provide a service implementation to this effect.
   *
   * @example
   * effect.provideService(LoggerTag, consoleLogger)
   */
  export function provideService<A, E, R, S, I extends S>(
    self: Effect.Effect<A, E, R>,
    tag: import("effect").Context.Tag<S, I>,
    service: I
  ): Effect.Effect<A, E, Exclude<R, S>> {
    return E.provideService(self, tag, service);
  }

  /**
   * Provide a layer to this effect.
   *
   * @example
   * effect.provide(LiveDatabaseLayer)
   */
  export function provide<A, E, R, R2, E2, ROut>(
    self: Effect.Effect<A, E, R>,
    layer: import("effect").Layer.Layer<ROut, E2, R2>
  ): Effect.Effect<A, E | E2, R2 | Exclude<R, ROut>> {
    return E.provide(self, layer);
  }

  // ==========================================================================
  // Running
  // ==========================================================================

  /**
   * Run this effect synchronously, throwing on async or error.
   *
   * @example
   * const value = effect.runSync()
   */
  export function runSync<A, E>(self: Effect.Effect<A, E, never>): A {
    return E.runSync(self);
  }

  /**
   * Run this effect and return a Promise.
   *
   * @example
   * const value = await effect.runPromise()
   */
  export function runPromise<A, E>(self: Effect.Effect<A, E, never>): Promise<A> {
    return E.runPromise(self);
  }

  /**
   * Run this effect and return a Promise that resolves to Exit.
   *
   * @example
   * const exit = await effect.runPromiseExit()
   */
  export function runPromiseExit<A, E>(
    self: Effect.Effect<A, E, never>
  ): Promise<import("effect").Exit.Exit<A, E>> {
    return E.runPromiseExit(self);
  }
}

/**
 * Extension methods for Option.Option<A>.
 */
export namespace OptionExt {
  /**
   * Transform the value inside Some.
   */
  export function map<A, B>(self: Option.Option<A>, f: (a: A) => B): Option.Option<B> {
    return O.map(self, f);
  }

  /**
   * Chain Options.
   */
  export function flatMap<A, B>(
    self: Option.Option<A>,
    f: (a: A) => Option.Option<B>
  ): Option.Option<B> {
    return O.flatMap(self, f);
  }

  /**
   * Get the value or return a default.
   */
  export function getOrElse<A, B>(self: Option.Option<A>, orElse: () => B): A | B {
    return O.getOrElse(self, orElse);
  }

  /**
   * Convert to null if None.
   */
  export function getOrNull<A>(self: Option.Option<A>): A | null {
    return O.getOrNull(self);
  }

  /**
   * Convert to undefined if None.
   */
  export function getOrUndefined<A>(self: Option.Option<A>): A | undefined {
    return O.getOrUndefined(self);
  }

  /**
   * Check if this is Some.
   */
  export function isSome<A>(self: Option.Option<A>): self is Option.Some<A> {
    return O.isSome(self);
  }

  /**
   * Check if this is None.
   */
  export function isNone<A>(self: Option.Option<A>): self is Option.None<A> {
    return O.isNone(self);
  }

  /**
   * Filter with a predicate.
   */
  export function filter<A>(
    self: Option.Option<A>,
    predicate: (a: A) => boolean
  ): Option.Option<A> {
    return O.filter(self, predicate);
  }

  /**
   * Provide fallback Option.
   */
  export function orElse<A, B>(
    self: Option.Option<A>,
    that: () => Option.Option<B>
  ): Option.Option<A | B> {
    return O.orElse(self, that);
  }
}

/**
 * Extension methods for Either.Either<R, L>.
 */
export namespace EitherExt {
  /**
   * Transform the Right value.
   */
  export function map<A, E, B>(self: Either.Either<A, E>, f: (a: A) => B): Either.Either<B, E> {
    return Ei.map(self, f);
  }

  /**
   * Chain Eithers.
   */
  export function flatMap<A, E, B, E2>(
    self: Either.Either<A, E>,
    f: (a: A) => Either.Either<B, E2>
  ): Either.Either<B, E | E2> {
    return Ei.flatMap(self, f);
  }

  /**
   * Transform the Left value.
   */
  export function mapLeft<A, E, E2>(
    self: Either.Either<A, E>,
    f: (e: E) => E2
  ): Either.Either<A, E2> {
    return Ei.mapLeft(self, f);
  }

  /**
   * Get the Right value or return a default.
   */
  export function getOrElse<A, E, B>(self: Either.Either<A, E>, orElse: (e: E) => B): A | B {
    return Ei.getOrElse(self, orElse);
  }

  /**
   * Check if this is Right.
   */
  export function isRight<A, E>(self: Either.Either<A, E>): boolean {
    return Ei.isRight(self);
  }

  /**
   * Check if this is Left.
   */
  export function isLeft<A, E>(self: Either.Either<A, E>): boolean {
    return Ei.isLeft(self);
  }

  /**
   * Flip Left and Right.
   */
  export function flip<A, E>(self: Either.Either<A, E>): Either.Either<E, A> {
    return Ei.flip(self);
  }
}
