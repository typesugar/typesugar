/**
 * Typeclasses using Effect-style HKT encoding
 *
 * Simplified for benchmarking - demonstrates the HKT structure.
 */

import type { Kind, TypeLambda, OptionTypeLambda, ArrayTypeLambda, Option } from "./hkt";
import { Some, None } from "./hkt";

// Functor typeclass with full variance positions
export interface Functor<F extends TypeLambda> {
  readonly map: <In, Out2, Out1, A, B>(
    fa: Kind<F, In, Out2, Out1, A>,
    f: (a: A) => B
  ) => Kind<F, In, Out2, Out1, B>;
}

// Applicative typeclass
export interface Applicative<F extends TypeLambda> extends Functor<F> {
  readonly pure: <A>(a: A) => Kind<F, unknown, never, never, A>;
  readonly ap: <In, Out2, Out1, A, B>(
    fab: Kind<F, In, Out2, Out1, (a: A) => B>,
    fa: Kind<F, In, Out2, Out1, A>
  ) => Kind<F, In, Out2, Out1, B>;
}

// Monad typeclass
export interface Monad<F extends TypeLambda> extends Applicative<F> {
  readonly flatMap: <In, Out2, Out1, A, B>(
    fa: Kind<F, In, Out2, Out1, A>,
    f: (a: A) => Kind<F, In, Out2, Out1, B>
  ) => Kind<F, In, Out2, Out1, B>;
}

// ============================================================================
// Instances - Option and Array only (Either has variance complexity)
// ============================================================================

export const optionFunctor: Functor<OptionTypeLambda> = {
  map: <In, Out2, Out1, A, B>(fa: Option<A>, f: (a: A) => B): Option<B> =>
    fa._tag === "Some" ? Some(f(fa.value)) : None,
};

export const optionMonad: Monad<OptionTypeLambda> = {
  ...optionFunctor,
  pure: <A>(a: A): Option<A> => Some(a),
  ap: <In, Out2, Out1, A, B>(fab: Option<(a: A) => B>, fa: Option<A>): Option<B> =>
    fab._tag === "Some" && fa._tag === "Some" ? Some(fab.value(fa.value)) : None,
  flatMap: <In, Out2, Out1, A, B>(fa: Option<A>, f: (a: A) => Option<B>): Option<B> =>
    fa._tag === "Some" ? f(fa.value) : None,
};

export const arrayFunctor: Functor<ArrayTypeLambda> = {
  map: <In, Out2, Out1, A, B>(fa: A[], f: (a: A) => B): B[] => fa.map(f),
};

export const arrayMonad: Monad<ArrayTypeLambda> = {
  ...arrayFunctor,
  pure: <A>(a: A): A[] => [a],
  ap: <In, Out2, Out1, A, B>(fab: ((a: A) => B)[], fa: A[]): B[] => fab.flatMap((f) => fa.map(f)),
  flatMap: <In, Out2, Out1, A, B>(fa: A[], f: (a: A) => B[]): B[] => fa.flatMap(f),
};
