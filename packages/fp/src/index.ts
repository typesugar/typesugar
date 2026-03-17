/**
 * @typesugar/fp — Functional Programming for TypeScript
 *
 * Zero-cost FP with dot-syntax extension methods via @opaque type macros.
 *
 * @example
 * ```typescript
 * import { Some, None, Right, Left, pipe } from '@typesugar/fp';
 * import type { Option, Either } from '@typesugar/fp';
 *
 * // Dot syntax works directly — no namespace imports needed.
 * // The type rewrite registry resolves methods automatically:
 * //   Some(5).map(f)  →  map(Some(5), f)
 *
 * const output = Some(5)
 *   .map(n => n * 2)
 *   .filter(n => n > 5)
 *   .getOrElse(() => 0);
 *
 * const validated = Right<string, number>(42)
 *   .map(n => n * 2)
 *   .flatMap(n => n > 50 ? Right(n) : Left("too small"));
 * ```
 */

// ============================================================================
// HKT Foundation
// ============================================================================

export { unsafeCoerce } from "./hkt.js";
export type { _, Kind, StateF, ReaderF, WriterF, IOF, IdF, ResourceF, Resource } from "./hkt.js";

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

export type { Option, OptionF, Defined } from "./data/option.js";
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

export type { Either, EitherF } from "./data/either.js";
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

export type { List, ListF } from "./data/list.js";
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

export type { NonEmptyList, NonEmptyListF } from "./data/nonempty-list.js";
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

export type { Validated, ValidatedF, ValidatedNel } from "./data/validated.js";
export {
  Valid,
  Invalid,
  valid,
  invalid,
  validNel,
  invalidNel,
  isValid,
  isInvalid,
} from "./data/validated.js";
export {
  getEq as getValidatedEq,
  getOrd as getValidatedOrd,
  getShow as getValidatedShow,
  getSemigroup as getValidatedSemigroup,
} from "./data/validated.js";

// ============================================================================
// RemoteData — Async data state (PEP-014 Wave 4 example)
// ============================================================================

export type {
  RemoteData,
  RemoteDataF,
  NotAsked,
  Loading,
  Failure,
  Success,
} from "./data/remote-data.js";
export {
  NotAsked as RemoteNotAsked,
  Loading as RemoteLoading,
  Failure as RemoteFailure,
  Success as RemoteSuccess,
  isNotAsked,
  isLoading,
  isFailure,
  isSuccess,
  isComplete,
  isPending,
} from "./data/remote-data.js";
export {
  getEq as getRemoteDataEq,
  getOrd as getRemoteDataOrd,
  getShow as getRemoteDataShow,
} from "./data/remote-data.js";

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
