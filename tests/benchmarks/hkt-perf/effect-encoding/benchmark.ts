/**
 * Type-checking benchmark for Effect-style HKT encoding
 *
 * Uses Effect's TypeLambda + 5-arity Kind encoding.
 * Focus: measuring type-checking cost of the HKT structure.
 */

import type {
  Kind,
  TypeLambda,
  OptionTypeLambda,
  ArrayTypeLambda,
  EitherTypeLambda,
  Option,
  Either,
} from "./hkt";
import { Some, None, Right } from "./hkt";
import type { Functor, Monad, Applicative } from "./typeclasses";
import { optionMonad, arrayMonad } from "./typeclasses";

// ============================================================================
// 1. Concrete Type Applications (exercises Kind resolution)
// ============================================================================

type ConcreteOption = Kind<OptionTypeLambda, unknown, never, never, number>;
type ConcreteArray = Kind<ArrayTypeLambda, unknown, never, never, string>;
type ConcreteEither = Kind<EitherTypeLambda, unknown, Error, never, boolean>;
type NestedOption = Kind<
  OptionTypeLambda,
  unknown,
  never,
  never,
  Kind<OptionTypeLambda, unknown, never, never, number>
>;
type NestedArray = Kind<
  ArrayTypeLambda,
  unknown,
  never,
  never,
  Kind<OptionTypeLambda, unknown, never, never, string>
>;

// Deeply nested types - stress test for type resolution
type Deep1 = Kind<
  OptionTypeLambda,
  unknown,
  never,
  never,
  Kind<
    ArrayTypeLambda,
    unknown,
    never,
    never,
    Kind<EitherTypeLambda, unknown, string, never, number>
  >
>;
type Deep2 = Kind<
  ArrayTypeLambda,
  unknown,
  never,
  never,
  Kind<
    OptionTypeLambda,
    unknown,
    never,
    never,
    Kind<
      ArrayTypeLambda,
      unknown,
      never,
      never,
      Kind<OptionTypeLambda, unknown, never, never, boolean>
    >
  >
>;
type Deep3 = Kind<
  EitherTypeLambda,
  unknown,
  Error,
  never,
  Kind<
    OptionTypeLambda,
    unknown,
    never,
    never,
    Kind<
      ArrayTypeLambda,
      unknown,
      never,
      never,
      Kind<EitherTypeLambda, unknown, string, never, number>
    >
  >
>;

// Extra stress: more deeply nested types
type Deep4 = Kind<
  OptionTypeLambda,
  unknown,
  never,
  never,
  Kind<
    ArrayTypeLambda,
    unknown,
    never,
    never,
    Kind<
      OptionTypeLambda,
      unknown,
      never,
      never,
      Kind<
        ArrayTypeLambda,
        unknown,
        never,
        never,
        Kind<OptionTypeLambda, unknown, never, never, number>
      >
    >
  >
>;

// ============================================================================
// 2. Generic Function Definitions (exercises type variable unification)
// ============================================================================

function map<F extends TypeLambda>(
  F: Functor<F>
): <In, Out2, Out1, A, B>(
  fa: Kind<F, In, Out2, Out1, A>,
  f: (a: A) => B
) => Kind<F, In, Out2, Out1, B> {
  return (fa, f) => F.map(fa, f);
}

function flatMap<F extends TypeLambda>(
  F: Monad<F>
): <In, Out2, Out1, A, B>(
  fa: Kind<F, In, Out2, Out1, A>,
  f: (a: A) => Kind<F, In, Out2, Out1, B>
) => Kind<F, In, Out2, Out1, B> {
  return (fa, f) => F.flatMap(fa, f);
}

function pure<F extends TypeLambda>(F: Monad<F>): <A>(a: A) => Kind<F, unknown, never, never, A> {
  return (a) => F.pure(a);
}

function ap<F extends TypeLambda>(
  F: Applicative<F>
): <In, Out2, Out1, A, B>(
  fab: Kind<F, In, Out2, Out1, (a: A) => B>,
  fa: Kind<F, In, Out2, Out1, A>
) => Kind<F, In, Out2, Out1, B> {
  return (fab, fa) => F.ap(fab, fa);
}

// Derived operations with more type parameters
function map2<F extends TypeLambda>(F: Applicative<F>) {
  return <In, Out2, Out1, A, B, C>(
    fa: Kind<F, In, Out2, Out1, A>,
    fb: Kind<F, In, Out2, Out1, B>,
    f: (a: A, b: B) => C
  ): Kind<F, In, Out2, Out1, C> =>
    F.ap(
      F.map(fa, (a: A) => (b: B) => f(a, b)),
      fb
    );
}

function map3<F extends TypeLambda>(F: Applicative<F>) {
  return <In, Out2, Out1, A, B, C, D>(
    fa: Kind<F, In, Out2, Out1, A>,
    fb: Kind<F, In, Out2, Out1, B>,
    fc: Kind<F, In, Out2, Out1, C>,
    f: (a: A, b: B, c: C) => D
  ): Kind<F, In, Out2, Out1, D> =>
    F.ap(
      F.ap(
        F.map(fa, (a: A) => (b: B) => (c: C) => f(a, b, c)),
        fb
      ),
      fc
    );
}

function map4<F extends TypeLambda>(F: Applicative<F>) {
  return <In, Out2, Out1, A, B, C, D, E>(
    fa: Kind<F, In, Out2, Out1, A>,
    fb: Kind<F, In, Out2, Out1, B>,
    fc: Kind<F, In, Out2, Out1, C>,
    fd: Kind<F, In, Out2, Out1, D>,
    f: (a: A, b: B, c: C, d: D) => E
  ): Kind<F, In, Out2, Out1, E> =>
    F.ap(
      F.ap(
        F.ap(
          F.map(fa, (a: A) => (b: B) => (c: C) => (d: D) => f(a, b, c, d)),
          fb
        ),
        fc
      ),
      fd
    );
}

// ============================================================================
// 3. Deep Pipeline Chains
// ============================================================================

function pipeline1(M: Monad<OptionTypeLambda>) {
  const result = M.flatMap(M.pure(1), (a) =>
    M.flatMap(M.pure(a + 1), (b) =>
      M.flatMap(M.pure(b * 2), (c) => M.flatMap(M.pure(c.toString()), (d) => M.pure(d.length)))
    )
  );
  return result;
}

function pipeline2(M: Monad<ArrayTypeLambda>) {
  const result = M.flatMap(M.pure(1), (a) =>
    M.flatMap([a, a + 1, a + 2], (b) =>
      M.flatMap([b * 2, b * 3], (c) => M.flatMap([c.toString()], (d) => M.pure(d.length)))
    )
  );
  return result;
}

// Longer pipeline
function pipeline3(M: Monad<OptionTypeLambda>) {
  return M.flatMap(M.pure(1), (a) =>
    M.flatMap(M.pure(a + 1), (b) =>
      M.flatMap(M.pure(b + 2), (c) =>
        M.flatMap(M.pure(c + 3), (d) =>
          M.flatMap(M.pure(d + 4), (e) =>
            M.flatMap(M.pure(e + 5), (f) => M.flatMap(M.pure(f + 6), (g) => M.pure(g.toString())))
          )
        )
      )
    )
  );
}

// ============================================================================
// 4. Complex Type Compositions
// ============================================================================

type OptionT<F extends TypeLambda, A> = Kind<F, unknown, never, never, Option<A>>;
type EitherT<F extends TypeLambda, E, A> = Kind<F, unknown, E, never, Either<E, A>>;

function liftOptionT<F extends TypeLambda>(
  F: Functor<F>
): <In, Out2, Out1, A>(fa: Kind<F, In, Out2, Out1, A>) => Kind<F, In, Out2, Out1, Option<A>> {
  return (fa) => F.map(fa, Some);
}

function mapOptionT<F extends TypeLambda>(F: Functor<F>) {
  return <In, Out2, Out1, A, B>(
    fa: Kind<F, In, Out2, Out1, Option<A>>,
    f: (a: A) => B
  ): Kind<F, In, Out2, Out1, Option<B>> =>
    F.map(fa, (opt) => (opt._tag === "Some" ? Some(f(opt.value)) : None));
}

type Kleisli<F extends TypeLambda, In, Out2, Out1, A, B> = (a: A) => Kind<F, In, Out2, Out1, B>;

function compose<F extends TypeLambda>(M: Monad<F>) {
  return <In, Out2, Out1, A, B, C>(
      f: Kleisli<F, In, Out2, Out1, A, B>,
      g: Kleisli<F, In, Out2, Out1, B, C>
    ): Kleisli<F, In, Out2, Out1, A, C> =>
    (a) =>
      M.flatMap(f(a), g);
}

function identity<F extends TypeLambda>(
  M: Monad<F>
): <A>() => Kleisli<F, unknown, never, never, A, A> {
  return () => (a) => M.pure(a);
}

// ============================================================================
// 5. Type-Level Computation
// ============================================================================

type TargetOf<T> =
  T extends Kind<infer _F, infer _In, infer _Out2, infer _Out1, infer A> ? A : never;

type Out2Of<T> =
  T extends Kind<infer _F, infer _In, infer Out2, infer _Out1, infer _A> ? Out2 : never;

// Deep extraction
type DeepTargetOf<T> =
  T extends Kind<infer _F, infer _In, infer _Out2, infer _Out1, infer A>
    ? A extends Kind<infer _G, infer _In2, infer _Out22, infer _Out12, infer B>
      ? DeepTargetOf<Kind<_G, _In2, _Out22, _Out12, B>>
      : A
    : T;

// ============================================================================
// 6. Usage at concrete types
// ============================================================================

const optionValue: Option<number> = Some(42);
const mappedOption = optionMonad.map(optionValue, (x) => x * 2);
const flatMappedOption = optionMonad.flatMap(optionValue, (x) => (x > 0 ? Some(x) : None));

const arrayValue: number[] = [1, 2, 3];
const mappedArray = arrayMonad.map(arrayValue, (x) => x.toString());
const flatMappedArray = arrayMonad.flatMap(arrayValue, (x) => [x, x * 2]);

// Type assertions (compile-time checks)
type _Test1 = TargetOf<Kind<OptionTypeLambda, unknown, never, never, number>>; // number
type _Test2 = TargetOf<Kind<ArrayTypeLambda, unknown, never, never, string>>; // string
type _Test3 = Out2Of<Kind<EitherTypeLambda, unknown, Error, never, boolean>>; // Error
type _Test4 = DeepTargetOf<Deep4>; // number

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
  Deep4,
  OptionT,
  EitherT,
  Kleisli,
  TargetOf,
  Out2Of,
  DeepTargetOf,
};

// Export functions and values
export {
  map,
  flatMap,
  pure,
  ap,
  map2,
  map3,
  map4,
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
};
