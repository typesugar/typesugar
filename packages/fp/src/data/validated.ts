/**
 * Validated Data Type
 *
 * Validated is similar to Either but designed for error accumulation.
 * Unlike Either, Validated does NOT have a Monad instance - it only has Applicative.
 * This allows multiple errors to be accumulated rather than short-circuiting on the first error.
 *
 * ValidatedNel<E, A> = Validated<NonEmptyList<E>, A> is the most common usage.
 */

import type { NonEmptyList } from "./nonempty-list.js";
import * as NEL from "./nonempty-list.js";
import type { Either } from "./either.js";
import {
  Left as EitherLeft,
  Right as EitherRight,
  isRight as isEitherRight,
} from "./either.js";
import type { Option } from "./option.js";
import { Some, None, isSome } from "./option.js";
import type { Eq, Ord, Ordering } from "../typeclasses/eq.js";
import type { Show } from "../typeclasses/show.js";
import type { Semigroup } from "../typeclasses/semigroup.js";

// ============================================================================
// Validated Type Definition
// ============================================================================

/**
 * Validated data type - either Valid (success) or Invalid (errors)
 */
export type Validated<E, A> = Valid<A> | Invalid<E>;

/**
 * Valid variant - represents success
 */
export interface Valid<A> {
  readonly _tag: "Valid";
  readonly value: A;
}

/**
 * Invalid variant - represents accumulated errors
 */
export interface Invalid<E> {
  readonly _tag: "Invalid";
  readonly error: E;
}

/**
 * ValidatedNel - Validated with NonEmptyList of errors
 */
export type ValidatedNel<E, A> = Validated<NonEmptyList<E>, A>;

// ============================================================================
// Constructors
// ============================================================================

/**
 * Create a Valid value
 */
export function Valid<E = never, A = unknown>(value: A): Validated<E, A> {
  return { _tag: "Valid", value };
}

/**
 * Create an Invalid value
 */
export function Invalid<E, A = never>(error: E): Validated<E, A> {
  return { _tag: "Invalid", error };
}

/**
 * Create a Valid value (alias)
 */
export function valid<E = never, A = unknown>(a: A): Validated<E, A> {
  return Valid(a);
}

/**
 * Create an Invalid value (alias)
 */
export function invalid<E, A = never>(e: E): Validated<E, A> {
  return Invalid(e);
}

/**
 * Create a ValidatedNel from a single error
 */
export function invalidNel<E, A = never>(e: E): ValidatedNel<E, A> {
  return Invalid(NEL.singleton(e));
}

/**
 * Create a Valid for ValidatedNel
 */
export function validNel<E = never, A = unknown>(a: A): ValidatedNel<E, A> {
  return Valid(a);
}

/**
 * Create a Validated from a predicate
 */
export function fromPredicate<E, A>(
  value: A,
  predicate: (a: A) => boolean,
  onFalse: (a: A) => E,
): Validated<E, A> {
  return predicate(value) ? Valid(value) : Invalid(onFalse(value));
}

/**
 * Create a ValidatedNel from a predicate
 */
export function fromPredicateNel<E, A>(
  value: A,
  predicate: (a: A) => boolean,
  onFalse: (a: A) => E,
): ValidatedNel<E, A> {
  return predicate(value) ? Valid(value) : invalidNel(onFalse(value));
}

/**
 * Create a Validated from an Either
 */
export function fromEither<E, A>(either: Either<E, A>): Validated<E, A> {
  return isEitherRight(either) ? Valid(either.right) : Invalid(either.left);
}

/**
 * Create a ValidatedNel from an Either
 */
export function fromEitherNel<E, A>(either: Either<E, A>): ValidatedNel<E, A> {
  return isEitherRight(either) ? Valid(either.right) : invalidNel(either.left);
}

/**
 * Create a Validated from an Option
 */
export function fromOption<E, A>(
  opt: Option<A>,
  onNone: () => E,
): Validated<E, A> {
  // With null-based Option, opt IS the value when it's not null
  return isSome(opt) ? Valid(opt) : Invalid(onNone());
}

/**
 * Create a Validated from a try/catch
 */
export function tryCatch<E, A>(
  f: () => A,
  onError: (error: unknown) => E,
): Validated<E, A> {
  try {
    return Valid(f());
  } catch (error) {
    return Invalid(onError(error));
  }
}

/**
 * Pure for Validated - lifts a value into Valid
 */
export function pure<E = never, A = unknown>(a: A): Validated<E, A> {
  return Valid(a);
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if Validated is Valid
 */
export function isValid<E, A>(v: Validated<E, A>): v is Valid<A> {
  return v._tag === "Valid";
}

/**
 * Check if Validated is Invalid
 */
export function isInvalid<E, A>(v: Validated<E, A>): v is Invalid<E> {
  return v._tag === "Invalid";
}

// ============================================================================
// Operations
// ============================================================================

/**
 * Map over the Valid value
 */
export function map<E, A, B>(
  v: Validated<E, A>,
  f: (a: A) => B,
): Validated<E, B> {
  return isValid(v) ? Valid(f(v.value)) : v;
}

/**
 * Map over the Invalid value
 */
export function mapError<E, A, E2>(
  v: Validated<E, A>,
  f: (e: E) => E2,
): Validated<E2, A> {
  return isInvalid(v) ? Invalid(f(v.error)) : v;
}

/**
 * Map over both values
 */
export function bimap<E, A, E2, B>(
  v: Validated<E, A>,
  f: (e: E) => E2,
  g: (a: A) => B,
): Validated<E2, B> {
  return isValid(v) ? Valid(g(v.value)) : Invalid(f(v.error));
}

/**
 * Apply function in Validated to value in Validated (with error accumulation)
 */
export function ap<E, A, B>(
  vf: Validated<E, (a: A) => B>,
  va: Validated<E, A>,
  S: Semigroup<E>,
): Validated<E, B> {
  if (isValid(vf) && isValid(va)) {
    return Valid(vf.value(va.value));
  }
  if (isInvalid(vf) && isInvalid(va)) {
    return Invalid(S.combine(vf.error, va.error));
  }
  if (isInvalid(vf)) {
    return vf;
  }
  return va as Invalid<E>;
}

/**
 * Apply function in ValidatedNel (uses NonEmptyList semigroup)
 */
export function apNel<E, A, B>(
  vf: ValidatedNel<E, (a: A) => B>,
  va: ValidatedNel<E, A>,
): ValidatedNel<E, B> {
  return ap(vf, va, NEL.getSemigroup<E>());
}

/**
 * Combine two Validated values with a function
 */
export function map2<E, A, B, C>(
  va: Validated<E, A>,
  vb: Validated<E, B>,
  f: (a: A, b: B) => C,
  S: Semigroup<E>,
): Validated<E, C> {
  return ap(
    map(va, (a) => (b: B) => f(a, b)),
    vb,
    S,
  );
}

/**
 * Combine two ValidatedNel values with a function
 */
export function map2Nel<E, A, B, C>(
  va: ValidatedNel<E, A>,
  vb: ValidatedNel<E, B>,
  f: (a: A, b: B) => C,
): ValidatedNel<E, C> {
  return map2(va, vb, f, NEL.getSemigroup<E>());
}

/**
 * Combine three Validated values with a function
 */
export function map3<E, A, B, C, D>(
  va: Validated<E, A>,
  vb: Validated<E, B>,
  vc: Validated<E, C>,
  f: (a: A, b: B, c: C) => D,
  S: Semigroup<E>,
): Validated<E, D> {
  return ap(
    map2(va, vb, (a, b) => (c: C) => f(a, b, c), S),
    vc,
    S,
  );
}

/**
 * Combine three ValidatedNel values with a function
 */
export function map3Nel<E, A, B, C, D>(
  va: ValidatedNel<E, A>,
  vb: ValidatedNel<E, B>,
  vc: ValidatedNel<E, C>,
  f: (a: A, b: B, c: C) => D,
): ValidatedNel<E, D> {
  return map3(va, vb, vc, f, NEL.getSemigroup<E>());
}

/**
 * Combine four Validated values with a function
 */
export function map4<E, A, B, C, D, F>(
  va: Validated<E, A>,
  vb: Validated<E, B>,
  vc: Validated<E, C>,
  vd: Validated<E, D>,
  f: (a: A, b: B, c: C, d: D) => F,
  S: Semigroup<E>,
): Validated<E, F> {
  return ap(
    map3(va, vb, vc, (a, b, c) => (d: D) => f(a, b, c, d), S),
    vd,
    S,
  );
}

/**
 * Combine four ValidatedNel values with a function
 */
export function map4Nel<E, A, B, C, D, F>(
  va: ValidatedNel<E, A>,
  vb: ValidatedNel<E, B>,
  vc: ValidatedNel<E, C>,
  vd: ValidatedNel<E, D>,
  f: (a: A, b: B, c: C, d: D) => F,
): ValidatedNel<E, F> {
  return map4(va, vb, vc, vd, f, NEL.getSemigroup<E>());
}

/**
 * Combine five Validated values with a function
 */
export function map5<E, A, B, C, D, F, G>(
  va: Validated<E, A>,
  vb: Validated<E, B>,
  vc: Validated<E, C>,
  vd: Validated<E, D>,
  ve: Validated<E, F>,
  f: (a: A, b: B, c: C, d: D, e: F) => G,
  S: Semigroup<E>,
): Validated<E, G> {
  return ap(
    map4(va, vb, vc, vd, (a, b, c, d) => (e: F) => f(a, b, c, d, e), S),
    ve,
    S,
  );
}

/**
 * Combine five ValidatedNel values with a function
 */
export function map5Nel<E, A, B, C, D, F, G>(
  va: ValidatedNel<E, A>,
  vb: ValidatedNel<E, B>,
  vc: ValidatedNel<E, C>,
  vd: ValidatedNel<E, D>,
  ve: ValidatedNel<E, F>,
  f: (a: A, b: B, c: C, d: D, e: F) => G,
): ValidatedNel<E, G> {
  return map5(va, vb, vc, vd, ve, f, NEL.getSemigroup<E>());
}

/**
 * Fold over Validated
 */
export function fold<E, A, B>(
  v: Validated<E, A>,
  onInvalid: (e: E) => B,
  onValid: (a: A) => B,
): B {
  return isValid(v) ? onValid(v.value) : onInvalid(v.error);
}

/**
 * Match over Validated (alias for fold with object syntax)
 */
export function match<E, A, B>(
  v: Validated<E, A>,
  patterns: { Invalid: (e: E) => B; Valid: (a: A) => B },
): B {
  return isValid(v) ? patterns.Valid(v.value) : patterns.Invalid(v.error);
}

/**
 * Get the Valid value or a default
 */
export function getOrElse<E, A>(
  v: Validated<E, A>,
  defaultValue: (e: E) => A,
): A {
  return isValid(v) ? v.value : defaultValue(v.error);
}

/**
 * Get the Valid value or a default (strict version)
 */
export function getOrElseStrict<E, A>(v: Validated<E, A>, defaultValue: A): A {
  return isValid(v) ? v.value : defaultValue;
}

/**
 * Convert to Either
 */
export function toEither<E, A>(v: Validated<E, A>): Either<E, A> {
  return isValid(v) ? EitherRight(v.value) : EitherLeft(v.error);
}

/**
 * Convert to Option (discards error)
 */
export function toOption<E, A>(v: Validated<E, A>): Option<A> {
  return isValid(v) ? Some(v.value) : None;
}

/**
 * Swap Valid and Invalid
 */
export function swap<E, A>(v: Validated<E, A>): Validated<A, E> {
  return isValid(v) ? Invalid(v.value) : Valid(v.error);
}

/**
 * Chain-like operation (but note: this short-circuits, unlike applicative!)
 * Use this when you need to do validation that depends on previous results.
 */
export function andThen<E, A, B>(
  v: Validated<E, A>,
  f: (a: A) => Validated<E, B>,
): Validated<E, B> {
  return isValid(v) ? f(v.value) : v;
}

/**
 * Ensure a condition holds or add an error
 */
export function ensure<E, A>(
  v: Validated<E, A>,
  predicate: (a: A) => boolean,
  onFalse: (a: A) => E,
  S: Semigroup<E>,
): Validated<E, A> {
  if (isInvalid(v)) return v;
  if (predicate(v.value)) return v;
  return Invalid(onFalse(v.value));
}

/**
 * Ensure for ValidatedNel
 */
export function ensureNel<E, A>(
  v: ValidatedNel<E, A>,
  predicate: (a: A) => boolean,
  onFalse: (a: A) => E,
): ValidatedNel<E, A> {
  if (isInvalid(v)) return v;
  if (predicate(v.value)) return v;
  return invalidNel(onFalse(v.value));
}

/**
 * Combine two Validated values (accumulating errors)
 */
export function combine<E, A>(
  v1: Validated<E, A>,
  v2: Validated<E, A>,
  SA: Semigroup<A>,
  SE: Semigroup<E>,
): Validated<E, A> {
  if (isValid(v1) && isValid(v2)) {
    return Valid(SA.combine(v1.value, v2.value));
  }
  if (isInvalid(v1) && isInvalid(v2)) {
    return Invalid(SE.combine(v1.error, v2.error));
  }
  if (isInvalid(v1)) {
    return v1;
  }
  return v2 as Invalid<E>;
}

/**
 * Traverse an array with a Validated-returning function
 */
export function traverse<E, A, B>(
  arr: A[],
  f: (a: A) => Validated<E, B>,
  S: Semigroup<E>,
): Validated<E, B[]> {
  return arr.reduce(
    (acc: Validated<E, B[]>, a: A) => map2(acc, f(a), (bs, b) => [...bs, b], S),
    Valid([]),
  );
}

/**
 * Traverse with ValidatedNel
 */
export function traverseNel<E, A, B>(
  arr: A[],
  f: (a: A) => ValidatedNel<E, B>,
): ValidatedNel<E, B[]> {
  return traverse(arr, f, NEL.getSemigroup<E>());
}

/**
 * Sequence an array of Validated
 */
export function sequence<E, A>(
  arr: Validated<E, A>[],
  S: Semigroup<E>,
): Validated<E, A[]> {
  return traverse(arr, (v) => v, S);
}

/**
 * Sequence with ValidatedNel
 */
export function sequenceNel<E, A>(
  arr: ValidatedNel<E, A>[],
): ValidatedNel<E, A[]> {
  return sequence(arr, NEL.getSemigroup<E>());
}

// ============================================================================
// Typeclass Instances
// ============================================================================

/**
 * Eq instance for Validated
 */
export function getEq<E, A>(EE: Eq<E>, EA: Eq<A>): Eq<Validated<E, A>> {
  return {
    eqv: (x, y) => {
      if (isValid(x) && isValid(y)) return EA.eqv(x.value, y.value);
      if (isInvalid(x) && isInvalid(y)) return EE.eqv(x.error, y.error);
      return false;
    },
  };
}

/**
 * Ord instance for Validated (Invalid < Valid)
 */
export function getOrd<E, A>(OE: Ord<E>, OA: Ord<A>): Ord<Validated<E, A>> {
  return {
    eqv: getEq(OE, OA).eqv,
    compare: (x, y) => {
      if (isValid(x) && isValid(y)) return OA.compare(x.value, y.value);
      if (isInvalid(x) && isInvalid(y)) return OE.compare(x.error, y.error);
      if (isInvalid(x)) return -1 as Ordering;
      return 1 as Ordering;
    },
  };
}

/**
 * Show instance for Validated
 */
export function getShow<E, A>(SE: Show<E>, SA: Show<A>): Show<Validated<E, A>> {
  return {
    show: (v) =>
      isValid(v)
        ? `Valid(${SA.show(v.value)})`
        : `Invalid(${SE.show(v.error)})`,
  };
}

/**
 * Semigroup instance for Validated
 */
export function getSemigroup<E, A>(
  SE: Semigroup<E>,
  SA: Semigroup<A>,
): Semigroup<Validated<E, A>> {
  return {
    combine: (x, y) => combine(x, y, SA, SE),
  };
}

// ============================================================================
// Namespace with static methods (for convenient mapN syntax)
// ============================================================================

export const Validated = {
  valid,
  invalid,
  validNel,
  invalidNel,
  pure,
  fromPredicate,
  fromPredicateNel,
  fromEither,
  fromEitherNel,
  fromOption,
  tryCatch,
  isValid,
  isInvalid,
  map,
  mapError,
  bimap,
  ap,
  apNel,
  map2,
  map2Nel,
  map3,
  map3Nel,
  map4,
  map4Nel,
  map5,
  map5Nel,
  fold,
  match,
  getOrElse,
  getOrElseStrict,
  toEither,
  toOption,
  swap,
  andThen,
  ensure,
  ensureNel,
  combine,
  traverse,
  traverseNel,
  sequence,
  sequenceNel,

  /**
   * mapN for ValidatedNel - convenience function
   */
  mapN: <E, A extends unknown[], B>(
    ...args: [...{ [K in keyof A]: ValidatedNel<E, A[K]> }, (...args: A) => B]
  ): ValidatedNel<E, B> => {
    const f = args[args.length - 1] as (...args: unknown[]) => B;
    const vs = args.slice(0, -1) as ValidatedNel<E, unknown>[];

    if (vs.length === 0) {
      return Valid(f());
    }
    if (vs.length === 1) {
      return map(vs[0], (a) => f(a)) as ValidatedNel<E, B>;
    }
    if (vs.length === 2) {
      return map2Nel(vs[0], vs[1], (a, b) => f(a, b)) as ValidatedNel<E, B>;
    }
    if (vs.length === 3) {
      return map3Nel(vs[0], vs[1], vs[2], (a, b, c) =>
        f(a, b, c),
      ) as ValidatedNel<E, B>;
    }
    if (vs.length === 4) {
      return map4Nel(vs[0], vs[1], vs[2], vs[3], (a, b, c, d) =>
        f(a, b, c, d),
      ) as ValidatedNel<E, B>;
    }
    if (vs.length === 5) {
      return map5Nel(vs[0], vs[1], vs[2], vs[3], vs[4], (a, b, c, d, e) =>
        f(a, b, c, d, e),
      ) as ValidatedNel<E, B>;
    }

    // For more than 5 arguments, fall back to sequential application
    let result: ValidatedNel<E, unknown[]> = map(vs[0], (a) => [
      a,
    ]) as ValidatedNel<E, unknown[]>;
    for (let i = 1; i < vs.length; i++) {
      result = map2Nel(result, vs[i], (arr, v) => [...arr, v]) as ValidatedNel<
        E,
        unknown[]
      >;
    }
    return map(result, (arr) => f(...arr)) as ValidatedNel<E, B>;
  },
};
