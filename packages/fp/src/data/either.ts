/**
 * Either Data Type
 *
 * Either represents a value of one of two possible types (a disjoint union).
 * An Either<E, A> is either Left<E, A> (representing failure/error) or Right<E, A> (representing success).
 * By convention, Right is the "right" (correct/success) case.
 *
 * This implementation uses field-based discrimination for native TypeScript narrowing:
 * - Left has `left: E` and `right?: undefined`
 * - Right has `left?: undefined` and `right: A`
 *
 * Narrowing options:
 * - `isRight(e)` / `isLeft(e)` — recommended, works for all cases including Either<E, void>
 * - `e.right !== undefined` — works when A is not undefined/void
 * - `'right' in e` — checks property presence (use with type guards for best results)
 */

import type { TypeFunction } from "@typesugar/type-system";
import type { Option } from "./option.js";
import { Some, None, isSome } from "./option.js";
import type { Eq, Ord, Ordering } from "../typeclasses/eq.js";
import type { Show } from "../typeclasses/show.js";
import type { Semigroup } from "../typeclasses/semigroup.js";

// ============================================================================
// Either Type Definition
// ============================================================================

/**
 * Left variant — represents failure/error.
 * Has `left: E` field, and `right?: undefined` for safe union access.
 */
export interface Left<E, A = never> {
  readonly left: E;
  readonly right?: undefined;
}

/**
 * Right variant — represents success.
 * Has `right: A` field, and `left?: undefined` for safe union access.
 */
export interface Right<E = never, A = unknown> {
  readonly left?: undefined;
  readonly right: A;
}

/**
 * Either data type — a discriminated union of Left (error) and Right (success).
 *
 * Uses field-based discrimination for native TypeScript narrowing:
 * - `isRight(e)` / `isLeft(e)` — recommended type guards
 * - `e.right !== undefined` narrows to Right (when A is not void/undefined)
 * - `e.left !== undefined` narrows to Left (when E is not void/undefined)
 *
 * @example
 * ```typescript
 * const e: Either<string, number> = Right(42);
 *
 * // Recommended: use type guards
 * if (isRight(e)) {
 *   e.right; // number (narrowed to Right)
 * }
 *
 * // Also works when A is not undefined
 * if (e.right !== undefined) {
 *   e.right; // number (narrowed to Right)
 * }
 *
 * // Safe union access (before narrowing)
 * e.right; // number | undefined
 * e.left;  // string | undefined
 * ```
 *
 * @hkt
 */
export type Either<E, A> = Left<E, A> | Right<E, A>;

/**
 * Type-level function for `Either<E, A>` with E fixed.
 * Kind<EitherF<string>, number> resolves to Either<string, number>.
 */
export interface EitherF<E> extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: Either<E, this["__kind__"]>;
}

// ============================================================================
// Constructors
// ============================================================================

/**
 * Create a Left value
 */
export function Left<E, A = never>(left: E): Either<E, A> {
  return { left };
}

/**
 * Create a Right value
 */
export function Right<E = never, A = unknown>(right: A): Either<E, A> {
  return { right };
}

/**
 * Create a Right value (alias)
 */
export function right<E = never, A = unknown>(a: A): Either<E, A> {
  return Right(a);
}

/**
 * Create a Left value (alias)
 */
export function left<E, A = never>(e: E): Either<E, A> {
  return Left(e);
}

/**
 * Create an Either from a nullable value
 */
export function fromNullable<E, A>(value: A | null | undefined, onNull: () => E): Either<E, A> {
  return value == null ? Left(onNull()) : Right(value);
}

/**
 * Create an Either from a predicate
 */
export function fromPredicate<E, A>(
  value: A,
  predicate: (a: A) => boolean,
  onFalse: (a: A) => E
): Either<E, A> {
  return predicate(value) ? Right(value) : Left(onFalse(value));
}

/**
 * Create an Either from a try/catch
 */
export function tryCatch<E, A>(f: () => A, onError: (error: unknown) => E): Either<E, A> {
  try {
    return Right(f());
  } catch (error) {
    return Left(onError(error));
  }
}

/**
 * Create an Either from an Option
 */
export function fromOption<E, A>(opt: Option<A>, onNone: () => E): Either<E, A> {
  return isSome(opt) ? Right(opt as A) : Left(onNone());
}

/**
 * Create Right(a) - pure for Either
 */
export function of<E = never, A = unknown>(a: A): Either<E, A> {
  return Right(a);
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if Either is Left.
 * Uses property presence check to handle Right(undefined) correctly.
 */
export function isLeft<E, A>(either: Either<E, A>): either is Left<E, A> {
  return !("right" in either);
}

/**
 * Check if Either is Right.
 * Uses property presence check to handle Right(undefined) correctly.
 */
export function isRight<E, A>(either: Either<E, A>): either is Right<E, A> {
  return "right" in either;
}

// ============================================================================
// Unsafe Accessors
// ============================================================================

/**
 * Get the Left value, throwing if Right.
 * @throws Error if the Either is Right
 */
export function unsafeLeft<E, A>(either: Either<E, A>): E {
  if (isRight(either)) {
    throw new Error("unsafeLeft called on Right");
  }
  return either.left!;
}

/**
 * Get the Right value, throwing if Left.
 * @throws Error if the Either is Left
 */
export function unsafeRight<E, A>(either: Either<E, A>): A {
  if (isLeft(either)) {
    throw new Error("unsafeRight called on Left");
  }
  return either.right;
}

// ============================================================================
// Operations
// ============================================================================

/**
 * Map over the Right value
 */
export function map<E, A, B>(either: Either<E, A>, f: (a: A) => B): Either<E, B> {
  if (isRight(either)) {
    return { right: f(either.right) };
  }
  return either as Left<E, B>;
}

/**
 * Map over the Left value
 */
export function mapLeft<E, A, E2>(either: Either<E, A>, f: (e: E) => E2): Either<E2, A> {
  if (isRight(either)) {
    return either as Right<E2, A>;
  }
  return { left: f(either.left!) };
}

/**
 * Map over both values
 */
export function bimap<E, A, E2, B>(
  either: Either<E, A>,
  f: (e: E) => E2,
  g: (a: A) => B
): Either<E2, B> {
  if (isRight(either)) {
    return { right: g(either.right) };
  }
  return { left: f(either.left!) };
}

/**
 * FlatMap over the Right value
 */
export function flatMap<E, A, B>(either: Either<E, A>, f: (a: A) => Either<E, B>): Either<E, B> {
  if (isRight(either)) {
    return f(either.right);
  }
  return either as Left<E, B>;
}

/**
 * Apply a function in Either to a value in Either
 */
export function ap<E, A, B>(eitherF: Either<E, (a: A) => B>, eitherA: Either<E, A>): Either<E, B> {
  return flatMap(eitherF, (f) => map(eitherA, f));
}

/**
 * Fold over Either - provide handlers for both cases
 */
export function fold<E, A, B>(either: Either<E, A>, onLeft: (e: E) => B, onRight: (a: A) => B): B {
  if (isRight(either)) {
    return onRight(either.right);
  }
  return onLeft(either.left!);
}

/**
 * Match over Either (alias for fold with object syntax)
 */
export function match<E, A, B>(
  either: Either<E, A>,
  patterns: { Left: (e: E) => B; Right: (a: A) => B }
): B {
  if (isRight(either)) {
    return patterns.Right(either.right);
  }
  return patterns.Left(either.left!);
}

/**
 * Swap Left and Right
 */
export function swap<E, A>(either: Either<E, A>): Either<A, E> {
  if (isRight(either)) {
    return { left: either.right };
  }
  return { right: either.left! };
}

/**
 * Get the Right value or a default
 */
export function getOrElse<E, A>(either: Either<E, A>, defaultValue: (e: E) => A): A {
  if (isRight(either)) {
    return either.right;
  }
  return defaultValue(either.left!);
}

/**
 * Get the Right value or a default (strict version)
 */
export function getOrElseStrict<E, A>(either: Either<E, A>, defaultValue: A): A {
  if (isRight(either)) {
    return either.right;
  }
  return defaultValue;
}

/**
 * Get the Right value or throw
 */
export function getOrThrow<E, A>(either: Either<E, A>): A {
  if (isRight(either)) {
    return either.right;
  }
  throw either.left;
}

/**
 * Get the Right value or throw with custom message
 */
export function getOrThrowWith<E, A>(either: Either<E, A>, toError: (e: E) => Error): A {
  if (isRight(either)) {
    return either.right;
  }
  throw toError(either.left!);
}

/**
 * Return the first Right, or evaluate the fallback
 */
export function orElse<E, A, E2>(
  either: Either<E, A>,
  fallback: (e: E) => Either<E2, A>
): Either<E2, A> {
  if (isRight(either)) {
    return either as Right<E2, A>;
  }
  return fallback(either.left!);
}

/**
 * Filter or else provide an error
 */
export function filterOrElse<E, A>(
  either: Either<E, A>,
  predicate: (a: A) => boolean,
  onFalse: (a: A) => E
): Either<E, A> {
  if (isRight(either)) {
    if (predicate(either.right)) {
      return either;
    }
    return { left: onFalse(either.right) };
  }
  return either;
}

/**
 * Convert Either to Option (discards the error)
 */
export function toOption<E, A>(either: Either<E, A>): Option<A> {
  if (isRight(either)) {
    return Some(either.right);
  }
  return None;
}

/**
 * Convert Either to Validated
 */
export function toValidated<E, A>(either: Either<E, A>): Validated<E, A> {
  if (isRight(either)) {
    return Valid(either.right);
  }
  return Invalid(either.left!);
}

// Simple Validated for toValidated
type Validated<E, A> =
  | { readonly _tag: "Valid"; readonly value: A }
  | { readonly _tag: "Invalid"; readonly error: E };
const Valid = <E, A>(value: A): Validated<E, A> => ({ _tag: "Valid", value });
const Invalid = <E, A>(error: E): Validated<E, A> => ({
  _tag: "Invalid",
  error,
});

/**
 * Merge Left and Right into a single value
 */
export function merge<A>(either: Either<A, A>): A {
  if (isRight(either)) {
    return either.right;
  }
  return either.left!;
}

/**
 * Check if the Right value satisfies a predicate
 */
export function exists<E, A>(either: Either<E, A>, predicate: (a: A) => boolean): boolean {
  if (isRight(either)) {
    return predicate(either.right);
  }
  return false;
}

/**
 * Check if all Right values satisfy a predicate
 */
export function forall<E, A>(either: Either<E, A>, predicate: (a: A) => boolean): boolean {
  if (isRight(either)) {
    return predicate(either.right);
  }
  return true;
}

/**
 * Check if Either contains a specific Right value
 */
export function contains<E, A>(
  either: Either<E, A>,
  value: A,
  eq: (a: A, b: A) => boolean = (a, b) => a === b
): boolean {
  if (isRight(either)) {
    return eq(either.right, value);
  }
  return false;
}

/**
 * Convert Either to array
 */
export function toArray<E, A>(either: Either<E, A>): A[] {
  if (isRight(either)) {
    return [either.right];
  }
  return [];
}

/**
 * Flatten a nested Either
 */
export function flatten<E, A>(either: Either<E, Either<E, A>>): Either<E, A> {
  return flatMap(either, (inner) => inner);
}

/**
 * Tap - perform a side effect on Right and return the original Either
 */
export function tap<E, A>(either: Either<E, A>, f: (a: A) => void): Either<E, A> {
  if (isRight(either)) {
    f(either.right);
  }
  return either;
}

/**
 * TapLeft - perform a side effect on Left and return the original Either
 */
export function tapLeft<E, A>(either: Either<E, A>, f: (e: E) => void): Either<E, A> {
  if (isLeft(either)) {
    f(either.left!);
  }
  return either;
}

/**
 * Handle errors with a recovery function
 */
export function handleError<E, A>(either: Either<E, A>, f: (e: E) => A): Either<never, A> {
  if (isRight(either)) {
    return either as Right<never, A>;
  }
  return Right(f(either.left!));
}

/**
 * Handle errors with a recovery function that returns Either
 */
export function handleErrorWith<E, E2, A>(
  either: Either<E, A>,
  f: (e: E) => Either<E2, A>
): Either<E2, A> {
  if (isRight(either)) {
    return either as Right<E2, A>;
  }
  return f(either.left!);
}

/**
 * Ensure a condition holds or return an error
 */
export function ensure<E, A>(
  either: Either<E, A>,
  predicate: (a: A) => boolean,
  onFalse: (a: A) => E
): Either<E, A> {
  return filterOrElse(either, predicate, onFalse);
}

/**
 * Traverse an array with an Either-returning function
 */
export function traverse<E, A, B>(arr: A[], f: (a: A) => Either<E, B>): Either<E, B[]> {
  const results: B[] = [];
  for (const a of arr) {
    const either = f(a);
    if (isLeft(either)) {
      return either as Left<E, B[]>;
    }
    results.push(either.right);
  }
  return Right(results);
}

/**
 * Sequence an array of Eithers
 */
export function sequence<E, A>(eithers: Either<E, A>[]): Either<E, A[]> {
  return traverse(eithers, (e) => e);
}

/**
 * Partition an array based on an Either-returning function
 */
export function partition<A, E, B>(
  arr: A[],
  f: (a: A) => Either<E, B>
): { lefts: E[]; rights: B[] } {
  const lefts: E[] = [];
  const rights: B[] = [];
  for (const a of arr) {
    const either = f(a);
    if (isRight(either)) {
      rights.push(either.right);
    } else {
      lefts.push(either.left!);
    }
  }
  return { lefts, rights };
}

// ============================================================================
// Typeclass Instances
// ============================================================================

/**
 * Eq instance for Either.
 *
 * Enables operator rewriting: `eitherA === eitherB` → `getEq(eqE, eqA).eqv(eitherA, eitherB)`
 */
export function getEq<E, A>(EE: Eq<E>, EA: Eq<A>): Eq<Either<E, A>> {
  return {
    eqv: (x, y) => {
      if (isRight(x) && isRight(y)) {
        return EA.eqv(x.right, y.right);
      }
      if (isLeft(x) && isLeft(y)) {
        return EE.eqv(x.left!, y.left!);
      }
      return false;
    },
  };
}

/**
 * Ord instance for Either (Left < Right).
 *
 * Enables operator rewriting for comparison operators:
 * - `eitherA < eitherB` → `getOrd(ordE, ordA).lessThan(eitherA, eitherB)`
 *
 * @example
 * ```typescript
 * const ordEitherStrNum = getOrd(ordString, ordNumber);
 * const a = Right(1);
 * const b = Right(2);
 *
 * // With transformer: a < b → ordEitherStrNum.lessThan(a, b) → true
 * ```
 */
export function getOrd<E, A>(OE: Ord<E>, OA: Ord<A>): Ord<Either<E, A>> {
  const compare = (x: Either<E, A>, y: Either<E, A>): Ordering => {
    if (isRight(x) && isRight(y)) {
      return OA.compare(x.right, y.right);
    }
    if (isLeft(x) && isLeft(y)) {
      return OE.compare(x.left!, y.left!);
    }
    if (isLeft(x)) {
      return -1 as Ordering; // Left < Right
    }
    return 1 as Ordering; // Right > Left
  };
  return {
    eqv: getEq(OE, OA).eqv,
    compare,
    lessThan: (x, y) => compare(x, y) === -1,
    lessThanOrEqual: (x, y) => compare(x, y) !== 1,
    greaterThan: (x, y) => compare(x, y) === 1,
    greaterThanOrEqual: (x, y) => compare(x, y) !== -1,
  };
}

/**
 * Show instance for Either
 */
export function getShow<E, A>(SE: Show<E>, SA: Show<A>): Show<Either<E, A>> {
  return {
    show: (either) => {
      if (isRight(either)) {
        return `Right(${SA.show(either.right)})`;
      }
      return `Left(${SE.show(either.left!)})`;
    },
  };
}

/**
 * Semigroup instance for Either (combines Right values)
 */
export function getSemigroup<E, A>(S: Semigroup<A>): Semigroup<Either<E, A>> {
  return {
    combine: (x, y) => {
      if (isLeft(x)) return x;
      if (isLeft(y)) return y;
      return Right(S.combine(x.right, y.right));
    },
  };
}

// ============================================================================
// Do-notation Support
// ============================================================================

/**
 * Start a do-comprehension with Either
 */
export function Do<E>(): Either<E, {}> {
  return Right({});
}

/**
 * Bind a value in do-notation style
 */
export function bind<N extends string, E, A extends object, B>(
  name: Exclude<N, keyof A>,
  f: (a: A) => Either<E, B>
): (either: Either<E, A>) => Either<E, A & { readonly [K in N]: B }> {
  return (either) =>
    flatMap(either, (a) => map(f(a), (b) => ({ ...a, [name]: b }) as A & { readonly [K in N]: B }));
}

/**
 * Let - bind a non-effectful value
 */
export function let_<N extends string, E, A extends object, B>(
  name: Exclude<N, keyof A>,
  f: (a: A) => B
): (either: Either<E, A>) => Either<E, A & { readonly [K in N]: B }> {
  return (either) => map(either, (a) => ({ ...a, [name]: f(a) }) as A & { readonly [K in N]: B });
}

// ============================================================================
// Either Namespace Object
// ============================================================================

/**
 * Either namespace - groups all Either operations for clean API access.
 *
 * @example
 * ```typescript
 * import { Either, Left, Right } from "@typesugar/fp";
 *
 * const e: Either<string, number> = Right(42);
 * Either.map(e, n => n * 2);           // Right(84)
 * Either.flatMap(e, n => Right(n));    // Right(42)
 * Either.getOrElse(Left("err"), () => 0); // 0
 * ```
 */
export const Either = {
  // Constructors
  of,
  right,
  left,
  fromNullable,
  fromPredicate,
  fromOption,
  tryCatch,

  // Type guards
  isLeft,
  isRight,

  // Unsafe accessors
  unsafeLeft,
  unsafeRight,

  // Core operations
  map,
  mapLeft,
  bimap,
  flatMap,
  ap,
  fold,
  match,
  swap,
  getOrElse,
  getOrElseStrict,
  getOrThrow,
  getOrThrowWith,
  orElse,
  filterOrElse,
  flatten,
  tap,
  tapLeft,
  handleError,
  handleErrorWith,
  ensure,
  exists,
  forall,
  contains,
  merge,

  // Conversions
  toOption,
  toValidated,
  toArray,

  // Combinators
  traverse,
  sequence,
  partition,

  // Typeclass instances
  getEq,
  getOrd,
  getShow,
  getSemigroup,

  // Do-notation
  Do,
  bind,
  let_,
} as const;

// ============================================================================
// Fluent API (Either class)
// ============================================================================

/**
 * Either with fluent methods
 */
export class EitherImpl<E, A> {
  private constructor(private readonly either: Either<E, A>) {}

  static right<E = never, A = unknown>(value: A): EitherImpl<E, A> {
    return new EitherImpl(Right(value));
  }

  static left<E, A = never>(error: E): EitherImpl<E, A> {
    return new EitherImpl(Left(error));
  }

  static fromNullable<E, A>(value: A | null | undefined, onNull: () => E): EitherImpl<E, A> {
    return new EitherImpl(fromNullable(value, onNull));
  }

  static tryCatch<E, A>(f: () => A, onError: (error: unknown) => E): EitherImpl<E, A> {
    return new EitherImpl(tryCatch(f, onError));
  }

  get value(): Either<E, A> {
    return this.either;
  }

  isLeft(): boolean {
    return isLeft(this.either);
  }

  isRight(): boolean {
    return isRight(this.either);
  }

  map<B>(f: (a: A) => B): EitherImpl<E, B> {
    return new EitherImpl(map(this.either, f));
  }

  mapLeft<E2>(f: (e: E) => E2): EitherImpl<E2, A> {
    return new EitherImpl(mapLeft(this.either, f));
  }

  bimap<E2, B>(f: (e: E) => E2, g: (a: A) => B): EitherImpl<E2, B> {
    return new EitherImpl(bimap(this.either, f, g));
  }

  flatMap<B>(f: (a: A) => Either<E, B>): EitherImpl<E, B> {
    return new EitherImpl(flatMap(this.either, f));
  }

  chain<B>(f: (a: A) => EitherImpl<E, B>): EitherImpl<E, B> {
    return new EitherImpl(flatMap(this.either, (a) => f(a).value));
  }

  fold<B>(onLeft: (e: E) => B, onRight: (a: A) => B): B {
    return fold(this.either, onLeft, onRight);
  }

  swap(): EitherImpl<A, E> {
    return new EitherImpl(swap(this.either));
  }

  getOrElse(defaultValue: (e: E) => A): A {
    return getOrElse(this.either, defaultValue);
  }

  getOrElseValue(defaultValue: A): A {
    return getOrElseStrict(this.either, defaultValue);
  }

  getOrThrow(): A {
    return getOrThrow(this.either);
  }

  orElse<E2>(fallback: (e: E) => Either<E2, A>): EitherImpl<E2, A> {
    return new EitherImpl(orElse(this.either, fallback));
  }

  filterOrElse(predicate: (a: A) => boolean, onFalse: (a: A) => E): EitherImpl<E, A> {
    return new EitherImpl(filterOrElse(this.either, predicate, onFalse));
  }

  toOption(): Option<A> {
    return toOption(this.either);
  }

  toArray(): A[] {
    return toArray(this.either);
  }

  tap(f: (a: A) => void): EitherImpl<E, A> {
    return new EitherImpl(tap(this.either, f));
  }

  tapLeft(f: (e: E) => void): EitherImpl<E, A> {
    return new EitherImpl(tapLeft(this.either, f));
  }
}
