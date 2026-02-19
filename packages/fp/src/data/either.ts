/**
 * Either Data Type
 *
 * Either represents a value of one of two possible types (a disjoint union).
 * An Either<E, A> is either Left<E> (representing failure/error) or Right<A> (representing success).
 * By convention, Right is the "right" (correct/success) case.
 */

import type { Option } from "./option.js";
import { Some, None, isSome } from "./option.js";
import type { Eq, Ord, Ordering } from "../typeclasses/eq.js";
import type { Show } from "../typeclasses/show.js";
import type { Semigroup } from "../typeclasses/semigroup.js";

// ============================================================================
// Either Type Definition
// ============================================================================

/**
 * Either data type - either Left (error) or Right (success)
 */
export type Either<E, A> = Left<E> | Right<A>;

/**
 * Left variant - represents failure/error
 */
export interface Left<E> {
  readonly _tag: "Left";
  readonly left: E;
}

/**
 * Right variant - represents success
 */
export interface Right<A> {
  readonly _tag: "Right";
  readonly right: A;
}

// ============================================================================
// Constructors
// ============================================================================

/**
 * Create a Left value
 */
export function Left<E, A = never>(left: E): Either<E, A> {
  return { _tag: "Left", left };
}

/**
 * Create a Right value
 */
export function Right<E = never, A = unknown>(right: A): Either<E, A> {
  return { _tag: "Right", right };
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
export function fromNullable<E, A>(
  value: A | null | undefined,
  onNull: () => E,
): Either<E, A> {
  return value == null ? Left(onNull()) : Right(value);
}

/**
 * Create an Either from a predicate
 */
export function fromPredicate<E, A>(
  value: A,
  predicate: (a: A) => boolean,
  onFalse: (a: A) => E,
): Either<E, A> {
  return predicate(value) ? Right(value) : Left(onFalse(value));
}

/**
 * Create an Either from a try/catch
 */
export function tryCatch<E, A>(
  f: () => A,
  onError: (error: unknown) => E,
): Either<E, A> {
  try {
    return Right(f());
  } catch (error) {
    return Left(onError(error));
  }
}

/**
 * Create an Either from an Option
 */
export function fromOption<E, A>(
  opt: Option<A>,
  onNone: () => E,
): Either<E, A> {
  // With null-based Option, opt IS the value when it's not null
  return isSome(opt) ? Right(opt) : Left(onNone());
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
 * Check if Either is Left
 */
export function isLeft<E, A>(either: Either<E, A>): either is Left<E> {
  return either._tag === "Left";
}

/**
 * Check if Either is Right
 */
export function isRight<E, A>(either: Either<E, A>): either is Right<A> {
  return either._tag === "Right";
}

// ============================================================================
// Operations
// ============================================================================

/**
 * Map over the Right value
 */
export function map<E, A, B>(
  either: Either<E, A>,
  f: (a: A) => B,
): Either<E, B> {
  return isRight(either) ? Right(f(either.right)) : either;
}

/**
 * Map over the Left value
 */
export function mapLeft<E, A, E2>(
  either: Either<E, A>,
  f: (e: E) => E2,
): Either<E2, A> {
  return isLeft(either) ? Left(f(either.left)) : either;
}

/**
 * Map over both values
 */
export function bimap<E, A, E2, B>(
  either: Either<E, A>,
  f: (e: E) => E2,
  g: (a: A) => B,
): Either<E2, B> {
  return isLeft(either) ? Left(f(either.left)) : Right(g(either.right));
}

/**
 * FlatMap over the Right value
 */
export function flatMap<E, A, B>(
  either: Either<E, A>,
  f: (a: A) => Either<E, B>,
): Either<E, B> {
  return isRight(either) ? f(either.right) : either;
}

/**
 * Apply a function in Either to a value in Either
 */
export function ap<E, A, B>(
  eitherF: Either<E, (a: A) => B>,
  eitherA: Either<E, A>,
): Either<E, B> {
  return flatMap(eitherF, (f) => map(eitherA, f));
}

/**
 * Fold over Either - provide handlers for both cases
 */
export function fold<E, A, B>(
  either: Either<E, A>,
  onLeft: (e: E) => B,
  onRight: (a: A) => B,
): B {
  return isRight(either) ? onRight(either.right) : onLeft(either.left);
}

/**
 * Match over Either (alias for fold with object syntax)
 */
export function match<E, A, B>(
  either: Either<E, A>,
  patterns: { Left: (e: E) => B; Right: (a: A) => B },
): B {
  return isRight(either)
    ? patterns.Right(either.right)
    : patterns.Left(either.left);
}

/**
 * Swap Left and Right
 */
export function swap<E, A>(either: Either<E, A>): Either<A, E> {
  return isRight(either) ? Left(either.right) : Right(either.left);
}

/**
 * Get the Right value or a default
 */
export function getOrElse<E, A>(
  either: Either<E, A>,
  defaultValue: (e: E) => A,
): A {
  return isRight(either) ? either.right : defaultValue(either.left);
}

/**
 * Get the Right value or a default (strict version)
 */
export function getOrElseStrict<E, A>(
  either: Either<E, A>,
  defaultValue: A,
): A {
  return isRight(either) ? either.right : defaultValue;
}

/**
 * Get the Right value or throw
 */
export function getOrThrow<E, A>(either: Either<E, A>): A {
  if (isRight(either)) return either.right;
  throw either.left;
}

/**
 * Get the Right value or throw with custom message
 */
export function getOrThrowWith<E, A>(
  either: Either<E, A>,
  toError: (e: E) => Error,
): A {
  if (isRight(either)) return either.right;
  throw toError(either.left);
}

/**
 * Return the first Right, or evaluate the fallback
 */
export function orElse<E, A, E2>(
  either: Either<E, A>,
  fallback: (e: E) => Either<E2, A>,
): Either<E2, A> {
  return isRight(either) ? either : fallback(either.left);
}

/**
 * Filter or else provide an error
 */
export function filterOrElse<E, A>(
  either: Either<E, A>,
  predicate: (a: A) => boolean,
  onFalse: (a: A) => E,
): Either<E, A> {
  return isRight(either)
    ? predicate(either.right)
      ? either
      : Left(onFalse(either.right))
    : either;
}

/**
 * Convert Either to Option (discards the error)
 */
export function toOption<E, A>(either: Either<E, A>): Option<A> {
  return isRight(either) ? Some(either.right) : None;
}

/**
 * Convert Either to Validated
 */
export function toValidated<E, A>(either: Either<E, A>): Validated<E, A> {
  return isRight(either) ? Valid(either.right) : Invalid(either.left);
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
  return isRight(either) ? either.right : either.left;
}

/**
 * Check if the Right value satisfies a predicate
 */
export function exists<E, A>(
  either: Either<E, A>,
  predicate: (a: A) => boolean,
): boolean {
  return isRight(either) && predicate(either.right);
}

/**
 * Check if all Right values satisfy a predicate
 */
export function forall<E, A>(
  either: Either<E, A>,
  predicate: (a: A) => boolean,
): boolean {
  return isLeft(either) || predicate(either.right);
}

/**
 * Check if Either contains a specific Right value
 */
export function contains<E, A>(
  either: Either<E, A>,
  value: A,
  eq: (a: A, b: A) => boolean = (a, b) => a === b,
): boolean {
  return isRight(either) && eq(either.right, value);
}

/**
 * Convert Either to array
 */
export function toArray<E, A>(either: Either<E, A>): A[] {
  return isRight(either) ? [either.right] : [];
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
export function tap<E, A>(
  either: Either<E, A>,
  f: (a: A) => void,
): Either<E, A> {
  if (isRight(either)) {
    f(either.right);
  }
  return either;
}

/**
 * TapLeft - perform a side effect on Left and return the original Either
 */
export function tapLeft<E, A>(
  either: Either<E, A>,
  f: (e: E) => void,
): Either<E, A> {
  if (isLeft(either)) {
    f(either.left);
  }
  return either;
}

/**
 * Handle errors with a recovery function
 */
export function handleError<E, A>(
  either: Either<E, A>,
  f: (e: E) => A,
): Either<never, A> {
  return isRight(either) ? either : Right(f(either.left));
}

/**
 * Handle errors with a recovery function that returns Either
 */
export function handleErrorWith<E, E2, A>(
  either: Either<E, A>,
  f: (e: E) => Either<E2, A>,
): Either<E2, A> {
  return isRight(either) ? either : f(either.left);
}

/**
 * Ensure a condition holds or return an error
 */
export function ensure<E, A>(
  either: Either<E, A>,
  predicate: (a: A) => boolean,
  onFalse: (a: A) => E,
): Either<E, A> {
  return filterOrElse(either, predicate, onFalse);
}

/**
 * Traverse an array with an Either-returning function
 */
export function traverse<E, A, B>(
  arr: A[],
  f: (a: A) => Either<E, B>,
): Either<E, B[]> {
  const results: B[] = [];
  for (const a of arr) {
    const either = f(a);
    if (isLeft(either)) return either;
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
  f: (a: A) => Either<E, B>,
): { lefts: E[]; rights: B[] } {
  const lefts: E[] = [];
  const rights: B[] = [];
  for (const a of arr) {
    const either = f(a);
    if (isLeft(either)) {
      lefts.push(either.left);
    } else {
      rights.push(either.right);
    }
  }
  return { lefts, rights };
}

// ============================================================================
// Typeclass Instances
// ============================================================================

/**
 * Eq instance for Either
 */
export function getEq<E, A>(EE: Eq<E>, EA: Eq<A>): Eq<Either<E, A>> {
  return {
    eqv: (x, y) => {
      if (isLeft(x) && isLeft(y)) return EE.eqv(x.left, y.left);
      if (isRight(x) && isRight(y)) return EA.eqv(x.right, y.right);
      return false;
    },
  };
}

/**
 * Ord instance for Either (Left < Right)
 */
export function getOrd<E, A>(OE: Ord<E>, OA: Ord<A>): Ord<Either<E, A>> {
  return {
    eqv: getEq(OE, OA).eqv,
    compare: (x, y) => {
      if (isLeft(x) && isLeft(y)) return OE.compare(x.left, y.left);
      if (isRight(x) && isRight(y)) return OA.compare(x.right, y.right);
      if (isLeft(x)) return -1 as Ordering;
      return 1 as Ordering;
    },
  };
}

/**
 * Show instance for Either
 */
export function getShow<E, A>(SE: Show<E>, SA: Show<A>): Show<Either<E, A>> {
  return {
    show: (either) =>
      isRight(either)
        ? `Right(${SA.show(either.right)})`
        : `Left(${SE.show(either.left)})`,
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
  f: (a: A) => Either<E, B>,
): (either: Either<E, A>) => Either<E, A & { readonly [K in N]: B }> {
  return (either) =>
    flatMap(either, (a) =>
      map(f(a), (b) => ({ ...a, [name]: b }) as A & { readonly [K in N]: B }),
    );
}

/**
 * Let - bind a non-effectful value
 */
export function let_<N extends string, E, A extends object, B>(
  name: Exclude<N, keyof A>,
  f: (a: A) => B,
): (either: Either<E, A>) => Either<E, A & { readonly [K in N]: B }> {
  return (either) =>
    map(
      either,
      (a) => ({ ...a, [name]: f(a) }) as A & { readonly [K in N]: B },
    );
}

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

  static fromNullable<E, A>(
    value: A | null | undefined,
    onNull: () => E,
  ): EitherImpl<E, A> {
    return new EitherImpl(fromNullable(value, onNull));
  }

  static tryCatch<E, A>(
    f: () => A,
    onError: (error: unknown) => E,
  ): EitherImpl<E, A> {
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

  filterOrElse(
    predicate: (a: A) => boolean,
    onFalse: (a: A) => E,
  ): EitherImpl<E, A> {
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
