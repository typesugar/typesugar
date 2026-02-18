/**
 * Typeclass Instances for Cats Data Types
 *
 * This module provides concrete typeclass instances (Functor, Monad, Foldable,
 * Traverse, etc.) for all Cats data types, using the zero-cost HKT system.
 *
 * ## Zero-Cost Option
 *
 * Option<A> is now represented as `A | null` at runtime:
 * - Some(42) → 42
 * - None → null
 * - No wrapper objects, no tags, truly zero-cost
 *
 * ## HKT and Type Safety
 *
 * TypeScript has a recursive type instantiation limit that triggers when
 * evaluating `Monad<OptionF>`. To work around this while keeping instances
 * type-safe, we use concrete type annotations instead of HKT-parameterized
 * types.
 *
 * The types are manually expanded:
 * - `$<OptionF, A>` → `Option<A>`
 * - `$<ArrayF, A>` → `Array<A>`
 *
 * This gives us full type safety without hitting TypeScript's limits.
 *
 * ## Usage
 *
 * ```typescript
 * import { optionMonad, arrayMonad } from "./instances.js";
 * import { specialize } from "@ttfx/specialize";
 *
 * // Generic function
 * function double<F>(F: Monad<F>, fa: $<F, number>): $<F, number> {
 *   return F.map(fa, x => x * 2);
 * }
 *
 * // Zero-cost specialized version (macro eliminates dictionary at compile time)
 * const doubleOption = specialize(double, optionMonad);
 * // Compiles to: (fa) => fa !== null ? fa * 2 : null
 * ```
 */

import type { $ } from "./hkt.js";
import type { OptionF, ArrayF, PromiseF, EitherF } from "./hkt.js";
import type { Functor } from "./typeclasses/functor.js";
import type { Applicative } from "./typeclasses/applicative.js";
import type { Monad } from "./typeclasses/monad.js";
import { makeMonad } from "./typeclasses/monad.js";
import type { Foldable } from "./typeclasses/foldable.js";
import type { Traverse } from "./typeclasses/traverse.js";
import type { MonadError } from "./typeclasses/monad-error.js";
import type {
  SemigroupK,
  MonoidK,
  Alternative,
} from "./typeclasses/alternative.js";

import type { Option } from "./data/option.js";
// Note: With null-based Option, isSome(opt) = opt !== null, isNone(opt) = opt === null
// Some(x) = x, None = null
import type { Either } from "./data/either.js";
import { Left, Right, isLeft, isRight } from "./data/either.js";

// ============================================================================
// Expanded Type Aliases (to avoid HKT recursion)
// ============================================================================

/**
 * Concrete Functor type for Option (expanded from Functor<OptionF>)
 */
type OptionFunctor = {
  readonly map: <A, B>(fa: Option<A>, f: (a: A) => B) => Option<B>;
};

/**
 * Concrete Monad type for Option (expanded from Monad<OptionF>)
 */
type OptionMonad = {
  readonly map: <A, B>(fa: Option<A>, f: (a: A) => B) => Option<B>;
  readonly flatMap: <A, B>(fa: Option<A>, f: (a: A) => Option<B>) => Option<B>;
  readonly pure: <A>(a: A) => Option<A>;
  readonly ap: <A, B>(fab: Option<(a: A) => B>, fa: Option<A>) => Option<B>;
};

/**
 * Concrete Foldable type for Option (expanded from Foldable<OptionF>)
 */
type OptionFoldable = {
  readonly foldLeft: <A, B>(fa: Option<A>, b: B, f: (b: B, a: A) => B) => B;
  readonly foldRight: <A, B>(fa: Option<A>, b: B, f: (a: A, b: B) => B) => B;
};

/**
 * Concrete Traverse type for Option (expanded from Traverse<OptionF>)
 */
type OptionTraverse = OptionFunctor &
  OptionFoldable & {
    readonly traverse: <G>(
      G: Applicative<G>,
    ) => <A, B>(fa: Option<A>, f: (a: A) => $<G, B>) => $<G, Option<B>>;
  };

/**
 * Concrete SemigroupK type for Option
 */
type OptionSemigroupK = {
  readonly combineK: <A>(x: Option<A>, y: Option<A>) => Option<A>;
};

/**
 * Concrete MonoidK type for Option
 */
type OptionMonoidK = OptionSemigroupK & {
  readonly emptyK: <A>() => Option<A>;
};

/**
 * Concrete Alternative type for Option
 */
type OptionAlternative = OptionMonad & OptionMonoidK;

/**
 * Concrete Functor type for Array (expanded from Functor<ArrayF>)
 */
type ArrayFunctor = {
  readonly map: <A, B>(fa: A[], f: (a: A) => B) => B[];
};

/**
 * Concrete Monad type for Array (expanded from Monad<ArrayF>)
 */
type ArrayMonad = {
  readonly map: <A, B>(fa: A[], f: (a: A) => B) => B[];
  readonly flatMap: <A, B>(fa: A[], f: (a: A) => B[]) => B[];
  readonly pure: <A>(a: A) => A[];
  readonly ap: <A, B>(fab: ((a: A) => B)[], fa: A[]) => B[];
};

/**
 * Concrete Foldable type for Array
 */
type ArrayFoldable = {
  readonly foldLeft: <A, B>(fa: A[], b: B, f: (b: B, a: A) => B) => B;
  readonly foldRight: <A, B>(fa: A[], b: B, f: (a: A, b: B) => B) => B;
};

/**
 * Concrete Traverse type for Array
 */
type ArrayTraverse = ArrayFunctor &
  ArrayFoldable & {
    readonly traverse: <G>(
      G: Applicative<G>,
    ) => <A, B>(fa: A[], f: (a: A) => $<G, B>) => $<G, B[]>;
  };

/**
 * Concrete SemigroupK type for Array
 */
type ArraySemigroupK = {
  readonly combineK: <A>(x: A[], y: A[]) => A[];
};

/**
 * Concrete MonoidK type for Array
 */
type ArrayMonoidK = ArraySemigroupK & {
  readonly emptyK: <A>() => A[];
};

/**
 * Concrete Alternative type for Array
 */
type ArrayAlternative = ArrayMonad & ArrayMonoidK;

/**
 * Concrete Functor type for Promise (expanded from Functor<PromiseF>)
 */
type PromiseFunctor = {
  readonly map: <A, B>(fa: Promise<A>, f: (a: A) => B) => Promise<B>;
};

/**
 * Concrete Monad type for Promise (expanded from Monad<PromiseF>)
 */
type PromiseMonad = {
  readonly map: <A, B>(fa: Promise<A>, f: (a: A) => B) => Promise<B>;
  readonly flatMap: <A, B>(
    fa: Promise<A>,
    f: (a: A) => Promise<B>,
  ) => Promise<B>;
  readonly pure: <A>(a: A) => Promise<A>;
  readonly ap: <A, B>(fab: Promise<(a: A) => B>, fa: Promise<A>) => Promise<B>;
};

/**
 * Concrete Functor type for Either<E, _> (expanded from Functor<EitherF<E>>)
 * Parameterized by error type E.
 */
type EitherFunctor<E> = {
  readonly map: <A, B>(fa: Either<E, A>, f: (a: A) => B) => Either<E, B>;
};

/**
 * Concrete Monad type for Either<E, _> (expanded from Monad<EitherF<E>>)
 */
type EitherMonad<E> = {
  readonly map: <A, B>(fa: Either<E, A>, f: (a: A) => B) => Either<E, B>;
  readonly flatMap: <A, B>(
    fa: Either<E, A>,
    f: (a: A) => Either<E, B>,
  ) => Either<E, B>;
  readonly pure: <A>(a: A) => Either<E, A>;
  readonly ap: <A, B>(
    fab: Either<E, (a: A) => B>,
    fa: Either<E, A>,
  ) => Either<E, B>;
};

/**
 * Concrete MonadError type for Either<E, _> (expanded from MonadError<EitherF<E>, E>)
 */
type EitherMonadError<E> = EitherMonad<E> & {
  readonly raiseError: <A>(e: E) => Either<E, A>;
  readonly handleErrorWith: <A>(
    fa: Either<E, A>,
    f: (e: E) => Either<E, A>,
  ) => Either<E, A>;
};

/**
 * Concrete Foldable type for Either<E, _>
 */
type EitherFoldable<E> = {
  readonly foldLeft: <A, B>(fa: Either<E, A>, b: B, f: (b: B, a: A) => B) => B;
  readonly foldRight: <A, B>(fa: Either<E, A>, b: B, f: (a: A, b: B) => B) => B;
};

/**
 * Concrete Traverse type for Either<E, _>
 */
type EitherTraverse<E> = EitherFunctor<E> &
  EitherFoldable<E> & {
    readonly traverse: <G>(
      G: Applicative<G>,
    ) => <A, B>(fa: Either<E, A>, f: (a: A) => $<G, B>) => $<G, Either<E, B>>;
  };

/**
 * Concrete SemigroupK type for Either<E, _>
 */
type EitherSemigroupK<E> = {
  readonly combineK: <A>(x: Either<E, A>, y: Either<E, A>) => Either<E, A>;
};

// Note: registerInstanceMethods is from @ttfx/specialize package
// For now, registration is done separately in the macro package
// import { registerInstanceMethods } from "@ttfx/specialize";

// ============================================================================
// Option Instances (Zero-Cost: Option<A> = A | null)
// ============================================================================

/**
 * Functor instance for Option
 *
 * With null-based Option, Some(x) is just x and None is null.
 * Uses concrete expanded types to avoid TypeScript's HKT recursion.
 */
export const optionFunctor: OptionFunctor = {
  map: <A, B>(fa: Option<A>, f: (a: A) => B): Option<B> =>
    fa !== null ? f(fa) : null,
};

/**
 * Monad instance for Option
 *
 * Uses concrete expanded types (OptionMonad) instead of Monad<OptionF>
 * to avoid TypeScript's recursive type instantiation limit.
 */
export const optionMonad: OptionMonad = {
  map: optionFunctor.map,
  flatMap: <A, B>(fa: Option<A>, f: (a: A) => Option<B>): Option<B> =>
    fa !== null ? f(fa) : null,
  pure: <A>(a: A): Option<A> => a,
  ap: <A, B>(fab: Option<(a: A) => B>, fa: Option<A>): Option<B> =>
    fab !== null && fa !== null ? fab(fa) : null,
};

/**
 * Foldable instance for Option
 */
export const optionFoldable: OptionFoldable = {
  foldLeft: <A, B>(fa: Option<A>, b: B, f: (b: B, a: A) => B): B =>
    fa !== null ? f(b, fa) : b,
  foldRight: <A, B>(fa: Option<A>, b: B, f: (a: A, b: B) => B): B =>
    fa !== null ? f(fa, b) : b,
};

/**
 * Traverse instance for Option
 */
export const optionTraverse: OptionTraverse = {
  ...optionFunctor,
  ...optionFoldable,
  traverse:
    <G>(G: Applicative<G>) =>
    <A, B>(fa: Option<A>, f: (a: A) => $<G, B>): $<G, Option<B>> => {
      if (fa !== null) {
        return G.map(f(fa), (b: B) => b as Option<B>);
      }
      return G.pure(null as Option<B>);
    },
};

/**
 * SemigroupK instance for Option (first Some wins)
 */
export const optionSemigroupK: OptionSemigroupK = {
  combineK: <A>(x: Option<A>, y: Option<A>): Option<A> => (x !== null ? x : y),
};

/**
 * MonoidK instance for Option
 */
export const optionMonoidK: OptionMonoidK = {
  ...optionSemigroupK,
  emptyK: <A>(): Option<A> => null,
};

/**
 * Alternative instance for Option
 */
export const optionAlternative: OptionAlternative = {
  ...optionMonad,
  ...optionMonoidK,
};

// ============================================================================
// Array Instances
// ============================================================================

/**
 * Functor instance for Array
 */
export const arrayFunctor: ArrayFunctor = {
  map: <A, B>(fa: A[], f: (a: A) => B): B[] => fa.map(f),
};

/**
 * Monad instance for Array
 */
export const arrayMonad: ArrayMonad = {
  map: arrayFunctor.map,
  flatMap: <A, B>(fa: A[], f: (a: A) => B[]): B[] => fa.flatMap(f),
  pure: <A>(a: A): A[] => [a],
  ap: <A, B>(fab: ((a: A) => B)[], fa: A[]): B[] =>
    fab.flatMap((f) => fa.map(f)),
};

/**
 * Foldable instance for Array
 */
export const arrayFoldable: ArrayFoldable = {
  foldLeft: <A, B>(fa: A[], b: B, f: (b: B, a: A) => B): B => fa.reduce(f, b),
  foldRight: <A, B>(fa: A[], b: B, f: (a: A, b: B) => B): B =>
    fa.reduceRight((acc, a) => f(a, acc), b),
};

/**
 * Traverse instance for Array
 */
export const arrayTraverse: ArrayTraverse = {
  ...arrayFunctor,
  ...arrayFoldable,
  traverse:
    <G>(G: Applicative<G>) =>
    <A, B>(fa: A[], f: (a: A) => $<G, B>): $<G, B[]> =>
      fa.reduce(
        (acc: $<G, B[]>, a: A) =>
          G.ap(
            G.map(acc, (bs: B[]) => (b: B) => [...bs, b]),
            f(a),
          ),
        G.pure([] as B[]),
      ),
};

/**
 * SemigroupK instance for Array
 */
export const arraySemigroupK: ArraySemigroupK = {
  combineK: <A>(x: A[], y: A[]): A[] => [...x, ...y],
};

/**
 * MonoidK instance for Array
 */
export const arrayMonoidK: ArrayMonoidK = {
  ...arraySemigroupK,
  emptyK: <A>(): A[] => [],
};

/**
 * Alternative instance for Array
 */
export const arrayAlternative: ArrayAlternative = {
  ...arrayMonad,
  ...arrayMonoidK,
};

// ============================================================================
// Promise Instances
// ============================================================================

/**
 * Functor instance for Promise
 */
export const promiseFunctor: PromiseFunctor = {
  map: <A, B>(fa: Promise<A>, f: (a: A) => B): Promise<B> => fa.then(f),
};

/**
 * Monad instance for Promise
 */
export const promiseMonad: PromiseMonad = {
  map: promiseFunctor.map,
  flatMap: <A, B>(fa: Promise<A>, f: (a: A) => Promise<B>): Promise<B> =>
    fa.then(f),
  pure: <A>(a: A): Promise<A> => Promise.resolve(a),
  ap: <A, B>(fab: Promise<(a: A) => B>, fa: Promise<A>): Promise<B> =>
    fab.then((f) => fa.then((a) => f(a))),
};

// ============================================================================
// Either Instances
// ============================================================================

/**
 * Create a Functor for Either with a fixed error type E.
 * Uses concrete expanded types to avoid TypeScript's HKT recursion.
 */
export function eitherFunctor<E>(): EitherFunctor<E> {
  return {
    map: <A, B>(fa: Either<E, A>, f: (a: A) => B): Either<E, B> =>
      isRight(fa) ? Right(f(fa.right)) : fa,
  };
}

/**
 * Create a Monad for Either with a fixed error type E.
 */
export function eitherMonad<E>(): EitherMonad<E> {
  const functor = eitherFunctor<E>();
  return {
    map: functor.map,
    flatMap: <A, B>(
      fa: Either<E, A>,
      f: (a: A) => Either<E, B>,
    ): Either<E, B> => (isRight(fa) ? f(fa.right) : fa),
    pure: <A>(a: A): Either<E, A> => Right(a),
    ap: <A, B>(fab: Either<E, (a: A) => B>, fa: Either<E, A>): Either<E, B> => {
      if (isLeft(fab)) return fab;
      if (isLeft(fa)) return fa;
      return Right(fab.right(fa.right));
    },
  };
}

/**
 * Create a MonadError for Either with a fixed error type E.
 */
export function eitherMonadError<E>(): EitherMonadError<E> {
  const monad = eitherMonad<E>();
  return {
    ...monad,
    raiseError: <A>(e: E): Either<E, A> => Left(e),
    handleErrorWith: <A>(
      fa: Either<E, A>,
      f: (e: E) => Either<E, A>,
    ): Either<E, A> => (isLeft(fa) ? f(fa.left) : fa),
  };
}

/**
 * Create a Foldable for Either with a fixed error type E.
 */
export function eitherFoldable<E>(): EitherFoldable<E> {
  return {
    foldLeft: <A, B>(fa: Either<E, A>, b: B, f: (b: B, a: A) => B): B =>
      isRight(fa) ? f(b, fa.right) : b,
    foldRight: <A, B>(fa: Either<E, A>, b: B, f: (a: A, b: B) => B): B =>
      isRight(fa) ? f(fa.right, b) : b,
  };
}

/**
 * Create a Traverse for Either with a fixed error type E.
 */
export function eitherTraverse<E>(): EitherTraverse<E> {
  const functor = eitherFunctor<E>();
  const foldable = eitherFoldable<E>();
  return {
    ...functor,
    ...foldable,
    traverse:
      <G>(G: Applicative<G>) =>
      <A, B>(fa: Either<E, A>, f: (a: A) => $<G, B>): $<G, Either<E, B>> => {
        if (isRight(fa)) {
          return G.map(f(fa.right), (b: B) => Right(b));
        }
        return G.pure(fa as Either<E, B>);
      },
  };
}

/**
 * Create a SemigroupK for Either with a fixed error type E.
 */
export function eitherSemigroupK<E>(): EitherSemigroupK<E> {
  return {
    combineK: <A>(x: Either<E, A>, y: Either<E, A>): Either<E, A> =>
      isRight(x) ? x : y,
  };
}

// ============================================================================
// Specialization templates
// ============================================================================
// These templates are used by @ttfx/specialize to inline typeclass
// operations at compile time. They should be registered separately in the
// macro package. See src/macros/specialize.ts for registration.
//
// Option templates (zero-cost null-based):
//   optionFunctor.map:   '(fa, f) => fa !== null ? f(fa) : null'
//   optionMonad.pure:    '(a) => a'
//   optionMonad.flatMap: '(fa, f) => fa !== null ? f(fa) : null'
//   optionMonad.ap:      '(fab, fa) => fab !== null && fa !== null ? fab(fa) : null'
//
// Array templates:
//   arrayFunctor.map:    '(fa, f) => fa.map(f)'
//   arrayMonad.pure:     '(a) => [a]'
//   arrayMonad.flatMap:  '(fa, f) => fa.flatMap(f)'
//
// Either templates:
//   eitherFunctor.map:   '(fa, f) => fa._tag === "Right" ? { _tag: "Right", right: f(fa.right) } : fa'
//   eitherMonad.pure:    '(a) => ({ _tag: "Right", right: a })'
//   eitherMonad.flatMap: '(fa, f) => fa._tag === "Right" ? f(fa.right) : fa'
