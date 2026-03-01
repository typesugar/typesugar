/**
 * Type-checking benchmark for typesugar HKT encoding
 *
 * Uses Apply<F, A> to get concrete types from type functions.
 * In production, the preprocessor rewrites this automatically.
 */

import type { TypeFunction, Apply, OptionF, ArrayF, EitherF, Option, Either } from "./hkt";
import { Some, None, Left, Right } from "./hkt";
import type { Functor, Monad, Applicative } from "./typeclasses";
import { optionMonad, arrayMonad, eitherMonad } from "./typeclasses";

// ============================================================================
// 1. Concrete Type Applications via Apply<>
// ============================================================================

type ConcreteOption = Apply<OptionF, number>;
type ConcreteArray = Apply<ArrayF, string>;
type ConcreteEither = Apply<EitherF<Error>, boolean>;
type NestedOption = Apply<OptionF, Apply<OptionF, number>>;
type NestedArray = Apply<ArrayF, Apply<OptionF, string>>;

// Deeply nested types
type Deep1 = Apply<OptionF, Apply<ArrayF, Apply<EitherF<string>, number>>>;
type Deep2 = Apply<ArrayF, Apply<OptionF, Apply<ArrayF, Apply<OptionF, boolean>>>>;
type Deep3 = Apply<EitherF<Error>, Apply<OptionF, Apply<ArrayF, Apply<EitherF<string>, number>>>>;

// ============================================================================
// 2. Generic Function Definitions
// ============================================================================

function map<F extends TypeFunction>(
  F: Functor<F>
): <A, B>(fa: Apply<F, A>, f: (a: A) => B) => Apply<F, B> {
  return (fa, f) => F.map(fa, f);
}

function flatMap<F extends TypeFunction>(
  F: Monad<F>
): <A, B>(fa: Apply<F, A>, f: (a: A) => Apply<F, B>) => Apply<F, B> {
  return (fa, f) => F.flatMap(fa, f);
}

function pure<F extends TypeFunction>(F: Monad<F>): <A>(a: A) => Apply<F, A> {
  return (a) => F.pure(a);
}

function ap<F extends TypeFunction>(
  F: Applicative<F>
): <A, B>(fab: Apply<F, (a: A) => B>, fa: Apply<F, A>) => Apply<F, B> {
  return (fab, fa) => F.ap(fab, fa);
}

// Derived operations
function map2<F extends TypeFunction>(F: Applicative<F>) {
  return <A, B, C>(fa: Apply<F, A>, fb: Apply<F, B>, f: (a: A, b: B) => C): Apply<F, C> =>
    F.ap(
      F.map(fa, (a: A) => (b: B) => f(a, b)),
      fb
    );
}

function map3<F extends TypeFunction>(F: Applicative<F>) {
  return <A, B, C, D>(
    fa: Apply<F, A>,
    fb: Apply<F, B>,
    fc: Apply<F, C>,
    f: (a: A, b: B, c: C) => D
  ): Apply<F, D> =>
    F.ap(
      F.ap(
        F.map(fa, (a: A) => (b: B) => (c: C) => f(a, b, c)),
        fb
      ),
      fc
    );
}

// ============================================================================
// 3. Deep Pipeline Chains
// ============================================================================

function pipeline1(M: Monad<OptionF>) {
  const result = M.flatMap(M.pure(1), (a) =>
    M.flatMap(M.pure(a + 1), (b) =>
      M.flatMap(M.pure(b * 2), (c) => M.flatMap(M.pure(c.toString()), (d) => M.pure(d.length)))
    )
  );
  return result;
}

function pipeline2(M: Monad<ArrayF>) {
  const result = M.flatMap(M.pure(1), (a) =>
    M.flatMap([a, a + 1, a + 2], (b) =>
      M.flatMap([b * 2, b * 3], (c) => M.flatMap([c.toString()], (d) => M.pure(d.length)))
    )
  );
  return result;
}

function pipeline3<E>(M: Monad<EitherF<E>>) {
  const result = M.flatMap(M.pure(1), (a) =>
    M.flatMap(M.pure(a + 1), (b) =>
      M.flatMap(M.pure(b * 2), (c) => M.flatMap(M.pure(c.toString()), (d) => M.pure(d.length)))
    )
  );
  return result;
}

// ============================================================================
// 4. Complex Type Compositions
// ============================================================================

type OptionT<F extends TypeFunction, A> = Apply<F, Option<A>>;
type EitherT<F extends TypeFunction, E, A> = Apply<F, Either<E, A>>;

function liftOptionT<F extends TypeFunction>(F: Functor<F>): <A>(fa: Apply<F, A>) => OptionT<F, A> {
  return (fa) => F.map(fa, Some);
}

function mapOptionT<F extends TypeFunction>(F: Functor<F>) {
  return <A, B>(fa: OptionT<F, A>, f: (a: A) => B): OptionT<F, B> =>
    F.map(fa, (opt) => (opt._tag === "Some" ? Some(f(opt.value)) : None));
}

type Kleisli<F extends TypeFunction, A, B> = (a: A) => Apply<F, B>;

function compose<F extends TypeFunction>(M: Monad<F>) {
  return <A, B, C>(f: Kleisli<F, A, B>, g: Kleisli<F, B, C>): Kleisli<F, A, C> =>
    (a) =>
      M.flatMap(f(a), g);
}

function identity<F extends TypeFunction>(M: Monad<F>): <A>() => Kleisli<F, A, A> {
  return () => (a) => M.pure(a);
}

// ============================================================================
// 5. Type-Level Computation
// ============================================================================

type ElementOf<F extends TypeFunction, T> = T extends Apply<F, infer A> ? A : never;

// ============================================================================
// 6. Usage at concrete types
// ============================================================================

const optionValue: Option<number> = Some(42);
const mappedOption = optionMonad.map(optionValue, (x) => x * 2);
const flatMappedOption = optionMonad.flatMap(optionValue, (x) => (x > 0 ? Some(x) : None));

const arrayValue: number[] = [1, 2, 3];
const mappedArray = arrayMonad.map(arrayValue, (x) => x.toString());
const flatMappedArray = arrayMonad.flatMap(arrayValue, (x) => [x, x * 2]);

const eitherValue: Either<string, number> = Right(42);
const eitherM = eitherMonad<string>();
const mappedEither = eitherM.map(eitherValue, (x) => x * 2);
const flatMappedEither = eitherM.flatMap(eitherValue, (x) => (x > 0 ? Right(x) : Left("negative")));

// Export types
export type {
  ConcreteOption,
  ConcreteArray,
  ConcreteEither,
  NestedOption,
  NestedArray,
  Deep1,
  Deep2,
  Deep3,
  OptionT,
  EitherT,
  Kleisli,
  ElementOf,
};

// Export functions and values
export {
  map,
  flatMap,
  pure,
  ap,
  map2,
  map3,
  pipeline1,
  pipeline2,
  pipeline3,
  liftOptionT,
  mapOptionT,
  compose,
  identity,
  mappedOption,
  flatMappedOption,
  mappedArray,
  flatMappedArray,
  mappedEither,
  flatMappedEither,
};
