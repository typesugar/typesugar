/**
 * @typesugar/fp — Functional Programming for TypeScript
 *
 * Zero-cost FP with implicit extension methods.
 *
 * @example
 * ```typescript
 * // Import constructors and utilities from main package
 * import { Some, None, Right, Left, pipe } from '@typesugar/fp';
 *
 * // Import operation namespaces for extension syntax
 * import * as O from '@typesugar/fp/data/option';
 * import * as E from '@typesugar/fp/data/either';
 *
 * // Extension methods work via namespace imports
 * // x.map(f) → O.map(x, f) when O is in scope
 *
 * const output = pipe(
 *   Some(5),
 *   x => O.map(x, n => n * 2),
 *   x => O.filter(x, n => n > 5),
 *   x => O.getOrElse(x, () => 0)
 * );
 * ```
 */

// ============================================================================
// HKT Foundation
// ============================================================================

export { unsafeCoerce } from "./hkt.js";
export type {
  $,
  Kind,
  OptionF,
  EitherF,
  ListF,
  NonEmptyListF,
  ValidatedF,
  StateF,
  ReaderF,
  WriterF,
  IOF,
  IdF,
  ResourceF,
  Resource,
} from "./hkt.js";

// ============================================================================
// Typeclasses
// ============================================================================

export * as TC from "./typeclasses/index.js";
export type {
  Functor,
  Apply,
  Applicative,
  FlatMap,
  Monad,
  Foldable,
  Traverse,
  SemigroupK,
  MonoidK,
  Alternative,
  Semigroup,
  Monoid,
  Eq,
  Ord,
  Show,
  ApplicativeError,
  MonadError,
  Semigroupal,
} from "./typeclasses/index.js";

// ============================================================================
// Option — Zero-cost (null-based)
// ============================================================================

export type { Option, Defined } from "./data/option.js";
export { Some, None, isSome, isNone, defined, unwrapDefined } from "./data/option.js";
export {
  getEq as getOptionEq,
  getOrd as getOptionOrd,
  getShow as getOptionShow,
  getSemigroup as getOptionSemigroup,
  getMonoid as getOptionMonoid,
  getFirstMonoid as getOptionFirstMonoid,
  getLastMonoid as getOptionLastMonoid,
} from "./data/option.js";

// ============================================================================
// Either — Typed error handling
// ============================================================================

export type { Either } from "./data/either.js";
export { Left, Right, isLeft, isRight } from "./data/either.js";
export {
  getEq as getEitherEq,
  getOrd as getEitherOrd,
  getShow as getEitherShow,
  getSemigroup as getEitherSemigroup,
} from "./data/either.js";

// ============================================================================
// List — Persistent linked list
// ============================================================================

export type { List } from "./data/list.js";
export { Cons, Nil, isCons, isNil } from "./data/list.js";
export {
  of as listOf,
  fromArray as listFromArray,
  getEq as getListEq,
  getOrd as getListOrd,
  getShow as getListShow,
  getSemigroup as getListSemigroup,
  getMonoid as getListMonoid,
} from "./data/list.js";

// ============================================================================
// NonEmptyList — List with at least one element
// ============================================================================

export type { NonEmptyList } from "./data/nonempty-list.js";
export {
  of as nelOf,
  singleton as nelSingleton,
  fromArray as nelFromArray,
  fromList as nelFromList,
  getEq as getNelEq,
  getOrd as getNelOrd,
  getShow as getNelShow,
  getSemigroup as getNelSemigroup,
} from "./data/nonempty-list.js";

// ============================================================================
// Validated — Error accumulation
// ============================================================================

export type { Validated, ValidatedNel } from "./data/validated.js";
export { Valid, Invalid, valid, invalid, validNel, invalidNel, isValid, isInvalid } from "./data/validated.js";
export {
  getEq as getValidatedEq,
  getOrd as getValidatedOrd,
  getShow as getValidatedShow,
  getSemigroup as getValidatedSemigroup,
} from "./data/validated.js";

// ============================================================================
// State — Stateful computation
// ============================================================================

export { State, IndexedState } from "./data/state.js";

// ============================================================================
// Reader — Environment/dependency injection
// ============================================================================

export { Reader, Kleisli } from "./data/reader.js";

// ============================================================================
// Writer — Logging/accumulation
// ============================================================================

export { Writer, LogWriterMonoid, SumWriterMonoid } from "./data/writer.js";
export type { LogWriter, SumWriter, ProductWriter } from "./data/writer.js";

// ============================================================================
// Id — Identity functor
// ============================================================================

export { Id } from "./data/id.js";

// ============================================================================
// IO & Runtime
// ============================================================================

export { IO, runIO, runIOSync, IODo } from "./io/io.js";
export * as Ref from "./io/ref.js";
export * as Deferred from "./io/deferred.js";
export * as ResourceIO from "./io/resource.js";
export * as Console from "./io/console.js";
export * as IOApp from "./io/io-app.js";

// ============================================================================
// Syntax Utilities
// ============================================================================

export * from "./syntax/index.js";

// ============================================================================
// Zero-Cost Abstractions
// ============================================================================

export * as ZeroCost from "./zero-cost/index.js";
export { ZeroCostOptionOps, ZeroCostResultOps } from "./zero-cost/index.js";
export type { ZeroCostOption, ZeroCostResult, ZeroCostOk, ZeroCostErr } from "./zero-cost/index.js";

// ============================================================================
// Typeclass Instances (for explicit usage)
// ============================================================================

export {
  flatMapOption,
  flatMapEither,
  flatMapIO,
  flatMapList,
  flatMapValidated,
  fpFlatMapInstances,
  registerFpFlatMapInstances,
  traverseArray,
  sequenceArray,
  fmap,
  bind,
  applyF,
  foldL,
  optionFunctor,
  optionMonad,
  optionFoldable,
  arrayTraverse,
} from "./instances.js";

// ============================================================================
// Typeclass Laws
// ============================================================================

export * as Laws from "./laws/index.js";
export type {
  Law,
  LawSet,
  LawGenerator,
  ProofHint,
  EqF,
  Arbitrary,
  LawVerificationResult,
  VerifyLawsOptions,
} from "./laws/index.js";
export {
  eqLaws,
  ordLaws,
  semigroupLaws,
  monoidLaws,
  showLaws,
  showLawsWithEq,
  functorLaws,
  functorCompositionLaws,
  applyLaws,
  applicativeLaws,
  flatMapLaws,
  monadLaws,
  monadStackSafetyLaws,
  foldableLaws,
  foldableOrderLaws,
  traverseLaws,
  traverseLawsWithApplicative,
  sequenceLaws,
  semigroupKLaws,
  monoidKLaws,
  alternativeLaws,
  alternativeLawsNonDistributive,
} from "./laws/index.js";
