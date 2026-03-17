/**
 * RemoteData Data Type
 *
 * RemoteData represents the state of asynchronously loaded data:
 * - NotAsked: Request hasn't been made yet
 * - Loading: Request is in progress
 * - Failure: Request failed with an error
 * - Success: Request succeeded with data
 *
 * This implementation demonstrates PEP-014's auto-tag injection pattern:
 * - NotAsked and Loading are EMPTY interfaces (indistinguishable structurally)
 *   → They require `_tag` for discrimination
 * - Failure has `error: E` field, Success has `value: A` field
 *   → They are structurally distinguishable, no `_tag` needed
 *
 * In a full `@adt` macro implementation, the macro would:
 * 1. Analyze variant distinguishability
 * 2. Auto-inject `_tag` only for NotAsked and Loading
 * 3. Leave Failure and Success with field-based discrimination
 *
 * For this manual implementation, we include `_tag` on ambiguous variants only.
 */

import type { Op } from "@typesugar/core";
import type { TypeFunction } from "@typesugar/type-system";
import type { Option } from "./option.js";
import { Some, None, isSome } from "./option.js";
import type { Either } from "./either.js";
import { Left, Right, isRight } from "./either.js";
import type { Eq, Ord, Ordering } from "../typeclasses/eq.js";
import type { Show } from "../typeclasses/show.js";

// ============================================================================
// RemoteData Type Definition
// ============================================================================

/**
 * NotAsked variant — request hasn't been made yet.
 * REQUIRES `_tag` because it's structurally indistinguishable from Loading.
 */
export interface NotAsked {
  readonly _tag: "NotAsked";
  readonly error?: undefined;
  readonly value?: undefined;
}

/**
 * Loading variant — request is in progress.
 * REQUIRES `_tag` because it's structurally indistinguishable from NotAsked.
 */
export interface Loading {
  readonly _tag: "Loading";
  readonly error?: undefined;
  readonly value?: undefined;
}

/**
 * Failure variant — request failed with an error.
 * NO `_tag` needed — `error: E` field distinguishes this variant.
 */
export interface Failure<E, A = never> {
  readonly error: E;
  readonly value?: undefined;
  readonly _tag?: undefined;
}

/**
 * Success variant — request succeeded with data.
 * NO `_tag` needed — `value: A` field distinguishes this variant.
 */
export interface Success<E = never, A = unknown> {
  readonly value: A;
  readonly error?: undefined;
  readonly _tag?: undefined;
}

/**
 * RemoteData — represents the state of asynchronously loaded data.
 *
 * Demonstrates mixed discrimination:
 * - `_tag` for NotAsked/Loading (structurally identical empty variants)
 * - Field presence for Failure/Success (unique fields)
 *
 * Narrowing options:
 * - `isNotAsked(rd)` / `isLoading(rd)` — use `_tag` check
 * - `isFailure(rd)` — checks for `error` field
 * - `isSuccess(rd)` — checks for `value` field
 * - `rd._tag === "NotAsked"` — direct tag check
 * - `rd.error !== undefined` — narrows to Failure
 * - `rd.value !== undefined` — narrows to Success
 *
 * @example
 * ```typescript
 * const rd: RemoteData<Error, User> = Loading();
 *
 * if (isSuccess(rd)) {
 *   rd.value; // User (narrowed to Success)
 * }
 *
 * if (rd._tag === "Loading") {
 *   // narrowed to Loading
 * }
 *
 * if (rd.error !== undefined) {
 *   rd.error; // Error (narrowed to Failure)
 * }
 * ```
 *
 * @hkt
 */
export type RemoteData<E, A> = NotAsked | Loading | Failure<E, A> | Success<E, A>;

/**
 * Type-level function for `RemoteData<E, A>` with E fixed.
 * Kind<RemoteDataF<Error>, User> resolves to RemoteData<Error, User>.
 */
export interface RemoteDataF<E> extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: RemoteData<E, this["__kind__"]>;
}

// ============================================================================
// Constructors
// ============================================================================

/**
 * Create a NotAsked value
 */
export function NotAsked<E = never, A = never>(): RemoteData<E, A> {
  return { _tag: "NotAsked" };
}

/**
 * Create a Loading value
 */
export function Loading<E = never, A = never>(): RemoteData<E, A> {
  return { _tag: "Loading" };
}

/**
 * Create a Failure value
 */
export function Failure<E, A = never>(error: E): RemoteData<E, A> {
  return { error };
}

/**
 * Create a Success value
 */
export function Success<E = never, A = unknown>(value: A): RemoteData<E, A> {
  return { value };
}

/**
 * Alias for NotAsked
 */
export const notAsked = NotAsked;

/**
 * Alias for Loading
 */
export const loading = Loading;

/**
 * Alias for Failure
 */
export const failure = Failure;

/**
 * Alias for Success
 */
export const success = Success;

/**
 * Create RemoteData from an Either
 */
export function fromEither<E, A>(either: Either<E, A>): RemoteData<E, A> {
  return isRight(either) ? Success(either.right) : Failure(either.left!);
}

/**
 * Create RemoteData from an Option (None becomes NotAsked)
 */
export function fromOption<E = never, A = unknown>(opt: Option<A>): RemoteData<E, A> {
  return isSome(opt) ? Success(opt as A) : NotAsked();
}

/**
 * Create RemoteData from a nullable value
 */
export function fromNullable<E = never, A = unknown>(
  value: A | null | undefined
): RemoteData<E, A> {
  return value != null ? Success(value) : NotAsked();
}

/**
 * Pure for RemoteData - lifts a value into Success
 */
export function pure<E = never, A = unknown>(a: A): RemoteData<E, A> {
  return Success(a);
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if RemoteData is NotAsked
 */
export function isNotAsked<E, A>(rd: RemoteData<E, A>): rd is NotAsked {
  return "_tag" in rd && rd._tag === "NotAsked";
}

/**
 * Check if RemoteData is Loading
 */
export function isLoading<E, A>(rd: RemoteData<E, A>): rd is Loading {
  return "_tag" in rd && rd._tag === "Loading";
}

/**
 * Check if RemoteData is Failure
 */
export function isFailure<E, A>(rd: RemoteData<E, A>): rd is Failure<E, A> {
  return "error" in rd;
}

/**
 * Check if RemoteData is Success
 */
export function isSuccess<E, A>(rd: RemoteData<E, A>): rd is Success<E, A> {
  return "value" in rd;
}

/**
 * Check if RemoteData is in a terminal state (Failure or Success)
 */
export function isComplete<E, A>(rd: RemoteData<E, A>): rd is Failure<E, A> | Success<E, A> {
  return isFailure(rd) || isSuccess(rd);
}

/**
 * Check if RemoteData is in a pending state (NotAsked or Loading)
 */
export function isPending<E, A>(rd: RemoteData<E, A>): rd is NotAsked | Loading {
  return isNotAsked(rd) || isLoading(rd);
}

// ============================================================================
// Operations
// ============================================================================

/**
 * Map over the Success value
 */
export function map<E, A, B>(rd: RemoteData<E, A>, f: (a: A) => B): RemoteData<E, B> {
  if (isSuccess(rd)) {
    return Success(f(rd.value));
  }
  return rd as RemoteData<E, B>;
}

/**
 * Map over the Failure value
 */
export function mapError<E, A, E2>(rd: RemoteData<E, A>, f: (e: E) => E2): RemoteData<E2, A> {
  if (isFailure(rd)) {
    return Failure(f(rd.error));
  }
  return rd as RemoteData<E2, A>;
}

/**
 * Map over both Failure and Success values
 */
export function bimap<E, A, E2, B>(
  rd: RemoteData<E, A>,
  f: (e: E) => E2,
  g: (a: A) => B
): RemoteData<E2, B> {
  if (isSuccess(rd)) {
    return Success(g(rd.value));
  }
  if (isFailure(rd)) {
    return Failure(f(rd.error));
  }
  return rd as RemoteData<E2, B>;
}

/**
 * FlatMap over the Success value
 */
export function flatMap<E, A, B>(
  rd: RemoteData<E, A>,
  f: (a: A) => RemoteData<E, B>
): RemoteData<E, B> {
  if (isSuccess(rd)) {
    return f(rd.value);
  }
  return rd as RemoteData<E, B>;
}

/**
 * Apply a function in RemoteData to a value in RemoteData
 */
export function ap<E, A, B>(
  rdF: RemoteData<E, (a: A) => B>,
  rdA: RemoteData<E, A>
): RemoteData<E, B> {
  return flatMap(rdF, (f) => map(rdA, f));
}

/**
 * Fold over RemoteData - provide handlers for all cases
 */
export function fold<E, A, B>(
  rd: RemoteData<E, A>,
  onNotAsked: () => B,
  onLoading: () => B,
  onFailure: (e: E) => B,
  onSuccess: (a: A) => B
): B {
  if (isNotAsked(rd)) return onNotAsked();
  if (isLoading(rd)) return onLoading();
  if (isFailure(rd)) return onFailure(rd.error);
  return onSuccess(rd.value);
}

/**
 * Match over RemoteData (alias for fold with object syntax)
 */
export function match<E, A, B>(
  rd: RemoteData<E, A>,
  patterns: {
    NotAsked: () => B;
    Loading: () => B;
    Failure: (e: E) => B;
    Success: (a: A) => B;
  }
): B {
  return fold(rd, patterns.NotAsked, patterns.Loading, patterns.Failure, patterns.Success);
}

/**
 * Get the Success value or a default
 */
export function getOrElse<E, A>(rd: RemoteData<E, A>, defaultValue: () => A): A {
  if (isSuccess(rd)) {
    return rd.value;
  }
  return defaultValue();
}

/**
 * Get the Success value or a default (strict version)
 */
export function getOrElseStrict<E, A>(rd: RemoteData<E, A>, defaultValue: A): A {
  if (isSuccess(rd)) {
    return rd.value;
  }
  return defaultValue;
}

/**
 * Convert to Option (discards everything except Success)
 */
export function toOption<E, A>(rd: RemoteData<E, A>): Option<A> {
  if (isSuccess(rd)) {
    return Some(rd.value);
  }
  return None;
}

/**
 * Convert to Either (NotAsked/Loading become Left with provided error)
 */
export function toEither<E, A>(rd: RemoteData<E, A>, onPending: () => E): Either<E, A> {
  if (isSuccess(rd)) {
    return Right(rd.value);
  }
  if (isFailure(rd)) {
    return Left(rd.error);
  }
  return Left(onPending());
}

/**
 * Combine two RemoteData values
 * - If both are Success, combine with function
 * - If either is Failure, return first Failure
 * - If either is Loading (and no Failure), return Loading
 * - If both are NotAsked, return NotAsked
 */
export function map2<E, A, B, C>(
  rdA: RemoteData<E, A>,
  rdB: RemoteData<E, B>,
  f: (a: A, b: B) => C
): RemoteData<E, C> {
  if (isSuccess(rdA) && isSuccess(rdB)) {
    return Success(f(rdA.value, rdB.value));
  }
  if (isFailure(rdA)) return rdA as RemoteData<E, C>;
  if (isFailure(rdB)) return rdB as RemoteData<E, C>;
  if (isLoading(rdA) || isLoading(rdB)) return Loading();
  return NotAsked();
}

/**
 * Sequence an array of RemoteData
 */
export function sequence<E, A>(rds: RemoteData<E, A>[]): RemoteData<E, A[]> {
  return rds.reduce(
    (acc: RemoteData<E, A[]>, rd: RemoteData<E, A>) => map2(acc, rd, (arr, a) => [...arr, a]),
    Success([])
  );
}

/**
 * Traverse an array with a RemoteData-returning function
 */
export function traverse<E, A, B>(arr: A[], f: (a: A) => RemoteData<E, B>): RemoteData<E, B[]> {
  return sequence(arr.map(f));
}

// ============================================================================
// State Transitions
// ============================================================================

/**
 * Transition to Loading state (preserves type)
 */
export function toLoading<E, A>(_rd: RemoteData<E, A>): RemoteData<E, A> {
  return Loading();
}

/**
 * Refresh - set to Loading if Success, otherwise keep current state
 */
export function refresh<E, A>(rd: RemoteData<E, A>): RemoteData<E, A> {
  if (isSuccess(rd)) {
    return Loading();
  }
  return rd;
}

// ============================================================================
// Typeclass Instances
// ============================================================================

/**
 * Eq instance for RemoteData
 */
export function getEq<E, A>(EE: Eq<E>, EA: Eq<A>): Eq<RemoteData<E, A>> {
  return {
    eqv: (x, y) => {
      if (isNotAsked(x) && isNotAsked(y)) return true;
      if (isLoading(x) && isLoading(y)) return true;
      if (isFailure(x) && isFailure(y)) return EE.eqv(x.error, y.error);
      if (isSuccess(x) && isSuccess(y)) return EA.eqv(x.value, y.value);
      return false;
    },
  };
}

/**
 * Ord instance for RemoteData (NotAsked < Loading < Failure < Success)
 */
export function getOrd<E, A>(OE: Ord<E>, OA: Ord<A>): Ord<RemoteData<E, A>> {
  const stateOrder = (rd: RemoteData<E, A>): number => {
    if (isNotAsked(rd)) return 0;
    if (isLoading(rd)) return 1;
    if (isFailure(rd)) return 2;
    return 3;
  };

  const compare = (x: RemoteData<E, A>, y: RemoteData<E, A>): Ordering => {
    const xOrder = stateOrder(x);
    const yOrder = stateOrder(y);
    if (xOrder !== yOrder) {
      return (xOrder < yOrder ? -1 : 1) as Ordering;
    }
    if (isFailure(x) && isFailure(y)) return OE.compare(x.error, y.error);
    if (isSuccess(x) && isSuccess(y)) return OA.compare(x.value, y.value);
    return 0 as Ordering;
  };

  return {
    eqv: getEq(OE, OA).eqv,
    compare,
    lessThan: ((x, y) => compare(x, y) === -1) as (
      x: RemoteData<E, A>,
      y: RemoteData<E, A>
    ) => boolean & Op<"<">,
    lessThanOrEqual: ((x, y) => compare(x, y) !== 1) as (
      x: RemoteData<E, A>,
      y: RemoteData<E, A>
    ) => boolean & Op<"<=">,
    greaterThan: ((x, y) => compare(x, y) === 1) as (
      x: RemoteData<E, A>,
      y: RemoteData<E, A>
    ) => boolean & Op<">">,
    greaterThanOrEqual: ((x, y) => compare(x, y) !== -1) as (
      x: RemoteData<E, A>,
      y: RemoteData<E, A>
    ) => boolean & Op<">=">,
  };
}

/**
 * Show instance for RemoteData
 */
export function getShow<E, A>(SE: Show<E>, SA: Show<A>): Show<RemoteData<E, A>> {
  return {
    show: (rd) => {
      if (isNotAsked(rd)) return "NotAsked";
      if (isLoading(rd)) return "Loading";
      if (isFailure(rd)) return `Failure(${SE.show(rd.error)})`;
      return `Success(${SA.show(rd.value)})`;
    },
  };
}

// ============================================================================
// RemoteData Namespace Object
// ============================================================================

/**
 * RemoteData namespace - groups all RemoteData operations for clean API access.
 *
 * @example
 * ```typescript
 * import { RemoteData } from "@typesugar/fp";
 *
 * const rd: RemoteData<Error, User> = RemoteData.success(user);
 * RemoteData.map(rd, u => u.name);           // Success("Alice")
 * RemoteData.getOrElse(rd, () => anonymous); // User
 * ```
 */
export const RemoteData = {
  // Constructors
  notAsked: NotAsked,
  loading: Loading,
  failure: Failure,
  success: Success,
  pure,
  fromEither,
  fromOption,
  fromNullable,

  // Type guards
  isNotAsked,
  isLoading,
  isFailure,
  isSuccess,
  isComplete,
  isPending,

  // Core operations
  map,
  mapError,
  bimap,
  flatMap,
  ap,
  fold,
  match,
  getOrElse,
  getOrElseStrict,
  map2,

  // Conversions
  toOption,
  toEither,

  // Combinators
  sequence,
  traverse,

  // State transitions
  toLoading,
  refresh,

  // Typeclass instances
  getEq,
  getOrd,
  getShow,
} as const;
