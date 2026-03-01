/**
 * Type-checking benchmark for preprocessed (concrete) code
 *
 * This represents what typesugar compiles to after macro expansion:
 * - No HKT types
 * - Specialized functions instead of generic ones
 * - Direct type references
 *
 * This should be the fastest to type-check (our target performance)
 */

import type { Option, Either } from "./types";
import { Some, None, Left, Right } from "./types";
import {
  optionMap,
  optionFlatMap,
  optionPure,
  optionAp,
  arrayMap,
  arrayFlatMap,
  arrayPure,
  arrayAp,
  eitherMap,
  eitherFlatMap,
  eitherPure,
  eitherAp,
} from "./instances";

// ============================================================================
// 1. Concrete Type Applications (no Kind resolution)
// ============================================================================

type ConcreteOption = Option<number>;
type ConcreteArray = Array<string>;
type ConcreteEither = Either<Error, boolean>;
type NestedOption = Option<Option<number>>;
type NestedArray = Array<Option<string>>;

// Deeply nested types
type Deep1 = Option<Array<Either<string, number>>>;
type Deep2 = Array<Option<Array<Option<boolean>>>>;
type Deep3 = Either<Error, Option<Array<Either<string, number>>>>;

// ============================================================================
// 2. Specialized Function Definitions (no type parameters for F)
// ============================================================================

function map2Option<A, B, C>(fa: Option<A>, fb: Option<B>, f: (a: A, b: B) => C): Option<C> {
  return optionAp(
    optionMap(fa, (a: A) => (b: B) => f(a, b)),
    fb
  );
}

function map3Option<A, B, C, D>(
  fa: Option<A>,
  fb: Option<B>,
  fc: Option<C>,
  f: (a: A, b: B, c: C) => D
): Option<D> {
  return optionAp(
    optionAp(
      optionMap(fa, (a: A) => (b: B) => (c: C) => f(a, b, c)),
      fb
    ),
    fc
  );
}

function map2Array<A, B, C>(fa: A[], fb: B[], f: (a: A, b: B) => C): C[] {
  return arrayAp(
    arrayMap(fa, (a: A) => (b: B) => f(a, b)),
    fb
  );
}

function map3Array<A, B, C, D>(fa: A[], fb: B[], fc: C[], f: (a: A, b: B, c: C) => D): D[] {
  return arrayAp(
    arrayAp(
      arrayMap(fa, (a: A) => (b: B) => (c: C) => f(a, b, c)),
      fb
    ),
    fc
  );
}

function map2Either<E, A, B, C>(
  fa: Either<E, A>,
  fb: Either<E, B>,
  f: (a: A, b: B) => C
): Either<E, C> {
  return eitherAp(
    eitherMap(fa, (a: A) => (b: B) => f(a, b)),
    fb
  );
}

// ============================================================================
// 3. Deep Pipeline Chains
// ============================================================================

function optionPipeline() {
  const result = optionFlatMap(optionPure(1), (a) =>
    optionFlatMap(optionPure(a + 1), (b) =>
      optionFlatMap(optionPure(b * 2), (c) =>
        optionFlatMap(optionPure(c.toString()), (d) => optionPure(d.length))
      )
    )
  );
  return result;
}

function arrayPipeline() {
  const result = arrayFlatMap(arrayPure(1), (a) =>
    arrayFlatMap([a, a + 1, a + 2], (b) =>
      arrayFlatMap([b * 2, b * 3], (c) => arrayFlatMap([c.toString()], (d) => arrayPure(d.length)))
    )
  );
  return result;
}

function eitherPipeline<E>() {
  const result = eitherFlatMap(eitherPure(1) as Either<E, number>, (a) =>
    eitherFlatMap(eitherPure(a + 1) as Either<E, number>, (b) =>
      eitherFlatMap(eitherPure(b * 2) as Either<E, number>, (c) =>
        eitherFlatMap(
          eitherPure(c.toString()) as Either<E, string>,
          (d) => eitherPure(d.length) as Either<E, number>
        )
      )
    )
  );
  return result;
}

// ============================================================================
// 4. Concrete Type Compositions
// ============================================================================

type OptionTArray<A> = Array<Option<A>>;
type OptionTEither<E, A> = Either<E, Option<A>>;
type EitherTArray<E, A> = Array<Either<E, A>>;

function liftOptionTArray<A>(fa: A[]): OptionTArray<A> {
  return arrayMap(fa, Some);
}

function mapOptionTArray<A, B>(fa: OptionTArray<A>, f: (a: A) => B): OptionTArray<B> {
  return arrayMap(fa, (opt) => (opt._tag === "Some" ? Some(f(opt.value)) : None));
}

type OptionKleisli<A, B> = (a: A) => Option<B>;
type ArrayKleisli<A, B> = (a: A) => B[];
type EitherKleisli<E, A, B> = (a: A) => Either<E, B>;

function composeOptionKleisli<A, B, C>(
  f: OptionKleisli<A, B>,
  g: OptionKleisli<B, C>
): OptionKleisli<A, C> {
  return (a) => optionFlatMap(f(a), g);
}

function composeArrayKleisli<A, B, C>(
  f: ArrayKleisli<A, B>,
  g: ArrayKleisli<B, C>
): ArrayKleisli<A, C> {
  return (a) => arrayFlatMap(f(a), g);
}

function composeEitherKleisli<E, A, B, C>(
  f: EitherKleisli<E, A, B>,
  g: EitherKleisli<E, B, C>
): EitherKleisli<E, A, C> {
  return (a) => eitherFlatMap(f(a), g);
}

function identityOptionKleisli<A>(): OptionKleisli<A, A> {
  return (a) => optionPure(a);
}

// ============================================================================
// 5. Type-Level Computation
// ============================================================================

type OptionElement<T> = T extends Option<infer A> ? A : never;
type ArrayElement<T> = T extends Array<infer A> ? A : never;
type EitherRight<T> = T extends Either<infer _E, infer A> ? A : never;

type DeepUnwrap<T> =
  T extends Option<infer A>
    ? DeepUnwrap<A>
    : T extends Array<infer A>
      ? DeepUnwrap<A>
      : T extends Either<infer _E, infer A>
        ? DeepUnwrap<A>
        : T;

// ============================================================================
// 6. Usage at concrete types
// ============================================================================

const optionValue: Option<number> = Some(42);
const mappedOption = optionMap(optionValue, (x) => x * 2);
const flatMappedOption = optionFlatMap(optionValue, (x) => (x > 0 ? Some(x) : None));

const arrayValue: number[] = [1, 2, 3];
const mappedArray = arrayMap(arrayValue, (x) => x.toString());
const flatMappedArray = arrayFlatMap(arrayValue, (x) => [x, x * 2]);

const eitherValue: Either<string, number> = Right(42);
const mappedEither = eitherMap(eitherValue, (x) => x * 2);
const flatMappedEither = eitherFlatMap(eitherValue, (x) => (x > 0 ? Right(x) : Left("negative")));

// ============================================================================
// 7. Specialized sequence/traverse operations
// ============================================================================

function sequenceOptionArray<A>(fga: Array<Option<A>>): Option<A[]> {
  const result: A[] = [];
  for (const opt of fga) {
    if (opt._tag === "None") return None;
    result.push(opt.value);
  }
  return Some(result);
}

function traverseArrayOption<A, B>(fa: A[], f: (a: A) => Option<B>): Option<B[]> {
  const result: B[] = [];
  for (const a of fa) {
    const opt = f(a);
    if (opt._tag === "None") return None;
    result.push(opt.value);
  }
  return Some(result);
}

function sequenceEitherArray<E, A>(fga: Array<Either<E, A>>): Either<E, A[]> {
  const result: A[] = [];
  for (const e of fga) {
    if (e._tag === "Left") return e;
    result.push(e.right);
  }
  return Right(result);
}

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
  OptionTArray,
  OptionTEither,
  EitherTArray,
  OptionKleisli,
  ArrayKleisli,
  EitherKleisli,
  OptionElement,
  ArrayElement,
  EitherRight,
  DeepUnwrap,
};

// Export functions and values
export {
  map2Option,
  map3Option,
  map2Array,
  map3Array,
  map2Either,
  optionPipeline,
  arrayPipeline,
  eitherPipeline,
  liftOptionTArray,
  mapOptionTArray,
  composeOptionKleisli,
  composeArrayKleisli,
  composeEitherKleisli,
  identityOptionKleisli,
  sequenceOptionArray,
  traverseArrayOption,
  sequenceEitherArray,
  mappedOption,
  flatMappedOption,
  mappedArray,
  flatMappedArray,
  mappedEither,
  flatMappedEither,
};
