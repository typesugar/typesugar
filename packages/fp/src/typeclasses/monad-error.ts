/**
 * ApplicativeError and MonadError Typeclasses
 *
 * These extend Applicative and Monad with error handling capabilities.
 * Allows for raising and recovering from errors in a principled way.
 *
 * Laws:
 *   - raiseError(e).handleError(f) === f(e)
 *   - pure(a).handleError(f) === pure(a)
 *   - raiseError(e).flatMap(f) === raiseError(e)
 */

import type { Applicative, Apply } from "./applicative.js";
import type { Monad, FlatMap } from "./monad.js";
import type { $ } from "../hkt.js";

// ============================================================================
// ApplicativeError
// ============================================================================

/**
 * ApplicativeError typeclass - Applicative with error handling
 *
 * E is the error type, F is the type constructor
 */
export interface ApplicativeError<F, E> extends Applicative<F> {
  readonly raiseError: <A>(e: E) => $<F, A>;
  readonly handleErrorWith: <A>(fa: $<F, A>, f: (e: E) => $<F, A>) => $<F, A>;
}

// ============================================================================
// MonadError
// ============================================================================

/**
 * MonadError typeclass - Monad with error handling
 */
export interface MonadError<F, E> extends ApplicativeError<F, E>, Monad<F> {}

// ============================================================================
// Derived Operations from ApplicativeError
// ============================================================================

/**
 * Handle errors with a pure recovery function
 */
export function handleError<F, E>(
  F: ApplicativeError<F, E>,
): <A>(fa: $<F, A>, f: (e: E) => A) => $<F, A> {
  return (fa, f) => F.handleErrorWith(fa, (e) => F.pure(f(e)));
}

/**
 * Recover from errors, providing a fallback value
 */
export function recover<F, E>(
  F: ApplicativeError<F, E>,
): <A>(fa: $<F, A>, fallback: A) => $<F, A> {
  return (fa, fallback) => handleError(F)(fa, () => fallback);
}

/**
 * Try to recover with an optional partial function
 */
export function recoverWith<F, E>(
  F: ApplicativeError<F, E>,
): <A>(fa: $<F, A>, pf: (e: E) => $<F, A> | undefined) => $<F, A> {
  return (fa, pf) =>
    F.handleErrorWith(fa, (e) => {
      const result = pf(e);
      return result !== undefined ? result : F.raiseError(e);
    });
}

/**
 * Convert error to Option.none, keeping success as Option.some
 */
export function attempt<F, E>(
  F: ApplicativeError<F, E>,
): <A>(fa: $<F, A>) => $<F, Either<E, A>> {
  return <A>(fa: $<F, A>): $<F, Either<E, A>> =>
    F.handleErrorWith(
      F.map(fa, (a: A): Either<E, A> => ({ _tag: "Right" as const, value: a })),
      (e: E): $<F, Either<E, A>> => F.pure({ _tag: "Left" as const, value: e }),
    );
}

/**
 * Lift from Either into the error context
 */
export function fromEither<F, E>(
  F: ApplicativeError<F, E>,
): <A>(either: Either<E, A>) => $<F, A> {
  return (either) =>
    either._tag === "Right" ? F.pure(either.value) : F.raiseError(either.value);
}

/**
 * Lift from Option, using provided error for None case
 */
export function fromOption<F, E>(
  F: ApplicativeError<F, E>,
): <A>(option: Option<A>, error: () => E) => $<F, A> {
  // With null-based Option, option IS the value when it's not null
  return <A>(option: Option<A>, error: () => E): $<F, A> =>
    option !== null ? F.pure(option as A) : F.raiseError(error());
}

// ============================================================================
// Derived Operations from MonadError
// ============================================================================

/**
 * Ensure a condition holds, raising error if not
 */
export function ensure<F, E>(
  F: MonadError<F, E>,
): <A>(fa: $<F, A>, error: (a: A) => E, p: (a: A) => boolean) => $<F, A> {
  return (fa, error, p) =>
    F.flatMap(fa, (a) => (p(a) ? F.pure(a) : F.raiseError(error(a))));
}

/**
 * Ensure a condition holds, raising error if it does
 */
export function ensureOr<F, E>(
  F: MonadError<F, E>,
): <A>(fa: $<F, A>, error: (a: A) => E, p: (a: A) => boolean) => $<F, A> {
  return (fa, error, p) =>
    F.flatMap(fa, (a) => (p(a) ? F.raiseError(error(a)) : F.pure(a)));
}

/**
 * Re-raise an error, potentially transformed
 */
export function adaptError<F, E>(
  F: MonadError<F, E>,
): <A>(fa: $<F, A>, f: (e: E) => E) => $<F, A> {
  return (fa, f) => F.handleErrorWith(fa, (e) => F.raiseError(f(e)));
}

/**
 * Try a fallback on error
 */
export function orElse<F, E>(
  F: MonadError<F, E>,
): <A>(fa: $<F, A>, fallback: () => $<F, A>) => $<F, A> {
  return (fa, fallback) => F.handleErrorWith(fa, () => fallback());
}

/**
 * Rethrow after inspecting the error
 */
export function onError<F, E>(
  F: MonadError<F, E>,
): <A>(fa: $<F, A>, handler: (e: E) => $<F, void>) => $<F, A> {
  return <A>(fa: $<F, A>, handler: (e: E) => $<F, void>): $<F, A> =>
    F.handleErrorWith(fa, (e: E) =>
      F.flatMap(handler(e), () => F.raiseError<A>(e)),
    );
}

// ============================================================================
// Helper Types
// ============================================================================

type Either<E, A> =
  | { readonly _tag: "Left"; readonly value: E }
  | { readonly _tag: "Right"; readonly value: A };

type Option<A> =
  | { readonly _tag: "None" }
  | { readonly _tag: "Some"; readonly value: A };

// ============================================================================
// Instance Creator
// ============================================================================

/**
 * Create a MonadError instance
 */
export function makeMonadError<F, E>(
  map: <A, B>(fa: $<F, A>, f: (a: A) => B) => $<F, B>,
  flatMap: <A, B>(fa: $<F, A>, f: (a: A) => $<F, B>) => $<F, B>,
  pure: <A>(a: A) => $<F, A>,
  raiseError: <A>(e: E) => $<F, A>,
  handleErrorWith: <A>(fa: $<F, A>, f: (e: E) => $<F, A>) => $<F, A>,
): MonadError<F, E> {
  return {
    map,
    flatMap,
    pure,
    ap: (fab, fa) => flatMap(fab, (f) => map(fa, f)),
    raiseError,
    handleErrorWith,
  };
}
