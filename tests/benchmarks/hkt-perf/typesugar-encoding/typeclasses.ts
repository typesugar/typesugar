/**
 * Typeclasses using typesugar HKT encoding with Apply<>
 *
 * Note: In real typesugar usage, the preprocessor rewrites
 * Apply<OptionF, A> → Option<A> before type-checking.
 */

import type { TypeFunction, Apply, OptionF, ArrayF, EitherF, Option, Either } from "./hkt";
import { Some, None, Left, Right } from "./hkt";

// Functor typeclass - uses Apply<> to get concrete types
export interface Functor<F extends TypeFunction> {
  readonly map: <A, B>(fa: Apply<F, A>, f: (a: A) => B) => Apply<F, B>;
}

// Applicative typeclass
export interface Applicative<F extends TypeFunction> extends Functor<F> {
  readonly pure: <A>(a: A) => Apply<F, A>;
  readonly ap: <A, B>(fab: Apply<F, (a: A) => B>, fa: Apply<F, A>) => Apply<F, B>;
}

// Monad typeclass
export interface Monad<F extends TypeFunction> extends Applicative<F> {
  readonly flatMap: <A, B>(fa: Apply<F, A>, f: (a: A) => Apply<F, B>) => Apply<F, B>;
}

// ============================================================================
// Instances
// ============================================================================

export const optionFunctor: Functor<OptionF> = {
  map: <A, B>(fa: Option<A>, f: (a: A) => B): Option<B> =>
    fa._tag === "Some" ? Some(f(fa.value)) : None,
};

export const optionMonad: Monad<OptionF> = {
  ...optionFunctor,
  pure: <A>(a: A): Option<A> => Some(a),
  ap: <A, B>(fab: Option<(a: A) => B>, fa: Option<A>): Option<B> =>
    fab._tag === "Some" && fa._tag === "Some" ? Some(fab.value(fa.value)) : None,
  flatMap: <A, B>(fa: Option<A>, f: (a: A) => Option<B>): Option<B> =>
    fa._tag === "Some" ? f(fa.value) : None,
};

export const arrayFunctor: Functor<ArrayF> = {
  map: <A, B>(fa: A[], f: (a: A) => B): B[] => fa.map(f),
};

export const arrayMonad: Monad<ArrayF> = {
  ...arrayFunctor,
  pure: <A>(a: A): A[] => [a],
  ap: <A, B>(fab: ((a: A) => B)[], fa: A[]): B[] => fab.flatMap((f) => fa.map(f)),
  flatMap: <A, B>(fa: A[], f: (a: A) => B[]): B[] => fa.flatMap(f),
};

export const eitherFunctor = <E>(): Functor<EitherF<E>> => ({
  map: <A, B>(fa: Either<E, A>, f: (a: A) => B): Either<E, B> =>
    fa._tag === "Right" ? Right(f(fa.right)) : fa,
});

export const eitherMonad = <E>(): Monad<EitherF<E>> => ({
  ...eitherFunctor<E>(),
  pure: <A>(a: A): Either<E, A> => Right(a),
  ap: <A, B>(fab: Either<E, (a: A) => B>, fa: Either<E, A>): Either<E, B> =>
    fab._tag === "Right" && fa._tag === "Right"
      ? Right(fab.right(fa.right))
      : fab._tag === "Left"
        ? fab
        : (fa as Either<E, B>),
  flatMap: <A, B>(fa: Either<E, A>, f: (a: A) => Either<E, B>): Either<E, B> =>
    fa._tag === "Right" ? f(fa.right) : fa,
});
